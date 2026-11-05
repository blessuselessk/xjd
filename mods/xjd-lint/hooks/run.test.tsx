import { expect, test } from 'claude-code/testing'

// The world beneath the mod: a home at /h, and a jdlint that prints whatever
// the test queued last. $.state is the kit's own, so it holds as in a session.

const XJD_TOML = 'watch = ["**"]\n[checkers.jdlint]\nconfig = "jdlint.toml"\nignore = [".git/**"]\n'
const FILES: Record<string, string> = { '/h': '', '/h/xjd.toml': XJD_TOML, '/h/jdlint.toml': '' }

const jdlint = (...files: string[]) =>
  JSON.stringify({
    jdex: null,
    roots: { Documents: { errors: files.map(file => ({ file, type: 'EMPTY_FOLDER' })) } },
  })

const world = (on: any, first: string, { cwd = '/h', env = '/h' } = {}) => {
  const w = { out: first, runs: 0, state: {} as Record<string, any> }

  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  // A test's own $ has no state noun: keep what the mod writes, then let the
  // kit store it as a session would.
  on('state.set', (_: unknown, e: { key: string; value: unknown }, next: any) => {
    w.state[e.key] = e.value

    return next(e).then((value: unknown) => ({ value }))
  })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'XJD_HOME' ? env : undefined }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in FILES }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: FILES[e.path] }))
  on('clock.now', () => ({ value: 1_000 }))
  on('process.run', () => {
    w.runs += 1

    return {
      value: { exitCode: 0, stdout: w.out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  // Nothing beneath the mod draws.
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  // Every tool the test calls does nothing and succeeds.
  on('tool.call', () => ({ result: {} }))

  return w
}

const START = { cwd: '/h', surface: 'terminal', isInteractive: true } as const

test('run: session start checks once, and the first good run is the baseline', async ($, on) => {
  const w = world(on, jdlint('10-19 Life/13 Stuff'))

  await $.session.start(START)

  expect(w.runs).toBe(1)
  expect((w.state.findings).map((f: any) => f.path)).toEqual(['10-19 Life/13 Stuff'])
  expect((w.state.baseline).length).toBe(2)
  expect(w.state.run).toBe('idle')
})

test('run: a Bash call checks again, and what it added is new', async ($, on) => {
  const w = world(on, jdlint('10-19 Life/13 Stuff'))

  await $.session.start(START)
  const baseline = w.state.baseline

  w.out = jdlint('10-19 Life/13 Stuff', 'Stray')
  await $.tool.call({ tool: 'Bash', command: 'mkdir /h/Stray' })

  expect(w.runs).toBe(2)
  expect((w.state.findings).length).toBe(2)
  expect(w.state.baseline).toEqual(baseline)

  const ui = await $.ui.mount({
    plugin: 'xjd-lint',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { bodyColumns: 100, hasSurvey: false },
  })

  expect(await ui.find({ type: 'Text', text: /1 new/ })).toBeTruthy()
  await ui.unmount()
})

test('run: a failed check keeps the last findings and the baseline', async ($, on) => {
  const w = world(on, jdlint('10-19 Life/13 Stuff'))

  await $.session.start(START)
  const findings = w.state.findings
  const baseline = w.state.baseline

  w.out = 'Traceback (most recent call last)'
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(w.state.run).toBe('failed')
  expect(w.state.findings).toEqual(findings)
  expect(w.state.baseline).toEqual(baseline)
  expect(w.state.asOf).toBe(1_000)
})

test('run: a failed first check sets no baseline, the next good one does', async ($, on) => {
  const w = world(on, 'not json')

  await $.session.start(START)
  expect(w.state.baseline).toBe(undefined)

  w.out = jdlint('Stray')
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect((w.state.baseline).length).toBe(1)
})

test('watch: an edit checks again only inside the home and outside the ignore list', async ($, on) => {
  const w = world(on, jdlint())

  await $.session.start(START)

  const edit = (file_path: string) =>
    $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })

  await edit('/elsewhere/notes.md')
  await edit('/h/.git/config')
  await $.tool.call({ tool: 'Read', file_path: '/h/10-19 Life/note.md' })
  expect(w.runs).toBe(1)

  await edit('/h/10-19 Life/note.md')
  await $.tool.call({ tool: 'Write', file_path: '/h/Stray', content: '' })
  expect(w.runs).toBe(3)
})

test('watch: outside an XJD system nothing runs', async ($, on) => {
  const w = world(on, jdlint('Stray'), { cwd: '/elsewhere', env: '' })

  await $.session.start({ ...START, cwd: '/elsewhere' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(w.runs).toBe(0)
  // Never written: setHome skips a write that changes nothing, and unset reads as null.
  expect(w.state.home ?? null).toBe(null)
})
