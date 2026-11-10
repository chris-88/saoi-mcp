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

describe('home calculator card v4: folded when the host gave the figures', () => {
  it('starts folded to one summary line with Edit, and chips only for the facts still missing', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    expect(card.doc.querySelector('#in-depositSavedEur')).toBeNull()
    expect(card.text('.summary-row p')).toEqual(['€30k saved · €1,000/mo · €100k · €400k'])
    expect(card.byText('Edit')).toBeDefined()
    // Second-hand was given; first home and rent were not. Rent comes last.
    expect(card.text('.summary-row ~ .chips .chip')).toEqual(['First home?', 'Rent a month? (optional)'])
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

  it('keeps the statement and the three warnings in small text at the foot', () => {
    const card = open(recorded.homeCalculatorSecondHand)
    const foot = card.text('footer p').join(' ')
    expect(foot).toMatch(/you may lose your home/)
    expect(foot).toMatch(/monthly repayments may increase/)
    expect(foot).toMatch(/go into arrears/)
    expect(foot).toMatch(/not regulated by the Central Bank of Ireland/)
  })
})

describe('home calculator card v4: expanded without figures', () => {
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

describe('home calculator card v4: one headline, then the routes', () => {
  it('gives one headline line without a conditional Help to Buy, and the new-build route names it', () => {
    const card = open(recorded.homeCalculatorNewBuild)
    const headline = card.text('.headline')
    expect(headline).toHaveLength(1)
    expect(headline[0]).toMatch(/deposit ready around Apr 2028 \(before interest\)/)
    expect(headline[0]).not.toMatch(/Nov 2026/)
    expect(card.text('.route-head > span:first-child')[0]).toBe(
      'New build with Help to Buy: keys Nov 2026 if your tax paid covers €35,000',
    )
  })

  it('shows the first three route lines in saoi-api’s order, then More routes (N)', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const lines = (): string[] => card.text('.route-head > span:first-child')
    expect(lines()).toEqual(result.routes.slice(0, 3).map((route) => route.line))
    expect(card.text('.route-head > span.muted')).toEqual(['Potential', 'Potential', 'One detail'])
    expect(card.doc.querySelectorAll('.route-head[aria-expanded="true"]')).toHaveLength(0)
    card.byText('More routes (3)')?.click()
    expect(lines()).toEqual(result.routes.map((route) => route.line))
    expect(card.byText('More routes (3)')).toBeUndefined()
  })

  it('opens a route to its reason, conditions and first source, with nothing styled as a pick', () => {
    const result = recorded.homeCalculatorSecondHand
    const card = open(result)
    const head = card.doc.querySelector('.route-head') as unknown as HTMLButtonElement
    head.click()
    const body = card.doc.querySelector('#route-second_hand') as unknown as HTMLElement
    expect(body.hidden).toBe(false)
    expect(body.textContent).toContain(result.routes[0]?.reason ?? 'missing')
    expect(body.textContent).toContain(result.routes[0]?.conditions[0] ?? 'missing')
    const link = body.querySelector('a')
    expect(link?.getAttribute('href')).toBe(result.routes[0]?.sources[0]?.url)
    expect(link?.textContent).toBe('Source: centralbank.ie (read 2026-11-09)')
    expect(card.doc.querySelector('#card')?.textContent).not.toMatch(/best|faster|recommended/i)
  })

  it('gives a missing detail a chip that opens its control, and sends the answer', async () => {
    const card = open(recorded.homeCalculatorSecondHand)
    card.byText('More routes (3)')?.click()
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

describe('home calculator card v4: options and Open in Saoi', () => {
  const responses = { saoi_build_plan: recorded.planHome, saoi_save_plan: recorded.saved }

  it('has one filled button, Open in Saoi, which compares, then opens the single-use link', async () => {
    const card = open(recorded.homeCalculatorSecondHand, responses)
    const filled = card.buttons().filter((node) => node.classList.contains('btn'))
    expect(filled.map((node) => node.textContent)).toEqual(['Open in Saoi'])
    expect(card.byText('Show my options')?.className).toMatch(/btn-outline/)
    card.byText('Open in Saoi')?.click()
    await card.settle()
    expect(card.calls.map((call) => call.name)).toContain('saoi_build_plan')
    expect(card.opened).toEqual([recorded.planHome.saveLink?.url])
    expect(card.text('.status').join(' ')).toMatch(/Opens in the Saoi app; the link works once/)
    expect(card.doc.querySelectorAll('.options .option-head')).toHaveLength(3)
  })

  it('lists the top three options with the sort chip, then rent against the repayments when given', async () => {
    const result = recorded.homeCalculatorSecondHand
    const card = mount({ saoi_home_calculator: result, ...responses })
    card.emit('ui/notifications/tool-input', { arguments: { ...result.inputs, monthlyRentEur: 1_800 } })
    card.emit('ui/notifications/tool-result', { structuredContent: result })
    expect(card.text('.chip')).not.toContain('Rent a month? (optional)')
    card.byText('Show my options')?.click()
    await card.settle()
    expect(card.doc.querySelectorAll('ol.options > li')).toHaveLength(3)
    expect(card.byText('5-year cost')?.getAttribute('aria-pressed')).toBe('true')
    expect(card.byText(`Show all ${String(recorded.planHome.home?.pathways.length ?? 0)}`)).toBeDefined()
    expect(card.text('p').find((line) => line.startsWith('Rent '))).toMatch(
      /^Rent €1,800 a month against a €[\d,]+( to €[\d,]+)? repayment$/,
    )
    expect(card.byText('Update my options')).toBeUndefined()
  })
})
