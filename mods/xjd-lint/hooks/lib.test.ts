import { expect, test } from 'claude-code/testing'

import { fixPrompt, parseJdlint, summarize } from './lib/findings'
import { globToRegExp, isWatched, matches } from './lib/glob'
import { list, parseToml, table, text } from './lib/toml'

// Taken from a real `jdlint.py --json` run over fixtures/home.
const REAL = JSON.stringify({
  jdex: null,
  roots: {
    Documents: {
      errors: [
        { file: 'Stray', type: 'ARBITRARY_CONTENT_WHERE_NOT_ALLOWED', possible_formats: [] },
        {
          file: '10-19 Life/11 Me/11.11 Dup',
          files: ['10-19 Life/11 Me/11.11 Dup', '10-19 Life/11 Me/11.11 Me'],
          id: '11.11',
          type: 'DUPLICATE_ID',
        },
        { file: '10-19 Life/13 Stuff', type: 'EMPTY_FOLDER' },
      ],
      path: '.',
      structure: {},
    },
  },
  system: null,
  ignored_errs: 0,
})

test('jdlint output becomes findings in the spec shape', () => {
  const found = parseJdlint(REAL)

  expect(found.length).toBe(3)
  expect(found[1]).toEqual({
    source: 'jdlint',
    code: 'DUPLICATE_ID',
    path: '10-19 Life/11 Me/11.11 Dup',
    message: 'the ID is used more than once',
    severity: 'error',
  })
})

test('jdex errors are read too', () => {
  const found = parseJdlint(
    JSON.stringify({
      roots: {},
      jdex: { errors: [{ file: 'jdex.md', type: 'JDEX_ORPHAN' }] },
    }),
  )

  expect(found.map(f => f.code)).toEqual(['JDEX_ORPHAN'])
  expect(found[0].message).toBe('jdex orphan')
})

test('output that is not jdlint JSON throws, so it reads as a failed run', () => {
  expect(() => parseJdlint('Traceback (most recent call last)')).toThrow()
  expect(() => parseJdlint('{"hello": 1}')).toThrow()
})

test('a clean system has no findings', () => {
  expect(parseJdlint('{"jdex":null,"roots":{"D":{"errors":[],"path":"."}}}')).toEqual([])
})

test('the strip summary leads with the first error and counts the rest', () => {
  const sum = summarize(parseJdlint(REAL))

  expect(sum).toEqual({ errors: 3, warnings: 0, lead: 'ARBITRARY_CONTENT_WHERE_NOT_ALLOWED +2' })
})

test('the fix prompt names each problem and asks for a re-check', () => {
  const prompt = fixPrompt(parseJdlint(REAL))

  expect(prompt).toContain('- EMPTY_FOLDER at "10-19 Life/13 Stuff": the folder is empty')
  expect(prompt).toContain('run jdlint again')
})

test('xjd.toml: tables, strings, arrays, comments', () => {
  const toml = parseToml(`
name = "Costa" # the system
[checkers.jdlint]
config = "jdlint.toml"
watch = ["**", "a/*.md"]
ignore = [".git/**"]
`)

  expect(text(toml, 'name')).toBe('Costa')
  const checker = table(toml, 'checkers', 'jdlint')
  expect(text(checker, 'config')).toBe('jdlint.toml')
  expect(list(checker, 'watch')).toEqual(['**', 'a/*.md'])
  expect(list(checker, 'ignore')).toEqual(['.git/**'])
  expect(table(toml, 'checkers', 'nope')).toBe(undefined)
})

test('xjd.toml: a hash inside a string is not a comment, unknown lines are skipped', () => {
  const toml = parseToml('name = "a # b"\nweird = {x = 1}\nok = true')

  expect(text(toml, 'name')).toBe('a # b')
  expect(toml.weird).toBe(undefined)
  expect(toml.ok).toBe(true)
})

test('globs: ** crosses folders, * does not', () => {
  expect(globToRegExp('**').test('10-19 Life/11 Me/x')).toBe(true)
  expect(globToRegExp('*.md').test('a/b.md')).toBe(false)
  expect(globToRegExp('**/*.md').test('a/b.md')).toBe(true)
  expect(globToRegExp('**/*.md').test('b.md')).toBe(true)
  expect(globToRegExp('.git/**').test('.git/HEAD')).toBe(true)
  expect(matches(['20-29*/**'], '20-29 Clients/21 Acme/x')).toBe(true)
})

test('a file counts only inside the home, in the watch list, outside the ignore list', () => {
  const watch = ['**']
  const ignore = ['.git/**']

  expect(isWatched('/h', '/h/10-19 Life/x', watch, ignore)).toBe(true)
  expect(isWatched('/h', '/h/.git/HEAD', watch, ignore)).toBe(false)
  expect(isWatched('/h', '/elsewhere/x', watch, ignore)).toBe(false)
  expect(isWatched('/h', '/hx/y', watch, ignore)).toBe(false)
})
