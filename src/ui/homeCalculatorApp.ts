/// <reference lib="dom" />
import type { BuildPlanResult } from '../saoiClient.js'
import type { Bridge } from './bridge.js'
import type { HomeCalculatorModel, HomeInputs, HomeRules, HomeSort } from './homeCalculatorModel.js'

/**
 * The home calculator card's browser side. Runs inside the host's sandboxed frame as this
 * function's own source, with the bridge and the model handed in.
 *
 * One step at a time (Chris, 2026-11-10: "too much information at once"): the must-have figures,
 * then preferences, one live headline line, and "Show my options". Everything else sits behind an
 * expander. Once the options run, the inputs fold to one summary line with Edit. Results show
 * the top three in the order the customer picks, each row expanding for its detail. No option
 * is picked or highlighted for them. Every string goes in with `textContent`.
 */
export function homeCalculatorApp(win: Window, bridge: Bridge, model: HomeCalculatorModel): void {
  const doc = win.document
  const root = doc.getElementById('card')
  if (root === null) return
  const asOf = new Date().toISOString().slice(0, 7)
  let inputs: HomeInputs = model.defaults(asOf)
  let rules: HomeRules | null = null
  let sortBy: HomeSort = 'five_year_cost'
  let comparison: BuildPlanResult | null = null
  let editing = true
  let showAll = false
  let drawn = false
  let secondIncome = false

  const STATEMENT =
    'Saoi is not regulated by the Central Bank of Ireland and does not give advice; it compares products on the figures you give.'
  const WARNINGS = [
    'Warning: if you do not keep up your repayments you may lose your home.',
    'Warning: the cost of your monthly repayments may increase.',
    'Warning: if you do not meet the repayments on your loan, your account will go into arrears.',
  ]

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
  const button = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
    const node = el('button', className, text)
    node.type = 'button'
    node.onclick = onClick
    return node
  }
  /** A Collapsible: the summary is the 44px tap target. */
  const collapsible = (
    title: string,
    fill: (body: HTMLElement) => void,
    open = false,
  ): HTMLDetailsElement => {
    const details = el('details', 'collapsible')
    details.open = open
    details.append(el('summary', '', title))
    const body = el('div', 'fold')
    fill(body)
    details.append(body)
    return details
  }

  // ---- live headline ---------------------------------------------------------------------------

  const headline = el('p', 'headline')
  headline.setAttribute('aria-live', 'polite')
  const breakdown = el('div', 'rows')
  const refresh = (): void => {
    if (rules === null) {
      headline.textContent = 'Working out your figures…'
      return
    }
    const figures = model.figures(inputs, rules, asOf)
    headline.textContent = model.headline(inputs, figures)
    breakdown.replaceChildren()
    const kv = (label: string, value: string): void => {
      const row = el('p', 'kv')
      row.append(el('span', 'muted', label), el('span', 'num medium', value))
      breakdown.append(row)
    }
    kv('Mortgage at this price', model.eur(figures.loanEur))
    kv('Deposit needed', model.eur(figures.depositNeededEur))
    kv('Stamp duty', model.eur(figures.stampDutyEur))
    if (figures.helpToBuyEur > 0) kv('Help to Buy (at most)', `−${model.eur(figures.helpToBuyEur)}`)
    kv('Needed at the keys', model.eur(figures.neededAtKeysEur))
    breakdown.append(
      el('p', 'small muted', 'Before interest. Lenders decide within the Central Bank limits.'),
    )
  }

  // ---- inputs ----------------------------------------------------------------------------------

  type MoneyKey =
    | 'depositSavedEur'
    | 'monthlySavingEur'
    | 'annualGrossIncomeEur'
    | 'secondIncomeEur'
    | 'targetPriceEur'
    | 'monthlyDebtRepaymentsEur'

  /** Slider + Input, moving together. */
  const money = (key: MoneyKey, label: string, max: number, step: number): HTMLElement => {
    const wrap = el('div', 'field')
    const head = el('div', 'field-head')
    const name = el('label', '', label)
    name.htmlFor = `in-${key}`
    const box = el('input', 'input')
    box.type = 'number'
    box.inputMode = 'numeric'
    box.min = '0'
    box.step = String(step)
    box.id = `in-${key}`
    box.value = String(inputs[key])
    const boxWrap = el('span', 'input-wrap')
    boxWrap.append(el('span', '', '€'), box)
    const slider = el('input', 'slider')
    slider.type = 'range'
    slider.min = '0'
    slider.max = String(Math.max(max, inputs[key]))
    slider.step = String(step)
    slider.value = String(inputs[key])
    slider.setAttribute('aria-label', label)
    const set = (value: number): void => {
      inputs = { ...inputs, [key]: Number.isFinite(value) && value >= 0 ? value : 0 }
      refresh()
    }
    slider.oninput = () => {
      box.value = slider.value
      set(Number(slider.value))
    }
    box.oninput = () => {
      const value = Number(box.value)
      if (value > Number(slider.max)) slider.max = String(value)
      slider.value = String(value)
      set(value)
    }
    head.append(name, boxWrap)
    wrap.append(head, slider)
    return wrap
  }

  const keysDate = (): HTMLElement => {
    const wrap = el('div', 'field')
    const head = el('div', 'field-head')
    const name = el('label', '', 'Keys wanted by')
    name.htmlFor = 'in-targetDate'
    const box = el('input', 'input plain')
    box.type = 'month'
    box.id = 'in-targetDate'
    box.value = inputs.targetDate
    const slider = el('input', 'slider')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '120'
    slider.value = String(model.monthsBetween(asOf, inputs.targetDate))
    slider.setAttribute('aria-label', 'Months until the keys')
    slider.oninput = () => {
      inputs = { ...inputs, targetDate: model.addMonths(asOf, Number(slider.value)) }
      box.value = inputs.targetDate
      refresh()
    }
    box.oninput = () => {
      if (!/^\d{4}-\d{2}$/.test(box.value)) return
      inputs = { ...inputs, targetDate: box.value }
      slider.value = String(model.monthsBetween(asOf, box.value))
      refresh()
    }
    head.append(name, box)
    wrap.append(head, slider)
    return wrap
  }

  /** ToggleGroup in the segmented style. */
  const toggle = <T extends string>(
    label: string,
    options: readonly (readonly [T, string])[],
    current: T,
    onPick: (value: T) => void,
  ): HTMLElement => {
    const field = el('div', 'choice-field')
    field.append(el('p', '', label))
    const group = el('div', 'segmented')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', label)
    for (const [value, text] of options) {
      const item = button('', text, () => {
        for (const other of Array.from(group.children)) other.setAttribute('aria-pressed', 'false')
        item.setAttribute('aria-pressed', 'true')
        onPick(value)
        refresh()
      })
      item.setAttribute('aria-pressed', String(value === current))
      group.append(item)
    }
    field.append(group)
    return field
  }

  const switchRow = (label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement => {
    const row = el('div', 'switch-row')
    const id = `sw-${String(Math.random()).slice(2, 8)}`
    const name = el('label', '', label)
    name.htmlFor = id
    const control = el('button')
    control.type = 'button'
    control.id = id
    control.setAttribute('role', 'switch')
    control.setAttribute('aria-checked', String(value))
    control.append(el('span'))
    control.onclick = () => {
      const next = control.getAttribute('aria-checked') !== 'true'
      control.setAttribute('aria-checked', String(next))
      onChange(next)
      refresh()
    }
    row.append(name, control)
    return row
  }

  const BANKS = [
    '',
    'Bank of Ireland',
    'AIB',
    'PTSB',
    'EBS',
    'Haven',
    'Avant Money',
    'ICS Mortgages',
    'Credit union',
  ]

  const figuresStep = (): HTMLElement => {
    const step = el('section', 'section')
    step.append(el('h3', 'label', 'Your figures'))
    step.append(
      money('depositSavedEur', 'Deposit saved', 100_000, 500),
      money('monthlySavingEur', 'Saving a month', 5_000, 50),
      money('annualGrossIncomeEur', 'Income a year (gross)', 250_000, 1_000),
    )
    const second = el('div', '')
    if (secondIncome || inputs.secondIncomeEur > 0) {
      second.append(money('secondIncomeEur', 'Second income a year', 250_000, 1_000))
    } else {
      second.append(
        button('link', '+ Add a second income', () => {
          secondIncome = true
          second.replaceChildren(money('secondIncomeEur', 'Second income a year', 250_000, 1_000))
          second.querySelector('input')?.focus()
        }),
      )
    }
    step.append(second, money('targetPriceEur', 'Price in mind', 1_000_000, 5_000))
    step.append(
      collapsible('More details', (body) => {
        body.append(
          money('monthlyDebtRepaymentsEur', 'Loan and card repayments a month', 3_000, 25),
          keysDate(),
        )
      }),
    )
    return step
  }

  const preferencesStep = (): HTMLElement => {
    const step = el('section', 'section')
    step.append(el('h3', 'label', 'Your preferences'))
    const bankField = el('div', 'choice-field')
    const bankLabel = el('label', '', 'Who you bank with')
    bankLabel.htmlFor = 'in-bank'
    const bank = el('select', 'input')
    bank.id = 'in-bank'
    const banks = BANKS.includes(inputs.currentBank) ? BANKS : [...BANKS, inputs.currentBank]
    for (const name of banks) {
      const option = el('option', '', name === '' ? 'Not saying' : name)
      option.value = name
      option.selected = name === inputs.currentBank
      bank.append(option)
    }
    bank.onchange = () => {
      inputs = { ...inputs, currentBank: bank.value }
    }
    bankField.append(bankLabel, bank)
    step.append(
      bankField,
      switchRow('Only show my bank’s options', inputs.stayWithBank, (v) => {
        inputs = { ...inputs, stayWithBank: v }
      }),
      toggle(
        'First home?',
        [
          ['yes', 'Yes'],
          ['no', 'No'],
        ] as const,
        inputs.firstTimeBuyer ? 'yes' : 'no',
        (v) => {
          inputs = { ...inputs, firstTimeBuyer: v === 'yes' }
        },
      ),
      toggle(
        'New build or second-hand?',
        [
          ['second_hand', 'Second-hand'],
          ['new_build', 'New build'],
        ] as const,
        inputs.propertyKind,
        (v) => {
          inputs = { ...inputs, propertyKind: v }
        },
      ),
      collapsible('More filters', (body) => {
        body.append(
          toggle(
            'Rate type',
            [
              ['either', 'Both'],
              ['fixed', 'Fixed'],
              ['variable', 'Variable'],
            ] as const,
            inputs.rateType,
            (v) => {
              inputs = { ...inputs, rateType: v }
            },
          ),
          switchRow('Green home (BER B3 or better)', inputs.green, (v) => {
            inputs = { ...inputs, green: v }
          }),
          switchRow('Open to switching current account', inputs.openToCurrentAccountSwitch, (v) => {
            inputs = { ...inputs, openToCurrentAccountSwitch: v }
          }),
        )
      }),
    )
    return step
  }

  // ---- results ---------------------------------------------------------------------------------

  const optionRow = (row: ReturnType<HomeCalculatorModel['rows']>[number], index: number): HTMLElement => {
    const item = el('li', '')
    const head = el('button', 'option-head')
    head.type = 'button'
    head.setAttribute('aria-expanded', 'false')
    const id = `opt-${String(index)}`
    head.setAttribute('aria-controls', id)
    const left = el('span', '')
    const lender = el('span', 'medium block', row.lender)
    if (row.unconfirmed) lender.append(el('span', 'badge', 'Unconfirmed'))
    left.append(lender, el('span', 'small muted block', `${row.kind} · ${row.rate}`))
    const right = el('span', 'right')
    right.append(el('span', 'big num block', row.lead), el('span', 'small muted num block', row.second))
    head.append(left, right)
    const body = el('div', 'option-body')
    body.id = id
    body.hidden = true
    const kv = (label: string, value: string): void => {
      const line = el('p', 'kv small')
      line.append(el('span', 'muted', label), el('span', 'num', value))
      body.append(line)
    }
    kv('Product', row.product)
    kv('Monthly', row.monthly)
    kv('Cost over 5 years', row.fiveYear)
    kv('Keys', row.keys)
    if (row.more !== null) kv('Cashback and bonus', row.more)
    for (const note of row.notes) body.append(el('p', 'small muted', note))
    if (row.unconfirmed)
      body.append(
        el(
          'p',
          'small muted',
          'Unconfirmed: the incentives come from CCPC’s tables and are not confirmed on the lender’s own site.',
        ),
      )
    head.onclick = () => {
      body.hidden = !body.hidden
      head.setAttribute('aria-expanded', String(!body.hidden))
    }
    item.append(head, body)
    return item
  }

  const resultsView = (): HTMLElement => {
    const wrap = el('div', '')
    const home = comparison?.home ?? null
    const block = el('section', 'section')
    if (home === null || home.pathways.length === 0) {
      block.append(
        el('h3', 'label', 'No options fit these filters'),
        el('p', 'muted', 'Try fewer filters under Edit.'),
      )
      wrap.append(block)
      return wrap
    }
    const rows = model.rows(home, sortBy)
    const title = el('div', '')
    title.append(el('h3', 'label', `${String(rows.length)} options`))
    for (const filter of home.filters) title.append(el('p', 'small muted', filter))
    block.append(title)
    const sort = el('div', 'segmented')
    sort.setAttribute('role', 'group')
    sort.setAttribute('aria-label', 'Sort by')
    for (const [value, text] of [
      ['keys_date', 'Keys date'],
      ['five_year_cost', '5-year cost'],
      ['monthly_repayment', 'Monthly'],
    ] as const) {
      const item = button('', text, () => {
        sortBy = value
        draw()
      })
      item.setAttribute('aria-pressed', String(value === sortBy))
      sort.append(item)
    }
    block.append(sort)
    const shared = model.sharedKeys(home)
    if (shared !== null && sortBy === 'keys_date') {
      block.append(
        el(
          'p',
          'small muted',
          `Every option has the same keys date, ${shared}: the deposit needed is the same at each lender. Shown by 5-year cost.`,
        ),
      )
    }
    const list = el('ol', 'options')
    list.setAttribute('aria-label', 'Options, in the order chosen')
    const shown = showAll ? rows : rows.slice(0, 3)
    shown.forEach((row, index) => {
      list.append(optionRow(row, index))
    })
    block.append(list)
    if (rows.length > shown.length) {
      block.append(
        button('link', `Show all ${String(rows.length)}`, () => {
          showAll = true
          draw()
        }),
      )
    }
    wrap.append(block)
    const method = el('div', '')
    method.style.padding = '0 16px'
    method.append(
      collapsible('How we worked this out', (body) => {
        body.append(
          el(
            'p',
            'small muted',
            '5-year cost: interest on a 30-year term and the valuation fee, less cashback and bonuses paid within the first 5 years.',
          ),
          ...home.assumptions.map((line) => el('p', 'small muted', line)),
        )
      }),
    )
    wrap.append(method)

    const save = el('div', 'actions')
    const status = el('p', 'status')
    status.setAttribute('role', 'status')
    const saveButton = button('btn', 'Save this comparison', () => {
      void (async () => {
        saveButton.disabled = true
        const held = bridge.record(bridge.record(comparison)?.['saveLink'])?.['url']
        let url = typeof held === 'string' && held.startsWith('https://') ? held : null
        if (url === null && comparison !== null) {
          status.textContent = 'Saving to Saoi…'
          const saved = await bridge.callTool('saoi_save_plan', { plan: comparison.plan })
          const claim = bridge.record(saved?.['structuredContent'])?.['claimUrl']
          url = typeof claim === 'string' && claim.startsWith('https://') ? claim : null
        }
        if (url === null) {
          status.textContent = 'It could not be saved from the card. Ask in the chat to save it.'
          saveButton.disabled = false
          return
        }
        const opened = await bridge.openLink(url)
        status.textContent = opened
          ? 'Opens in the Saoi app; the link works once.'
          : 'Open it in the Saoi app (the link works once):'
        if (!opened) {
          const link = el('a', 'claim', url)
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          status.append(' ', link)
        }
        saveButton.disabled = false
      })()
    })
    save.append(saveButton, status, el('p', 'small muted', 'Held for 24 hours, then deleted unless opened.'))
    // The statutory warnings stay visible, small, at the foot of mortgage results.
    for (const warning of home.warnings.length > 0 ? home.warnings : WARNINGS)
      save.append(el('p', 'small muted', warning))
    wrap.append(save)
    return wrap
  }

  const showOptions = async (go: HTMLButtonElement, status: HTMLElement): Promise<void> => {
    go.disabled = true
    status.textContent = 'Comparing every option that fits…'
    const result = await bridge.callTool('saoi_build_plan', model.buildPlanBody(inputs, sortBy))
    const content = bridge.record(result?.['structuredContent'])
    if (content === null || bridge.record(content['plan']) === null) {
      status.textContent = 'The options could not be fetched from the card. Ask in the chat instead.'
      go.disabled = false
      return
    }
    comparison = content as unknown as BuildPlanResult
    editing = false
    showAll = false
    draw()
    void bridge.updateContext(model.contextText(inputs, sortBy, comparison.home?.pathways.length ?? 0))
  }

  // ---- the card --------------------------------------------------------------------------------

  const draw = (): void => {
    drawn = true
    root.replaceChildren()
    root.removeAttribute('aria-busy')
    const header = el('header', 'header')
    header.append(el('p', 'eyebrow', 'Saoi'), el('h2', 'title', 'Buying a home'))
    root.append(header)

    const live = el('section', 'section')
    live.append(headline)
    if (editing)
      live.append(
        collapsible('See the breakdown', (body) => {
          body.append(breakdown)
        }),
      )
    root.append(live)

    if (editing) {
      root.append(figuresStep(), preferencesStep())
      const actions = el('div', 'actions')
      const status = el('p', 'status')
      status.setAttribute('role', 'status')
      const go = button('btn', comparison === null ? 'Show my options' : 'Update my options', () => {
        void showOptions(go, status)
      })
      actions.append(go, status)
      root.append(actions)
    } else {
      const summary = el('section', 'section')
      const line = el('div', 'summary-row')
      line.append(
        el('p', 'muted num', model.summary(inputs)),
        button('btn-outline', 'Edit', () => {
          editing = true
          draw()
        }),
      )
      summary.append(line)
      root.append(summary, resultsView())
    }

    const foot = el('footer', 'footer')
    foot.append(el('p', 'small', STATEMENT))
    root.append(foot)
    refresh()
  }

  bridge.on('ui/notifications/tool-input', (params) => {
    if (drawn && rules !== null) return
    inputs = model.fromArguments(bridge.record(params?.['arguments']), asOf)
    draw()
  })
  bridge.on('ui/notifications/tool-result', (params) => {
    const content = bridge.record(params?.['structuredContent'])
    const sent = bridge.record(content?.['rules'])
    if (sent !== null) rules = sent as unknown as HomeRules
    if (!drawn) inputs = model.fromArguments(bridge.record(content?.['inputs']), asOf)
    if (!drawn) draw()
    else refresh()
  })
  bridge.on('ui/notifications/tool-cancelled', () => {
    if (!drawn) draw()
  })
  void bridge.start('saoi-home-calculator')
}
