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
  /**
   * For a home goal (saoi-api `home`): "Your home: keys around <month>", the assumptions, and up
   * to three pathways, ranked by cost, each with the keys month first. Null for other goals.
   */
  home: {
    headline: string
    assumptions: string
    rows: { lender: string; keys: string; cost: string; driver: string; confirmed: boolean }[]
  } | null
  /** `headline` is the figure; `note` the sentences after it (how money held is counted). */
  moneyFound: { headline: string; note: string | null; notCounted: string[] }
  /** The goals the plan saves towards (the buffer shows in the position instead). */
  goals: { label: string; detail: string }[]
  /**
   * Everything held at the end, less what is still owed, with its parts named. Null for a result
   * from before saoi-api carried it.
   */
  position: {
    heading: string
    total: string
    parts: { label: string; value: string }[]
    note: string | null
  } | null
  /** "Assumed: …" for each debt whose repayment was not given; shown under the position. */
  assumed: string[]
  /** One compact row per alternative worked out in the same call, under the position. */
  /**
   * `total` is what goes towards the goal (options are compared by it, Chris 2026-11-10); `held`
   * the total held in all, secondary.
   */
  alternatives: {
    name: string
    changes: string
    total: string
    held: string
    difference: string | null
  }[]
  products: {
    name: string
    provider: string
    role: string
    rate: string | null
    /** "MoCo · €11,000": the provider and the amounts, for the one-line view. */
    line: string
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
  /** The save button's label and note, growing with the plan (saoi-api `saveCall`). */
  save: { label: string; note: string; today: string; coming: string | null }
  /** "Plan based on 4 of 6 answers", or null for older results. */
  completeness: string | null
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

  const goals = plan.goals
    .filter((goal) => goal.kind !== 'emergency_fund')
    .map((goal) => {
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
    const short = [
      product.amount === undefined ? '' : eur(product.amount),
      product.monthlyAmount === undefined ? '' : `${eur(product.monthlyAmount)} a month`,
    ]
      .filter((part) => part !== '')
      .join(' + ')
    return {
      name: product.productName,
      provider: product.providerName,
      role: ROLES[product.role] ?? product.role,
      line: [product.providerName, product.role === 'emergency_fund' ? `${short} buffer` : short]
        .filter((part) => part !== '')
        .join(' · '),
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
      // With no debts given the figure is savings only: not a net position against debts.
      heading:
        plan.situation.debts.length === 0
          ? `Locked or instant access: in all at ${horizon}, no debts given`
          : `Locked or instant access: net position at ${horizon}`,
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

  // The position: towards the goal, the buffer, less what is still owed (saoi-api, build-plan).
  // Optional at runtime: results from before saoi-api carried it have none.
  const held = (result as { position?: BuildPlanResult['position'] }).position
  const goalLabel = plan.goals.find((goal) => goal.kind !== 'emergency_fund')?.label ?? null
  const at = held === undefined ? null : (month(held.at) ?? held.at)
  const position: PlanCardView['position'] =
    held === undefined
      ? null
      : {
          heading: held.owed > 0 ? `Net position at ${at ?? horizon}` : `In all at ${at ?? horizon}`,
          total: eur(Math.round(held.total)),
          parts: [
            {
              label:
                goalLabel === null
                  ? 'Savings'
                  : `Towards ${goalLabel.charAt(0).toLowerCase()}${goalLabel.slice(1)}`,
              value: eur(Math.round(held.towardsGoal)),
            },
            ...(held.buffer > 0 ? [{ label: 'Emergency buffer', value: eur(Math.round(held.buffer)) }] : []),
            ...(held.owed > 0
              ? [
                  {
                    label: held.owedIsCeiling ? 'Still owed (at most)' : 'Still owed',
                    value: `−${eur(Math.round(held.owed))}`,
                  },
                ]
              : []),
          ],
          note: !held.debtsGiven
            ? 'No debts given'
            : held.owedIsCeiling
              ? 'A repayment was not given, so today’s balance is counted as owed: the net figure is the least it can be.'
              : held.owed > 0
                ? null
                : 'Nothing still owed on the debts given',
        }

  // Assumed repayments and alternatives (saoi-api, build-plan): optional at runtime, as results
  // from before saoi-api carried them have neither.
  const extra = result as {
    assumedRepayments?: BuildPlanResult['assumedRepayments']
    alternatives?: BuildPlanResult['alternatives']
  }
  const assumed = (extra.assumedRepayments ?? []).map((item) => item.note)
  const alternatives = (extra.alternatives ?? []).map((alternative) => {
    const sameDate = held !== undefined && alternative.position.at === held.at
    return {
      name: alternative.name,
      changes: alternative.changes.join(', '),
      total: `${eur(Math.round(alternative.position.towardsGoal))} towards the goal at ${month(alternative.position.at) ?? alternative.position.at}`,
      held: `${eur(Math.round(alternative.position.total))} held in all`,
      difference: !sameDate
        ? null
        : alternative.towardsGoalDifferenceEur >= 0
          ? `${eur(Math.round(alternative.towardsGoalDifferenceEur))} more`
          : `${eur(Math.round(-alternative.towardsGoalDifferenceEur))} less`,
    }
  })

  // The save call and completeness (saoi-api, build-plan): optional at runtime, for older results.
  const { saveCall, completeness } = result as {
    saveCall?: BuildPlanResult['saveCall']
    completeness?: BuildPlanResult['completeness']
  }

  // Pathways to a home (saoi-api, build-plan): optional at runtime, for older results.
  const homeResult = (result as { home?: BuildPlanResult['home'] }).home ?? null
  const period =
    homeResult === null
      ? ''
      : homeResult.comparedOver.basis === 'term'
        ? `over ${String(homeResult.comparedOver.years)} years`
        : `over the ${String(homeResult.comparedOver.years)}-year fixed period`
  const home: PlanCardView['home'] =
    homeResult === null
      ? null
      : {
          headline: homeResult.headline,
          assumptions: homeResult.assumptions.join(' '),
          rows: homeResult.pathways.slice(0, 3).map((pathway) => ({
            lender: pathway.lenderName,
            keys:
              pathway.keysOn === null
                ? 'keys not in reach'
                : `keys ${month(pathway.keysOn) ?? pathway.keysOn}`,
            cost:
              pathway.vsCheapestEur <= 0
                ? `lowest cost ${period}`
                : `+${eur(Math.round(pathway.vsCheapestEur))} ${period}`,
            driver: pathway.drivers,
            confirmed: pathway.confirmed,
          })),
        }

  // "Money found: about €X a year after DIRT (parts). How money held is counted." Bold the first.
  const lead = /^(Money found: .*?\)\.)\s+(.+)$/.exec(result.moneyFound.headline)

  return {
    title: plan.title,
    home,
    moneyFound: {
      headline: lead?.[1] ?? result.moneyFound.headline,
      note: lead?.[2] ?? null,
      notCounted: result.moneyFound.notCounted.map(
        (item) =>
          `Not counted: ${item.label}${item.annualEur === null ? '' : ` (${eur(item.annualEur)} a year)`}. ${item.why}`,
      ),
    },
    goals,
    position,
    assumed,
    alternatives,
    products,
    scenarios,
    basis: `Ranked by ${plan.ranking.objective.replaceAll('_', ' ')}: ${plan.ranking.basis}`,
    footer: [
      `Information, not advice: options with their figures, for you to decide. Rates checked ${day(plan.dataCheckedAt)}; figures assume today's rates hold.`,
    ],
    attributions,
    app: 'In the Saoi app the plan opens as a card, Saoirse knows it and can talk it through, and signing in with an email keeps it across your devices.',
    save:
      saveCall === undefined
        ? { label: 'Save to Saoi app', note: '', today: '', coming: null }
        : {
            label: saveCall.label,
            note: saveCall.note,
            today: `Today the app ${saveCall.appToday.join(', ')}.`,
            coming:
              saveCall.ready && saveCall.coming.length > 0 ? `Coming: ${saveCall.coming.join(', ')}.` : null,
          },
    completeness: completeness?.line ?? null,
    plan,
    draftUrl,
  }
}
