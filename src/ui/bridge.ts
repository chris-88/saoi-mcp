/// <reference lib="dom" />

/**
 * The MCP Apps `ui/*` bridge over postMessage (spec 2026-01-26, `io.modelcontextprotocol/ui`),
 * as the plan card speaks it: initialize, notifications from the host, size, open-link,
 * update-model-context and tools/call. Self-contained: a card's script carries this function's
 * own source, so it uses nothing from module scope.
 */
export interface Bridge {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
  notify(method: string, params?: Record<string, unknown>): void
  /** Host notifications by method: tool-input, tool-result, host-context-changed, ... */
  on(method: string, handler: (params: Record<string, unknown> | null) => void): void
  /** tools/call; resolves to the result record, or null on an error result or a failure. */
  callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null>
  openLink(url: string): Promise<boolean>
  updateContext(text: string): Promise<void>
  /** ui/initialize, then initialized; applies the host's theme, fonts and safe area. */
  start(appName: string): Promise<void>
  record(value: unknown): Record<string, unknown> | null
}

export function createBridge(win: Window): Bridge {
  const doc = win.document
  const PROTOCOL_VERSION = '2026-01-26'
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const handlers = new Map<string, (params: Record<string, unknown> | null) => void>()
  let nextId = 1
  let canOpenLinks = true
  let fontsApplied = false

  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const post = (message: Record<string, unknown>): void => {
    win.parent.postMessage({ jsonrpc: '2.0', ...message }, '*')
  }
  const notify = (method: string, params: Record<string, unknown> = {}): void => {
    post({ method, params })
  }
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ id, method, params })
    })

  const applyContext = (context: Record<string, unknown> | null): void => {
    if (context === null) return
    const theme = context['theme']
    if (theme === 'light' || theme === 'dark') {
      doc.documentElement.dataset['theme'] = theme
      doc.documentElement.style.colorScheme = theme
    }
    const styles = record(context['styles'])
    const variables = record(styles?.['variables'])
    if (variables !== null) {
      for (const [name, value] of Object.entries(variables)) {
        if (name.startsWith('--') && typeof value === 'string')
          doc.documentElement.style.setProperty(name, value)
      }
    }
    const fonts = record(styles?.['css'])?.['fonts']
    if (!fontsApplied && typeof fonts === 'string' && fonts !== '') {
      const style = doc.createElement('style')
      style.textContent = fonts
      doc.head.append(style)
      fontsApplied = true
    }
    const insets = record(context['safeAreaInsets'])
    if (insets !== null) {
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const value = insets[side]
        if (typeof value === 'number') doc.body.style.setProperty(`padding-${side}`, `${String(value)}px`)
      }
    }
  }

  let lastHeight = 0
  const reportSize = (): void => {
    const html = doc.documentElement
    const previous = html.style.height
    html.style.height = 'max-content'
    const height = Math.ceil(html.getBoundingClientRect().height)
    html.style.height = previous
    if (height !== lastHeight) {
      lastHeight = height
      notify('ui/notifications/size-changed', {
        width: Math.ceil(html.getBoundingClientRect().width),
        height,
      })
    }
  }

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win.parent) return
    const message = record(event.data)
    if (message === null || message['jsonrpc'] !== '2.0') return
    const id = message['id']
    const method = message['method']
    if (typeof method !== 'string') {
      if (typeof id !== 'number') return
      const waiter = pending.get(id)
      if (waiter === undefined) return
      pending.delete(id)
      const error = record(message['error'])
      if (error === null) waiter.resolve(message['result'])
      else waiter.reject(new Error(typeof error['message'] === 'string' ? error['message'] : 'host error'))
      return
    }
    const params = record(message['params'])
    if (id !== undefined && id !== null) {
      if (method === 'ui/resource-teardown' || method === 'ping') post({ id, result: {} })
      else post({ id, error: { code: -32601, message: 'Method not found' } })
      return
    }
    if (method === 'ui/notifications/host-context-changed') applyContext(params)
    handlers.get(method)?.(params)
  })

  return {
    request,
    notify,
    record,
    on: (method, handler) => {
      handlers.set(method, handler)
    },
    callTool: async (name, args) => {
      try {
        const result = record(await request('tools/call', { name, arguments: args }))
        return result === null || result['isError'] === true ? null : result
      } catch {
        return null
      }
    },
    openLink: async (url) => {
      if (!canOpenLinks) return false
      try {
        const result = record(await request('ui/open-link', { url }))
        return result?.['isError'] !== true
      } catch {
        return false
      }
    },
    updateContext: async (text) => {
      try {
        await request('ui/update-model-context', { content: [{ type: 'text', text }] })
      } catch {
        // A host without model context still has the card.
      }
    },
    start: async (appName) => {
      try {
        const result = record(
          await request('ui/initialize', {
            appInfo: { name: appName, version: '1.0.0' },
            appCapabilities: { availableDisplayModes: ['inline'] },
            protocolVersion: PROTOCOL_VERSION,
          }),
        )
        const capabilities = record(result?.['hostCapabilities'])
        canOpenLinks = capabilities === null || record(capabilities['openLinks']) !== null
        applyContext(record(result?.['hostContext']))
      } catch {
        // Answered or not, say we are ready: the tool result is what matters.
      }
      notify('ui/notifications/initialized')
      new ResizeObserver(reportSize).observe(doc.documentElement)
      reportSize()
    },
  }
}
