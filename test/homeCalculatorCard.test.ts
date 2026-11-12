import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bridge } from '../src/ui/bridge.js'
import { homeCalculatorApp } from '../src/ui/homeCalculatorApp.js'
import { homeCalculatorModel } from '../src/ui/homeCalculatorModel.js'
import { cardIcons } from '../src/ui/icons.js'
import { recorded } from './helpers.js'

/**
 * The card's DOM, driven the way a host drives it: tool-input with the arguments, then
 * tool-result with saoi-api's recorded answer. The bridge is a stand-in that answers tools/call
 * from recordings and records every call, opened link and context update.
 */
function mount(responses: Record<string, unknown> = {}) {
  const window = new Window({ url: 'https://card.test/' })
  const doc = window.document
  doc.body.innerHTML = '<main id="card" aria-busy="true"></main>'
  const handlers = new Map<string, (params: Record<string, unknown> | null) => void>()
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const opened: string[] = []
  const contexts: string[] = []
  const bridge: Bridge = {
    request: () => Promise.resolve(null),
    notify: () => undefined,
    on: (method, handler) => {
      handlers.set(method, handler)
    },
    callTool: (name, args) => {
      calls.push({ name, args })
      const answer = responses[name]
      return Promise.resolve(answer === undefined ? null : { structuredContent: answer })
    },
    openLink: (url) => {
      opened.push(url)
      return Promise.resolve(true)
    },
    updateContext: (text) => {
      contexts.push(text)
      return Promise.resolve()
    },
    start: () => Promise.resolve(),
    record: (value) =>
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null,
  }
  const win = window as unknown as globalThis.Window
  homeCalculatorApp(win, bridge, homeCalculatorModel(), cardIcons(win.document))
  const emit = (method: string, params: Record<string, unknown>): void => {
    handlers.get(method)?.(params)
  }
  const buttons = (): HTMLButtonElement[] =>
    Array.from(doc.querySelectorAll('button')) as unknown as HTMLButtonElement[]
  const byText = (text: string): HTMLButtonElement | undefined =>
    buttons().find((node) => node.textContent === text)
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const text = (selector: string): string[] =>
    Array.from(doc.querySelectorAll(selector)).map((node) => node.textContent)
  /** Changes what a tool answers from now on. */
  const respond = (name: string, answer: unknown): void => {
    responses[name] = answer
  }
  return { doc, emit, calls, opened, contexts, buttons, byText, settle, text, respond }
}

/** The host's arguments and saoi-api's answer for one recorded example. */
function open(result: typeof recorded.homeCalculatorSecondHand, responses: Record<string, unknown> = {}) {
  const card = mount({ saoi_home_calculator: result, ...responses })
  card.emit('ui/notifications/tool-input', { arguments: result.inputs })
  card.emit('ui/notifications/tool-result', { structuredContent: result })
  return card
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

/** No route or option is worded as a pick, an endorsement or an instruction. */
const PICK = /\b(best|faster|recommended|eligible|eligibility|apply|right for you)\b/i

const responses = { saoi_build_plan: recorded.planHome, saoi_save_plan: recorded.saved }
/** A comparison without its held link, so Open in Saoi saves it through saoi_save_plan. */
const unsaved = { saoi_build_plan: { ...recorded.planHome, saveLink: null }, saoi_save_plan: recorded.saved }
const home = recorded.planHome.home
if (home === null) throw new Error('recording has no home')

type Card = ReturnType<typeof mount>
const openButton = (card: Card): HTMLButtonElement =>
  card.doc.querySelector('.btn-open') as unknown as HTMLButtonElement
const routesLink = (card: Card): HTMLButtonElement | undefined => card.byText('See all 6 supports in Saoi')
const footToggle = (card: Card): HTMLButtonElement =>
  card.doc.querySelector('.foot-toggle') as unknown as HTMLButtonElement
const footDetail = (card: Card): HTMLElement =>
  card.doc.querySelector('#foot-detail') as unknown as HTMLElement
const count = (card: Card, name: string): number => card.calls.filter((call) => call.name === name).length

describe('home calculator card v8: folded when the host gave the figures', () => {
  it('heads the plan with Saoirse’s mark, the title and Edit, and one chip, for rent', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('#in-depositSavedEur')).toBeNull()
    expect(card.text('header .title')).toEqual(['Your home-buying plan'])
    expect(card.doc.querySelector('header .badge')).toBeNull()
    expect(card.doc.querySelector('header .icon-house')).toBeNull()
    const mark = card.doc.querySelector('header .mark svg.icon-saoirse')
    expect(mark?.getAttribute('viewBox')).toBe('0 0 64 64')
    expect(mark?.getAttribute('width')).toBe('36')
    expect(mark?.querySelector('g')?.getAttribute('stroke')).toBe('currentColor')
    expect(
      Array.from(mark?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('stroke-width')),
    ).toEqual(['14', '6', '6'])
    expect(mark?.getAttribute('stroke-linecap')).toBeNull()
    const edit = card.byText('Edit')
    expect(edit?.querySelector('svg.icon-pencil')).not.toBeNull()
    // First home was not given either, but it stays assumed (the footer says so): rent is the one chip.
    expect(card.text('.facts .chip')).toEqual(['Rent a month?'])
    expect(card.doc.querySelectorAll('input, select')).toHaveLength(0)
  })

  it('calls no tool until something is pressed', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    await card.settle()
    expect(card.calls).toHaveLength(0)
    expect(card.contexts).toHaveLength(0)
    openButton(card).click()
    await card.settle()
    expect(card.calls.length).toBeGreaterThan(0)
  })

  it('keeps every icon decorative', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    const icons = Array.from(card.doc.querySelectorAll('svg'))
    expect(icons.length).toBeGreaterThan(8)
    for (const svg of icons) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.textContent).toBe('')
    }
  })

  it('leaves first home to the Edit state, where its control stays', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.byText('First home?')).toBeUndefined()
    expect(card.byText('New build or second-hand?')).toBeUndefined()
    card.byText('Edit')?.click()
    expect(card.text('.choice-field > p')).toContain('First home?')
  })

  it('opens only the rent chip’s control, then drops the chip once answered', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('Rent a month?')?.click()
    expect(card.doc.querySelectorAll('.control')).toHaveLength(1)
    const box = card.doc.querySelector('#ask-monthlyRentEur') as unknown as HTMLInputElement
    box.value = '2500'
    card.byText('Done')?.click()
    await card.settle()
    expect(card.doc.querySelector('.facts')).toBeNull()
    expect(card.text('.meter p').at(-1)).toBe('Rent now €2,500 a month')
  })

  it('takes rent from its chip, saying in the control that it is optional', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('Rent a month?')?.click()
    expect(card.text('.control p').join(' ')).toMatch(/^Optional/)
    const box = card.doc.querySelector('#ask-monthlyRentEur') as unknown as HTMLInputElement
    box.value = '1800'
    card.byText('Done')?.click()
    await card.settle()
    expect(card.calls.at(-1)?.args).toMatchObject({ monthlyRentEur: 1_800 })
  })

  it('opens the editing state from Edit with the same title', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('Edit')?.click()
    expect(card.doc.querySelector('#in-depositSavedEur')).not.toBeNull()
    expect(card.text('header .title')).toEqual(['Your home-buying plan'])
    expect(card.byText('Edit')).toBeUndefined()
  })
})

describe('home calculator card v8: the month, what is needed, the progress and three tiles', () => {
  it('shows the month the money is ready, what that money is made of, and saved against it', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const { inputs, figures } = result
    const needed = figures.neededAtKeysEur ?? 0
    // The card's own estimate: €17,000 to go at €1,000 a month from November 2026.
    expect(figures.depositReachedOn).toBe('2028-04')
    expect(card.text('.hero p')).toEqual([
      'Ready to buy',
      'April 2028',
      '€40,000 deposit + €4,000 stamp duty + €3,000 legal and survey',
    ])
    expect((figures.depositNeededEur ?? 0) + (figures.stampDutyEur ?? 0) + figures.legalAndSurveyEur).toBe(
      figures.neededAtKeysEur,
    )
    expect(needed).toBe(47_000)
    const bar = card.doc.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(needed))
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(inputs.depositSavedEur))
    expect(card.text('.meter p')[0]).toBe('€30,000 of €47,000')
    // The piggy bank is on the Savings tile now, not repeated here.
    expect(card.doc.querySelector('.meter svg')).toBeNull()
    expect(card.text('.meter .kv span.muted')).toEqual(['€1,000 a month'])
    expect(card.text('.meter .kv span.medium')).toEqual(['€17,000 to go'])
    // No rent given: no rent line.
    expect(card.doc.querySelector('.meter .rent')).toBeNull()
    expect(card.doc.querySelector('#card')?.textContent).not.toMatch(/Rent now/)
  })

  it('fills the three tiles from saoi-api’s market block and affordability figures, naming no provider', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const tile = (n: number): string[] => card.text(`.tile:nth-child(${String(n)}) p`)
    expect(card.doc.querySelectorAll('.tile')).toHaveLength(3)
    // From the live result: top savings rate 3.11%, €735.86 interest by 2028-06, 28 accounts; 49
    // mortgages from 3.2% and €1,556.88 a month over 30 years; up to €444,000 within the limits.
    expect(tile(1)).toEqual(['Savings', 'up to 3.11%', '€736 interest by Jun 2028', '28 accounts'])
    expect(tile(2)).toEqual(['Mortgage', '€360,000', 'from 3.20%, €1,557/mo', '49 options, 30 years'])
    expect(tile(3)).toEqual(['Could afford', 'up to €444,000', '4× income, 90% loan', '30 years'])
    const icons = Array.from(card.doc.querySelectorAll('.tile svg')).map((svg) => svg.getAttribute('class'))
    expect(icons).toEqual(['icon icon-piggy-bank', 'icon icon-landmark', 'icon icon-house'])
    const provider = result.market?.savings?.topRateProvider ?? 'missing'
    expect(card.doc.querySelector('#card')?.textContent).not.toContain(provider)
  })

  it('says See in Saoi on the tiles when saoi-api sent no market block', () => {
    const result = { ...recorded.homeCalculatorSecondHand, market: null }
    const card = open(result)
    const tile = (n: number): string[] => card.text(`.tile:nth-child(${String(n)}) p`)
    expect(tile(1)).toEqual(['Savings', 'In Saoi', 'See in Saoi'])
    expect(tile(2)).toEqual(['Mortgage', '€360,000', 'See in Saoi'])
    expect(tile(3)).toEqual(['Could afford', 'up to €444,000', '4× income, 90% loan', '30 years'])
  })

  it('takes the new market facts when a chip answer brings a new result', async () => {
    const result = recorded.homeCalculatorSecondHand
    const market = result.market
    const mortgage = market?.mortgage ?? null
    if (market === null || mortgage === null) throw new Error('recording has no mortgage market')
    const card = open(result)
    const newer = { ...result, market: { ...market, mortgage: { ...mortgage, options: 12 } } }
    card.respond('saoi_home_calculator', newer)
    card.byText('Rent a month?')?.click()
    ;(card.doc.querySelector('#ask-monthlyRentEur') as unknown as HTMLInputElement).value = '2500'
    card.byText('Done')?.click()
    await card.settle()
    expect(card.text('.tile:nth-child(2) p')[3]).toBe('12 options, 30 years')
  })

  it('puts the rent given as one line under the progress', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = mount({ saoi_home_calculator: result })
    card.emit('ui/notifications/tool-input', { arguments: { ...result.inputs, monthlyRentEur: 2_500 } })
    card.emit('ui/notifications/tool-result', { structuredContent: result })
    expect(card.text('.meter p').at(-1)).toBe('Rent now €2,500 a month')
    expect(card.doc.querySelector('.meter .rent')?.className).toMatch(/muted/)
  })

  it('says Covered when the deposit saved meets the money needed at the keys', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = mount({ saoi_home_calculator: result })
    const inputs = { ...result.inputs, depositSavedEur: 60_000 }
    card.emit('ui/notifications/tool-input', { arguments: inputs })
    card.emit('ui/notifications/tool-result', { structuredContent: { ...result, inputs } })
    expect(card.text('.meter .kv span')).toEqual(['€1,000 a month', 'Covered'])
    expect(card.doc.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('47000')
  })

  it('keeps a conditional Help to Buy out of the month, and the new-build route names it', () => {
    const card = open(recorded.homeCalculatorNewBuild)
    expect(card.text('.hero-month')).toEqual(['April 2028'])
    expect(card.doc.querySelector('.hero')?.textContent).not.toMatch(/Nov(ember)? 2026/)
    // The new build's own market: 51 mortgages from 3.10%.
    expect(card.text('.tile:nth-child(2) p')).toEqual([
      'Mortgage',
      '€360,000',
      'from 3.10%, €1,537/mo',
      '51 options, 30 years',
    ])
    // Tax paid not given: Help to Buy is not counted, so it is not taken off the line.
    expect(card.text('.hero p').at(-1)).toBe('€40,000 deposit + €4,000 stamp duty + €3,000 legal and survey')
    // New build is the customer's own kind here, so the two rows are the next two routes.
    expect(card.text('.route-name')).toEqual(['Second-hand', 'Vacant property grant'])
  })

  it('takes Help to Buy off the line once tax paid is given', () => {
    const result = recorded.homeCalculatorNewBuild
    const card = mount({ saoi_home_calculator: result })
    const inputs = { ...result.inputs, taxPaidLastFourYearsEur: 50_000 }
    card.emit('ui/notifications/tool-input', { arguments: inputs })
    card.emit('ui/notifications/tool-result', { structuredContent: { ...result, inputs } })
    expect(card.text('.hero p').at(-1)).toBe(
      '€40,000 deposit + €4,000 stamp duty + €3,000 legal and survey − €35,000 Help to Buy',
    )
    expect(card.text('.meter p')[0]).toBe('€30,000 of €12,000')
  })

  it('moves the before-interest note from under the month into the footer detail', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('.hero')?.textContent).not.toMatch(/before interest/i)
    expect(footDetail(card).textContent).toContain('April 2028: before interest.')
  })
})

describe('home calculator card v8: expanded without figures', () => {
  it('opens the inputs as today, with Show my options as an outline button, and runs nothing on its own', async () => {
    const card = mount({ saoi_home_calculator: recorded.homeCalculator, ...responses })
    card.emit('ui/notifications/tool-input', { arguments: {} })
    card.emit('ui/notifications/tool-result', { structuredContent: recorded.homeCalculator })
    await card.settle()
    expect(card.calls).toHaveLength(0)
    expect(card.doc.querySelector('#in-depositSavedEur')).not.toBeNull()
    expect(card.doc.querySelector('#in-county')).not.toBeNull()
    expect(card.doc.querySelector('#in-monthlyRentEur')).not.toBeNull()
    expect(card.byText('Show my options')?.className).toMatch(/btn-outline/)
    expect(card.doc.querySelector('.chips')).toBeNull()
    expect(card.text('label').join(' ')).toMatch(/Rent a month \(optional\)/)
  })

  it('runs the comparison from Show my options and folds', async () => {
    const card = mount({ saoi_home_calculator: recorded.homeCalculator, ...responses })
    card.emit('ui/notifications/tool-input', { arguments: {} })
    card.emit('ui/notifications/tool-result', { structuredContent: recorded.homeCalculator })
    card.byText('Show my options')?.click()
    await card.settle()
    expect(count(card, 'saoi_build_plan')).toBe(1)
    expect(card.contexts).toHaveLength(1)
    expect(card.doc.querySelector('#in-depositSavedEur')).toBeNull()
  })
})

describe('home calculator card v8: other routes', () => {
  it('shows the two routes after the customer’s own kind as two-line rows, then a link into Saoi', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const ids = (): string[] =>
      Array.from(card.doc.querySelectorAll('.route-head')).map(
        (node) => node.getAttribute('aria-controls')?.replace('route-', '') ?? '',
      )
    expect(card.text('h3.label')).toContain('Other supports')
    expect(card.doc.querySelector('h3.label svg.icon-sparkles')).not.toBeNull()
    const others = result.routes.slice(1, 3)
    expect(ids()).toEqual(others.map((route) => route.id))
    expect(card.text('.route-head .route-name')).toEqual(others.map((route) => route.name))
    expect(card.text('.route-head .route-detail')).toEqual(
      others.map((route) => route.line.replace(`${route.name}: `, '')),
    )
    expect(card.doc.querySelector('.route-head .icon-box-32 svg.icon-hammer')).not.toBeNull()
    expect(card.doc.querySelector('.route-head .icon-box-32 svg.icon-house-plus')).not.toBeNull()
    expect(card.text('.route-head > .badge')).toEqual(['Potential', 'One detail'])
    expect(card.doc.querySelectorAll('.route-head svg.chevron')).toHaveLength(2)
    expect(card.doc.querySelectorAll('.route-head[aria-expanded="true"]')).toHaveLength(0)
    expect(routesLink(card)?.querySelector('svg.icon-chevron-right')).not.toBeNull()
    expect(card.text('button').some((label) => /See all routes/.test(label))).toBe(false)
  })

  it('opens a shown route to its reason, missing-detail chip, conditions and first source', async () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const htb = result.routes.find((route) => route.id === 'new_build_help_to_buy')
    const head = card.doc.querySelector(
      '[aria-controls="route-new_build_help_to_buy"]',
    ) as unknown as HTMLButtonElement
    head.click()
    expect(head.getAttribute('aria-expanded')).toBe('true')
    const body = card.doc.querySelector('#route-new_build_help_to_buy') as unknown as HTMLElement
    expect(body.hidden).toBe(false)
    expect(body.textContent).toContain(htb?.missing ?? 'missing')
    expect(body.textContent).toContain(htb?.conditions[0] ?? 'missing')
    expect(body.querySelector('a')?.getAttribute('href')).toBe(htb?.sources[0]?.url)
    card.byText('Tax paid, last 4 years?')?.click()
    const box = card.doc.querySelector('#ask-taxPaid') as unknown as HTMLInputElement
    box.value = '40000'
    card.byText('Done')?.click()
    await card.settle()
    expect(card.calls.at(-1)).toMatchObject({
      name: 'saoi_home_calculator',
      args: { taxPaidLastFourYearsEur: 40_000 },
    })
  })

  it('opens Saoi from "See all 6 supports in Saoi" exactly as the button does', async () => {
    const card = open(recorded.homeCalculatorSecondHand, unsaved)
    const link = routesLink(card)
    if (link === undefined) throw new Error('no routes link')
    link.click()
    // Both openers are disabled while it runs, and the line under the button says what it is doing.
    expect(routesLink(card)?.disabled).toBe(true)
    expect(openButton(card).disabled).toBe(true)
    expect(card.text('.actions .status')).toEqual(['Comparing every option that fits…'])
    await card.settle()
    expect(count(card, 'saoi_build_plan')).toBe(1)
    expect(count(card, 'saoi_save_plan')).toBe(1)
    expect(card.opened).toEqual([recorded.saved.claimUrl])
    expect(card.text('.actions .status').join(' ')).toMatch(/Opens in the Saoi app; the link works once/)
    expect(routesLink(card)?.disabled).toBe(false)
  })
})

describe('home calculator card v8: Open in Saoi and the footer', () => {
  it('has one filled two-line button, Open in Saoi, which compares, saves and opens the single-use link', async () => {
    const card = open(recorded.homeCalculatorSecondHand, unsaved)
    const filled = card.buttons().filter((node) => node.classList.contains('btn'))
    expect(filled).toHaveLength(1)
    expect(card.text('.btn-open .btn-words > span')).toEqual([
      'Open in Saoi',
      'Compare all product options and supports',
    ])
    expect(openButton(card).querySelector('svg.icon-external-link')).not.toBeNull()
    openButton(card).click()
    expect(openButton(card).disabled).toBe(true)
    await card.settle()
    expect(count(card, 'saoi_build_plan')).toBe(1)
    expect(count(card, 'saoi_save_plan')).toBe(1)
    expect(card.opened).toEqual([recorded.saved.claimUrl])
    expect(card.text('.status').join(' ')).toMatch(/Opens in the Saoi app; the link works once/)
    // No count on the card, before or after.
    expect(card.text('.btn-open .btn-words > span')[1]).toBe('Compare all product options and supports')
  })

  it('does not compare again for the same inputs, and uses the held link when the comparison has one', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    openButton(card).click()
    await card.settle()
    routesLink(card)?.click()
    await card.settle()
    expect(count(card, 'saoi_build_plan')).toBe(1)
    expect(count(card, 'saoi_save_plan')).toBe(0)
    expect(card.opened).toEqual([recorded.planHome.saveLink?.url, recorded.planHome.saveLink?.url])
  })

  it('says so when the options cannot be fetched from the card, without inviting a follow-up in the chat', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    openButton(card).click()
    await card.settle()
    expect(card.text('.status').join(' ')).toMatch(/could not be fetched just now/)
    expect(card.doc.body.textContent).not.toMatch(/\bask\b|in the chat/i)
    expect(openButton(card).disabled).toBe(false)
  })

  it('folds the footer to one line, and opens what was assumed, the warnings, the 24-hour note and the statement', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const toggle = footToggle(card)
    expect(toggle.textContent).toBe('Estimates only. Assumptions, warnings and how Saoi works')
    expect(toggle.querySelector('svg.icon-info')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(footDetail(card).hidden).toBe(true)
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(footDetail(card).hidden).toBe(false)
    const lines = card.text('#foot-detail p')
    expect(lines[0]).toBe(
      `Assumed: ${result.assumed.map((line) => line.replace(/\.$/, '')).join(', ')}. Estimates only; rates and offers are not confirmed.`,
    )
    expect(lines[1]).toBe('April 2028: before interest.')
    const warnings = lines.filter((line) => line.startsWith('Warning:'))
    expect(warnings).toHaveLength(3)
    expect(warnings.join(' ')).toMatch(/you may lose your home/)
    expect(warnings.join(' ')).toMatch(/monthly repayments may increase/)
    expect(warnings.join(' ')).toMatch(/go into arrears/)
    expect(lines.at(-2)).toBe('Held for 24 hours, then deleted unless opened.')
    expect(lines.at(-1)).toMatch(/not regulated by the Central Bank of Ireland/)
    expect(card.text('.actions p').join(' ')).not.toMatch(/Held for 24 hours/)
  })

  it('takes the comparison’s own warnings once it returned them, else the statutory three', async () => {
    const card = open(recorded.homeCalculatorSecondHand, {
      ...responses,
      saoi_build_plan: { ...recorded.planHome, home: { ...home, warnings: ['Warning: as returned.'] } },
    })
    openButton(card).click()
    await card.settle()
    expect(card.text('#foot-detail p').filter((line) => line.startsWith('Warning:'))).toEqual([
      'Warning: as returned.',
    ])
    const empty = open(recorded.homeCalculatorSecondHand, {
      ...responses,
      saoi_build_plan: { ...recorded.planHome, home: { ...home, warnings: [] } },
    })
    openButton(empty).click()
    await empty.settle()
    expect(empty.text('#foot-detail p').filter((line) => line.startsWith('Warning:'))).toHaveLength(3)
  })

  it('never words a route or an option as a pick, with the shown routes and the footer open', async () => {
    for (const result of [recorded.homeCalculatorSecondHand, recorded.homeCalculatorNewBuild]) {
      const card = open(result, responses)
      openButton(card).click()
      await card.settle()
      for (const head of Array.from(card.doc.querySelectorAll('.route-head')))
        (head as unknown as HTMLElement).click()
      footToggle(card).click()
      expect(footDetail(card).hidden).toBe(false)
      expect(card.doc.querySelector('#card')?.textContent).not.toMatch(PICK)
    }
  })
})

describe('home calculator card: the core-information gate', () => {
  const gate = {
    ready: false,
    missing: [
      {
        key: 'annualGrossIncomeEur',
        question: 'What is your gross income a year?',
        moves: 'It sets how much the limits allow.',
        askNow: true,
      },
    ],
  }

  it('shows nothing, not even its height, while the gate holds the card back', async () => {
    const card = mount({ saoi_home_calculator: recorded.homeCalculatorSecondHand })
    card.emit('ui/notifications/tool-input', { arguments: { targetDate: '2028-06' } })
    // Drawn from the arguments first (every host sends those); the gated result then hides it.
    expect(card.doc.body.hidden).toBe(false)
    card.emit('ui/notifications/tool-result', {
      structuredContent: { gate, statement: 'Saoi is not regulated.' },
    })
    card.emit('ui/notifications/tool-cancelled', {})
    await card.settle()
    expect(card.doc.body.hidden).toBe(true)
    expect(card.doc.getElementById('card')?.childElementCount).toBe(0)
    expect(card.doc.getElementById('card')?.hasAttribute('aria-busy')).toBe(false)
    expect(card.calls).toHaveLength(0)
  })

  it('draws as before once the gate is open', () => {
    const result = { ...recorded.homeCalculatorSecondHand, gate: { ready: true, missing: [] } }
    const card = open(result)
    expect(card.doc.body.hidden).toBe(false)
    expect(card.doc.querySelector('.hero-month')).not.toBeNull()
  })
})
