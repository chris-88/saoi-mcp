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
  return { doc, emit, calls, opened, contexts, buttons, byText, settle, text }
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
const home = recorded.planHome.home
if (home === null) throw new Error('recording has no home')
const lowest = Math.round(Math.min(...home.pathways.map((option) => option.mortgage.monthlyRepayment)))
const fromLowest = `from €${lowest.toLocaleString('en-IE')}/mo`

type Card = ReturnType<typeof mount>
const openButton = (card: Card): HTMLButtonElement =>
  card.doc.querySelector('.btn-open') as unknown as HTMLButtonElement
const optionsTile = (card: Card): string[] => card.text('.tile:last-child p')
const footToggle = (card: Card): HTMLButtonElement =>
  card.doc.querySelector('.foot-toggle') as unknown as HTMLButtonElement
const footDetail = (card: Card): HTMLElement =>
  card.doc.querySelector('#foot-detail') as unknown as HTMLElement

describe('home calculator card v6: folded when the host gave the figures', () => {
  it('heads the plan with its icon, title, Estimate badge and Edit, and chips only for the facts still missing', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('#in-depositSavedEur')).toBeNull()
    expect(card.text('header .title')).toEqual(['Your home-buying planEstimate'])
    expect(card.text('header .badge')).toEqual(['Estimate'])
    expect(card.doc.querySelector('header .icon-box-36 svg.icon-house')).not.toBeNull()
    const edit = card.byText('Edit')
    expect(edit?.querySelector('svg.icon-pencil')).not.toBeNull()
    // Second-hand was given; first home and rent were not. Rent comes last, without "(optional)".
    expect(card.text('.facts .chip')).toEqual(['First home?', 'Rent a month?'])
    expect(card.doc.querySelectorAll('input, select')).toHaveLength(0)
  })

  it('keeps every icon decorative', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    const icons = Array.from(card.doc.querySelectorAll('svg'))
    expect(icons.length).toBeGreaterThan(8)
    for (const svg of icons) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.textContent).toBe('')
    }
  })

  it('opens only the tapped fact’s control, and asks saoi-api again with the answer', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('First home?')?.click()
    expect(card.doc.querySelectorAll('.control')).toHaveLength(1)
    expect(card.doc.querySelectorAll('input, select')).toHaveLength(0)
    card.byText('Yes')?.click()
    await card.settle()
    expect(card.text('.chip')).not.toContain('First home?')
    expect(card.calls.at(-1)).toMatchObject({
      name: 'saoi_home_calculator',
      args: { firstTimeBuyer: true, propertyKind: 'second_hand' },
    })
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
    expect(card.text('header .title')).toEqual(['Your home-buying planEstimate'])
    expect(card.byText('Edit')).toBeUndefined()
  })
})

describe('home calculator card v6: the month, the facts and the progress', () => {
  it('shows the month the money is ready, one fact line, and saved against needed at the keys', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const { inputs, figures } = result
    const needed = figures.neededAtKeysEur ?? 0
    expect(card.text('.hero .eyebrow')).toEqual(['Ready to buy'])
    // The card's own estimate: €17,000 to go at €1,000 a month from November 2026.
    expect(figures.depositReachedOn).toBe('2028-04')
    expect(card.text('.hero p')).toEqual([
      'Ready to buy',
      'April 2028',
      '€400,000 second-hand, €47,000 needed at the keys',
    ])
    expect(needed).toBe(47_000)
    const bar = card.doc.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(needed))
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(inputs.depositSavedEur))
    expect(card.text('.meter p')[0]).toBe('€30,000 of €47,000')
    expect(card.doc.querySelector('.meter svg.icon-piggy-bank')).not.toBeNull()
    expect(card.text('.meter .kv span.muted')).toEqual(['€1,000 a month'])
    expect(card.text('.meter .kv span.medium')).toEqual(['€17,000 to go'])
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
    expect(card.text('.hero p').join(' | ')).toContain('€400,000 new build, €47,000 needed at the keys')
    card.byText('See all routes (6)')?.click()
    expect(card.text('.route-name')[0]).toBe('New build with Help to Buy')
    expect(card.text('.route-detail')[0]).toBe('keys Nov 2026 if your tax paid covers €35,000')
  })

  it('moves the before-interest note from under the month into the footer detail', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('.hero')?.textContent).not.toMatch(/before interest/i)
    expect(footDetail(card).textContent).toContain('April 2028: before interest.')
  })
})

describe('home calculator card v6: the tiles and the one automatic comparison', () => {
  it('runs the comparison once when the card first folds, and fills the Options tile with the count', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    const tile = card.doc.querySelector('.tile:last-child')
    expect(tile?.getAttribute('aria-busy')).toBe('true')
    expect(optionsTile(card)).toEqual(['Options', '…'])
    await card.settle()
    expect(card.calls.filter((call) => call.name === 'saoi_build_plan')).toHaveLength(1)
    expect(card.doc.querySelector('.tile:last-child')?.getAttribute('aria-busy')).toBe('false')
    expect(card.text('.tile')).toEqual([
      'Home price€400,000',
      'Mortgage€360,000',
      `Options${String(home.pathways.length)}${fromLowest}`,
    ])
    expect(card.doc.querySelectorAll('.tile svg')).toHaveLength(3)
    // The options are not listed on the card; they open in the app.
    expect(card.doc.querySelectorAll('.option-head')).toHaveLength(0)
    // Redraws (a route opened, all routes, the footer) and Open in Saoi do not run it again.
    card.byText('See all routes (6)')?.click()
    footToggle(card).click()
    openButton(card).click()
    await card.settle()
    expect(card.calls.filter((call) => call.name === 'saoi_build_plan')).toHaveLength(1)
    expect(card.opened).toEqual([recorded.planHome.saveLink?.url])
  })

  it('does not tell the conversation about the automatic comparison', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    await card.settle()
    expect(card.contexts).toHaveLength(0)
  })

  it('shows See in Saoi on the tile when the comparison cannot be run from the card', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    await card.settle()
    expect(card.calls.filter((call) => call.name === 'saoi_build_plan')).toHaveLength(1)
    expect(optionsTile(card)).toEqual(['Options', 'See in Saoi'])
    expect(card.text('.hero-month')).toEqual(['April 2028'])
    expect(card.text('.status').join('')).toBe('')
  })

  it('puts the rent given on the Options tile, alone while it runs and beside the lowest monthly after', async () => {
    const result = recorded.homeCalculatorSecondHand
    const card = mount({ saoi_home_calculator: result, ...responses })
    card.emit('ui/notifications/tool-input', { arguments: { ...result.inputs, monthlyRentEur: 1_800 } })
    card.emit('ui/notifications/tool-result', { structuredContent: result })
    expect(optionsTile(card)).toEqual(['Options', '…', 'rent €1,800'])
    await card.settle()
    expect(optionsTile(card)).toEqual([
      'Options',
      String(home.pathways.length),
      `${fromLowest} · rent €1,800`,
    ])
  })
})

describe('home calculator card v6: expanded without figures', () => {
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
})

describe('home calculator card v6: other routes', () => {
  it('shows the two routes after the customer’s own kind as two-line rows, then See all routes (N)', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const ids = (): string[] =>
      Array.from(card.doc.querySelectorAll('.route-head')).map(
        (node) => node.getAttribute('aria-controls')?.replace('route-', '') ?? '',
      )
    expect(card.text('h3.label')).toContain('Other routes')
    expect(card.doc.querySelector('h3.label svg.icon-sparkles')).not.toBeNull()
    const others = result.routes.slice(1, 3)
    expect(ids()).toEqual(others.map((route) => route.id))
    expect(ids()).not.toContain('second_hand')
    expect(card.text('.route-head .route-name')).toEqual(others.map((route) => route.name))
    expect(card.text('.route-head .route-detail')).toEqual(
      others.map((route) => route.line.replace(`${route.name}: `, '')),
    )
    expect(card.doc.querySelector('.route-head .icon-box-32 svg.icon-hammer')).not.toBeNull()
    expect(card.doc.querySelector('.route-head .icon-box-32 svg.icon-house-plus')).not.toBeNull()
    expect(card.text('.route-head > .badge')).toEqual(['Potential', 'One detail'])
    expect(card.doc.querySelectorAll('.route-head svg.chevron')).toHaveLength(2)
    expect(card.doc.querySelectorAll('.route-head[aria-expanded="true"]')).toHaveLength(0)
    const more = card.byText(`See all routes (${String(result.routes.length)})`)
    expect(more?.querySelector('svg.icon-chevron-right')).not.toBeNull()
    more?.click()
    expect(ids()).toEqual(result.routes.map((route) => route.id))
    expect(card.byText(`See all routes (${String(result.routes.length)})`)).toBeUndefined()
    const icons = Array.from(card.doc.querySelectorAll('.route-head .icon-box-32 svg')).map(
      (svg) => svg.getAttribute('class') ?? '',
    )
    expect(icons.map((name) => name.replace('icon icon-', ''))).toEqual([
      'house',
      'hammer',
      'house-plus',
      'key-round',
      'landmark',
      'building-2',
    ])
  })

  it('opens a route to its reason, conditions and first source', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    card.byText('See all routes (6)')?.click()
    const head = card.doc.querySelector('[aria-controls="route-second_hand"]') as unknown as HTMLButtonElement
    head.click()
    expect(head.getAttribute('aria-expanded')).toBe('true')
    const body = card.doc.querySelector('#route-second_hand') as unknown as HTMLElement
    expect(body.hidden).toBe(false)
    expect(body.textContent).toContain(result.routes[0]?.reason ?? 'missing')
    expect(body.textContent).toContain(result.routes[0]?.conditions[0] ?? 'missing')
    const link = body.querySelector('a')
    expect(link?.getAttribute('href')).toBe(result.routes[0]?.sources[0]?.url)
    expect(link?.textContent).toBe('Source: centralbank.ie (read 2026-11-09)')
  })

  it('gives a missing detail a chip that opens its control, and sends the answer', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('See all routes (6)')?.click()
    ;(card.doc.querySelector('[aria-controls="route-first_home_scheme"]') as unknown as HTMLElement).click()
    card.byText('Which county?')?.click()
    const select = card.doc.querySelector('#ask-county') as unknown as HTMLSelectElement
    expect(select.querySelectorAll('option')).toHaveLength(31)
    select.value = 'dublin_city'
    select.dispatchEvent(
      new (select.ownerDocument.defaultView as unknown as typeof globalThis).Event('change'),
    )
    await card.settle()
    expect(card.calls.at(-1)).toMatchObject({ name: 'saoi_home_calculator', args: { county: 'dublin_city' } })
  })
})

describe('home calculator card v6: Open in Saoi and the footer', () => {
  it('has one filled two-line button, Open in Saoi, which opens the single-use link', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    const filled = card.buttons().filter((node) => node.classList.contains('btn'))
    expect(filled).toHaveLength(1)
    expect(card.text('.btn-open .btn-words > span')).toEqual([
      'Open in Saoi',
      'Compare every option and all 6 routes with Saoirse',
    ])
    expect(openButton(card).querySelector('svg.icon-external-link')).not.toBeNull()
    await card.settle()
    expect(card.text('.btn-open .btn-words > span')[1]).toBe(
      `Compare the ${String(home.pathways.length)} options and all 6 routes with Saoirse`,
    )
    openButton(card).click()
    await card.settle()
    expect(card.opened).toEqual([recorded.planHome.saveLink?.url])
    expect(card.text('.status').join(' ')).toMatch(/Opens in the Saoi app; the link works once/)
  })

  it('compares from the button when the automatic run failed, and says so when it fails again', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    await card.settle()
    openButton(card).click()
    await card.settle()
    expect(card.calls.filter((call) => call.name === 'saoi_build_plan')).toHaveLength(2)
    expect(card.text('.status').join(' ')).toMatch(/could not be fetched from the card/)
  })

  it('folds the footer to one line, and opens what was assumed, the warnings, the 24-hour note and the statement', async () => {
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
    // The 24-hour note is no longer under the button.
    expect(card.text('.actions p').join(' ')).not.toMatch(/Held for 24 hours/)
    await card.settle()
    // It stays open across the redraw the automatic comparison brings.
    expect(footDetail(card).hidden).toBe(false)
  })

  it('takes the comparison’s own warnings once it returned them, else the statutory three', async () => {
    const card = open(recorded.homeCalculatorSecondHand, {
      ...responses,
      saoi_build_plan: { ...recorded.planHome, home: { ...home, warnings: ['Warning: as returned.'] } },
    })
    await card.settle()
    expect(card.text('#foot-detail p').filter((line) => line.startsWith('Warning:'))).toEqual([
      'Warning: as returned.',
    ])
    const empty = open(recorded.homeCalculatorSecondHand, {
      ...responses,
      saoi_build_plan: { ...recorded.planHome, home: { ...home, warnings: [] } },
    })
    await empty.settle()
    expect(empty.text('#foot-detail p').filter((line) => line.startsWith('Warning:'))).toHaveLength(3)
  })

  it('never words a route or an option as a pick, with every route and the footer open', async () => {
    for (const result of [recorded.homeCalculatorSecondHand, recorded.homeCalculatorNewBuild]) {
      const card = open(result, responses)
      await card.settle()
      card.byText('See all routes (6)')?.click()
      for (const head of Array.from(card.doc.querySelectorAll('.route-head')))
        (head as unknown as HTMLElement).click()
      footToggle(card).click()
      expect(footDetail(card).hidden).toBe(false)
      expect(card.doc.querySelector('#card')?.textContent).not.toMatch(PICK)
    }
  })
})
