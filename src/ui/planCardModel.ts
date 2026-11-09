import type { BuildPlanResult } from '../saoiClient.js'

/**
 * What the plan card shows, worked out from a `saoi_build_plan` result: every string is ready to
 * put on screen, so the browser side only places text. Nothing here computes a figure; it formats
 * the engine's.
 *
 * Self-contained on purpose: the card's script is this function's own source (see
 * `planCardResource.ts`), so it must not reach for anything outside its body at runtime. Types
 * are fine; they are gone by then.
 */
export interface PlanCardView {
  title: string
  moneyFound: { headline: string; notCounted: string[] }
  goals: { label: string; detail: string }[]
  products: {
    name: string
    provider: string
    role: string
    rate: string | null
    amounts: string
    projected: string | null
    guarantee: string
    guaranteeKnown: boolean
    checks: string[]
    unknowns: string | null
  }[]
  /** The net position (savings less debt) at the horizon, one row per scenario the engine ran. */
  scenarios: {
    heading: string
    rows: { label: string; net: string; note: string | null; inPlan: boolean }[]
  }[]
  basis: string
  footer: string[]
  /** What the Saoi app adds today, beside the button. Only what is built. */
  app: string
  attributions: string[]
  /** The plan exactly as the engine returned it, for `saoi_save_plan`. */
  plan: BuildPlanResult['plan']
  /** The 24-hour draft link into app.saoi.ie (`saveLink.url`), when the result carries one. */
  draftUrl: string | null
}

export function planCardModel(result: BuildPlanResult): PlanCardView {
  const eur = (value: number): string =>
    `€${value.toLocaleString('en-IE', {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`
  const pct = (value: number): string => `${String(Math.round(value * 100) / 100)}%`
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  /** "2028-05" or "2028-05-31" → "May 2028". */
  const month = (iso: string | null | undefined): string | null => {
    if (iso === null || iso === undefined) return null
    const match = /^(\d{4})-(\d{2})/.exec(iso)
    const name = match === null ? undefined : MONTHS[Number(match[2]) - 1]
    return match === null || name === undefined ? iso : `${name} ${match[1] ?? ''}`
  }
  const day = (iso: string): string => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime())
      ? iso.slice(0, 10)
      : date.toLocaleDateString('en-IE', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Europe/Dublin',
        })
  }
  const ROLES: Record<string, string> = {
    regular_saver: 'Regular saver',
    lump_sum: 'Lump sum',
    emergency_fund: 'Emergency fund',
    mortgage: 'Mortgage',
    refinance: 'Refinance',
    current_account: 'Current account',
    other: 'Other',
  }

  const { plan } = result
  const created = new Date(plan.createdAt)
  const horizon = Number.isNaN(created.getTime())
    ? `month ${String(result.horizonMonths)}`
    : (month(
        new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + result.horizonMonths, 1))
          .toISOString()
          .slice(0, 7),
      ) ?? `month ${String(result.horizonMonths)}`)

  const goals = plan.goals.map((goal) => {
    const target = [
      goal.targetAmount === undefined ? '' : eur(goal.targetAmount),
      goal.targetDate === undefined ? '' : `by ${month(goal.targetDate) ?? goal.targetDate}`,
    ]
      .filter((part) => part !== '')
      .join(' ')
    const reached = month(result.goalReachedOn)
    return {
      label: goal.label,
      detail: [target, reached === null ? '' : `reached ${reached} at this pace`]
        .filter((part) => part !== '')
        .join(' · '),
    }
  })

  const products = plan.recommendation.products.map((product) => {
    const guarantee = product.depositGuarantee
    const known = guarantee !== undefined && guarantee.scheme !== null
    // The guarantee has its own line; a check that only repeats it is dropped.
    const checks = product.checks.filter((check) => !(known && /deposit guarantee/i.test(check)))
    return {
      name: product.productName,
      provider: product.providerName,
      role: ROLES[product.role] ?? product.role,
      rate:
        product.ratePct === undefined
          ? null
          : `${pct(product.ratePct)} ${product.category === 'loan' || product.category === 'mortgage' || product.category === 'credit_card' ? 'APR' : 'AER'}`,
      amounts: [
        product.amount === undefined ? '' : `${eur(product.amount)} placed`,
        product.monthlyAmount === undefined ? '' : `${eur(product.monthlyAmount)} a month`,
      ]
        .filter((part) => part !== '')
        .join(' · '),
      projected:
        product.projected?.netInterest === undefined
          ? null
          : `${eur(product.projected.netInterest)} interest after DIRT over ${String(product.projected.horizonMonths)} months` +
            (product.projected.balance === undefined ? '' : `; balance ${eur(product.projected.balance)}`),
      guarantee:
        guarantee === undefined
          ? 'Deposit guarantee: not recorded; confirm with the provider'
          : guarantee.scheme === null
            ? `Deposit guarantee: ${guarantee.note ?? 'not recorded; confirm with the provider'}`
            : `Deposit guarantee: ${guarantee.scheme}${guarantee.coverEur === null ? '' : `, up to ${eur(guarantee.coverEur)}`}`,
      guaranteeKnown: known,
      checks,
      unknowns: product.unknowns.length === 0 ? null : `Not published: ${product.unknowns.join(', ')}`,
    }
  })

  const scenarios: PlanCardView['scenarios'] = result.debtScenarios.map((scenario) => {
    const debt = plan.situation.debts.find((candidate) => candidate.id === scenario.debtId)
    const label = debt?.label ?? scenario.debtId
    const row = (which: 'cleared' | 'kept') => {
      const figures = scenario[which]
      const reached = month(figures.goalReachedOn)
      return {
        label: which === 'cleared' ? `${label} cleared from the lump sum` : `${label} kept`,
        net: eur(figures.netPosition),
        note:
          [
            figures.debtAtHorizon > 0 ? `${eur(figures.debtAtHorizon)} still owed` : '',
            reached === null ? '' : `goal ${reached}`,
          ]
            .filter((part) => part !== '')
            .join(' · ') || null,
        inPlan: scenario.chosen === which,
      }
    }
    return { heading: `${label}: net position at ${horizon}`, rows: [row('cleared'), row('kept')] }
  })
  const { liquidity } = result
  if (liquidity.lockedNetPosition !== null && liquidity.instantNetPosition !== null) {
    scenarios.push({
      heading: `Locked or instant access: net position at ${horizon}`,
      rows: [
        {
          label: 'Instant access',
          net: eur(liquidity.instantNetPosition),
          note: null,
          inPlan: liquidity.decision === 'instant_access',
        },
        {
          label: 'Locked in a fixed term',
          net: eur(liquidity.lockedNetPosition),
          note:
            liquidity.gainEur === null
              ? null
              : `${eur(liquidity.gainEur)} ${liquidity.gainEur >= 0 ? 'more' : 'less'}, money tied up`,
          inPlan: liquidity.decision === 'locked',
        },
      ],
    })
  }

  const attributions = [
    ...new Set(
      plan.recommendation.products.flatMap((product) =>
        product.attribution === undefined ? [] : [product.attribution],
      ),
    ),
  ]

  // `saveLink` (saoi-api, build-plan): the plan held as a 24-hour single-use draft, or null when
  // it could not be held. Read without trusting its shape until the generated types carry it.
  const saveLink = (result as unknown as Record<string, unknown>)['saveLink']
  const linkUrl =
    typeof saveLink === 'object' && saveLink !== null
      ? (saveLink as Record<string, unknown>)['url']
      : undefined
  const draftUrl = typeof linkUrl === 'string' && /^https:\/\/app\.saoi\.ie\//.test(linkUrl) ? linkUrl : null

  return {
    title: plan.title,
    moneyFound: {
      headline: result.moneyFound.headline,
      notCounted: result.moneyFound.notCounted.map(
        (item) =>
          `Not counted: ${item.label}${item.annualEur === null ? '' : ` (${eur(item.annualEur)} a year)`}. ${item.why}`,
      ),
    },
    goals,
    products,
    scenarios,
    basis: `Ranked by ${plan.ranking.objective.replaceAll('_', ' ')}: ${plan.ranking.basis}`,
    footer: [
      `Information, not advice: options with their figures, for you to decide. Rates checked ${day(plan.dataCheckedAt)}; figures assume today's rates hold.`,
    ],
    attributions,
    app: 'In the Saoi app the plan opens as a card, Saoirse knows it and can talk it through, and signing in with an email keeps it across your devices.',
    plan,
    draftUrl,
  }
}
