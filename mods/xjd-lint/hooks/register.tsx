import type { EngineInterface, Register } from 'claude-code'

import type { Finding, Home, Run } from '../types'
import { fingerprint, fixPrompt, freshIn, idsOf, parseJdlint, summarize, time } from './lib/findings'
import { isWatched } from './lib/glob'
import { list, parseToml, table, text } from './lib/toml'

const home = { plugin: 'xjd-lint', key: 'home' } as const
const findings = { plugin: 'xjd-lint', key: 'findings' } as const
const baseline = { plugin: 'xjd-lint', key: 'baseline' } as const
const run = { plugin: 'xjd-lint', key: 'run' } as const
const asOf = { plugin: 'xjd-lint', key: 'asOf' } as const
const isOpen = { plugin: 'xjd-lint', key: 'isOpen' } as const

// The code column fits the longest jdlint code, so rows never shift.
const CODE_COLUMNS = 41
// Below this width the path column goes first.
const PATH_MIN_COLUMNS = 70
const MAX_ROWS = 8

let isRunning = false
let isDirty = false
let lastOk = 0

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// Older engines load the mod but have no $.state, which holds everything here.
// The scan allows $.state only as a call, so try one: a TypeError means none.
const TOO_OLD = 'Needs Claude Code 2.1.287 or later. Update Claude Code, or the desktop app.'
const isTooOld = async ($: EngineInterface): Promise<boolean> => {
  try {
    await $.state.get(home)

    return false
  } catch (err) {
    return err instanceof TypeError
  }
}

// XJD_HOME first, then the nearest parent of the working directory that
// holds an xjd.toml. Nothing found, or no checker config, means out of scope.
const findHome = async ($: EngineInterface): Promise<Home | null> => {
  let dir: string | undefined
  const fromEnv = await $.env.get('XJD_HOME')

  if (fromEnv && fromEnv.startsWith('/') && (await $.fs.exists(fromEnv))) {
    dir = fromEnv.replace(/\/+$/, '')
  } else {
    let at: string = await $.session.cwd()

    while (at !== '') {
      if (await $.fs.exists(`${at}/xjd.toml`)) {
        dir = at
        break
      }

      at = at.slice(0, at.lastIndexOf('/'))
    }
  }

  if (dir === undefined) {
    return null
  }

  const toml = (await $.fs.exists(`${dir}/xjd.toml`))
    ? parseToml(await $.fs.read(`${dir}/xjd.toml`))
    : {}
  const checker = table(toml, 'checkers', 'jdlint')
  const config = text(checker, 'config') ?? 'jdlint.toml'
  const configPath = config.startsWith('/') ? config : `${dir}/${config}`

  if (!(await $.fs.exists(configPath))) {
    return null
  }

  return {
    dir,
    config: configPath,
    watch: list(checker, 'watch') ?? ['**'],
    ignore: list(checker, 'ignore') ?? ['.git/**'],
  }
}

const jdlintPath = async ($: EngineInterface): Promise<string> =>
  (await $.env.get('XJD_JDLINT')) ??
  `${$.plugin.root}/../../vendor/jdlint/jdlint.py`

// A write that changes nothing would still redraw the readers, so each value
// is compared first. One function per value: the scan wants each read to name
// its value outright.
const setHome = async ($: EngineInterface, next: Home | null): Promise<void> => {
  if (JSON.stringify((await $.state.get(home)).value ?? null) !== JSON.stringify(next)) {
    await $.state.set(home, next)
  }
}

const setFindings = async ($: EngineInterface, next: Finding[]): Promise<void> => {
  if (fingerprint((await $.state.get(findings)).value ?? []) !== fingerprint(next)) {
    await $.state.set(findings, next)
  }
}

const setRun = async ($: EngineInterface, next: Run): Promise<void> => {
  if (((await $.state.get(run)).value ?? 'idle') !== next) {
    await $.state.set(run, next)
  }
}

const setAsOf = async ($: EngineInterface, next: number): Promise<void> => {
  if (((await $.state.get(asOf)).value ?? 0) !== next) {
    await $.state.set(asOf, next)
  }
}

// One run at a time. A change that lands during a run asks for one more.
const lint = async ($: EngineInterface): Promise<void> => {
  const where = (await $.state.get(home)).value ?? null

  if (where === null) {
    return
  }

  if (isRunning) {
    isDirty = true

    return
  }

  isRunning = true

  try {
    do {
      isDirty = false

      // Show the placeholder rows only for the first run, so later runs
      // do not blink the band.
      if (lastOk === 0) {
        await setRun($, 'checking')
      }

      try {
        const out = await $.process.run(
          ['python3', await jdlintPath($), '-c', where.config, '--json'],
          { cwd: where.dir, timeoutMs: 30000 },
        )
        const found = await parseJdlint(out.stdout)

        lastOk = await $.clock.now()

        // Every Bash command runs this, so "new" is since the session's first
        // good run, not since the last one, or it would vanish at once.
        if ((await $.state.get(baseline)).value === undefined) {
          await $.state.set(baseline, idsOf(found))
        }

        await setFindings($, found)
        await setRun($, 'idle')
      } catch {
        // Keep the last rows. The band dims them and shows their age.
        await setAsOf($, lastOk)
        await setRun($, 'failed')
      }
    } while (isDirty)
  } finally {
    isRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'xjd',
      description: 'Show or hide the XJD lint problems',
    })

    if (await isTooOld($)) {
      // The host shows a hook's error by the prompt. Here that is the message.
      throw new Error(TOO_OLD)
    }

    await setHome($, await findHome($))
    await lint($)

    return next(e)
  })

  on('command.run', { command: 'xjd' }, async $ => {
    if (await isTooOld($)) {
      return { text: TOO_OLD }
    }

    const open = !((await $.state.get(isOpen)).value ?? false)
    await $.state.set(isOpen, open)
    const found = (await $.state.get(findings)).value ?? []

    return { text: found.length === 0 ? 'No problems.' : `${found.length} problems.` }
  })

  // After a tool that may have changed files in the system, check again.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (await isTooOld($)) {
      return ran
    }

    const where = (await $.state.get(home)).value ?? null

    if (where === null) {
      return ran
    }

    const tool = String(e.tool)
    const file = (e as { file_path?: unknown }).file_path
    const isChange =
      tool === 'Bash' ||
      (FILE_TOOLS.has(tool) &&
        typeof file === 'string' &&
        isWatched(where.dir, file, where.watch, where.ignore))

    // The tool has already run. A broken check must not lose its result.
    if (isChange) {
      await lint($).catch(() => setRun($, 'failed').catch(() => {}))
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (await isTooOld($)) {
      return next(e)
    }

    const where = (await $.state.get(home)).value ?? null
    const found = (await $.state.get(findings)).value ?? []
    const status = (await $.state.get(run)).value ?? 'idle'

    if (e.props.hasSurvey || where === null) {
      return next(e)
    }

    const isFailed = status === 'failed'
    const isChecking = status === 'checking'

    if (found.length === 0 && !isFailed && !isChecking) {
      return next(e)
    }

    const open = (await $.state.get(isOpen)).value ?? false
    const age = isFailed ? ((await $.state.get(asOf)).value ?? 0) : 0
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns ?? 100
    const hasPath = columns >= PATH_MIN_COLUMNS
    const sum = summarize(found)
    const fresh = freshIn(found, (await $.state.get(baseline)).value)

    const bar = (children: unknown) => (
      <Box flexDirection="row" gap={2}>
        {children}
      </Box>
    )

    const dot = (f: Finding) => (
      <Box width={1}>
        <Text color={f.severity === 'error' ? 'error' : 'warning'}>●</Text>
      </Box>
    )

    const strip = bar(
      <Box flexDirection="row" gap={2} flexGrow={1}>
        {isChecking ? (
          <Text dimColor>checking</Text>
        ) : (
          <Text wrap="truncate">
            {sum.errors} {sum.errors === 1 ? 'error' : 'errors'}
          </Text>
        )}
        {sum.warnings > 0 && (
          <Text dimColor wrap="truncate">
            {sum.warnings} {sum.warnings === 1 ? 'warning' : 'warnings'}
          </Text>
        )}
        {fresh.size > 0 && <Text wrap="truncate">· {fresh.size} new</Text>}
        {hasPath && (
          <Text dimColor wrap="truncate-end">
            {sum.lead}
          </Text>
        )}
        <Box flexGrow={1} />
        <Button key="fix" plain dimColor onPress={() => $.prompt.fill({ text: fixPrompt(found) })}>
          fix
        </Button>
        <Button key="details" plain dimColor onPress={() => $.state.set(isOpen, true)}>
          details
        </Button>
      </Box>,
    )

    const rows = found.slice(0, MAX_ROWS).map((f, i) => (
      <Box key={`${f.code}:${f.path}:${i}`} flexDirection="row" gap={1}>
        {dot(f)}
        <Box width={CODE_COLUMNS}>
          <Text dimColor={isFailed} wrap="truncate-end">
            {f.code}
          </Text>
        </Box>
        {hasPath && (
          <Box flexGrow={1}>
            <Text dimColor wrap="truncate-start">
              {f.path}
            </Text>
          </Box>
        )}
        {fresh.has(f.id) && <Text bold>new</Text>}
      </Box>
    ))

    const placeholders = [0, 1, 2].map(i => (
      <Box key={`ph${i}`} flexDirection="row" gap={1}>
        <Box width={1}>
          <Text dimColor>●</Text>
        </Box>
        <Box width={CODE_COLUMNS}>
          <Text dimColor>————————————</Text>
        </Box>
        {hasPath && (
          <Box flexGrow={1}>
            <Text dimColor>——————————————</Text>
          </Box>
        )}
      </Box>
    ))

    const detail = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text bold>Problems</Text>
          {(isChecking || found.length > 0) && (
            <Text dimColor>{isChecking ? '—' : found.length}</Text>
          )}
          {isFailed && age > 0 && <Text dimColor>as of {time(age)}</Text>}
          <Box flexGrow={1} />
          <Text dimColor>auto-fix off</Text>
          {found.length > 0 && (
            <Button key="fix" plain dimColor onPress={() => $.prompt.fill({ text: fixPrompt(found) })}>
              fix
            </Button>
          )}
          <Button key="hide" plain dimColor onPress={() => $.state.set(isOpen, false)}>
            hide
          </Button>
        </Box>
        {isChecking ? placeholders : rows}
        {found.length > MAX_ROWS && (
          <Text dimColor>+{found.length - MAX_ROWS} more</Text>
        )}
        {isFailed && (
          <Text dimColor>Couldn't run jdlint. Trying again on the next change.</Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {below}
        {open || found.length === 0 ? detail : strip}
      </Box>
    )
  })

  // The count in the footer, before the mode labels by the model name. It
  // opens and closes the list, as /xjd does.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (await isTooOld($)) {
      return next(e)
    }

    const where = (await $.state.get(home)).value ?? null
    const found = (await $.state.get(findings)).value ?? []
    const status = (await $.state.get(run)).value ?? 'idle'
    const isChecking = status === 'checking'

    if (where === null || (found.length === 0 && !isChecking)) {
      return next(e)
    }

    const open = (await $.state.get(isOpen)).value ?? false
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const sum = summarize(found)
    const isDim = isChecking || status === 'failed'
    const label = isChecking
      ? '…'
      : sum.errors > 0
        ? `${sum.errors} ${sum.errors === 1 ? 'error' : 'errors'}`
        : `${sum.warnings} ${sum.warnings === 1 ? 'warning' : 'warnings'}`

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor={isDim} color={sum.errors > 0 ? 'error' : 'warning'}>
          ●
        </Text>
        <Button key="count" plain dimColor={isDim} onPress={() => $.state.set(isOpen, !open)}>
          {label}
        </Button>
        {below}
      </Box>
    )
  })
}
