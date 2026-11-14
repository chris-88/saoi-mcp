import { Window } from 'happy-dom'
import { describe, expect, it, vi } from 'vitest'
import { planCardApp } from '../src/ui/planCardApp.js'
import { planCardModel } from '../src/ui/planCardModel.js'
import { cardMemory } from '../src/ui/remember.js'
import { recorded } from './helpers.js'

// The card watches its own size for the host; nothing here needs it.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {
      // No layout in happy-dom.
    }
  },
)

/**
 * The plan card's own bridge, driven over postMessage: the host is a stand-in parent that answers
 * every request and records the links it is asked to open.
 */
function mount(existing?: Window) {
  const window = existing ?? new Window({ url: 'https://card.test/' })
  const doc = window.document
  doc.body.innerHTML = '<main id="card" aria-busy="true"></main>'
  const win = window as unknown as globalThis.Window
  const opened: string[] = []
  const host = {
    postMessage: (message: { id?: number; method?: string; params?: { url?: string } }) => {
      if (message.method === 'ui/open-link' && typeof message.params?.url === 'string')
        opened.push(message.params.url)
      if (typeof message.id === 'number') answer({ jsonrpc: '2.0', id: message.id, result: {} })
    },
  }
  Object.defineProperty(win, 'parent', { value: host, configurable: true })
  const answer = (data: unknown): void => {
    queueMicrotask(() => {
      win.dispatchEvent(
        new window.MessageEvent('message', { data, source: host as never }) as unknown as Event,
      )
    })
  }
  planCardApp(win, planCardModel, cardMemory(win))
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const result = async (content: unknown): Promise<void> => {
    answer({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: content } })
    await settle()
  }
  const buttons = (): HTMLButtonElement[] =>
    Array.from(doc.querySelectorAll('button')) as unknown as HTMLButtonElement[]
  const byText = (text: string): HTMLButtonElement | undefined =>
    buttons().find((node) => node.textContent === text)
  return { window, doc, opened, result, settle, byText }
}

const plan = recorded.planHome
const link = plan.saveLink?.url ?? ''

describe('plan card: the way back in (2026-11-14)', () => {
  it('opens its link, says it can be tapped again, and leads with Continue in Saoi from then on', async () => {
    const card = mount()
    await card.result(plan)
    expect(card.byText('Continue in Saoi')).toBeUndefined()
    const save = card.doc.querySelector('.actions .save') as unknown as HTMLButtonElement
    save.click()
    await card.settle()
    expect(card.opened).toEqual([link])
    expect(card.doc.querySelector('.status')?.textContent).toBe(
      'Opens in the Saoi app. Tap again any time to come back to your conversation.',
    )
    expect(card.byText('Continue in Saoi')).toBeDefined()
  })

  it('draws the return state when the host re-renders it from the stored result', async () => {
    const first = mount()
    await first.result(plan)
    ;(first.doc.querySelector('.actions .save') as unknown as HTMLButtonElement).click()
    await first.settle()

    const card = mount(first.window)
    await card.result(plan)
    const children = Array.from(card.doc.querySelector('#card')?.children ?? [])
    expect(children.map((node) => node.className)).toEqual(['header', 'return', 'plan-toggle', 'plan-fold'])
    expect(card.doc.querySelector('.return-title')?.textContent).toBe('Continue your conversation in Saoi')
    expect(card.doc.querySelector('.return p.small')?.textContent).toBe(
      'Back to Saoirse with everything as you left it.',
    )
    const fold = card.doc.querySelector('#plan-fold') as unknown as HTMLElement
    expect(fold.hidden).toBe(true)
    expect(fold.querySelector('.actions .save')).not.toBeNull()
    const toggle = card.doc.querySelector('.plan-toggle') as unknown as HTMLButtonElement
    expect(toggle.textContent).toBe('Show the plan')
    expect(toggle.querySelector('svg.plan-chevron path')?.getAttribute('d')).toBe('m6 9 6 6 6-6')
    toggle.click()
    expect(fold.hidden).toBe(false)
    expect(toggle.textContent).toBe('Hide the plan')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    card.byText('Continue in Saoi')?.click()
    await card.settle()
    expect(card.opened).toEqual([link])
  })

  it('a card for another plan draws the plan as before', async () => {
    const first = mount()
    await first.result(plan)
    ;(first.doc.querySelector('.actions .save') as unknown as HTMLButtonElement).click()
    await first.settle()
    const other = mount(first.window)
    await other.result({
      ...plan,
      saveLink: { ...plan.saveLink, url: 'https://app.saoi.ie/?plan=ZyXwVuTsRqPoNmLkJiHgFe' },
    })
    expect(other.byText('Continue in Saoi')).toBeUndefined()
  })
})
