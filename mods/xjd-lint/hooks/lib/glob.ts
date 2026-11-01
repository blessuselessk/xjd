// Globs for the watch and ignore lists. "**" crosses folders, "*" and "?" do
// not. Paths are relative to the home and use "/".

const escape = (c: string): string => c.replace(/[.+^${}()|[\]\\]/g, '\\$&')

export const globToRegExp = (glob: string): RegExp => {
  let out = ''

  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]

    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') {
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += escape(c)
    }
  }

  return new RegExp(`^${out}$`)
}

export const matches = (globs: readonly string[], path: string): boolean =>
  globs.some(glob => globToRegExp(glob).test(path))

// The path of a file inside the home, or undefined when it lies outside.
export const relativeTo = (home: string, file: string): string | undefined => {
  const base = home.endsWith('/') ? home : `${home}/`

  return file.startsWith(base) ? file.slice(base.length) : undefined
}

// Should a change to this file start a lint run?
export const isWatched = (
  home: string,
  file: string,
  watch: readonly string[],
  ignore: readonly string[],
): boolean => {
  const rel = relativeTo(home, file)

  return rel !== undefined && matches(watch, rel) && !matches(ignore, rel)
}
