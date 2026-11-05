import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'xjd-lint',
  component: 'AbovePrompt',
  props: { bodyColumns: 100, hasSurvey: false },
} as const

const FINDINGS = [
  { id: 'a', source: 'jdlint', code: 'DUPLICATE_ID', path: '10-19 Life/11 Me/11.11 Me', message: 'x', severity: 'error' },
  { id: 'b', source: 'jdlint', code: 'EMPTY_FOLDER', path: '20-29 Clients/21 Acme/21.14 Q3 contracts', message: 'x', severity: 'error' },
  { id: 'c', source: 'jdlint', code: 'JDEX_ARBITRARY_CONTENT_WHERE_NOT_ALLOWED', path: 'jdex.md', message: 'x', severity: 'error' },
]

const HOME = { dir: '/h', config: '/h/jdlint.toml', watch: ['**'], ignore: [] }

type Values = {
  home?: typeof HOME | null
  findings?: typeof FINDINGS
  baseline?: string[]
  run?: 'idle' | 'checking' | 'failed'
  asOf?: number
  isOpen?: boolean
}

// Each value the band reads is answered by its key.
const given = (on: any, values: Values) => {
  const all = {
    home: HOME,
    findings: [],
    run: 'idle',
    asOf: 0,
    isOpen: false,
    ...values,
  } as Record<string, unknown>

  on('state.get', (_: unknown, e: { key: string }) => ({
    value: { value: all[e.key], version: 1 },
  }))
  // Nothing beneath the mod draws.
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

const SURFACES = ['terminal', 'desktop'] as const

test('clean: nothing is drawn', async ($, on) => {
  given(on, { findings: [] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text' })).toBe(undefined)
    await ui.unmount()
  }
})

test('out of scope: nothing is drawn even with findings stored', async ($, on) => {
  given(on, { home: null, findings: FINDINGS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text' })).toBe(undefined)
    await ui.unmount()
  }
})

test('strip: the count, the lead code, fix and details', async ($, on) => {
  given(on, { findings: FINDINGS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /3 errors/ }))?.text).toBe('3 errors')
    expect(await ui.find({ type: 'Text', text: /DUPLICATE_ID \+2/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'details' })).toBeTruthy()
    // The list is not open, so no row shows.
    expect(await ui.find({ type: 'Text', text: /^EMPTY_FOLDER$/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('expanded: one row per finding, the full longest code, hide', async ($, on) => {
  given(on, { findings: FINDINGS, isOpen: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text', text: /^DUPLICATE_ID$/ })).toBeTruthy()
    expect(
      await ui.find({ type: 'Text', text: /^JDEX_ARBITRARY_CONTENT_WHERE_NOT_ALLOWED$/ }),
    ).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /auto-fix off/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('narrow: the path column is dropped, the codes stay', async ($, on) => {
  given(on, { findings: FINDINGS, isOpen: true })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 60 },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /^DUPLICATE_ID$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /11\.11 Me/ })).toBe(undefined)
  await ui.unmount()
})

// Regression: at 60 columns "5 errors" wrapped onto two lines and the lead
// code was cut in the middle of the strip.
test('narrow strip: the count stays on one line and the lead code is dropped', async ($, on) => {
  given(on, { findings: FINDINGS })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 60 },
    surface: 'terminal',
  })
  const count = await ui.find({ type: 'Text', text: /3 errors/ })

  expect(count?.text).toBe('3 errors')
  expect(await ui.find({ type: 'Text', text: /DUPLICATE_ID/ })).toBe(undefined)
  expect(await ui.find({ type: 'Button', key: 'fix' })).toBeTruthy()
  await ui.unmount()
})

// Regression: a first run that failed showed "Problems 0 as of 18:00", the
// time being the epoch in the person's zone. There was never a good run.
test('failed before any good run: no count, no time, no fix button', async ($, on) => {
  given(on, { findings: [], run: 'failed', asOf: 0 })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text', text: /Couldn't run jdlint/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /as of/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^0$/ })).toBe(undefined)
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBe(undefined)
    await ui.unmount()
  }
})

test('checking: placeholders in the rows, no count yet', async ($, on) => {
  given(on, { findings: [], run: 'checking', isOpen: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text', text: /^————————————$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^DUPLICATE_ID$/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('failed: the last rows stay, with their age and a short note', async ($, on) => {
  given(on, { findings: FINDINGS, run: 'failed', asOf: 1_700_000_000_000, isOpen: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text', text: /^DUPLICATE_ID$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Couldn't run jdlint/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /as of/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a survey wins the band', async ($, on) => {
  given(on, { findings: FINDINGS })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /errors/ })).toBe(undefined)
  await ui.unmount()
})

const FOOTER = {
  plugin: 'xjd-lint',
  component: 'SessionMode',
  props: { modes: [] },
} as const

test('footer: the count by the model name', async ($, on) => {
  given(on, { findings: FINDINGS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOOTER, surface })

    expect((await ui.find({ type: 'Button', key: 'count' }))?.text).toBe('3 errors')
    await ui.unmount()
  }
})

test('footer: clean or out of scope draws nothing', async ($, on) => {
  given(on, { findings: [] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...FOOTER, surface })

    expect(await ui.find({ type: 'Button', key: 'count' })).toBe(undefined)
    await ui.unmount()
  }
})

test('footer: out of scope draws nothing even with findings stored', async ($, on) => {
  given(on, { home: null, findings: FINDINGS })

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'count' })).toBe(undefined)
  await ui.unmount()
})

test('footer: checking shows a placeholder', async ($, on) => {
  given(on, { findings: [], run: 'checking' })

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })

  expect((await ui.find({ type: 'Button', key: 'count' }))?.text).toBe('…')
  await ui.unmount()
})

test('footer: pressing the count opens the list', async ($, on) => {
  given(on, { findings: FINDINGS })
  const writes: unknown[] = []

  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    writes.push([e.key, e.value])

    return { value: { isSet: true, version: 2 } }
  })

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })

  await ui.press({ key: 'count' })
  expect(writes).toEqual([['isOpen', true]])
  await ui.unmount()
})

test('new: the strip counts them', async ($, on) => {
  given(on, { findings: FINDINGS, baseline: ['a', 'b'] })

  for (const surface of SURFACES) {
    const strip = await $.ui.mount({ ...BAND, surface })

    expect(await strip.find({ type: 'Text', text: /1 new/ })).toBeTruthy()
    await strip.unmount()
  }
})

test('new: none before a baseline', async ($, on) => {
  given(on, { findings: FINDINGS })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /new/ })).toBe(undefined)
  await ui.unmount()
})

test('new: the list marks the new row', async ($, on) => {
  given(on, { findings: FINDINGS, baseline: ['a', 'b'], isOpen: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^new$/ }))?.text).toBe('new')
  await ui.unmount()
})
