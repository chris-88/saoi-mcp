/// <reference lib="dom" />
import type { BuildPlanResult } from '../saoiClient.js'
import type { Bridge } from './bridge.js'
import type {
  HomeCalculatorModel,
  HomeControl,
  HomeInputs,
  HomeRoute,
  HomeRules,
  HomeSort,
} from './homeCalculatorModel.js'

/**
 * The home calculator card's browser side. Runs inside the host's sandboxed frame as this
 * function's own source, with the bridge and the model handed in.
 *
 * Card v5, one phone screen (decision 2026-11-11): when the host supplied the figures, the card
 * starts folded: "Your home-buying plan" with an Estimate badge and Edit, chips for the facts
 * still missing (each opening one control), then the month the money for the keys is ready, one
 * fact line, a thin progress bar of deposit saved against the money needed at the keys, three
 * tiles (home price, mortgage, options with the rent when given), the other routes to a home in
 * the order saoi-api gave (two, each opening to its reason, conditions and source, then "See all
 * routes (N)"), one filled button, "Open in Saoi", and a footer of what was assumed, the three
 * warnings (always: the card shows a mortgage figure) and the statement. The options are
 * compared for the tile and the save; their list opens in the app. Without figures from the
 * host, the inputs open expanded and fold once the options run. No route or option is picked or
 * highlighted for them. Every string goes in with `textContent`.
 */
export function homeCalculatorApp(win: Window, bridge: Bridge, model: HomeCalculatorModel): void {
  const doc = win.document
  const root = doc.getElementById('card')
  if (root === null) return
  const asOf = new Date().toISOString().slice(0, 7)
  let inputs: HomeInputs = model.defaults(asOf)
  let rules: HomeRules | null = null
  /** The order saoi_build_plan ranks by; the list itself opens in the app. */
  const sortBy: HomeSort = 'five_year_cost'
  let comparison: BuildPlanResult | null = null
  let editing = true
  let drawn = false
  let secondIncome = false
  /** The inputs the shown comparison was run on. */
  let comparedFor = ''
  /** Every route to a home, in saoi-api's order, from the last saoi_home_calculator result. */
  let routes: HomeRoute[] = []
  /** What the figures take as given when it was not said, from the same result. */
  let assumed: string[] = []
  /** The request keys the customer has given (the host's arguments, then their answers). */
  let given: string[] = []
  let showAllRoutes = false
  let openRoute: string | null = null
  /** The one control a chip opened: under the fact chips ('facts') or inside a route (its id). */
  let openControl: { where: string; control: HomeControl } | null = null
  let routesNote = ''
  let routesRun = 0
  /** What "Open in Saoi" said last, kept across redraws; with a link when the host cannot open it. */
  let actionNote: { text: string; url: string | null } = { text: '', url: null }

  const STATEMENT =
    'Saoi is not regulated by the Central Bank of Ireland and does not give advice; it compares products on the figures you give.'
  /** Shown whenever the comparison has not returned its own: the card shows a mortgage figure. */
  const WARNINGS = [
    'Warning: if you do not keep up your repayments you may lose your home.',
    'Warning: the cost of your monthly repayments may increase.',
    'Warning: if you do not meet the repayments on your loan, your account will go into arrears.',
  ]
  /** The request key each control answers. */
  const KEYS: Record<HomeControl, string> = {
    county: 'county',
    firstTimeBuyer: 'firstTimeBuyer',
    propertyKind: 'propertyKind',
    joint: 'secondIncomeEur',
    taxPaid: 'taxPaidLastFourYearsEur',
    monthlyRentEur: 'monthlyRentEur',
  }

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
  /** A link out of the frame: through the host when it can, else a new tab. */
  const outLink = (text: string, url: string): HTMLAnchorElement => {
    const link = el('a', 'claim small', text)
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.onclick = (event) => {
      event.preventDefault()
      void bridge.openLink(url).then((opened) => {
        if (!opened) win.open(url, '_blank', 'noopener')
      })
    }
    return link
  }
  const markGiven = (...keys: string[]): void => {
    given = [...new Set([...given, ...keys])]
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
    // Once options ran for these same inputs, the headline takes their keys month (interest
    // counted), so the two never disagree; otherwise the card's estimate, before interest. The
    // model keeps a conditional Help to Buy out of it either way.
    const same = comparison !== null && comparedFor === JSON.stringify(inputs)
    headline.textContent = same
      ? model.headline(inputs, figures, comparison?.home?.keysOn ?? null)
      : model.headline(inputs, figures)
    breakdown.replaceChildren()
    const kv = (label: string, value: string): void => {
      const row = el('p', 'kv')
      row.append(el('span', 'muted', label), el('span', 'num medium', value))
      breakdown.append(row)
    }
    kv('Mortgage at this price', model.eur(figures.loanEur))
    kv('Deposit needed', model.eur(figures.depositNeededEur))
    kv('Stamp duty', model.eur(figures.stampDutyEur))
    if (figures.helpToBuyConditional)
      kv('Help to Buy (not counted: tax paid not given)', `up to ${model.eur(figures.helpToBuyEur)}`)
    else if (figures.helpToBuyEur > 0) kv('Help to Buy', `−${model.eur(figures.helpToBuyEur)}`)
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

  const shown = (value: number): string => value.toLocaleString('en-IE', { maximumFractionDigits: 0 })
  const digitsOf = (text: string): number | null => {
    const digits = text.replace(/[^0-9]/g, '')
    return digits === '' ? null : Number(digits)
  }
  /** A euro box: text, not number, so it can show 25,000; digits are what is read back. */
  const euroBox = (id: string, value: number | null): { wrap: HTMLElement; box: HTMLInputElement } => {
    const box = el('input', 'input')
    box.type = 'text'
    box.inputMode = 'numeric'
    box.autocomplete = 'off'
    box.id = id
    box.value = value === null ? '' : shown(value)
    const wrap = el('span', 'input-wrap')
    wrap.append(el('span', '', '€'), box)
    return { wrap, box }
  }

  /** Slider + Input, moving together. */
  const money = (key: MoneyKey, label: string, max: number, step: number): HTMLElement => {
    const wrap = el('div', 'field')
    const head = el('div', 'field-head')
    const name = el('label', '', label)
    name.htmlFor = `in-${key}`
    const { wrap: boxWrap, box } = euroBox(`in-${key}`, inputs[key])
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
      box.value = shown(Number(slider.value))
      set(Number(slider.value))
    }
    box.oninput = () => {
      const value = digitsOf(box.value) ?? 0
      box.value = digitsOf(box.value) === null ? '' : shown(value)
      if (value > Number(slider.max)) slider.max = String(value)
      slider.value = String(value)
      set(value)
    }
    head.append(name, boxWrap)
    wrap.append(head, slider)
    return wrap
  }

  /** A box for a figure that may be left out (rent, tax paid): empty is "not given". */
  const optionalMoney = (key: 'monthlyRentEur' | 'taxPaidLastFourYearsEur', label: string): HTMLElement => {
    const wrap = el('div', 'field-head')
    const name = el('label', '', label)
    name.htmlFor = `in-${key}`
    const { wrap: boxWrap, box } = euroBox(`in-${key}`, inputs[key])
    box.oninput = () => {
      const value = digitsOf(box.value)
      box.value = value === null ? '' : shown(value)
      inputs = { ...inputs, [key]: value }
      refresh()
    }
    wrap.append(name, boxWrap)
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
    current: T | null,
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

  /** The county select: saoi-api's 30 slugs with their names. */
  const countySelect = (id: string, onPick: (slug: string) => void): HTMLElement => {
    const field = el('div', 'choice-field')
    const label = el('label', '', 'Where the home is')
    label.htmlFor = id
    const select = el('select', 'input')
    select.id = id
    const none = el('option', '', 'Not saying')
    none.value = ''
    select.append(none)
    for (const [slug, name] of model.counties()) {
      const option = el('option', '', name)
      option.value = slug
      option.selected = slug === inputs.county
      select.append(option)
    }
    select.onchange = () => {
      onPick(select.value)
    }
    field.append(label, select)
    return field
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
          optionalMoney('taxPaidLastFourYearsEur', 'Income Tax and DIRT paid, last 4 years'),
          optionalMoney('monthlyRentEur', 'Rent a month (optional)'),
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
          markGiven('firstTimeBuyer')
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
          markGiven('propertyKind')
        },
      ),
      countySelect('in-county', (slug) => {
        inputs = { ...inputs, county: slug }
      }),
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

  // ---- one fact, one control -------------------------------------------------------------------

  /** Takes the answer, closes the control, and asks saoi-api for the routes on the new facts. */
  const answer = (control: HomeControl, patch: Partial<HomeInputs>): void => {
    inputs = { ...inputs, ...patch }
    markGiven(KEYS[control])
    openControl = null
    draw()
    void refreshRoutes()
  }

  /** A euro box with Done, for a figure asked from a chip. */
  const figureControl = (
    control: HomeControl,
    label: string,
    value: number | null,
    onDone: (value: number | null) => void,
  ): HTMLElement => {
    const wrap = el('div', 'field')
    const head = el('div', 'field-head')
    const name = el('label', '', label)
    name.htmlFor = `ask-${control}`
    const { wrap: boxWrap, box } = euroBox(`ask-${control}`, value)
    box.oninput = () => {
      const typed = digitsOf(box.value)
      box.value = typed === null ? '' : shown(typed)
    }
    const done = button('btn-outline', 'Done', () => {
      onDone(digitsOf(box.value))
    })
    box.onkeydown = (event) => {
      if (event.key === 'Enter') done.click()
    }
    head.append(name, boxWrap)
    wrap.append(head, done)
    return wrap
  }

  const controlView = (control: HomeControl): HTMLElement => {
    const wrap = el('div', 'control')
    if (control === 'firstTimeBuyer')
      wrap.append(
        toggle(
          'First home?',
          [
            ['yes', 'Yes'],
            ['no', 'No'],
          ] as const,
          given.includes('firstTimeBuyer') ? (inputs.firstTimeBuyer ? 'yes' : 'no') : null,
          (v) => {
            answer(control, { firstTimeBuyer: v === 'yes' })
          },
        ),
      )
    else if (control === 'propertyKind')
      wrap.append(
        toggle(
          'New build or second-hand?',
          [
            ['second_hand', 'Second-hand'],
            ['new_build', 'New build'],
          ] as const,
          given.includes('propertyKind') ? inputs.propertyKind : null,
          (v) => {
            answer(control, { propertyKind: v })
          },
        ),
      )
    else if (control === 'county')
      wrap.append(
        countySelect('ask-county', (slug) => {
          answer(control, { county: slug })
        }),
      )
    else if (control === 'joint')
      wrap.append(
        figureControl(control, 'Their income a year (gross)', inputs.secondIncomeEur || null, (v) => {
          answer(control, { secondIncomeEur: v ?? 0 })
        }),
      )
    else if (control === 'taxPaid')
      wrap.append(
        figureControl(
          control,
          'Income Tax and DIRT paid, last 4 years',
          inputs.taxPaidLastFourYearsEur,
          (v) => {
            answer(control, { taxPaidLastFourYearsEur: v })
          },
        ),
      )
    else
      wrap.append(
        figureControl(control, 'Rent a month (optional)', inputs.monthlyRentEur, (v) => {
          answer(control, { monthlyRentEur: v })
        }),
      )
    return wrap
  }

  /** A chip: a short question that opens only its control, where it was tapped. */
  const chip = (control: HomeControl, where: string): HTMLButtonElement => {
    const open = openControl?.where === where && openControl.control === control
    const node = button('chip', model.chipText(control), () => {
      openControl = open ? null : { where, control }
      draw()
    })
    node.setAttribute('aria-expanded', String(open))
    return node
  }

  // ---- routes ----------------------------------------------------------------------------------

  const refreshRoutes = async (): Promise<void> => {
    const run = ++routesRun
    routesNote = 'Updating the routes…'
    if (!editing) draw()
    const result = await bridge.callTool('saoi_home_calculator', model.homeCalculatorBody(inputs, given))
    if (run !== routesRun) return
    routesNote = takeRoutes(result) ? '' : 'The routes could not be updated from the card.'
    if (!editing) draw()
  }

  /** Takes the routes (and rules) from a saoi_home_calculator result; false when it has none. */
  const takeRoutes = (result: Record<string, unknown> | null): boolean => {
    const content = bridge.record(result?.['structuredContent'])
    const sent = bridge.record(content?.['rules'])
    if (sent !== null) rules = sent as unknown as HomeRules
    const said = content?.['assumed']
    if (Array.isArray(said)) assumed = said.filter((line): line is string => typeof line === 'string')
    const next = content?.['routes']
    if (!Array.isArray(next)) return false
    routes = next as HomeRoute[]
    return true
  }

  const routeRow = (route: HomeRoute): HTMLElement => {
    const item = el('li', '')
    const head = el('button', 'route-head')
    head.type = 'button'
    const open = openRoute === route.id
    head.setAttribute('aria-expanded', String(open))
    head.setAttribute('aria-controls', `route-${route.id}`)
    const line = el('span', 'route-line')
    line.append(el('span', 'medium', route.name), ` · ${model.routeDetail(route)}`)
    head.append(line, el('span', 'badge', model.statusWord(route.status)), el('span', 'chevron'))
    const body = el('div', 'option-body')
    body.id = `route-${route.id}`
    body.hidden = !open
    if (route.reason !== null) body.append(el('p', 'small', route.reason))
    if (route.missing !== null) {
      body.append(el('p', 'small', route.missing))
      const control = model.controlFor(route.missing)
      if (control !== null) {
        const chips = el('div', 'chips')
        chips.append(chip(control, route.id))
        body.append(chips)
        if (openControl?.where === route.id && openControl.control === control)
          body.append(controlView(control))
      }
    }
    if (route.conditions.length > 0) {
      const list = el('ul', 'flags small')
      for (const condition of route.conditions) list.append(el('li', '', condition))
      body.append(list)
    }
    if (!route.confirmed)
      body.append(el('p', 'small muted', 'Not every rule here is read from a primary page yet.'))
    const source = route.sources[0]
    if (source !== undefined) {
      let host = source.url
      try {
        host = new URL(source.url).hostname.replace(/^www\./, '')
      } catch {
        // Shown as given.
      }
      body.append(outLink(`Source: ${host} (read ${source.checkedOn})`, source.url))
    }
    head.onclick = () => {
      body.hidden = !body.hidden
      openRoute = body.hidden ? null : route.id
      head.setAttribute('aria-expanded', String(!body.hidden))
    }
    item.append(head, body)
    return item
  }

  const routesView = (): HTMLElement | null => {
    if (routes.length === 0) return null
    const block = el('section', 'section')
    block.append(el('h3', 'label', 'Other routes'))
    if (routesNote !== '') block.append(el('p', 'status', routesNote))
    const list = el('ul', 'options')
    list.setAttribute('aria-label', 'Routes, in the order given')
    for (const route of showAllRoutes ? routes : model.otherRoutes(routes)) list.append(routeRow(route))
    block.append(list)
    if (!showAllRoutes && routes.length > model.otherRoutes(routes).length)
      block.append(
        button('link', `See all routes (${String(routes.length)})`, () => {
          showAllRoutes = true
          draw()
        }),
      )
    return block
  }

  // ---- the plan --------------------------------------------------------------------------------

  /** True when the comparison shown was run on these same inputs. */
  const compared = (): boolean => comparison !== null && comparedFor === JSON.stringify(inputs)

  /** The month, one fact line, progress and the three tiles. */
  const planView = (): HTMLElement => {
    const block = el('section', 'section plan')
    if (rules === null) {
      block.append(el('p', 'muted', 'Working out your figures…'))
      return block
    }
    const figures = model.figures(inputs, rules, asOf)
    const ready = compared()
      ? model.readyHeadline(inputs, figures, comparison?.home?.keysOn ?? null)
      : model.readyHeadline(inputs, figures)
    const hero = el('div', 'hero')
    hero.setAttribute('aria-live', 'polite')
    hero.append(el('p', 'eyebrow caps', 'Ready to buy'), el('p', 'hero-month', ready.text))
    if (ready.note !== null) hero.append(el('p', 'small muted', ready.note))
    hero.append(el('p', 'num', model.factLine(inputs, figures)))
    block.append(hero)

    const progress = model.progress(inputs, figures)
    const meter = el('div', 'meter')
    const bar = el('div', 'bar')
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-label', 'Deposit saved towards the money needed at the keys')
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', String(Math.round(progress.neededEur)))
    bar.setAttribute('aria-valuenow', String(Math.round(Math.min(progress.savedEur, progress.neededEur))))
    const fill = el('span', '')
    fill.style.width = `${String(progress.pct)}%`
    bar.append(fill)
    const saved = el('p', 'small num', `${model.eur(progress.savedEur)} of ${model.eur(progress.neededEur)}`)
    const pace = el('p', 'kv small muted num')
    pace.append(
      el('span', '', `${model.eur(inputs.monthlySavingEur)} a month`),
      el('span', '', progress.covered ? 'Covered' : `${model.eur(progress.toGoEur)} to go`),
    )
    meter.append(bar, saved, pace)
    block.append(meter)

    const tiles = el('div', 'tiles')
    const tile = (label: string, value: string): void => {
      const node = el('div', 'tile')
      node.append(el('p', 'small muted', label), el('p', 'medium num', value))
      tiles.append(node)
    }
    tile('Home price', model.eur(inputs.targetPriceEur))
    tile('Mortgage', model.eur(figures.loanEur))
    const home = comparison?.home ?? null
    const lowest = home === null ? null : model.lowestMonthly(home)
    tile(
      'Options',
      model.optionsTile(
        compared() ? { count: home?.pathways.length ?? 0, lowestMonthlyEur: lowest } : null,
        inputs.monthlyRentEur,
      ),
    )
    block.append(tiles)
    return block
  }

  // ---- options ---------------------------------------------------------------------------------

  /** "Show my options" or "Update my options": an outline button, with its own status line. */
  const compareButton = (): HTMLElement => {
    const wrap = el('div', 'grid')
    const status = el('p', 'status')
    status.setAttribute('role', 'status')
    const go = button(
      'btn-outline wide',
      comparison === null ? 'Show my options' : 'Update my options',
      () => {
        void (async () => {
          go.disabled = true
          status.textContent = 'Comparing every option that fits…'
          if (await runComparison()) {
            draw()
            return
          }
          status.textContent = 'The options could not be fetched from the card. Ask in the chat instead.'
          go.disabled = false
        })()
      },
    )
    wrap.append(go, status)
    return wrap
  }

  /** saoi_build_plan (and the routes alongside) for the current inputs; false when it failed. */
  const runComparison = async (): Promise<boolean> => {
    // In the expanded view the customer has seen and kept the first-home and kind toggles.
    if (editing) markGiven('firstTimeBuyer', 'propertyKind')
    const run = ++routesRun
    const [result, calc] = await Promise.all([
      bridge.callTool('saoi_build_plan', model.buildPlanBody(inputs, sortBy)),
      bridge.callTool('saoi_home_calculator', model.homeCalculatorBody(inputs, given)),
    ])
    if (run === routesRun && takeRoutes(calc)) routesNote = ''
    const content = bridge.record(result?.['structuredContent'])
    if (content === null || bridge.record(content['plan']) === null) return false
    comparison = content as unknown as BuildPlanResult
    comparedFor = JSON.stringify(inputs)
    editing = false
    openControl = null
    void bridge.updateContext(model.contextText(inputs, sortBy, comparison.home?.pathways.length ?? 0))
    return true
  }

  // ---- open in Saoi ----------------------------------------------------------------------------

  /**
   * The one filled button. Saves the comparison (running it first when there is none for these
   * inputs) through the single-use link and opens it in the Saoi app.
   */
  const actionsView = (): HTMLElement => {
    const block = el('div', 'actions')
    const status = el('p', 'status', actionNote.text)
    status.setAttribute('role', 'status')
    if (actionNote.url !== null) status.append(' ', outLink(actionNote.url, actionNote.url))
    const open = button('btn', 'Open in Saoi', () => {
      void (async () => {
        open.disabled = true
        const finish = (text: string, url: string | null = null): void => {
          actionNote = { text, url }
          draw()
        }
        if (comparison === null || comparedFor !== JSON.stringify(inputs)) {
          status.textContent = 'Comparing every option that fits…'
          if (!(await runComparison())) {
            finish('The options could not be fetched from the card. Ask in the chat instead.')
            return
          }
        }
        const held = bridge.record(bridge.record(comparison)?.['saveLink'])?.['url']
        let url = typeof held === 'string' && held.startsWith('https://') ? held : null
        if (url === null && comparison !== null) {
          status.textContent = 'Saving to Saoi…'
          const saved = await bridge.callTool('saoi_save_plan', { plan: comparison.plan })
          const claim = bridge.record(saved?.['structuredContent'])?.['claimUrl']
          url = typeof claim === 'string' && claim.startsWith('https://') ? claim : null
        }
        if (url === null) {
          finish('It could not be saved from the card. Ask in the chat to save it.')
          return
        }
        const opened = await bridge.openLink(url)
        if (opened) finish('Opens in the Saoi app; the link works once.')
        else finish('Open it in the Saoi app (the link works once):', url)
      })()
    })
    const count = compared() ? (comparison?.home?.pathways.length ?? null) : null
    block.append(
      open,
      el('p', 'small muted', model.openLine(count, routes.length)),
      status,
      el('p', 'small muted', 'Held for 24 hours, then deleted unless opened.'),
    )
    return block
  }

  // ---- the card --------------------------------------------------------------------------------

  const draw = (): void => {
    drawn = true
    root.replaceChildren()
    root.removeAttribute('aria-busy')
    const header = el('header', 'header head-row')
    const title = el('h2', 'title', 'Your home-buying plan')
    title.append(el('span', 'badge', 'Estimate'))
    header.append(title)
    if (!editing)
      header.append(
        button('btn-outline', 'Edit', () => {
          editing = true
          openControl = null
          draw()
        }),
      )
    root.append(header)

    if (editing) {
      const live = el('section', 'section')
      live.append(
        headline,
        collapsible('See the breakdown', (body) => {
          body.append(breakdown)
        }),
      )
      const actions = el('div', 'actions')
      actions.append(compareButton())
      root.append(live, figuresStep(), preferencesStep(), actions)
    } else {
      const missing = model.missingFacts(given)
      if (missing.length > 0) {
        const facts = el('section', 'facts')
        const chips = el('div', 'chips')
        for (const control of missing) chips.append(chip(control, 'facts'))
        facts.append(chips)
        if (openControl?.where === 'facts') facts.append(controlView(openControl.control))
        root.append(facts)
      }
      root.append(planView())
      const routeBlock = routesView()
      if (routeBlock !== null) root.append(routeBlock)
    }
    root.append(actionsView())

    // What was assumed, the warnings (the comparison’s, else the statutory three) and the statement.
    const foot = el('footer', 'footer')
    foot.append(el('p', 'small', model.assumedLine(assumed)))
    const returned = comparison?.home?.warnings ?? []
    for (const warning of returned.length > 0 ? returned : WARNINGS) foot.append(el('p', 'small', warning))
    foot.append(el('p', 'small', STATEMENT))
    root.append(foot)
    refresh()
  }

  /** The host's figures (arguments or the result's echo): fold when the four figures came. */
  const take = (args: Record<string, unknown> | null): void => {
    inputs = model.fromArguments(args, asOf)
    given = model.given(args)
    editing = !model.startsFolded(args)
  }

  bridge.on('ui/notifications/tool-input', (params) => {
    if (drawn && rules !== null) return
    take(bridge.record(params?.['arguments']))
    draw()
  })
  bridge.on('ui/notifications/tool-result', (params) => {
    const content = bridge.record(params?.['structuredContent'])
    if (!drawn) take(bridge.record(content?.['inputs']))
    // The host's result, unless the card has already asked for newer routes itself.
    if (routesRun === 0) takeRoutes({ structuredContent: content })
    else {
      const sent = bridge.record(content?.['rules'])
      if (sent !== null) rules = sent as unknown as HomeRules
    }
    if (!drawn || !editing) draw()
    else refresh()
  })
  bridge.on('ui/notifications/tool-cancelled', () => {
    if (!drawn) draw()
  })
  void bridge.start('saoi-home-calculator')
}
