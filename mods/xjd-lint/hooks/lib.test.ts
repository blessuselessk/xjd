import { expect, test } from 'claude-code/testing'

import { freshIn, fixPrompt, idsOf, parseJdlint, summarize } from './lib/findings'
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

test('jdlint output becomes findings in the spec shape', async () => {
  const found = await parseJdlint(REAL)

  expect(found.length).toBe(3)
  expect(found[1]).toEqual({
    id: 'bc8131b8769eae02f4abd9c74ad38ff9',
    alias: found[1].alias,
    source: 'jdlint',
    code: 'DUPLICATE_ID',
    path: '10-19 Life/11 Me/11.11 Dup',
    message: 'the ID is used more than once',
    severity: 'error',
  })
})

test('jdex errors are read too', async () => {
  const found = await parseJdlint(
    JSON.stringify({
      roots: {},
      jdex: { errors: [{ file: 'jdex.md', type: 'JDEX_ORPHAN' }] },
    }),
  )

  expect(found.map(f => f.code)).toEqual(['JDEX_ORPHAN'])
  expect(found[0].message).toBe('jdex orphan')
})

test('output that is not jdlint JSON throws, so it reads as a failed run', async () => {
  await expect(parseJdlint('Traceback (most recent call last)')).rejects.toThrow()
  await expect(parseJdlint('{"hello": 1}')).rejects.toThrow()
})

test('a clean system has no findings', async () => {
  expect(await parseJdlint('{"jdex":null,"roots":{"D":{"errors":[],"path":"."}}}')).toEqual([])
})

test('the strip summary leads with the first error and counts the rest', async () => {
  const sum = summarize(await parseJdlint(REAL))

  expect(sum).toEqual({ errors: 3, warnings: 0, lead: 'ARBITRARY_CONTENT_WHERE_NOT_ALLOWED +2' })
})

test('the fix prompt names each problem and asks for a re-check', async () => {
  const prompt = fixPrompt(await parseJdlint(REAL))

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

const run = (errors: object[], root = 'Documents') =>
  parseJdlint(JSON.stringify({ jdex: null, roots: { [root]: { errors } } }))

const EMPTY = 'EMPTY_FOLDER'

test('IDs: a rename keeps the ID, a renumber or a numberless rename does not', async () => {
  const [before] = await run([{ file: '10-19 Life/11 Me/11.11 Me', type: EMPTY }])
  const [renamed] = await run([{ file: '10-19 Life/11 Me/11.11 Myself', type: EMPTY }])
  const [moved] = await run([{ file: '10-19 Life/11 Me/11.12 Me', type: EMPTY }])
  const [stray] = await run([{ file: 'Stray', type: EMPTY }])
  const [strays] = await run([{ file: 'Strays', type: EMPTY }])

  expect(renamed.id).toBe(before.id)
  expect(moved.id).not.toBe(before.id)
  expect(strays.id).not.toBe(stray.id)
})

test('IDs: categories and areas anchor on their number', async () => {
  const [stuff] = await run([{ file: '10-19 Life/13 Stuff', type: EMPTY }])
  const [things] = await run([{ file: '10-19 Life/13 Things', type: EMPTY }])
  const [life] = await run([{ file: '10-19 Life', type: EMPTY }])
  const [living] = await run([{ file: '10-19 Living', type: EMPTY }])

  expect(things.id).toBe(stuff.id)
  expect(living.id).toBe(life.id)
})

test('IDs: two findings sharing a number get different IDs', async () => {
  const [dup, me] = await run([
    { file: '11 Me/11.11 Dup', type: EMPTY },
    { file: '11 Me/11.11 Me', type: EMPTY },
  ])

  expect(dup.id).not.toBe(me.id)
})

test('IDs: the same problem in two roots gets two IDs, and a lone root is not named', async () => {
  const both = await parseJdlint(
    JSON.stringify({
      roots: {
        A: { errors: [{ file: '11.11 Me', type: EMPTY }] },
        B: { errors: [{ file: '11.11 Me', type: EMPTY }] },
      },
    }),
  )
  const [one] = await run([{ file: '11.11 Me', type: EMPTY }], 'A')
  const [other] = await run([{ file: '11.11 Me', type: EMPTY }], 'B')

  expect(both[0].id).not.toBe(both[1].id)
  expect(one.id).toBe(other.id)
})

// Regression: fixing one of a pair flips the other's ID from path to number.
test('new: fixing one of a pair does not make the other look new', async () => {
  const pair = await run([
    { file: '11 Me/11.11 Dup', type: EMPTY },
    { file: '11 Me/11.11 Me', type: EMPTY },
  ])
  const left = await run([{ file: '11 Me/11.11 Me', type: EMPTY }])

  expect(left[0].id).not.toBe(pair[1].id)
  expect(freshIn(left, idsOf(pair)).size).toBe(0)
})

test('new: a second folder joining a number is new, the first is not', async () => {
  const alone = await run([{ file: '11 Me/11.11 Me', type: EMPTY }])
  const pair = await run([
    { file: '11 Me/11.11 Dup', type: EMPTY },
    { file: '11 Me/11.11 Me', type: EMPTY },
  ])

  expect([...freshIn(pair, idsOf(alone))]).toEqual([pair[0].id])
})

test('new: nothing without a baseline', async () => {
  expect(freshIn(await run([{ file: 'Stray', type: EMPTY }]), undefined).size).toBe(0)
})
