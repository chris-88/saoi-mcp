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
  const prose = detail.verbatim.flatMap((row) =>
    Object.entries(row.prose).map(
      ([label, text]) => `${label}: ${text.length > 600 ? `${text.slice(0, 599)}…` : text}`,
    ),
  )
  return [
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

export function renderReview(result: ReviewResult): string {
  return [
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
  return [
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
  BuildPlanResult['plan']['recommendation']['products'][number]['depositGuarantee']
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

export function renderPlan(result: BuildPlanResult): string {
  const { plan } = result
  return [
    plan.title,
    `Ranked by ${plan.ranking.objective.replaceAll('_', ' ')}: ${plan.ranking.basis}`,
    '',
    ...result.reasoning.map((line) => `- ${line}`),
    '',
    'Products:',
    ...plan.recommendation.products.flatMap((product) => [
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
          ...plan.debts.map((step) => `- ${step.debtId}: ${step.action.replaceAll('_', ' ')}. ${step.why}`),
        ]),
    ...footer({
      assumptions: plan.assumptions,
      dataCheckedAt: plan.dataCheckedAt,
      attributions: [
        ...new Set(
          plan.recommendation.products.flatMap((p) => (p.attribution === undefined ? [] : [p.attribution])),
        ),
      ],
    }),
    '',
    `Next: ${result.next}`,
  ].join('\n')
}

export function renderSaved(result: SavePlanResult): string {
  return [
    `Saved. Open this link to carry the plan into the Saoi app: ${result.claimUrl}`,
    `It works once and expires ${day(result.expiresAt)}.`,
    'Nothing about the customer was kept before this call; the plan is stored only now, behind this link.',
  ].join('\n')
}
