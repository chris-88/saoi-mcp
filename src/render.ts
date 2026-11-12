/**
 * Short text renderings of saoi-api's results, for hosts that do not read structured content.
 * Every one keeps what the design says must travel with a figure: the ranking basis, flags,
 * unknowns, when the data was checked, and the CCPC attribution. Nothing here is advice; the
 * wording comes from saoi-api or states a figure.
 */

import type {
  About,
  BuildPlanResult,
  DebtResult,
  FirstHomeResult,
  HomeCalculatorResult,
  MoneyCheckResult,
  MortgageResult,
  ProductDetail,
  ProjectionResult,
  ReviewResult,
  SavePlanResult,
  SearchResult,
} from './saoiClient.js'

type Product = SearchResult['results'][number]['product']
type Figures = SearchResult['results'][number]['figures']

export const eur = (value: number): string =>
  `€${value.toLocaleString('en-IE', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`

const pct = (value: number): string => `${String(Math.round(value * 100) / 100)}%`

const day = (iso: string | null | undefined): string =>
  iso === null || iso === undefined ? 'not known' : iso.slice(0, 10)

function footer(input: {
  dataCheckedAt?: string | null
  attributions?: readonly string[]
  assumptions?: readonly string[]
}): string[] {
  const lines: string[] = []
  if (input.assumptions !== undefined && input.assumptions.length > 0) {
    lines.push('', 'Assumptions:', ...input.assumptions.map((text) => `- ${text}`))
  }
  if (input.dataCheckedAt !== undefined && input.dataCheckedAt !== null) {
    lines.push('', `Data last checked: ${day(input.dataCheckedAt)}.`)
  }
  for (const attribution of input.attributions ?? []) lines.push(attribution)
  return lines
}

/**
 * The block every result opens with: what to tell the customer, in order. Hosts read the top of a
 * result and relay it, so the headline sentences go here and the detail follows under "Detail".
 */
export function present(lines: readonly string[]): string[] {
  return ['Present to the customer:', ...lines.map((line) => `- ${line}`), '', 'Detail:']
}

/** Under every result (decision 2026-11-10): Saoi compares; it is not regulated and does not advise. */
export const STATEMENT =
  'Saoi is not regulated by the Central Bank of Ireland and does not give advice; it compares products on the figures you give.'

const DECIDES = `These are options with their figures, for the inputs given; the customer decides. ${STATEMENT}`

/** The statutory mortgage warnings, shown with every mortgage result (saoi-api's wording). */
export const MORTGAGE_WARNINGS = [
  'Warning: if you do not keep up your repayments you may lose your home.',
  'Warning: the cost of your monthly repayments may increase.',
  'Warning: if you do not meet the repayments on your loan, your account will go into arrears.',
] as const

export const productName = (product: Pick<Product, 'name' | 'providerName'>): string =>
  product.name.toLowerCase().startsWith(product.providerName.toLowerCase())
    ? product.name
    : `${product.providerName} ${product.name}`

export function figuresLine(figures: Figures): string {
  switch (figures.kind) {
    case 'savings':
      return (
        `${eur(figures.netInterest)} interest after DIRT over ${String(figures.knownMonths)} months` +
        `${figures.termMonths === null ? '' : ` (${String(figures.termMonths)}-month term)`}, ` +
        `${pct(figures.netRatePct)} net a year; balance ${eur(figures.endBalance)}`
      )
    case 'mortgage':
      return (
        `${eur(figures.monthlyRepayment)} a month` +
        (figures.monthlyAfterFixed === null ? '' : `, then ${eur(figures.monthlyAfterFixed)}`) +
        (figures.totalCostAfterCashback === null
          ? ''
          : `; cost over ${String(figures.termYears)} years ${eur(figures.totalCostAfterCashback)}`) +
        (figures.cashbackEur === null ? '' : `; cashback ${eur(figures.cashbackEur)}`) +
        (figures.ltvPct === null ? '' : `; LTV ${pct(figures.ltvPct)}`)
      )
    case 'loan':
      return `${eur(figures.monthlyRepayment)} a month for ${String(figures.termMonths)} months; total interest ${eur(figures.totalInterest)}`
    case 'credit_card':
      return figures.interestOver12Months === null
        ? 'interest not known (no purchase rate stated)'
        : `${eur(figures.interestOver12Months)} interest over 12 months on ${eur(figures.balance)}`
    case 'current_account':
      return figures.annualFeeEur === null ? 'fee not stated' : `${eur(figures.annualFeeEur)} a year in fees`
  }
}

function productLines(rank: string, product: Product, figures: string, flags: readonly string[]): string[] {
  return [
    `${rank} ${productName(product)} [${product.id}] (${product.provenance.source === 'bank' ? 'from the provider' : 'from CCPC'}, checked ${day(product.provenance.checkedAt)})`,
    `   ${figures}`,
    ...flags.map((flag) => `   · ${flag}`),
  ]
}

export function renderSearch(result: SearchResult): string {
  return [
    ...present([
      ...result.results
        .slice(0, 3)
        .map((row) => `${String(row.rank)}. ${productName(row.product)}: ${figuresLine(row.figures)}.`),
      ...(result.results.some((row) => row.product.category === 'mortgage') ? MORTGAGE_WARNINGS : []),
      `Ranked by ${result.ranking.objective.replaceAll('_', ' ')}; another order can be asked for. ${DECIDES}`,
    ]),
    `Ranked by ${result.ranking.objective.replaceAll('_', ' ')}: ${result.ranking.basis}`,
    `${String(result.matched)} matched; ${String(result.results.length)} shown.`,
    '',
    ...result.results.flatMap((row) =>
      productLines(`${String(row.rank)}.`, row.product, figuresLine(row.figures), row.flags),
    ),
    ...(result.excluded.length === 0
      ? []
      : ['', `Left out: ${result.excluded.map((e) => `${e.reason} (${String(e.count)})`).join('; ')}.`]),
    ...footer(result),
  ].join('\n')
}

export function renderProduct(detail: ProductDetail): string {
  const { product } = detail
  const latest = detail.history[0]
  const prose = detail.verbatim.flatMap((row) =>
    Object.entries(row.prose).map(
      ([label, text]) => `${label}: ${text.length > 600 ? `${text.slice(0, 599)}…` : text}`,
    ),
  )
  return [
    ...present([
      `${productName(product)}${latest === undefined ? '' : `: ${latest.headline}`} (${product.provenance.source === 'bank' ? 'the provider’s own site' : 'CCPC'}, checked ${day(product.provenance.checkedAt)}).`,
      ...(product.depositGuarantee === null ? [] : [guaranteeLine(product.depositGuarantee)]),
      ...product.checks.slice(0, 2),
    ]),
    `${productName(product)} [${product.id}], ${product.category.replace('_', ' ')}`,
    `Source: ${product.provenance.source === 'bank' ? 'the provider’s own site' : 'CCPC'} (${product.provenance.sourceUrl}); checked ${day(product.provenance.checkedAt)}; last changed ${product.provenance.lastChangedAt === null ? 'no change seen since first recorded' : day(product.provenance.lastChangedAt)}.`,
    ...(product.provenance.providerUrl === null ? [] : [`Provider page: ${product.provenance.providerUrl}`]),
    ...(product.platform === null ? [] : [product.platform.note]),
    ...(product.depositGuarantee === null ? [] : [guaranteeLine(product.depositGuarantee)]),
    '',
    'Rate history (newest first):',
    ...detail.history.map(
      (row) =>
        `- ${row.headline}, from ${day(row.from)}${row.to === null ? ' (current)' : ` to ${day(row.to)}`} [${row.source}]`,
    ),
    ...(product.unknowns.length === 0
      ? []
      : ['', 'Not stated by the source:', ...product.unknowns.map((u) => `- ${u.meaning}`)]),
    '',
    'Check:',
    ...product.checks.map((check) => `- ${check}`),
    ...(prose.length === 0 ? [] : ['', 'In the source’s words:', ...prose]),
    ...footer({
      attributions: product.provenance.attribution === null ? [] : [product.provenance.attribution],
    }),
  ].join('\n')
}

export function renderAbout(about: About): string {
  return about.text
}

type MoneyFound = ReviewResult['moneyFound']

/** The headline first: the figure a year, its parts with their sources, and what is not counted. */
export function renderMoneyFound(found: MoneyFound): string[] {
  return [
    found.headline,
    ...found.parts.map(
      (part) =>
        `- ${eur(part.annualEur)} a year: ${part.label}. ${part.detail} (${part.source}${part.checkedAt === null ? '' : `, checked ${day(part.checkedAt)}`})`,
    ),
    ...(found.notCounted.length === 0
      ? []
      : [
          'Not counted:',
          ...found.notCounted.map(
            (item) =>
              `- ${item.label}${item.annualEur === null ? '' : ` (${eur(item.annualEur)} a year)`}: ${item.why}`,
          ),
        ]),
    found.basis,
    '',
  ]
}

export function renderReview(result: ReviewResult): string {
  return [
    ...present(result.presentation),
    ...renderMoneyFound(result.moneyFound),
    result.findings.length === 0 ? 'No findings for the figures given.' : 'Findings:',
    ...result.findings.flatMap((finding) => [`- ${finding.headline}`, `  ${finding.detail}`]),
    ...(result.candidateGoals.length === 0
      ? []
      : ['', 'Goals these suggest:', ...result.candidateGoals.map((goal) => `- ${goal.label}: ${goal.why}`)]),
    ...footer(result),
    '',
    `Next: ${result.next}`,
  ].join('\n')
}

export function renderProjection(result: ProjectionResult): string {
  return [
    ...present([
      `To month ${String(result.totals.knownThroughMonth)}: ${eur(result.totals.paidIn)} paid in, ${eur(result.totals.netInterest)} interest after DIRT, ${eur(result.totals.balance)} in all.`,
      ...(result.goal === null
        ? []
        : [
            result.goal.reachedOn === null
              ? `${eur(result.goal.targetAmount)} is not reached within the months the figures cover.`
              : `${eur(result.goal.targetAmount)} is reached in ${result.goal.reachedOn}.`,
          ]),
      DECIDES,
    ]),
    result.basis,
    '',
    ...result.lines.flatMap((line) => [
      `- ${productName(line.product)} [${line.product.id}]: ${[
        line.lumpSum > 0 ? `${eur(line.lumpSum)} placed` : '',
        line.monthly > 0 ? `${eur(line.monthly)} a month` : '',
      ]
        .filter((part) => part !== '')
        .join(' and ')}${line.termMonths === null ? '' : `, ${String(line.termMonths)}-month term`}`,
      `  ${figuresLine(line.figures)}`,
      ...line.notes.map((note) => `  · ${note}`),
    ]),
    '',
    `Totals to month ${String(result.totals.knownThroughMonth)}: paid in ${eur(result.totals.paidIn)}, interest after DIRT ${eur(result.totals.netInterest)}, balance ${eur(result.totals.balance)}.`,
    ...(result.goal === null
      ? []
      : [
          result.goal.reachedOn === null
            ? `${eur(result.goal.targetAmount)} is not reached within the months the figures cover.`
            : `${eur(result.goal.targetAmount)} is reached in ${result.goal.reachedOn} (month ${String(result.goal.reachedMonth)}).`,
        ]),
    ...footer(result),
  ].join('\n')
}

export function renderMortgage(result: MortgageResult): string {
  if (result.mode === 'affordability') {
    return [
      ...present([
        `Under the Central Bank limits the highest price is ${eur(result.maxPrice)} (the ${result.bindingLimit} limit binds): up to ${eur(result.maxLoanByIncome)} borrowed.`,
        ...(result.forProperty === null
          ? []
          : [
              `At ${eur(result.forProperty.propertyValue)}: a ${eur(result.forProperty.depositNeeded)} deposit${result.forProperty.depositShortfall > 0 ? `, ${eur(result.forProperty.depositShortfall)} short` : ''}; the loan is ${result.forProperty.withinIncomeLimit ? 'within' : 'above'} the income limit.`,
            ]),
        'For a first home, saoi_first_home adds Help to Buy.',
        ...MORTGAGE_WARNINGS,
        DECIDES,
      ]),
      `Central Bank limits: loan up to ${String(result.limits.loanToIncome)} times income, loan-to-value up to ${pct(result.limits.maxLtvPct)}. ${result.limits.allowance}`,
      `Most the income allows: ${eur(result.maxLoanByIncome)} borrowed. Most the deposit supports: a price of ${eur(result.maxPriceByDeposit)}.`,
      `Highest price within both: ${eur(result.maxPrice)} (the ${result.bindingLimit} limit binds).`,
      ...(result.forProperty === null
        ? []
        : [
            `For a ${eur(result.forProperty.propertyValue)} property: deposit needed ${eur(result.forProperty.depositNeeded)} (short by ${eur(result.forProperty.depositShortfall)}); loan ${eur(result.forProperty.loanNeeded)}, ${result.forProperty.withinIncomeLimit ? 'within' : 'above'} the income limit; LTV ${pct(result.forProperty.ltvPct)}.`,
          ]),
      '',
      `Mortgages for ${eur(result.loanAmount)} at ${pct(result.ltvPct)} LTV. ${result.ranking.basis}`,
      ...result.options.flatMap((option, index) =>
        productLines(`${String(index + 1)}.`, option.product, figuresLine(option.figures), option.flags),
      ),
      ...footer(result),
    ].join('\n')
  }
  const best = result.options[0]
  return [
    ...present([
      `Now: ${pct(result.current.ratePct)}, ${eur(result.current.monthlyRepayment)} a month.`,
      ...(best === undefined
        ? ['No switcher rate in the data is lower for these figures.']
        : [
            `Lowest whole-term cost of the ${String(result.options.length)} shown: ${productName(best.product)}, ${eur(best.monthlySaving)} a month less${best.lifetimeSaving === null ? '' : `, ${eur(best.lifetimeSaving)} over the term`} (fees as stated, not counted).`,
          ]),
      ...MORTGAGE_WARNINGS,
      DECIDES,
    ]),
    `Now: ${pct(result.current.ratePct)}, ${eur(result.current.monthlyRepayment)} a month, ${eur(result.current.totalRemaining)} over the rest of the term.${result.ltvPct === null ? '' : ` LTV ${pct(result.ltvPct)}.`}`,
    result.ranking.basis,
    '',
    ...result.options.flatMap((option, index) =>
      productLines(
        `${String(index + 1)}.`,
        option.product,
        `${figuresLine(option.figures)}; saves ${eur(option.monthlySaving)} a month${option.lifetimeSaving === null ? '' : `, ${eur(option.lifetimeSaving)} over the term`}${option.breakEvenMonths === null ? '' : `; break-even ${String(option.breakEvenMonths)} months`}`,
        option.flags,
      ),
    ),
    ...footer(result),
  ].join('\n')
}

export function renderDebt(result: DebtResult): string {
  return [
    ...present([
      ...result.costs.map(
        (cost) =>
          `${cost.label}: ${cost.ratePct === null ? 'rate not given' : pct(cost.ratePct)}${cost.interestRemaining === null ? '' : `, ${eur(cost.interestRemaining)} interest still to pay at the current repayment`}.`,
      ),
      ...result.overpayVersusSave.map(
        (row) =>
          `${eur(row.amount)}${row.cadence === 'monthly' ? ' a month' : ' once'}: put against ${row.debtId} it saves ${eur(row.interestSavedByOverpaying)} in interest; saved, it earns ${eur(row.netInterestBySaving)} after DIRT.`,
      ),
      DECIDES,
    ]),
    'What each debt costs:',
    ...result.costs.flatMap((cost) => [
      `- ${cost.label}: ${cost.ratePct === null ? 'rate not given' : pct(cost.ratePct)}` +
        (cost.interestRemaining === null ? '' : `; ${eur(cost.interestRemaining)} interest still to pay`) +
        (cost.monthsToClear === null ? '' : ` over ${String(cost.monthsToClear)} months`),
      ...cost.notes.map((note) => `  · ${note}`),
    ]),
    '',
    'Payoff order (saves the most interest first):',
    ...result.payoffOrder.map((step, index) => `${String(index + 1)}. ${step.debtId}: ${step.why}`),
    ...result.overpayVersusSave.flatMap((row) => [
      '',
      `${eur(row.amount)}${row.cadence === 'monthly' ? ' a month' : ' once'} over ${String(row.horizonMonths)} months: overpaying ${row.debtId} saves ${eur(row.interestSavedByOverpaying)} in interest; saving it${row.savingProduct === null ? '' : ` in ${row.savingProduct}`} earns ${eur(row.netInterestBySaving)} after DIRT (difference ${eur(row.difference)}).`,
    ]),
    ...result.refinance.flatMap((item) => [
      '',
      `Refinancing ${item.debtId}: ${item.note}`,
      ...item.options.flatMap((option, index) =>
        productLines(
          `${String(index + 1)}.`,
          option.product,
          `${figuresLine(option.figures)}${option.interestSaving === null ? '' : `; ${eur(option.interestSaving)} less interest`}`,
          option.flags,
        ),
      ),
    ]),
    ...footer(result),
  ].join('\n')
}

type PlanGuarantee = NonNullable<
  BuildPlanResult['plan']['combination']['products'][number]['depositGuarantee']
>

/** The deposit guarantee in one line, with where it was read. */
export function guaranteeLine(guarantee: PlanGuarantee): string {
  const where =
    guarantee.sourceUrl === null || guarantee.sourceUrl === undefined
      ? ''
      : ` (source: ${guarantee.sourceUrl}${guarantee.checkedOn === null || guarantee.checkedOn === undefined ? '' : `, checked ${guarantee.checkedOn}`})`
  if (guarantee.scheme === null) {
    return `Deposit guarantee: ${guarantee.note ?? 'not recorded; confirm with the provider'}${where}.`
  }
  return `Deposit guarantee: ${guarantee.scheme}${guarantee.coverEur === null ? '' : `, up to ${eur(guarantee.coverEur)}`}${guarantee.note === null || guarantee.note === undefined ? '' : `. ${guarantee.note}`}${where}.`
}

/** A payoff step as an option with its figures, not an instruction: the customer decides. */
const DEBT_ACTIONS: Record<BuildPlanResult['plan']['debts'][number]['action'], string> = {
  pay_off_first: 'cleared from the lump sum in this combination',
  overpay: 'part paid from the lump sum in this combination',
  keep_paying: 'kept as it is in this combination',
  refinance: 'refinancing compared in this combination',
}

export function renderPlan(result: BuildPlanResult): string {
  const { plan } = result
  return [
    ...present(result.presentation),
    ...renderMoneyFound(result.moneyFound),
    plan.title,
    `Ranked by ${plan.ranking.objective.replaceAll('_', ' ')}: ${plan.ranking.basis}`,
    '',
    ...result.reasoning.map((line) => `- ${line}`),
    ...renderHomeOptions(result.home),
    '',
    'One worked combination, for the stated rule (other splits below it):',
    ...plan.combination.products.flatMap((product) => [
      `- ${product.productName} (${product.providerName}, ${product.source === 'bank' ? 'from the provider' : 'from CCPC'}): ${[
        product.amount === undefined ? '' : `${eur(product.amount)} placed`,
        product.monthlyAmount === undefined ? '' : `${eur(product.monthlyAmount)} a month`,
      ]
        .filter((part) => part !== '')
        .join(' and ')}${product.ratePct === undefined ? '' : ` at ${pct(product.ratePct)}`}` +
        (product.projected?.netInterest === undefined
          ? ''
          : `; ${eur(product.projected.netInterest)} after DIRT over ${String(product.projected.horizonMonths)} months`),
      ...(product.depositGuarantee === undefined ? [] : [`  · ${guaranteeLine(product.depositGuarantee)}`]),
      ...product.unknowns.map((unknown) => `  · Not stated: ${unknown}`),
      ...product.checks.map((check) => `  · ${check}`),
    ]),
    ...((result.runnersUp as BuildPlanResult['runnersUp'] | undefined) === undefined ||
    result.runnersUp.length === 0
      ? []
      : [
          '',
          'Other splits, each without one product of the first:',
          ...result.runnersUp.map((runnerUp) => `- ${runnerUp.line}`),
        ]),
    '',
    `Locked or accessible: ${result.liquidity.why}`,
    ...(result.whatIf.lines.length === 0
      ? []
      : ['', 'What if:', ...result.whatIf.lines.map((line) => `- ${line}`)]),
    ...(plan.debts.length === 0
      ? []
      : [
          '',
          'Debts:',
          ...plan.debts.map((step) => {
            const debt = plan.situation.debts.find((candidate) => candidate.id === step.debtId)
            return `- ${debt?.label ?? step.debtId}: ${DEBT_ACTIONS[step.action]}. ${step.why}`
          }),
        ]),
    ...(result.helpToBuy === null
      ? []
      : [
          '',
          `${result.helpToBuy.note} Source: ${result.helpToBuy.sourceUrl} (checked ${result.helpToBuy.checkedOn}).`,
        ]),
    ...footer({
      assumptions: plan.assumptions,
      dataCheckedAt: plan.dataCheckedAt,
      attributions: [
        ...new Set(
          plan.combination.products.flatMap((p) => (p.attribution === undefined ? [] : [p.attribution])),
        ),
      ],
    }),
    '',
    `Next: ${result.next}`,
    '',
    STATEMENT,
  ].join('\n')
}

/** Every home option, in the customer's order, with the filters they chose and the warnings. */
function renderHomeOptions(home: BuildPlanResult['home'] | undefined): string[] {
  // Optional at runtime: results from before saoi-api carried `home` have none.
  if (home === null || home === undefined) return []
  // Older results carry neither the filters nor the warnings: the warnings are shown anyway.
  const extra = home as Partial<
    Pick<NonNullable<BuildPlanResult['home']>, 'filters' | 'sortedBy' | 'warnings'>
  >
  return [
    '',
    `Home options: ${extra.sortedBy ?? 'sorted by cost over the first 5 years'}`,
    ...(extra.filters ?? []).map((filter) => `- ${filter}`),
    ...home.pathways.map((option, index) => `${String(index + 1)}. ${option.line}`),
    ...home.leftOut.map((line) => `  Left out: ${line}`),
    ...(extra.warnings ?? MORTGAGE_WARNINGS),
  ]
}

type HomeRoute = HomeCalculatorResult['routes'][number]

const ROUTE_STATUS: Record<HomeRoute['status'], string> = {
  potential: 'potential',
  needs_one_detail: 'needs one detail',
  not_applicable: 'not applicable',
}

/**
 * Every route to a home, in saoi-api's order, for questions: the presentation block already
 * carries the first three lines and "More routes: N". Facts only; none is picked.
 */
function renderRoutes(routes: readonly HomeRoute[] | undefined): string[] {
  // Optional at runtime: results from before saoi-api carried routes have none.
  if (routes === undefined || routes.length === 0) return []
  return [
    '',
    'Every route to a home, in the order given (facts; the customer chooses between them):',
    ...routes.flatMap((route) => [
      `- ${route.line} (${ROUTE_STATUS[route.status]})`,
      ...(route.reason === null ? [] : [`  ${route.reason}`]),
      ...(route.missing === null ? [] : [`  Still to know: ${route.missing}`]),
      ...(route.confirmed ? [] : ['  Not every rule here is read from a primary page yet.']),
      ...route.sources.slice(0, 1).map((source) => `  Source: ${source.url} (checked ${source.checkedOn})`),
    ]),
  ]
}

type HomeGate = HomeCalculatorResult['gate']

/**
 * The core-information gate (spec "The first thought"): funds saved, monthly saving, income (a
 * second income when buying together) and a price or a date. Null when saoi-api sent no gate
 * (before it carried one): the result is then shown as it always was.
 */
export function homeGate(result: HomeCalculatorResult): HomeGate | null {
  const gate = (result as Partial<Pick<HomeCalculatorResult, 'gate'>>).gate
  return gate ?? null
}

/**
 * While the gate is closed: the one or two questions for this reply, each with what it moves, and
 * nothing else. No figure, tile, assumption or link reaches the text, so none can be quoted.
 */
export function renderHomeGate(gate: HomeGate): string {
  const flagged = gate.missing.filter((item) => item.askNow)
  const now = (flagged.length > 0 ? flagged : gate.missing).slice(0, 2)
  const later = gate.missing.filter((item) => !now.includes(item))
  return [
    'Present to the customer (these questions are the whole reply; no figure until the card):',
    ...now.map((item) => `- ${item.question} ${item.moves}`),
    '',
    'Detail:',
    'The card, with every figure, opens once the core figures are in. Ask only the questions above, in plain words.',
    ...(later.length === 0
      ? []
      : [`Still to ask after these, one or two at a time: ${later.map((item) => item.question).join(' ')}`]),
    'On the next call to saoi_home_calculator, pass everything the customer has said so far, these answers included.',
  ].join('\n')
}

/** What the result carries while the gate is closed: the gate and the statement, no figure. */
export function gatedHomeContent(result: HomeCalculatorResult, gate: HomeGate): Record<string, unknown> {
  return { gate, statement: result.statement }
}

/** The home calculator: the figures that move with the inputs, and what is still to ask. */
export function renderHomeCalculator(result: HomeCalculatorResult): string {
  const f = result.figures
  const extra = result as Partial<Pick<HomeCalculatorResult, 'routes' | 'market'>>
  const market = extra.market ?? null
  return [
    ...present(result.presentation),
    'Figures:',
    ...(f.maxLoanEur === null ? [] : [`- Central Bank income limit: ${eur(f.maxLoanEur)} borrowed`]),
    ...(f.priceEur === null
      ? ['- Price: not known yet']
      : [
          `- Price: ${eur(f.priceEur)} (${f.priceFrom === 'given' ? 'as given' : 'the most the deposit by the date and the income limit allow'})`,
        ]),
    ...(f.loanEur === null
      ? []
      : [`- Mortgage: ${eur(f.loanEur)}${f.ltvPct === null ? '' : ` (${pct(f.ltvPct)} of the price)`}`]),
    ...(f.depositNeededEur === null ? [] : [`- Deposit: ${eur(f.depositNeededEur)}`]),
    ...(f.neededAtKeysEur === null ? [] : [`- Needed at the keys: ${eur(f.neededAtKeysEur)}`]),
    ...(f.helpToBuyConditional
      ? [`- Help to Buy: not counted above; up to ${eur(f.helpToBuyEur)}, limited by tax paid (not given)`]
      : f.helpToBuyEur > 0
        ? [`- Help to Buy counted: ${eur(f.helpToBuyEur)}`]
        : []),
    ...(f.depositReachedOn === null ? [] : [`- Saved by: ${f.depositReachedOn} (before interest)`]),
    ...(typeof f.maxPriceEur !== 'number'
      ? []
      : [
          `- Within the Central Bank limits: up to ${eur(f.maxPriceEur)} over ${String(f.termYears)} years; lenders decide`,
        ]),
    // The market in two sentences, as saoi-api gave them: facts, no product picked.
    ...(market === null || market.lines.length === 0
      ? []
      : [
          '',
          'Savings and mortgages that fit (facts, none picked):',
          ...market.lines.map((line) => `- ${line}`),
        ]),
    ...renderRoutes(extra.routes),
    ...(result.questions.length === 0
      ? []
      : [
          '',
          'Still to ask, one or two at a time, in plain words:',
          ...result.questions.map((q) => `- ${q.question}`),
        ]),
    '',
    `Next: ${result.next}`,
    ...result.rules.sources.map((source) => `Source: ${source}`),
  ].join('\n')
}

export function renderFirstHome(result: FirstHomeResult): string {
  const { helpToBuy: htb, lending } = result
  const price = lending.forPrice
  const extra = result as Partial<Pick<FirstHomeResult, 'routes' | 'rentVsRepayment'>>
  return [
    ...present(result.presentation),
    `Help to Buy: ${htb.status.replace('_', ' ')}${htb.amountEur === null ? `, up to ${eur(htb.upToEur)}` : `, ${eur(htb.amountEur)}`}.`,
    ...htb.reasons.map((reason) => `- ${reason}`),
    'Conditions (Revenue):',
    ...htb.conditions.map((condition) => `- ${condition}`),
    ...htb.sources.map((source) => `  Source: ${source.url} (checked ${source.checkedOn})`),
    '',
    `Central Bank limits: loan up to ${String(lending.loanToIncome)} times income (${eur(lending.maxLoanByIncome)}), loan-to-value up to ${pct(lending.maxLtvPct)}. ${lending.allowance} ${lending.exemptions}`,
    `Highest price the limits allow: ${eur(lending.maxPriceWithoutHelpToBuy)} without Help to Buy${lending.maxPriceWithHelpToBuy === null ? '' : `, ${eur(lending.maxPriceWithHelpToBuy)} for a new build with Help to Buy towards the deposit`}.`,
    ...(price === null
      ? []
      : [
          `At ${eur(price.price)}: deposit needed ${eur(price.depositNeeded)}; Help to Buy counted ${eur(price.helpToBuy)}; short by ${eur(price.depositShortfall)}; loan ${eur(price.loanNeeded)} (LTV ${pct(price.ltvPct)}), ${price.withinIncomeLimit ? 'within' : `${eur(price.aboveIncomeLimitBy)} above`} the income limit${price.helpToBuyMortgageShareMet === null ? '' : price.helpToBuyMortgageShareMet ? '; the mortgage is at least 70% of the price, as Help to Buy needs' : '; the mortgage is under 70% of the price, which Help to Buy does not allow'}.`,
        ]),
    `  Source: ${lending.source.url} (checked ${lending.source.checkedOn})`,
    '',
    `First Home shared equity: ${result.firstHomeScheme.note}`,
    '',
    `Green rates: ${result.greenRates.note}${result.greenRates.cheapestGreen === null ? '' : ` Cheapest green rate at this loan-to-value: ${result.greenRates.cheapestGreen.name}, ${pct(result.greenRates.cheapestGreen.ratePct)}${result.greenRates.cheapestGreen.berNeeded === null ? '' : ` (BER ${result.greenRates.cheapestGreen.berNeeded})`}.`}${result.greenRates.cheapestStandard === null ? '' : ` Cheapest standard: ${result.greenRates.cheapestStandard.name}, ${pct(result.greenRates.cheapestStandard.ratePct)}.`}`,
    '',
    `Mortgages that fit. ${result.ranking.basis}`,
    ...result.options.flatMap((option, index) =>
      productLines(`${String(index + 1)}.`, option.product, figuresLine(option.figures), option.flags),
    ),
    ...(extra.rentVsRepayment ?? []),
    ...renderRoutes(extra.routes),
    ...footer(result),
    '',
    `Next: ${result.next}`,
  ].join('\n')
}

export function renderMoneyCheck(result: MoneyCheckResult): string {
  return [
    ...present(result.presentation),
    ...(result.planGoalAssumed === null ? [] : [`Plan built for: ${result.planGoalAssumed}.`, '']),
    ...(result.plan === null
      ? [renderReview(result.review).split('\nDetail:\n').slice(1).join('\nDetail:\n')]
      : [renderPlan(result.plan).split('\nDetail:\n').slice(1).join('\nDetail:\n')]),
  ].join('\n')
}

export function renderSaved(result: SavePlanResult): string {
  return [
    ...present([
      `Saved: this comparison can be opened in the Saoi app: ${result.claimUrl} (held for 24 hours, then deleted unless opened).`,
    ]),
    `It works once and expires ${result.expiresAt}. Nothing else about the customer is stored.`,
  ].join('\n')
}
