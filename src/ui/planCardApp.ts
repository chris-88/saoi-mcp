/// <reference lib="dom" />
import type { BuildPlanResult } from '../saoiClient.js'
import type { PlanCardView } from './planCardModel.js'

/**
 * The plan card's browser side: the MCP Apps `ui/*` bridge over postMessage (spec 2026-01-26,
 * `io.modelcontextprotocol/ui`) and the DOM. It runs inside the host's sandboxed frame as the
 * source of this function, so it uses nothing from module scope: `model` is handed in.
 *
 * The bridge is small on purpose (initialize, the tool result, host context, size, open-link and
 * one tools/call) so the card needs no external script and no CSP allowance for one.
 *
 * Every string goes in with `textContent`: product names and notes are data, never markup.
 */
export function planCardApp(win: Window, model: (result: BuildPlanResult) => PlanCardView): void {
  const doc = win.document
  const PROTOCOL_VERSION = '2026-01-26'
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 1
  let canOpenLinks = true

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
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

  // ---- DOM -------------------------------------------------------------------------------------

  const root = doc.getElementById('card')
  if (root === null) return
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string | null,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag)
    if (className !== undefined && className !== '') node.className = className
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }
  const section = (label: string): HTMLElement => {
    const node = el('section', 'section')
    node.append(el('h3', 'label', label))
    return node
  }

  const status = el('p', 'status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const showLink = (url: string): void => {
    const link = el('a', 'claim', url)
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    status.append(' ', link)
  }

  const openLink = async (url: string): Promise<boolean> => {
    if (!canOpenLinks) return false
    try {
      const result = record(await request('ui/open-link', { url }))
      return result?.['isError'] !== true
    } catch {
      return false
    }
  }

  const save = async (view: PlanCardView, button: HTMLButtonElement): Promise<void> => {
    button.disabled = true
    status.textContent = view.draftUrl === null ? 'Saving the plan to Saoi…' : 'Opening the Saoi app…'
    let url = view.draftUrl
    if (url === null) {
      try {
        const result = record(
          await request('tools/call', { name: 'saoi_save_plan', arguments: { plan: view.plan } }),
        )
        const content = record(result?.['structuredContent'])
        const claim = content?.['claimUrl']
        if (result?.['isError'] === true || typeof claim !== 'string' || !claim.startsWith('https://')) {
          throw new Error('not saved')
        }
        url = claim
        try {
          await request('ui/update-model-context', {
            content: [
              {
                type: 'text',
                text: `The customer saved this plan to the Saoi app from the plan card. Their one-time link (valid seven days): ${claim}. Do not call saoi_save_plan again for this plan.`,
              },
            ],
          })
        } catch {
          // A host without model context still has the link on the card.
        }
      } catch {
        status.textContent = 'The plan could not be saved from the card. Ask in the chat to save it instead.'
        button.disabled = false
        return
      }
    }
    const opened = await openLink(url)
    const lead = view.draftUrl === null ? 'Saved. ' : ''
    status.textContent = opened
      ? `${lead}The plan opens in the Saoi app; the link works once.`
      : `${lead}Open the plan in the Saoi app (the link works once):`
    if (!opened) showLink(url)
    button.textContent = 'Open in Saoi app again'
    button.disabled = false
    button.onclick = () => {
      void openLink(url)
    }
  }

  /** A folded section: the summary is the tap target (44px), the body is built on demand. */
  const fold = (title: string, fill: (body: HTMLElement) => void): HTMLElement => {
    const more = el('details', 'more')
    more.append(el('summary', '', title))
    const body = el('div', 'fold')
    fill(body)
    more.append(body)
    return more
  }

  /**
   * Compact by default (after the fourth Claude test, on a phone): the title, the money found,
   * the goal and date, the position with its parts, one line per product and the save button.
   * Product detail, scenarios, what is not counted and the ranking basis fold away below.
   */
  const render = (view: PlanCardView): void => {
    root.replaceChildren()
    root.removeAttribute('aria-busy')

    const header = el('header', 'header')
    header.append(el('p', 'eyebrow', 'Saoi plan'), el('h2', 'title', view.title))
    root.append(header)

    const found = el('div', 'found')
    found.append(el('p', 'found-headline', view.moneyFound.headline))
    if (view.moneyFound.note !== null) found.append(el('p', 'small muted-strong', view.moneyFound.note))
    root.append(found)

    const summary = el('section', 'section')
    for (const goal of view.goals) {
      const row = el('p', 'row')
      row.append(el('span', 'strong', goal.label), el('span', 'muted small num', goal.detail))
      summary.append(row)
    }
    if (view.position !== null) {
      const position = el('div', 'position')
      const top = el('p', 'row')
      top.append(el('span', 'label', view.position.heading), el('span', 'total num', view.position.total))
      position.append(top)
      const parts = el('ul', 'rows')
      for (const part of view.position.parts) {
        const item = el('li', 'row small')
        item.append(el('span', 'muted', part.label), el('span', 'num', part.value))
        parts.append(item)
      }
      position.append(parts)
      if (view.position.note !== null) position.append(el('p', 'muted small', view.position.note))
      for (const note of view.assumed) position.append(el('p', 'small muted-strong', note))
      summary.append(position)
    } else {
      for (const note of view.assumed) summary.append(el('p', 'small muted-strong', note))
    }
    if (view.alternatives.length > 0) {
      const compare = el('ul', 'rows position')
      compare.setAttribute('aria-label', 'Alternatives compared in this call')
      for (const alternative of view.alternatives) {
        const item = el('li', 'row small')
        const name = el('span', '')
        name.append(el('span', 'strong', alternative.name))
        if (alternative.changes !== '') name.append(el('span', 'muted', ` (${alternative.changes})`))
        item.append(
          name,
          el(
            'span',
            'num',
            alternative.difference === null
              ? alternative.total
              : `${alternative.total} · ${alternative.difference}`,
          ),
        )
        compare.append(item)
      }
      summary.append(compare)
    }
    root.append(summary)

    if (view.products.length > 0) {
      const products = el('ol', 'products section')
      products.setAttribute('aria-label', 'Products in the plan')
      for (const product of view.products) {
        const item = el('li', 'row')
        const name = el('span', 'product-name')
        name.append(
          el('span', 'strong block', product.name),
          el('span', 'muted small block num', product.line),
        )
        item.append(name, el('span', 'strong num', product.rate))
        products.append(item)
      }
      root.append(products)
    }

    const actions = el('div', 'actions')
    const button = el('button', 'save', 'Save to Saoi app')
    button.type = 'button'
    button.onclick = () => {
      void save(view, button)
    }
    actions.append(button, status, el('p', 'small muted', view.app))
    root.append(actions)

    const folds = el('div', 'folds')
    if (view.products.length > 0) {
      folds.append(
        fold('Product detail and checks', (body) => {
          for (const product of view.products) {
            const item = el('div', 'product')
            item.append(
              el('p', 'strong', product.name),
              el(
                'p',
                'muted small',
                `${product.provider} · ${product.role}${product.rate === null ? '' : ` · ${product.rate}`}`,
              ),
            )
            if (product.amounts !== '') item.append(el('p', 'num small', product.amounts))
            if (product.projected !== null) item.append(el('p', 'muted small num', product.projected))
            item.append(el('p', product.guaranteeKnown ? 'small guarantee' : 'small flag', product.guarantee))
            if (product.checks.length > 0 || product.unknowns !== null) {
              const flags = el('ul', 'flags')
              for (const check of product.checks) flags.append(el('li', 'small', check))
              if (product.unknowns !== null) flags.append(el('li', 'small muted', product.unknowns))
              item.append(flags)
            }
            body.append(item)
          }
        }),
      )
    }
    if (view.scenarios.length > 0) {
      folds.append(
        fold('Scenarios', (body) => {
          for (const scenario of view.scenarios) {
            body.append(el('p', 'label', scenario.heading))
            const table = el('table', 'scenarios')
            const tbody = el('tbody')
            for (const row of scenario.rows) {
              const tr = el('tr', row.inPlan ? 'in-plan' : '')
              const label = el('th', '', row.label)
              label.scope = 'row'
              if (row.inPlan) label.append(el('span', 'badge', 'in this plan'))
              if (row.note !== null) label.append(el('span', 'muted small block', row.note))
              tr.append(label, el('td', 'num strong', row.net))
              tbody.append(tr)
            }
            table.append(tbody)
            body.append(table)
          }
        }),
      )
    }
    if (view.moneyFound.notCounted.length > 0) {
      folds.append(
        fold('What is not counted', (body) => {
          for (const line of view.moneyFound.notCounted) body.append(el('p', 'small', line))
        }),
      )
    }
    folds.append(
      fold('How it is ranked', (body) => {
        body.append(el('p', 'small', view.basis))
        for (const line of view.footer) body.append(el('p', 'small muted', line))
      }),
    )
    root.append(folds)

    const foot = el('footer', 'footer')
    foot.append(
      el('p', 'small muted', 'Information, not advice: options with their figures, for you to decide.'),
    )
    for (const line of view.attributions) foot.append(el('p', 'small muted', line))
    root.append(foot)
  }

  const showText = (text: string): void => {
    root.replaceChildren(el('p', 'muted small', text))
    root.removeAttribute('aria-busy')
  }

  /**
   * A money check before there is a plan (saoi_money_check with `plan` null): what Saoi found and
   * the questions that unlock a plan. Nothing to save yet, so no button.
   */
  const renderCheck = (content: Record<string, unknown>): void => {
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const review = record(content['review'])
    root.replaceChildren()
    root.removeAttribute('aria-busy')
    const header = el('header', 'header')
    header.append(el('p', 'eyebrow', 'Saoi money check'))
    root.append(header)
    const headline = record(review?.['moneyFound'])?.['headline']
    if (typeof headline === 'string') {
      const found = el('div', 'found')
      found.append(el('p', 'found-headline', headline))
      root.append(found)
    }
    const findings = (Array.isArray(review?.['findings']) ? (review['findings'] as unknown[]) : [])
      .map((finding) => record(finding)?.['headline'])
      .filter((line): line is string => typeof line === 'string')
    if (findings.length > 0) {
      const block = section('What Saoi found')
      const list = el('ul', 'flags')
      for (const line of findings) list.append(el('li', '', line))
      block.append(list)
      root.append(block)
    }
    const questions = strings(content['questions'])
    if (questions.length > 0) {
      const block = section('To build a plan, Saoi needs')
      const list = el('ul', 'flags')
      for (const line of questions) list.append(el('li', '', line))
      block.append(list)
      root.append(block)
    }
    const foot = el('footer', 'footer')
    foot.append(
      el('p', 'small muted', 'Information, not advice: options with their figures, for you to decide.'),
    )
    for (const line of strings(review?.['attributions'])) foot.append(el('p', 'small muted', line))
    root.append(foot)
  }

  /** A build-plan result: `saoi_build_plan`'s own, or the `plan` inside a money check. */
  const asPlan = (value: Record<string, unknown> | null): BuildPlanResult | null =>
    value !== null && record(value['plan']) !== null && record(value['moneyFound']) !== null
      ? (value as unknown as BuildPlanResult)
      : null

  const onResult = (params: Record<string, unknown> | null): void => {
    const content = record(params?.['structuredContent'])
    if (params?.['isError'] === true || content === null) {
      showText('Nothing to show here. The details are in the conversation.')
      return
    }
    try {
      const plan = asPlan(content) ?? asPlan(record(content['plan']))
      if (plan !== null) render(model(plan))
      else if (record(content['review']) !== null) renderCheck(content)
      else showText('Nothing to show here. The details are in the conversation.')
    } catch {
      showText('The card could not be drawn here. The details are in the conversation.')
    }
  }

  // ---- host context: theme, Claude's style variables and fonts, safe area ---------------------

  let fontsApplied = false
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
      const style = el('style')
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

  // ---- size: the host fits the frame to what the card reports ---------------------------------

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

  // ---- messages -------------------------------------------------------------------------------

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
      // A request from the host: teardown and ping are answered; anything else is not supported.
      if (method === 'ui/resource-teardown' || method === 'ping') post({ id, result: {} })
      else post({ id, error: { code: -32601, message: 'Method not found' } })
      return
    }
    if (method === 'ui/notifications/tool-result') onResult(params)
    else if (method === 'ui/notifications/host-context-changed') applyContext(params)
    else if (method === 'ui/notifications/tool-cancelled') showText('The plan was cancelled.')
  })

  void (async () => {
    try {
      const result = record(
        await request('ui/initialize', {
          appInfo: { name: 'saoi-plan-card', version: '1.0.0' },
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
  })()
}
