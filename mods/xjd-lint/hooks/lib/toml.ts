// A reader for the small part of TOML that xjd.toml uses: [tables],
// "strings", true/false, numbers and one-line arrays of strings. Anything else
// on a line is skipped. Unknown keys are the caller's to ignore.

export type TomlValue = string | number | boolean | string[]
export type Toml = { [key: string]: TomlValue | Toml }

const unquote = (raw: string): string =>
  raw.slice(1, -1).replace(/\\(["\\])/g, '$1')

const value = (raw: string): TomlValue | undefined => {
  const text = raw.trim()

  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    return unquote(text)
  }

  if (text === 'true' || text === 'false') {
    return text === 'true'
  }

  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text)
  }

  if (text.startsWith('[') && text.endsWith(']')) {
    const items = text.slice(1, -1).match(/"(?:[^"\\]|\\.)*"/g) ?? []

    return items.map(unquote)
  }

  return undefined
}

// A "#" starts a comment unless it sits inside a string.
const stripComment = (line: string): string => {
  let isInString = false

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]

    if (c === '\\' && isInString) {
      i += 1
    } else if (c === '"') {
      isInString = !isInString
    } else if (c === '#' && !isInString) {
      return line.slice(0, i)
    }
  }

  return line
}

export const parseToml = (text: string): Toml => {
  const root: Toml = {}
  let table: Toml = root

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()

    if (line === '') {
      continue
    }

    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)

    if (header) {
      table = root

      for (const name of header[1].split('.')) {
        const next = table[name]

        if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
          table = next
        } else {
          const made: Toml = {}
          table[name] = made
          table = made
        }
      }

      continue
    }

    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)

    if (pair) {
      const parsed = value(pair[2])

      if (parsed !== undefined) {
        table[pair[1]] = parsed
      }
    }
  }

  return root
}

export const table = (toml: Toml, ...path: string[]): Toml | undefined => {
  let at: TomlValue | Toml | undefined = toml

  for (const name of path) {
    if (typeof at !== 'object' || at === null || Array.isArray(at)) {
      return undefined
    }

    at = at[name]
  }

  return typeof at === 'object' && at !== null && !Array.isArray(at)
    ? at
    : undefined
}

export const text = (from: Toml | undefined, key: string): string | undefined => {
  const v = from?.[key]

  return typeof v === 'string' ? v : undefined
}

export const list = (from: Toml | undefined, key: string): string[] | undefined => {
  const v = from?.[key]

  return Array.isArray(v) ? v : undefined
}
