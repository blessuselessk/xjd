import type { Finding } from '../../types'

const SOURCE = 'jdlint'

// jdlint prints a name and a path and nothing else. These are the plain
// sentences for the codes whose README entry is clear; any other code gets its
// name in lower case. jdlint calls every one of these an error.
const MESSAGES: Record<string, string> = {
  ARBITRARY_CONTENT_WHERE_NOT_ALLOWED: 'does not match any allowed format',
  DUPLICATE_ID: 'the ID is used more than once',
  EMPTY_FOLDER: 'the folder is empty',
  ENCOUNTERED_FORBIDDEN_FOLDER: 'the folder name is not allowed',
  FILE_WHERE_FOLDER_EXPECTED: 'a file is here where a folder is expected',
  FOLDER_SHOULD_BE_EMPTY: 'the folder should be empty',
  ID_DIFFERENT_FROM_JDEX: 'the ID differs from the JDex',
  ID_NOT_IN_JDEX: 'the ID is not in the JDex',
}

const describe = (code: string): string =>
  MESSAGES[code] ?? code.toLowerCase().replace(/_/g, ' ')

type Raw = { file?: unknown; type?: unknown }

const toFinding = (raw: Raw): Finding | undefined => {
  if (typeof raw.type !== 'string') {
    return undefined
  }

  return {
    source: SOURCE,
    code: raw.type,
    path: typeof raw.file === 'string' ? raw.file : '',
    message: describe(raw.type),
    severity: 'error',
  }
}

const errorsOf = (from: unknown): Raw[] => {
  if (typeof from !== 'object' || from === null) {
    return []
  }

  const errors = (from as { errors?: unknown }).errors

  return Array.isArray(errors) ? (errors as Raw[]) : []
}

// Turns what `jdlint.py --json` printed into findings. Throws when the text is
// not JSON or has none of the shape, so the caller can tell a failed run from
// a clean one.
export const parseJdlint = (stdout: string): Finding[] => {
  const json: unknown = JSON.parse(stdout)

  if (typeof json !== 'object' || json === null || !('roots' in json)) {
    throw new Error('jdlint output has no roots')
  }

  const { roots, jdex } = json as { roots: unknown; jdex?: unknown }
  const raws: Raw[] = []

  if (typeof roots === 'object' && roots !== null) {
    for (const root of Object.values(roots)) {
      raws.push(...errorsOf(root))
    }
  }

  raws.push(...errorsOf(jdex))

  return raws.flatMap(raw => {
    const finding = toFinding(raw)

    return finding ? [finding] : []
  })
}

// A change worth a redraw is a change in this string.
export const fingerprint = (findings: readonly Finding[]): string =>
  JSON.stringify(findings)

export type Summary = { errors: number; warnings: number; lead: string }

export const summarize = (findings: readonly Finding[]): Summary => {
  const errors = findings.filter(f => f.severity === 'error')
  const first = errors[0] ?? findings[0]
  const rest = findings.length - 1

  return {
    errors: errors.length,
    warnings: findings.length - errors.length,
    lead: first ? (rest > 0 ? `${first.code} +${rest}` : first.code) : '',
  }
}

// The text put in the prompt box when the person presses fix. They read it and
// send it.
export const fixPrompt = (findings: readonly Finding[]): string => {
  const lines = findings.map(
    f => `- ${f.code}${f.path ? ` at "${f.path}"` : ''}: ${f.message}`,
  )

  return [
    'jdlint found these problems in the XJD system. Fix them, then run jdlint again to check.',
    ...lines,
  ].join('\n')
}

export const time = (ms: number): string => {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')

  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
