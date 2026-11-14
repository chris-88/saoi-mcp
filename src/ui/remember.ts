/// <reference lib="dom" />

/** A plan link the customer opened from a card, and when (ISO 8601). Never any figures. */
export interface OpenedLink {
  readonly url: string
  readonly at: string
}

/**
 * What a card remembers about itself across a re-render (2026-11-14, the card as the way back in).
 */
export interface CardMemory {
  /**
   * After the host opened `link`: remember it for the card that `scope` names (the link itself by
   * default). An empty scope keeps it in the host's widget state only.
   */
  rememberOpened(link: string, scope?: string): void
  /** The link this card opened before, or null: never opened, or nowhere to remember it. */
  recallOpened(scope: string): OpenedLink | null
}

/**
 * The card's memory of the link it opened.
 *
 * A host re-renders a card from the stored tool result when the customer comes back to the
 * conversation, so a card that kept "opened" in a variable drew the plan again as if never opened
 * (Chris, ChatGPT, 2026-11-14). Two places to keep it, tried in order:
 *
 * 1. The host's widget state. The MCP Apps spec (2026-01-26) has no state call (state persistence
 *    is listed as future work), but ChatGPT offers `window.openai.widgetState` and
 *    `setWidgetState` as an extension, scoped to this one card. Feature-detected: absent
 *    elsewhere.
 * 2. `localStorage` on the sandbox's origin, keyed by a hash of the scope (the link's token, or
 *    for the home calculator its tool arguments). Blocked storage (Safari's partitioning, an
 *    opaque origin) throws; every access is caught and the card simply forgets.
 *
 * Self-contained: a card's script carries this function's own source, so it uses nothing from
 * module scope.
 */
export function cardMemory(win: Window): CardMemory {
  const KEY = 'saoiOpened'
  const PREFIX = 'saoi.opened.'

  interface OpenAiGlobal {
    widgetState?: unknown
    setWidgetState?: (state: Record<string, unknown>) => unknown
  }
  const host = (): OpenAiGlobal | null => {
    try {
      const openai = (win as unknown as { openai?: unknown }).openai
      return typeof openai === 'object' && openai !== null ? openai : null
    } catch {
      return null
    }
  }
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const asOpened = (value: unknown): OpenedLink | null => {
    const found = asRecord(value)
    const url = found?.['url']
    const at = found?.['at']
    return typeof url === 'string' && url.startsWith('https://') && typeof at === 'string'
      ? { url, at }
      : null
  }
  /** The plan token when the scope is a plan link, so `?plan=` and `#/plan/` forms agree. */
  const tokenOf = (scope: string): string => {
    const match = /(?:[?&]plan=|#\/plan\/)([A-Za-z0-9_-]{22})/.exec(scope)
    return match?.[1] ?? scope
  }
  /** FNV-1a, 32 bits, as hex: a short key that does not spell out the token. */
  const hash = (text: string): string => {
    let value = 0x811c9dc5
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }
  const storageKey = (scope: string): string => PREFIX + hash(tokenOf(scope))
  const isLink = (scope: string): boolean => scope.startsWith('https://')

  return {
    rememberOpened: (link, scope = link) => {
      const opened: OpenedLink = { url: link, at: new Date().toISOString() }
      const openai = host()
      if (typeof openai?.setWidgetState === 'function') {
        try {
          const current = asRecord(openai.widgetState) ?? {}
          void Promise.resolve(openai.setWidgetState({ ...current, [KEY]: opened })).catch(() => undefined)
        } catch {
          // The host refused; storage below may still keep it.
        }
      }
      if (scope === '') return
      try {
        win.localStorage.setItem(storageKey(scope), JSON.stringify(opened))
      } catch {
        // No storage here: the card forgets, as it did before.
      }
    },
    recallOpened: (scope) => {
      try {
        const kept = asOpened(asRecord(host()?.widgetState)?.[KEY])
        // Widget state belongs to this one card; a plan card still checks it is its own link.
        if (kept !== null && (!isLink(scope) || tokenOf(kept.url) === tokenOf(scope))) return kept
      } catch {
        // Fall through to storage.
      }
      if (scope === '') return null
      try {
        const raw = win.localStorage.getItem(storageKey(scope))
        return raw === null ? null : asOpened(JSON.parse(raw))
      } catch {
        return null
      }
    },
  }
}
