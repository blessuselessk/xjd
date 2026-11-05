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

type Raw = { file?: unknown; files?: unknown; id?: unknown; type?: unknown }
type Draft = Omit<Finding, 'id' | 'alias'> & { root: string; number?: string }

// shortcut: plain Johnny Decimal numbers only, a custom format anchors on its
// path and so loses rename protection; widen this if a system needs it.
const JD_NUMBER = /^(\d\d-\d\d|\d\d\.\d\d|\d\d)(?=\s|$)/

const toDraft = (raw: Raw, root: string): Draft | undefined => {
  if (typeof raw.type !== 'string') {
    return undefined
  }

  const path = typeof raw.file === 'string' ? raw.file : ''
  // DUPLICATE_ID names one folder as `file` and every copy in `files`.
  const others = Array.isArray(raw.files)
    ? raw.files.filter((f): f is string => typeof f === 'string' && f !== path)
    : []

  return {
    root,
    number: typeof raw.id === 'string' ? raw.id : path.split('/').pop()?.match(JD_NUMBER)?.[1],
    source: SOURCE,
    code: raw.type,
    path,
    message:
      others.length > 0
        ? `${describe(raw.type)} (also ${others.map(f => `"${f}"`).join(', ')})`
        : describe(raw.type),
    severity: 'error',
  }
}

const keyOf = (d: Draft, anchor: string): string =>
  [d.source, d.root, d.code, anchor].join('\0')

const hash = async (key: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// The number is the ID's anchor, so a rename keeps it. Findings sharing a number
// are told apart by path, and the other hash stays as `alias`, since the ID
// flips when one of them is fixed.
const withIds = async (drafts: Draft[]): Promise<Finding[]> => {
  const uses = new Map<string, number>()

  for (const d of drafts) {
    const key = keyOf(d, d.number ?? d.path)

    uses.set(key, (uses.get(key) ?? 0) + 1)
  }

  return Promise.all(
    drafts.map(async d => {
      const { root, number, ...finding } = d
      const byPath = await hash(keyOf(d, d.path))

      if (number === undefined) {
        return { id: byPath, ...finding }
      }

      const byNumber = await hash(keyOf(d, number))

      return (uses.get(keyOf(d, number)) ?? 0) > 1
        ? { id: byPath, alias: byNumber, ...finding }
        : { id: byNumber, alias: byPath, ...finding }
    }),
  )
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
export const parseJdlint = async (stdout: string): Promise<Finding[]> => {
  const json: unknown = JSON.parse(stdout)

  if (typeof json !== 'object' || json === null || !('roots' in json)) {
    throw new Error('jdlint output has no roots')
  }

  const { roots, jdex } = json as { roots: unknown; jdex?: unknown }
  const named = typeof roots === 'object' && roots !== null ? Object.entries(roots) : []
  const raws = named.flatMap(([name, root]) =>
    errorsOf(root).map(raw => toDraft(raw, named.length > 1 ? name : '')),
  )

  raws.push(...errorsOf(jdex).map(raw => toDraft(raw, '')))

  return withIds(raws.filter(d => d !== undefined))
}

// Everything a run's findings are known by: what later runs are compared with.
export const idsOf = (findings: readonly Finding[]): string[] =>
  findings.flatMap(f => (f.alias ? [f.id, f.alias] : [f.id]))

// No baseline yet means nothing to compare with, so nothing is new.
export const freshIn = (
  findings: readonly Finding[],
  baseline: readonly string[] | undefined,
): Set<string> =>
  new Set(baseline ? findings.map(f => f.id).filter(id => !baseline.includes(id)) : [])

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
