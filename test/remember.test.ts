import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { cardMemory } from '../src/ui/remember.js'

const LINK = 'https://app.saoi.ie/?plan=AbCdEfGhIjKlMnOpQrStUv'
const OTHER = 'https://app.saoi.ie/?plan=ZyXwVuTsRqPoNmLkJiHgFe'

const sandbox = (): globalThis.Window =>
  new Window({ url: 'https://sandbox.test/' }) as unknown as globalThis.Window

describe('a card’s memory of the link it opened', () => {
  it('remembers the link and the time, and recalls it for the same link', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK)
    // A fresh card in the same sandbox: a host re-render.
    const recalled = cardMemory(win).recallOpened(LINK)
    expect(recalled?.url).toBe(LINK)
    expect(Number.isNaN(Date.parse(recalled?.at ?? ''))).toBe(false)
  })

  it('knows a plan link by its token, in either form', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK)
    expect(cardMemory(win).recallOpened('https://app.saoi.ie/#/plan/AbCdEfGhIjKlMnOpQrStUv')?.url).toBe(LINK)
  })

  it('recalls nothing for another link, or before anything was opened', () => {
    const win = sandbox()
    expect(cardMemory(win).recallOpened(LINK)).toBeNull()
    cardMemory(win).rememberOpened(LINK)
    expect(cardMemory(win).recallOpened(OTHER)).toBeNull()
  })

  it('keeps a link under a scope that names the card, for a card whose result carries no link', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK, 'home:[["depositSavedEur",32000]]')
    expect(cardMemory(win).recallOpened('home:[["depositSavedEur",32000]]')?.url).toBe(LINK)
    expect(cardMemory(win).recallOpened('home:[["depositSavedEur",40000]]')).toBeNull()
  })

  it('stores only the link and the time, under a key that does not spell out the token', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK)
    expect(win.localStorage.length).toBe(1)
    const key = win.localStorage.key(0) ?? ''
    expect(key).toMatch(/^saoi\.opened\.[0-9a-f]{8}$/)
    expect(Object.keys(JSON.parse(win.localStorage.getItem(key) ?? '{}') as object)).toEqual(['url', 'at'])
  })

  it('uses no storage for an empty scope', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK, '')
    expect(win.localStorage.length).toBe(0)
    expect(cardMemory(win).recallOpened('')).toBeNull()
  })

  it('forgets quietly when storage is blocked', () => {
    const win = sandbox()
    Object.defineProperty(win, 'localStorage', {
      get: () => {
        throw new Error('SecurityError')
      },
    })
    expect(() => {
      cardMemory(win).rememberOpened(LINK)
    }).not.toThrow()
    expect(cardMemory(win).recallOpened(LINK)).toBeNull()
  })

  it('ignores a stored record that is not a link and a time', () => {
    const win = sandbox()
    cardMemory(win).rememberOpened(LINK)
    const key = win.localStorage.key(0) ?? ''
    win.localStorage.setItem(key, JSON.stringify({ url: 'javascript:alert(1)', at: 'now' }))
    expect(cardMemory(win).recallOpened(LINK)).toBeNull()
    win.localStorage.setItem(key, 'not json')
    expect(cardMemory(win).recallOpened(LINK)).toBeNull()
  })

  describe('in ChatGPT, with the host’s widget state', () => {
    const withWidgetState = (initial: Record<string, unknown> | null = null) => {
      const win = sandbox()
      const host = {
        widgetState: initial,
        setWidgetState(state: Record<string, unknown>) {
          host.widgetState = state
        },
      }
      Object.defineProperty(win, 'openai', { value: host })
      return { win, host }
    }

    it('keeps the record there too, beside whatever else the card kept', () => {
      const { win, host } = withWidgetState({ other: 1 })
      cardMemory(win).rememberOpened(LINK, '')
      expect(host.widgetState?.['other']).toBe(1)
      expect(Object.keys(host.widgetState?.['saoiOpened'] ?? {})).toEqual(['url', 'at'])
      expect((host.widgetState?.['saoiOpened'] as { url?: string } | undefined)?.url).toBe(LINK)
    })

    it('recalls from widget state when storage has nothing, for this card’s scope', () => {
      const { win } = withWidgetState({ saoiOpened: { url: LINK, at: '2026-11-14T12:00:00.000Z' } })
      expect(cardMemory(win).recallOpened('')).toEqual({ url: LINK, at: '2026-11-14T12:00:00.000Z' })
      expect(cardMemory(win).recallOpened('home:x')?.url).toBe(LINK)
      expect(cardMemory(win).recallOpened(LINK)?.url).toBe(LINK)
      // A plan card checks it is its own link.
      expect(cardMemory(win).recallOpened(OTHER)).toBeNull()
    })
  })
})
