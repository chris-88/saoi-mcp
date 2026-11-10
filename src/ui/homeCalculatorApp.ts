/// <reference lib="dom" />
import type { BuildPlanResult } from '../saoiClient.js'
import type { Bridge } from './bridge.js'
import type { HomeCalculatorModel, HomeInputs, HomeRules, HomeSort } from './homeCalculatorModel.js'

/**
 * The home calculator card's browser side. Runs inside the host's sandboxed frame as this
 * function's own source, with the bridge and the model handed in.
 *
 * Inputs are sliders, each paired with a typed number box (phones). The figures move as they
 * do, worked out in the card from the rules saoi-api sent. "Show my options" calls
 * saoi_build_plan through the host (tools/call) and tells the model what was entered
 * (ui/update-model-context), then shows every option that fits, sortable by the customer. No
 * option is picked or highlighted for them. Every string goes in with `textContent`.
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
  let showAll = false
  let drawn = false

  const STATEMENT =
    'Saoi is not regulated by the Central Bank of Ireland and does not give advice; it compares products on the figures you give.'

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

  // ---- inputs ----------------------------------------------------------------------------------

  const live = el('section', 'found')
  live.setAttribute('aria-live', 'polite')
  const results = el('div', '')
  const status = el('p', 'status')
  status.setAttribute('role', 'status')

  const refresh = (): void => {
    live.replaceChildren()
    if (rules === null) {
      live.append(el('p', 'small muted', 'Working out the figures…'))
      return
    }
    const figures = model.figures(inputs, rules, asOf)
    const top = el('p', 'row')
    top.append(
      el('span', 'label', 'Deposit and costs saved'),
      el('span', 'total num', figures.reachedOn === null ? 'not reached' : model.month(figures.reachedOn)),
    )
    live.append(top)
    const grid = el('ul', 'rows')
    const row = (label: string, value: string): void => {
      const item = el('li', 'row small')
      item.append(el('span', 'muted', label), el('span', 'num strong', value))
      grid.append(item)
    }
    row('Most you can borrow (Central Bank limit)', model.eur(figures.maxLoanEur))
    row('Mortgage at this price', model.eur(figures.loanEur))
    row('Deposit needed', model.eur(figures.depositNeededEur))
    row('Needed at the keys', model.eur(figures.neededAtKeysEur))
    live.append(grid)
    // The grid shows the limit, the mortgage, the deposit and the cash; the words add the rest.
    for (const line of figures.lines.slice(3)) live.append(el('p', 'small muted-strong', line))
    if (
      figures.loanEur < inputs.targetPriceEur * (rules.firstTimeBuyer.maxLtvPct / 100) &&
      inputs.firstTimeBuyer
    )
      live.append(el('p', 'small muted-strong', figures.lines[1] ?? ''))
  }

  /** A slider and a number box that move together. */
  const numberInput = (
    key:
      | 'depositSavedEur'
      | 'monthlySavingEur'
      | 'annualGrossIncomeEur'
      | 'secondIncomeEur'
      | 'targetPriceEur'
      | 'monthlyDebtRepaymentsEur',
    label: string,
    max: number,
    step: number,
  ): HTMLElement => {
    const wrap = el('div', 'field')
    const id = `in-${key}`
    const head = el('div', 'row')
    const name = el('label', 'small strong', label)
    name.htmlFor = id
    const box = el('input', 'box num')
    box.type = 'number'
    box.inputMode = 'numeric'
    box.min = '0'
    box.step = String(step)
    box.id = id
    box.value = String(inputs[key])
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
    const prefix = el('span', 'muted small', '€')
    const boxWrap = el('span', 'boxwrap')
    boxWrap.append(prefix, box)
    head.append(name, boxWrap)
    wrap.append(head, slider)
    return wrap
  }

  const dateInput = (): HTMLElement => {
    const wrap = el('div', 'field')
    const head = el('div', 'row')
    const name = el('label', 'small strong', 'Keys wanted by')
    name.htmlFor = 'in-targetDate'
    const box = el('input', 'box num')
    box.type = 'month'
    box.id = 'in-targetDate'
    box.value = inputs.targetDate
    const slider = el('input', 'slider')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '120'
    slider.step = '1'
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

  const choice = <T extends string>(
    label: string,
    options: readonly (readonly [T, string])[],
    current: T,
    onPick: (value: T) => void,
  ): HTMLElement => {
    const group = el('fieldset', 'choice')
    group.append(el('legend', 'small strong', label))
    const row = el('div', 'segments')
    for (const [value, text] of options) {
      const button = el('button', value === current ? 'segment on' : 'segment', text)
      button.type = 'button'
      button.setAttribute('aria-pressed', String(value === current))
      button.onclick = () => {
        for (const other of Array.from(row.children)) {
          other.className = 'segment'
          other.setAttribute('aria-pressed', 'false')
        }
        button.className = 'segment on'
        button.setAttribute('aria-pressed', 'true')
        onPick(value)
        refresh()
      }
      row.append(button)
    }
    group.append(row)
    return group
  }

  const check = (label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement => {
    const wrap = el('label', 'check small')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = value
    box.onchange = () => {
      onChange(box.checked)
      refresh()
    }
    wrap.append(box, el('span', '', label))
    return wrap
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

  // ---- results ---------------------------------------------------------------------------------

  const renderResults = (): void => {
    results.replaceChildren()
    const home = comparison?.home ?? null
    if (comparison === null) return
    const block = el('section', 'section')
    block.append(el('h3', 'label', 'Your options'))
    if (home === null || home.pathways.length === 0) {
      block.append(el('p', 'small', 'No mortgage in Saoi’s data fits these filters. Try fewer filters.'))
      for (const line of home?.leftOut ?? []) block.append(el('p', 'small muted', line))
      results.append(block)
      return
    }
    block.append(el('p', 'small strong', home.headline))
    for (const filter of home.filters) block.append(el('p', 'small filter', filter))
    const sorter = choice<HomeSort>(
      `${String(home.pathways.length)} options. Sort by`,
      [
        ['five_year_cost', 'Cost over 5 years'],
        ['keys_date', 'Keys date'],
        ['monthly_repayment', 'Monthly'],
      ],
      sortBy,
      (value) => {
        sortBy = value
        renderResults()
      },
    )
    block.append(sorter)
    const rows = model.rows(home, sortBy)
    const shown = showAll ? rows : rows.slice(0, 8)
    const list = el('ol', 'options')
    list.setAttribute('aria-label', 'Mortgage options, in the order chosen')
    for (const row of shown) {
      const item = el('li', 'option')
      const head = el('p', 'row')
      head.append(el('span', 'strong', `${row.lender} · ${row.kind}`), el('span', 'strong num', row.rate))
      const figures = el('p', 'figs small num')
      figures.append(
        el('span', '', `${row.monthly}/month`),
        el('span', '', `${row.fiveYear} over 5 yrs`),
        el('span', '', `keys ${row.keys}`),
      )
      item.append(head, figures, el('p', 'small muted', row.product))
      if (row.more !== null) item.append(el('p', 'small muted', row.more))
      if (row.unconfirmed)
        item.append(
          el('p', 'small flag', 'Incentives from CCPC’s tables, not confirmed on the lender’s site'),
        )
      list.append(item)
    }
    block.append(list)
    if (rows.length > shown.length) {
      const more = el('button', 'link', `Show all ${String(rows.length)} options`)
      more.type = 'button'
      more.onclick = () => {
        showAll = true
        renderResults()
      }
      block.append(more)
    }
    block.append(
      el(
        'p',
        'small muted',
        `5-year cost: ${home.comparedOver.years === 5 ? 'interest on a 30-year term and the valuation fee, less cashback and bonuses paid within the first 5 years' : 'over the period stated'}. ${home.assumptions.join(' ')}`,
      ),
    )
    results.append(block)

    const save = el('div', 'actions')
    const button = el('button', 'save', 'Save this comparison')
    button.type = 'button'
    const saveStatus = el('p', 'status')
    saveStatus.setAttribute('role', 'status')
    button.onclick = () => {
      void (async () => {
        button.disabled = true
        const held = bridge.record(bridge.record(comparison)?.['saveLink'])?.['url']
        let url = typeof held === 'string' && held.startsWith('https://') ? held : null
        if (url === null && comparison !== null) {
          saveStatus.textContent = 'Saving to Saoi…'
          const saved = await bridge.callTool('saoi_save_plan', { plan: comparison.plan })
          const claim = bridge.record(saved?.['structuredContent'])?.['claimUrl']
          url = typeof claim === 'string' && claim.startsWith('https://') ? claim : null
        }
        if (url === null) {
          saveStatus.textContent = 'It could not be saved from the card. Ask in the chat to save it.'
          button.disabled = false
          return
        }
        const opened = await bridge.openLink(url)
        saveStatus.textContent = opened
          ? 'The comparison opens in the Saoi app; the link works once.'
          : 'Open the comparison in the Saoi app (the link works once):'
        if (!opened) {
          const link = el('a', 'claim', url)
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          saveStatus.append(' ', link)
        }
        button.disabled = false
      })()
    }
    save.append(
      button,
      saveStatus,
      el('p', 'small muted', 'Held for 24 hours behind a single-use link, then deleted unless opened.'),
    )
    results.append(save)
  }

  const showOptions = async (button: HTMLButtonElement): Promise<void> => {
    button.disabled = true
    status.textContent = 'Comparing every option that fits…'
    const result = await bridge.callTool('saoi_build_plan', model.buildPlanBody(inputs, sortBy))
    const content = bridge.record(result?.['structuredContent'])
    if (content === null || bridge.record(content['plan']) === null) {
      status.textContent = 'The options could not be fetched from the card. Ask in the chat instead.'
      button.disabled = false
      return
    }
    comparison = content as unknown as BuildPlanResult
    showAll = false
    status.textContent = ''
    button.disabled = false
    button.textContent = 'Update my options'
    renderResults()
    void bridge.updateContext(model.contextText(inputs, sortBy, comparison.home?.pathways.length ?? 0))
  }

  // ---- the card --------------------------------------------------------------------------------

  const draw = (): void => {
    drawn = true
    root.replaceChildren()
    root.removeAttribute('aria-busy')
    const header = el('header', 'header')
    header.append(
      el('p', 'eyebrow', 'Saoi home calculator'),
      el('h2', 'title', 'Buying a home: your figures'),
    )
    root.append(header, live)

    const money = el('section', 'section')
    money.append(
      numberInput('depositSavedEur', 'Deposit saved', 100_000, 500),
      numberInput('monthlySavingEur', 'Saving a month', 5_000, 50),
      numberInput('annualGrossIncomeEur', 'Gross income a year', 250_000, 1_000),
      numberInput('secondIncomeEur', 'Second income (joint, 0 if alone)', 250_000, 1_000),
      numberInput('targetPriceEur', 'Price in mind', 1_000_000, 5_000),
      numberInput('monthlyDebtRepaymentsEur', 'Loan and card repayments a month', 3_000, 25),
      dateInput(),
    )
    root.append(money)

    const prefs = el('section', 'section')
    prefs.append(el('h3', 'label', 'Your filters'))
    prefs.append(
      choice(
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
      choice(
        'New build or second-hand?',
        [
          ['second_hand', 'Second-hand'],
          ['new_build', 'New build (Help to Buy)'],
        ] as const,
        inputs.propertyKind,
        (v) => {
          inputs = { ...inputs, propertyKind: v }
        },
      ),
      choice(
        'Fixed or variable?',
        [
          ['either', 'Show both'],
          ['fixed', 'Fixed'],
          ['variable', 'Variable'],
        ] as const,
        inputs.rateType,
        (v) => {
          inputs = { ...inputs, rateType: v }
        },
      ),
    )
    const bankRow = el('div', 'field')
    const bankLabel = el('label', 'small strong', 'Who you bank with now')
    bankLabel.htmlFor = 'in-bank'
    const bank = el('select', 'box')
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
    bankRow.append(bankLabel, bank)
    prefs.append(
      bankRow,
      check('Only show my bank’s options', inputs.stayWithBank, (v) => {
        inputs = { ...inputs, stayWithBank: v }
      }),
      check('The home is green (BER B3 or better)', inputs.green, (v) => {
        inputs = { ...inputs, green: v }
      }),
      check('Open to switching current account', inputs.openToCurrentAccountSwitch, (v) => {
        inputs = { ...inputs, openToCurrentAccountSwitch: v }
      }),
    )
    root.append(prefs)

    const actions = el('div', 'actions')
    const button = el('button', 'save', 'Show my options')
    button.type = 'button'
    button.onclick = () => {
      void showOptions(button)
    }
    actions.append(
      button,
      status,
      el(
        'p',
        'small muted',
        'Every lender’s options that fit your filters, in the order you choose. Nothing is picked for you.',
      ),
    )
    root.append(actions, results)

    const foot = el('footer', 'footer')
    foot.append(
      el('p', 'small muted', STATEMENT),
      ...[
        'Warning: if you do not keep up your repayments you may lose your home.',
        'Warning: the cost of your monthly repayments may increase.',
        'Warning: if you do not meet the repayments on your loan, your account will go into arrears.',
      ].map((line) => el('p', 'small muted', line)),
      el(
        'p',
        'small muted',
        'Figures before interest; lenders decide within the Central Bank limits. Rates from CCPC and lenders’ sites.',
      ),
    )
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
