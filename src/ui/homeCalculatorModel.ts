import type { HomeCalculatorResult } from '../saoiClient.js'

/**
 * The home calculator card's arithmetic and wording, as one self-contained function: the card's
 * script is this function's own source (see `homeCalculatorResource.ts`), so nothing here may
 * reach outside its body at runtime. Types are fine; they are gone by then.
 *
 * `figures` repeats saoi-api's `home-calculator.ts` on the rules the tool result carries, so the
 * card moves as the sliders move without a round trip; the tests hold the two equal. The options
 * themselves always come from saoi-api (`saoi_build_plan`).
 */

export type HomeRules = HomeCalculatorResult['rules']
export type HomeRoute = HomeCalculatorResult['routes'][number]

/** A fact the card can ask for with one control, from a chip. */
export type HomeControl =
  'county' | 'firstTimeBuyer' | 'propertyKind' | 'joint' | 'taxPaid' | 'monthlyRentEur'

export interface HomeInputs {
  depositSavedEur: number
  monthlySavingEur: number
  annualGrossIncomeEur: number
  /** 0 when buying alone. */
  secondIncomeEur: number
  targetPriceEur: number
  monthlyDebtRepaymentsEur: number
  /** "YYYY-MM". */
  targetDate: string
  firstTimeBuyer: boolean
  propertyKind: 'new_build' | 'second_hand'
  currentBank: string
  stayWithBank: boolean
  rateType: 'either' | 'fixed' | 'variable'
  green: boolean
  openToCurrentAccountSwitch: boolean
  /** One of saoi-api's 30 slugs, or '' when not given. */
  county: string
  /** Rent paid a month, or null when not given. It changes no figure. */
  monthlyRentEur: number | null
  /** Income Tax and DIRT paid over the last four tax years, or null: Help to Buy is then not counted. */
  taxPaidLastFourYearsEur: number | null
}

export type HomeSort = 'five_year_cost' | 'keys_date' | 'monthly_repayment'

export interface HomeFigures {
  maxLoanEur: number
  loanEur: number
  ltvPct: number
  depositNeededEur: number
  stampDutyEur: number
  /** The legal and survey allowance from the rules saoi-api sent. */
  legalAndSurveyEur: number
  /** Counted in `neededAtKeysEur`; with `helpToBuyConditional`, what it could be, not counted. */
  helpToBuyEur: number
  /** A new build with tax paid not given: the headline is without Help to Buy (saoi-api's rule). */
  helpToBuyConditional: boolean
  neededAtKeysEur: number
  /** "YYYY-MM", or null when it is not reached (nothing saved a month). */
  reachedOn: string | null
  targetMet: boolean | null
  lines: string[]
}

/** The thin bar under the headline: saved against the money needed at the keys. */
export interface HomeProgress {
  savedEur: number
  neededEur: number
  /** 0 to 100, capped. */
  pct: number
  toGoEur: number
  covered: boolean
}

export interface HomeCalculatorModel {
  defaults(asOf: string): HomeInputs
  fromArguments(args: Record<string, unknown> | null, asOf: string): HomeInputs
  figures(inputs: HomeInputs, rules: HomeRules, asOf: string): HomeFigures
  buildPlanBody(inputs: HomeInputs, sortBy: HomeSort): Record<string, unknown>
  contextText(inputs: HomeInputs, sortBy: HomeSort, count: number): string
  /**
   * "You could borrow up to €360,000 · deposit ready around Jan 2028".
   * With `keysOn` (saoi-api's month for these same inputs, savings interest counted) the headline
   * uses it, so it never disagrees with the options; without, the card's own estimate, before
   * interest, labelled so. With `helpToBuyConditional` it is always the card's own: the options'
   * month counts Help to Buy, and the headline must not.
   */
  headline(inputs: HomeInputs, figures: HomeFigures, keysOn?: string | null): string
  /**
   * The folded card's large headline, its month chosen exactly as `headline` chooses it:
   * "April 2028", or "Not reached at this pace"; `note` says when it is the card's own estimate
   * (before interest) and how far past the date given it falls.
   */
  readyHeadline(
    inputs: HomeInputs,
    figures: HomeFigures,
    keysOn?: string | null,
  ): { text: string; note: string | null }
  /**
   * What the money needed at the keys is made of: "€40,000 deposit + €4,000 stamp duty + €3,000
   * legal and survey", with " − €35,000 Help to Buy" when Help to Buy is counted.
   */
  factLine(figures: HomeFigures): string
  /** The same line in its terms, so the card can keep each term on one line when it wraps. */
  factParts(figures: HomeFigures): string[]
  /** Deposit saved against the money needed at the keys. */
  progress(inputs: HomeInputs, figures: HomeFigures): HomeProgress
  /** "Assumed: … Estimates only; rates and offers are not confirmed." */
  assumedLine(assumed: readonly string[]): string
  /** "Rent now €2,500 a month" under the progress, or null when rent was not given. */
  rentNow(rent: number | null): string | null
  /** The facts the arguments carried, by their request keys. */
  given(args: Record<string, unknown> | null): string[]
  /** True when the host supplied deposit, monthly saving, income and price: the card starts folded. */
  startsFolded(args: Record<string, unknown> | null): boolean
  /**
   * The facts still to ask on the folded card, as chips: rent only. First-time buyer stays assumed
   * (the result's `assumed` says so) and is answered under Edit, as is the kind of property.
   */
  missingFacts(given: readonly string[]): HomeControl[]
  /** The saoi_home_calculator request for these inputs; facts not given are left for it to ask. */
  homeCalculatorBody(inputs: HomeInputs, given: readonly string[]): Record<string, unknown>
  /** The control that answers a route's `missing` question, or null when the card has none. */
  controlFor(missing: string): HomeControl | null
  /** The chip's short question. */
  chipText(control: HomeControl): string
  /** The route's status as one small muted word. */
  statusWord(status: HomeRoute['status']): string
  /**
   * "Other supports": the first route is the customer's own kind (it is the headline), so the next
   * two in saoi-api's order. Every route sits behind "See all routes (N)".
   */
  otherRoutes(routes: readonly HomeRoute[]): HomeRoute[]
  /** The route's line without its name in front, when saoi-api put it there; otherwise as given. */
  routeDetail(route: HomeRoute): string
  /** saoi-api's county slugs with their names, in the order of the select. */
  counties(): (readonly [string, string])[]
  eur(value: number): string
  month(yyyyMm: string | null): string
  /** "April 2028". */
  longMonth(yyyyMm: string): string
  addMonths(asOf: string, months: number): string
  monthsBetween(from: string, to: string): number
}

export function homeCalculatorModel(): HomeCalculatorModel {
  const eur = (value: number): string =>
    `€${Math.round(value).toLocaleString('en-IE', { maximumFractionDigits: 0 })}`
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = (yyyyMm: string | null): string => {
    if (yyyyMm === null) return 'not reached'
    const match = /^(\d{4})-(\d{2})/.exec(yyyyMm)
    const name = match === null ? undefined : MONTHS[Number(match[2]) - 1]
    return match === null || name === undefined ? yyyyMm : `${name} ${match[1] ?? ''}`
  }
  const addMonths = (asOf: string, months: number): string => {
    const index = Number(asOf.slice(0, 4)) * 12 + Number(asOf.slice(5, 7)) - 1 + months
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`
  }
  const monthsBetween = (from: string, to: string): number => {
    const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1
    const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1
    return Math.max(0, b - a)
  }
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

  const defaults = (asOf: string): HomeInputs => ({
    depositSavedEur: 20_000,
    monthlySavingEur: 800,
    annualGrossIncomeEur: 70_000,
    secondIncomeEur: 0,
    targetPriceEur: 350_000,
    monthlyDebtRepaymentsEur: 0,
    targetDate: addMonths(asOf, 24),
    firstTimeBuyer: true,
    propertyKind: 'second_hand',
    currentBank: '',
    stayWithBank: false,
    rateType: 'either',
    green: false,
    openToCurrentAccountSwitch: true,
    county: '',
    monthlyRentEur: null,
    taxPaidLastFourYearsEur: null,
  })

  const COUNTIES: (readonly [string, string])[] = [
    ['carlow', 'Carlow'],
    ['cavan', 'Cavan'],
    ['clare', 'Clare'],
    ['cork', 'Cork'],
    ['donegal', 'Donegal'],
    ['dublin', 'Dublin (area not known)'],
    ['dublin_city', 'Dublin City'],
    ['dun_laoghaire_rathdown', 'Dún Laoghaire-Rathdown'],
    ['fingal', 'Fingal'],
    ['south_dublin', 'South Dublin'],
    ['galway', 'Galway'],
    ['kerry', 'Kerry'],
    ['kildare', 'Kildare'],
    ['kilkenny', 'Kilkenny'],
    ['laois', 'Laois'],
    ['leitrim', 'Leitrim'],
    ['limerick', 'Limerick'],
    ['longford', 'Longford'],
    ['louth', 'Louth'],
    ['mayo', 'Mayo'],
    ['meath', 'Meath'],
    ['monaghan', 'Monaghan'],
    ['offaly', 'Offaly'],
    ['roscommon', 'Roscommon'],
    ['sligo', 'Sligo'],
    ['tipperary', 'Tipperary'],
    ['waterford', 'Waterford'],
    ['westmeath', 'Westmeath'],
    ['wexford', 'Wexford'],
    ['wicklow', 'Wicklow'],
  ]
  const optional = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

  /** The tool's arguments (or the result's echo of them) over the defaults. */
  const fromArguments = (args: Record<string, unknown> | null, asOf: string): HomeInputs => {
    const base = defaults(asOf)
    if (args === null) return base
    const date = args['targetDate']
    const kind = args['propertyKind']
    const rate = args['rateType']
    const bank = args['currentBank']
    const county = args['county']
    return {
      depositSavedEur: num(args['depositSavedEur'], base.depositSavedEur),
      monthlySavingEur: num(args['monthlySavingEur'], base.monthlySavingEur),
      annualGrossIncomeEur: num(args['annualGrossIncomeEur'], base.annualGrossIncomeEur),
      secondIncomeEur: num(args['secondIncomeEur'], 0),
      targetPriceEur: num(args['targetPriceEur'], base.targetPriceEur),
      monthlyDebtRepaymentsEur: num(args['monthlyDebtRepaymentsEur'], 0),
      targetDate: typeof date === 'string' && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : base.targetDate,
      firstTimeBuyer: args['firstTimeBuyer'] !== false,
      propertyKind: kind === 'new_build' || kind === 'self_build' ? 'new_build' : 'second_hand',
      currentBank: typeof bank === 'string' ? bank.slice(0, 60) : '',
      stayWithBank: args['stayWithBank'] === true,
      rateType: rate === 'fixed' || rate === 'variable' ? rate : 'either',
      green: args['green'] === true,
      openToCurrentAccountSwitch: args['openToCurrentAccountSwitch'] !== false,
      county: typeof county === 'string' && COUNTIES.some(([slug]) => slug === county) ? county : '',
      monthlyRentEur: optional(args['monthlyRentEur']),
      taxPaidLastFourYearsEur: optional(args['taxPaidLastFourYearsEur']),
    }
  }

  /** saoi-api's `homeCalculator` for a given price, on the rules from the tool result. */
  const figures = (inputs: HomeInputs, rules: HomeRules, asOf: string): HomeFigures => {
    const measures = inputs.firstTimeBuyer ? rules.firstTimeBuyer : rules.otherBuyer
    const ltv = measures.maxLtvPct / 100
    const income = inputs.annualGrossIncomeEur + inputs.secondIncomeEur
    const maxLoan = round2(income * measures.loanToIncome)
    const price = inputs.targetPriceEur
    // Help to Buy counts towards the cash at the keys only when tax paid, which limits it, was
    // given; without it the figure is what it could be, and the headline leaves it out.
    const htbApplies = inputs.firstTimeBuyer && inputs.propertyKind === 'new_build'
    const htbUpTo =
      htbApplies && price <= rules.helpToBuy.maxPriceEur
        ? round2(Math.min(price * rules.helpToBuy.shareOfPrice, rules.helpToBuy.capEur))
        : 0
    const taxPaid = inputs.taxPaidLastFourYearsEur
    const htb = htbApplies && taxPaid !== null ? round2(Math.min(htbUpTo, taxPaid)) : 0
    const conditional = htbApplies && taxPaid === null && htbUpTo > 0
    const loan = round2(Math.min(price * ltv, maxLoan))
    const deposit = round2(price - loan)
    const stamp = round2((price * rules.stampDutyPct) / 100)
    const needed = round2(Math.max(0, deposit + stamp + rules.legalAndSurveyEur - htb))
    const saved = inputs.depositSavedEur
    const monthly = inputs.monthlySavingEur
    const reachedOn =
      saved >= needed
        ? addMonths(asOf, 0)
        : monthly > 0
          ? addMonths(asOf, Math.ceil((needed - saved) / monthly))
          : null
    const targetMet = reachedOn === null ? null : reachedOn <= inputs.targetDate
    const lines = [
      `Central Bank limit: ${String(measures.loanToIncome)} × ${eur(income)} = ${eur(maxLoan)}.`,
      loan < price * ltv
        ? `The loan is capped by income at ${eur(loan)}, so the deposit is ${eur(deposit)}.`
        : `A ${eur(loan)} mortgage (${String(measures.maxLtvPct)}%) and a ${eur(deposit)} deposit.`,
      `Needed at the keys: ${eur(needed)}${htb > 0 ? `, after ${eur(htb)} Help to Buy` : ''}.`,
      ...(conditional
        ? [
            `Help to Buy is not counted: up to ${eur(htbUpTo)}, it is limited by the Income Tax and DIRT paid over the last four tax years.`,
          ]
        : []),
      reachedOn === null
        ? 'Not reached with nothing saved a month.'
        : saved >= needed
          ? 'Already saved.'
          : `Saved around ${month(reachedOn)} (before interest)${targetMet === true ? ', by the date you gave' : `, ${String(monthsBetween(inputs.targetDate, reachedOn))} months after the date you gave`}.`,
      ...(inputs.monthlyDebtRepaymentsEur > 0
        ? [
            `Your ${eur(inputs.monthlyDebtRepaymentsEur)} a month in repayments is outside the Central Bank limits; lenders count it.`,
          ]
        : []),
    ]
    return {
      maxLoanEur: maxLoan,
      loanEur: loan,
      ltvPct: price > 0 ? round2((loan / price) * 100) : 0,
      depositNeededEur: deposit,
      stampDutyEur: stamp,
      legalAndSurveyEur: rules.legalAndSurveyEur,
      helpToBuyEur: conditional ? htbUpTo : htb,
      helpToBuyConditional: conditional,
      neededAtKeysEur: needed,
      reachedOn,
      targetMet,
      lines,
    }
  }

  /** The comparison call: saoi_build_plan with a house_deposit goal and the customer's filters. */
  const buildPlanBody = (inputs: HomeInputs, sortBy: HomeSort): Record<string, unknown> => ({
    situation: {
      summary: 'From the Saoi home calculator card.',
      ...(inputs.annualGrossIncomeEur + inputs.secondIncomeEur > 0
        ? { income: { annualGross: inputs.annualGrossIncomeEur + inputs.secondIncomeEur } }
        : {}),
      monthlySaving: inputs.monthlySavingEur,
      savings:
        inputs.depositSavedEur > 0
          ? [{ label: 'Deposit saved', balance: inputs.depositSavedEur, access: 'instant' }]
          : [],
      debts: [],
      firstTimeBuyer: inputs.firstTimeBuyer,
    },
    goals: [
      {
        id: 'home',
        kind: 'house_deposit',
        label: 'Buying a home',
        targetDate: inputs.targetDate,
        priority: 1,
      },
    ],
    homePrice: inputs.targetPriceEur,
    propertyKind: inputs.propertyKind,
    ...(inputs.taxPaidLastFourYearsEur === null
      ? {}
      : { taxPaidLastFourYearsEur: inputs.taxPaidLastFourYearsEur }),
    homePreferences: {
      ...(inputs.currentBank === '' ? {} : { currentBank: inputs.currentBank }),
      stayWithBank: inputs.currentBank !== '' && inputs.stayWithBank,
      rateType: inputs.rateType,
      green: inputs.green,
      openToCurrentAccountSwitch: inputs.openToCurrentAccountSwitch,
      sortBy,
    },
  })

  const SORTS: Record<HomeSort, string> = {
    five_year_cost: 'cost over the first 5 years',
    keys_date: 'keys date',
    monthly_repayment: 'monthly repayment',
  }

  /** What the conversation is told when the customer runs the comparison in the card. */
  const contextText = (inputs: HomeInputs, sortBy: HomeSort, count: number): string =>
    [
      'The customer used the Saoi home calculator card and ran the comparison with these inputs:',
      `deposit saved ${eur(inputs.depositSavedEur)}; saving ${eur(inputs.monthlySavingEur)} a month;`,
      `gross income ${eur(inputs.annualGrossIncomeEur)}${inputs.secondIncomeEur > 0 ? ` plus a second income of ${eur(inputs.secondIncomeEur)}` : ''};`,
      `price ${eur(inputs.targetPriceEur)}; existing repayments ${eur(inputs.monthlyDebtRepaymentsEur)} a month; keys wanted by ${month(inputs.targetDate)};`,
      `${inputs.firstTimeBuyer ? 'first-time buyer' : 'not a first-time buyer'}; ${inputs.propertyKind === 'new_build' ? 'new build' : 'second-hand'};`,
      `${inputs.currentBank === '' ? 'bank not given' : `banks with ${inputs.currentBank}${inputs.stayWithBank ? ', wants to see only their options' : ''}`};`,
      `rates: ${inputs.rateType}; green home: ${inputs.green ? 'yes' : 'no'}; open to switching current account: ${inputs.openToCurrentAccountSwitch ? 'yes' : 'no'};`,
      `county: ${COUNTIES.find(([slug]) => slug === inputs.county)?.[1] ?? 'not given'}; rent: ${inputs.monthlyRentEur === null ? 'not given' : `${eur(inputs.monthlyRentEur)} a month`}; tax paid over the last four years: ${inputs.taxPaidLastFourYearsEur === null ? 'not given' : eur(inputs.taxPaidLastFourYearsEur)}.`,
      'The card lists every route to a home as facts, in the order saoi-api gave; relay them as given and never call one the best.',
      `The comparison returned ${String(count)} options sorted by ${SORTS[sortBy]}; the list opens in the Saoi app. Talk them through as a comparison if asked;`,
      'do not pick one for the customer or say which to take. Use these inputs in any later saoi_build_plan call.',
    ].join(' ')

  /** Which month the headline shows, and whether it is the card's own estimate. */
  const readyOf = (figures: HomeFigures, keysOn?: string | null): { ready: string | null; own: boolean } => {
    // The options' month counts Help to Buy at its most; a conditional Help to Buy stays out of
    // the headline, so the card's own month (without it) is shown instead.
    const own = keysOn === undefined || figures.helpToBuyConditional
    return { ready: own ? figures.reachedOn : (keysOn ?? null), own }
  }

  const headline = (inputs: HomeInputs, figures: HomeFigures, keysOn?: string | null): string => {
    const { ready, own } = readyOf(figures, keysOn)
    const late = ready !== null && ready > inputs.targetDate
    return `You could borrow up to ${eur(figures.maxLoanEur)} · deposit ready ${
      ready === null ? 'not reached at this pace' : `around ${month(ready)}`
    }${own && ready !== null ? ' (before interest)' : ''}${late ? `, ${String(monthsBetween(inputs.targetDate, ready))} months after your date` : ''}`
  }

  const LONG_MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const longMonth = (yyyyMm: string): string => {
    const match = /^(\d{4})-(\d{2})/.exec(yyyyMm)
    const name = match === null ? undefined : LONG_MONTHS[Number(match[2]) - 1]
    return match === null || name === undefined ? yyyyMm : `${name} ${match[1] ?? ''}`
  }

  const readyHeadline = (
    inputs: HomeInputs,
    figures: HomeFigures,
    keysOn?: string | null,
  ): { text: string; note: string | null } => {
    const { ready, own } = readyOf(figures, keysOn)
    if (ready === null) return { text: 'Not reached at this pace', note: null }
    const notes = [
      ...(own ? ['Before interest'] : []),
      ...(ready > inputs.targetDate
        ? [
            `${String(monthsBetween(inputs.targetDate, ready))} ${monthsBetween(inputs.targetDate, ready) === 1 ? 'month' : 'months'} after your date`,
          ]
        : []),
    ]
    return { text: longMonth(ready), note: notes.length === 0 ? null : notes.join(', ') }
  }

  const factParts = (figures: HomeFigures): string[] => [
    `${eur(figures.depositNeededEur)} deposit`,
    `+ ${eur(figures.stampDutyEur)} stamp duty`,
    `+ ${eur(figures.legalAndSurveyEur)} legal and survey`,
    ...(!figures.helpToBuyConditional && figures.helpToBuyEur > 0
      ? [`− ${eur(figures.helpToBuyEur)} Help to Buy`]
      : []),
  ]

  const factLine = (figures: HomeFigures): string => factParts(figures).join(' ')

  const progress = (inputs: HomeInputs, figures: HomeFigures): HomeProgress => {
    const saved = inputs.depositSavedEur
    const needed = figures.neededAtKeysEur
    const covered = saved >= needed
    return {
      savedEur: saved,
      neededEur: needed,
      pct: covered ? 100 : Math.round((saved / needed) * 1000) / 10,
      toGoEur: covered ? 0 : round2(needed - saved),
      covered,
    }
  }

  const assumedLine = (assumed: readonly string[]): string => {
    const lines = assumed.map((line) => line.trim().replace(/\.$/, '')).filter((line) => line !== '')
    const tail = 'Estimates only; rates and offers are not confirmed.'
    return lines.length === 0 ? tail : `Assumed: ${lines.join(', ')}. ${tail}`
  }

  const rentNow = (rent: number | null): string | null =>
    rent === null ? null : `Rent now ${eur(rent)} a month`

  const given = (args: Record<string, unknown> | null): string[] =>
    args === null ? [] : Object.keys(args).filter((key) => args[key] !== undefined && args[key] !== null)

  const startsFolded = (args: Record<string, unknown> | null): boolean =>
    args !== null &&
    ['depositSavedEur', 'monthlySavingEur', 'annualGrossIncomeEur', 'targetPriceEur'].every(
      (key) => optional(args[key]) !== null,
    )

  const missingFacts = (known: readonly string[]): HomeControl[] =>
    (['monthlyRentEur'] as const).filter((key) => !known.includes(key))

  const homeCalculatorBody = (inputs: HomeInputs, known: readonly string[]): Record<string, unknown> => ({
    depositSavedEur: inputs.depositSavedEur,
    monthlySavingEur: inputs.monthlySavingEur,
    annualGrossIncomeEur: inputs.annualGrossIncomeEur,
    ...(inputs.secondIncomeEur > 0 ? { secondIncomeEur: inputs.secondIncomeEur } : {}),
    targetPriceEur: inputs.targetPriceEur,
    ...(inputs.monthlyDebtRepaymentsEur > 0
      ? { monthlyDebtRepaymentsEur: inputs.monthlyDebtRepaymentsEur }
      : {}),
    targetDate: inputs.targetDate,
    ...(known.includes('firstTimeBuyer') ? { firstTimeBuyer: inputs.firstTimeBuyer } : {}),
    ...(known.includes('propertyKind') ? { propertyKind: inputs.propertyKind } : {}),
    ...(inputs.taxPaidLastFourYearsEur === null
      ? {}
      : { taxPaidLastFourYearsEur: inputs.taxPaidLastFourYearsEur }),
    ...(inputs.county === '' ? {} : { county: inputs.county }),
    ...(inputs.monthlyRentEur === null ? {} : { monthlyRentEur: inputs.monthlyRentEur }),
    ...(inputs.currentBank === '' ? {} : { currentBank: inputs.currentBank }),
    stayWithBank: inputs.currentBank !== '' && inputs.stayWithBank,
    rateType: inputs.rateType,
    green: inputs.green,
    openToCurrentAccountSwitch: inputs.openToCurrentAccountSwitch,
  })

  const controlFor = (missing: string): HomeControl | null => {
    if (/county|part of .+ is the home in/i.test(missing)) return 'county'
    if (/income tax|tax paid/i.test(missing)) return 'taxPaid'
    if (/^what is the gross income/i.test(missing)) return null
    if (/buying with you|with someone|joint/i.test(missing)) return 'joint'
    if (/first home|owned one/i.test(missing)) return 'firstTimeBuyer'
    if (/new build or second-hand/i.test(missing)) return 'propertyKind'
    return null
  }

  const CHIPS: Record<HomeControl, string> = {
    county: 'Which county?',
    firstTimeBuyer: 'First home?',
    propertyKind: 'New build or second-hand?',
    joint: 'Buying with someone?',
    taxPaid: 'Tax paid, last 4 years?',
    monthlyRentEur: 'Rent a month?',
  }

  const STATUS: Record<HomeRoute['status'], string> = {
    potential: 'Potential',
    needs_one_detail: 'One detail',
    not_applicable: 'Not applicable',
  }

  const otherRoutes = (routes: readonly HomeRoute[]): HomeRoute[] => routes.slice(1, 3)

  const routeDetail = (route: HomeRoute): string => {
    const lead = `${route.name}: `
    return route.line.startsWith(lead) ? route.line.slice(lead.length) : route.line
  }

  return {
    defaults,
    fromArguments,
    given,
    startsFolded,
    missingFacts,
    homeCalculatorBody,
    controlFor,
    chipText: (control) => CHIPS[control],
    statusWord: (status) => STATUS[status],
    otherRoutes,
    routeDetail,
    counties: () => COUNTIES,
    figures,
    buildPlanBody,
    contextText,
    headline,
    readyHeadline,
    factLine,
    factParts,
    progress,
    assumedLine,
    rentNow,
    eur,
    month,
    longMonth,
    addMonths,
    monthsBetween,
  }
}
