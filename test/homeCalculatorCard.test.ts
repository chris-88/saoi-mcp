import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bridge } from '../src/ui/bridge.js'
import { homeCalculatorApp } from '../src/ui/homeCalculatorApp.js'
import { homeCalculatorModel } from '../src/ui/homeCalculatorModel.js'
import { recorded } from './helpers.js'

/**
 * The card's DOM, driven the way a host drives it: tool-input with the arguments, then
 * tool-result with saoi-api's recorded answer. The bridge is a stand-in that answers tools/call
 * from recordings and records every call and opened link.
 */
function mount(responses: Record<string, unknown> = {}) {
  const window = new Window({ url: 'https://card.test/' })
  const doc = window.document
  doc.body.innerHTML = '<main id="card" aria-busy="true"></main>'
  const handlers = new Map<string, (params: Record<string, unknown> | null) => void>()
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const opened: string[] = []
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
    updateContext: () => Promise.resolve(),
    start: () => Promise.resolve(),
    record: (value) =>
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null,
  }
  homeCalculatorApp(window as unknown as globalThis.Window, bridge, homeCalculatorModel())
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
  return { doc, emit, calls, opened, buttons, byText, settle, text }
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
const PICK = /\b(best|faster|recommended|eligible|eligibility|right for you)\b/i

describe('home calculator card v5: folded when the host gave the figures', () => {
  it('heads the plan with its title, an Estimate badge and Edit, and chips only for the facts still missing', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('#in-depositSavedEur')).toBeNull()
    expect(card.text('header .title')).toEqual(['Your home-buying planEstimate'])
    expect(card.text('header .badge')).toEqual(['Estimate'])
    expect(card.doc.querySelector('header')?.querySelector('button')?.textContent).toBe('Edit')
    // Second-hand was given; first home and rent were not. Rent comes last.
    expect(card.text('.facts .chip')).toEqual(['First home?', 'Rent a month? (optional)'])
    expect(card.doc.querySelectorAll('input, select')).toHaveLength(0)
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

  it('takes rent from its chip into the request', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('Rent a month? (optional)')?.click()
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

describe('home calculator card v5: the month, the facts and the progress', () => {
  it('shows the month the money is ready, one fact line, and saved against needed at the keys', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const { inputs, figures } = result
    const needed = figures.neededAtKeysEur ?? 0
    expect(card.text('.hero .eyebrow')).toEqual(['Ready to buy'])
    // The card's own estimate: €17,000 to go at €1,000 a month from November 2026.
    expect(figures.depositReachedOn).toBe('2028-04')
    expect(card.text('.hero-month')).toEqual(['April 2028'])
    expect(card.text('.hero p').join(' | ')).toContain('€400,000 second-hand, €47,000 needed at the keys')
    expect(needed).toBe(47_000)
    const bar = card.doc.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(needed))
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(inputs.depositSavedEur))
    expect(card.text('.meter p').join(' | ')).toBe('€30,000 of €47,000 | €1,000 a month€17,000 to go')
    expect(card.text('.meter .kv span')).toEqual(['€1,000 a month', '€17,000 to go'])
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
    expect(card.text('.route-head > .route-line')[0]).toBe(
      'New build with Help to Buy · keys Nov 2026 if your tax paid covers €35,000',
    )
  })

  it('shows the price and the mortgage as tiles, and the options once compared', async () => {
    const card = open(recorded.homeCalculatorSecondHand, { saoi_build_plan: recorded.planHome })
    const tiles = (): string[] => card.text('.tile')
    expect(tiles()).toEqual(['Home price€400,000', 'Mortgage€360,000', 'OptionsTap Open in Saoi'])
    card.byText('Open in Saoi')?.click()
    await card.settle()
    const home = recorded.planHome.home
    if (home === null) throw new Error('recording has no home')
    const lowest = Math.round(Math.min(...home.pathways.map((option) => option.mortgage.monthlyRepayment)))
    expect(tiles()[2]).toBe(
      `Options${String(home.pathways.length)}, from €${lowest.toLocaleString('en-IE')}/mo`,
    )
    // The options are not listed on the card; they open in the app.
    expect(card.doc.querySelectorAll('.option-head')).toHaveLength(0)
    expect(card.byText('5-year cost')).toBeUndefined()
  })
})

describe('home calculator card v5: expanded without figures', () => {
  it('opens the inputs as today, with Show my options as an outline button', () => {
    const card = mount({ saoi_home_calculator: recorded.homeCalculator })
    card.emit('ui/notifications/tool-input', { arguments: {} })
    card.emit('ui/notifications/tool-result', { structuredContent: recorded.homeCalculator })
    expect(card.doc.querySelector('#in-depositSavedEur')).not.toBeNull()
    expect(card.doc.querySelector('#in-county')).not.toBeNull()
    expect(card.doc.querySelector('#in-monthlyRentEur')).not.toBeNull()
    expect(card.byText('Show my options')?.className).toMatch(/btn-outline/)
    expect(card.doc.querySelector('.chips')).toBeNull()
    expect(card.text('label').join(' ')).toMatch(/Rent a month \(optional\)/)
  })
})

describe('home calculator card v5: other routes', () => {
  it('shows the two routes after the customer’s own kind, then See all routes (N) with every route', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const ids = (): string[] =>
      Array.from(card.doc.querySelectorAll('.route-head')).map(
        (node) => node.getAttribute('aria-controls')?.replace('route-', '') ?? '',
      )
    expect(card.text('h3.label')).toContain('Other routes')
    expect(ids()).toEqual(result.routes.slice(1, 3).map((route) => route.id))
    expect(ids()).not.toContain('second_hand')
    expect(card.text('.route-head > .route-line')).toEqual(
      result.routes.slice(1, 3).map((route) => route.line.replace(`${route.name}: `, `${route.name} · `)),
    )
    expect(card.text('.route-head > .badge')).toEqual(['Potential', 'One detail'])
    expect(card.doc.querySelectorAll('.route-head .chevron')).toHaveLength(2)
    expect(card.doc.querySelectorAll('.route-head[aria-expanded="true"]')).toHaveLength(0)
    card.byText(`See all routes (${String(result.routes.length)})`)?.click()
    expect(ids()).toEqual(result.routes.map((route) => route.id))
    expect(card.byText(`See all routes (${String(result.routes.length)})`)).toBeUndefined()
  })

  it('opens a route to its reason, conditions and first source, with nothing styled as a pick', () => {
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

describe('home calculator card v5: Open in Saoi and the footer', () => {
  const responses = { saoi_build_plan: recorded.planHome, saoi_save_plan: recorded.saved }

  it('has one filled button, Open in Saoi, which compares, then opens the single-use link', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    const filled = card.buttons().filter((node) => node.classList.contains('btn'))
    expect(filled.map((node) => node.textContent)).toEqual(['Open in Saoi'])
    expect(card.text('.actions p')).toContain('Compare every option and all 6 routes with Saoirse')
    expect(card.text('.actions p')).toContain('Held for 24 hours, then deleted unless opened.')
    card.byText('Open in Saoi')?.click()
    await card.settle()
    expect(card.calls.map((call) => call.name)).toContain('saoi_build_plan')
    expect(card.opened).toEqual([recorded.planHome.saveLink?.url])
    expect(card.text('.status').join(' ')).toMatch(/Opens in the Saoi app; the link works once/)
    expect(card.text('.actions p')).toContain(
      `Compare the ${String(recorded.planHome.home?.pathways.length ?? 0)} options and all 6 routes with Saoirse`,
    )
  })

  it('says what was assumed, then the warnings only once the comparison returned them, then the statement', async () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result, responses)
    const foot = (): string[] => card.text('footer p')
    expect(result.assumed.length).toBeGreaterThan(0)
    expect(foot()[0]).toBe(
      `Assumed: ${result.assumed.map((line) => line.replace(/\.$/, '')).join(', ')}. Estimates only; rates and offers are not confirmed.`,
    )
    expect(foot().join(' ')).not.toMatch(/Warning:/)
    expect(foot().at(-1)).toMatch(/not regulated by the Central Bank of Ireland/)
    card.byText('Open in Saoi')?.click()
    await card.settle()
    const warnings = recorded.planHome.home?.warnings ?? []
    expect(warnings).toHaveLength(3)
    expect(foot().slice(1, -1)).toEqual(warnings)
    expect(foot().at(-1)).toMatch(/not regulated by the Central Bank of Ireland/)
  })

  it('never words a route or an option as a pick, with every route open', async () => {
    for (const result of [recorded.homeCalculatorSecondHand, recorded.homeCalculatorNewBuild]) {
      const card = open(result, responses)
      card.byText('Open in Saoi')?.click()
      await card.settle()
      card.byText('See all routes (6)')?.click()
      for (const head of Array.from(card.doc.querySelectorAll('.route-head')))
        (head as unknown as HTMLElement).click()
      expect(card.doc.querySelector('#card')?.textContent).not.toMatch(PICK)
    }
  })
})
