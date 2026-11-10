import type { BuildPlanResult, HomeCalculatorResult } from '../saoiClient.js'

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
}

export type HomeSort = 'five_year_cost' | 'keys_date' | 'monthly_repayment'

export interface HomeFigures {
  maxLoanEur: number
  loanEur: number
  ltvPct: number
  depositNeededEur: number
  stampDutyEur: number
  helpToBuyEur: number
  neededAtKeysEur: number
  /** "YYYY-MM", or null when it is not reached (nothing saved a month). */
  reachedOn: string | null
  targetMet: boolean | null
  lines: string[]
}

export interface OptionRow {
  lender: string
  kind: string
  product: string
  rate: string
  monthly: string
  fiveYear: string
  keys: string
  more: string | null
  notes: string[]
  unconfirmed: boolean
}

export interface HomeCalculatorModel {
  defaults(asOf: string): HomeInputs
  fromArguments(args: Record<string, unknown> | null, asOf: string): HomeInputs
  figures(inputs: HomeInputs, rules: HomeRules, asOf: string): HomeFigures
  buildPlanBody(inputs: HomeInputs, sortBy: HomeSort): Record<string, unknown>
  contextText(inputs: HomeInputs, sortBy: HomeSort, count: number): string
  rows(home: NonNullable<BuildPlanResult['home']>, sortBy: HomeSort): OptionRow[]
  eur(value: number): string
  month(yyyyMm: string | null): string
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
  })

  /** The tool's arguments (or the result's echo of them) over the defaults. */
  const fromArguments = (args: Record<string, unknown> | null, asOf: string): HomeInputs => {
    const base = defaults(asOf)
    if (args === null) return base
    const date = args['targetDate']
    const kind = args['propertyKind']
    const rate = args['rateType']
    const bank = args['currentBank']
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
    }
  }

  /** saoi-api's `homeCalculator` for a given price, on the rules from the tool result. */
  const figures = (inputs: HomeInputs, rules: HomeRules, asOf: string): HomeFigures => {
    const measures = inputs.firstTimeBuyer ? rules.firstTimeBuyer : rules.otherBuyer
    const ltv = measures.maxLtvPct / 100
    const income = inputs.annualGrossIncomeEur + inputs.secondIncomeEur
    const maxLoan = round2(income * measures.loanToIncome)
    const price = inputs.targetPriceEur
    const htb =
      inputs.firstTimeBuyer && inputs.propertyKind === 'new_build' && price <= rules.helpToBuy.maxPriceEur
        ? round2(Math.min(price * rules.helpToBuy.shareOfPrice, rules.helpToBuy.capEur))
        : 0
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
      `Needed at the keys: ${eur(needed)}${htb > 0 ? `, after ${eur(htb)} Help to Buy (at its most)` : ''}.`,
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
      helpToBuyEur: htb,
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
      `rates: ${inputs.rateType}; green home: ${inputs.green ? 'yes' : 'no'}; open to switching current account: ${inputs.openToCurrentAccountSwitch ? 'yes' : 'no'}.`,
      `The card shows ${String(count)} options sorted by ${SORTS[sortBy]}. Talk them through as a comparison if asked;`,
      'do not pick one for the customer or say which to take. Use these inputs in any later saoi_build_plan call.',
    ].join(' ')

  const rows = (home: NonNullable<BuildPlanResult['home']>, sortBy: HomeSort): OptionRow[] => {
    const options = [...home.pathways].sort((a, b) => {
      const byCost = a.netCostEur - b.netCostEur
      const byMonthly = a.mortgage.monthlyRepayment - b.mortgage.monthlyRepayment
      const byKeys = (a.keysOn ?? '9999-99').localeCompare(b.keysOn ?? '9999-99')
      if (sortBy === 'monthly_repayment') return byMonthly || byCost
      if (sortBy === 'keys_date') return byKeys || byCost
      return byCost || byMonthly
    })
    return options.map((option) => {
      const fixed = option.mortgage.fixedYears
      return {
        lender: option.lenderName,
        kind: fixed === null ? 'Variable' : `${String(fixed)}-year fixed`,
        product: option.mortgage.name,
        rate: `${String(Math.round(option.mortgage.ratePct * 100) / 100)}%`,
        monthly: eur(option.mortgage.monthlyRepayment),
        fiveYear: eur(option.netCostEur),
        keys: month(option.keysOn),
        more: option.drivers === 'the rate alone' ? null : option.drivers,
        notes: option.conditions,
        unconfirmed: !option.confirmed,
      }
    })
  }

  return {
    defaults,
    fromArguments,
    figures,
    buildPlanBody,
    contextText,
    rows,
    eur,
    month,
    addMonths,
    monthsBetween,
  }
}
