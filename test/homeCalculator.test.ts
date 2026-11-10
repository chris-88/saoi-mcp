import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { homeCalculatorModel } from '../src/ui/homeCalculatorModel.js'
import { homeCalculatorHtml } from '../src/ui/homeCalculatorResource.js'
import { recorded } from './helpers.js'

const model = homeCalculatorModel()
const live = recorded.homeCalculator

describe('home calculator card document', () => {
  it('carries a script that parses as plain JavaScript, with the bridge and the model inline', () => {
    const html = homeCalculatorHtml()
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? ''
    expect(script).toMatch(/ui\/initialize/)
    expect(script).toMatch(/ui\/update-model-context/)
    expect(script).toMatch(/tools\/call/)
    expect(script).not.toMatch(/\bimport\b|\bexport\b/)
    expect(() => new Script(script)).not.toThrow()
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).toMatch(/["']month["']/)
  })

  it('names the statement and the three mortgage warnings', () => {
    const html = homeCalculatorHtml()
    expect(html).toMatch(/not regulated by the Central Bank of Ireland and does not give advice/)
    expect(html).toMatch(/you may lose your home/)
    expect(html).toMatch(/monthly repayments may increase/)
    expect(html).toMatch(/your account will go into arrears/)
    expect(html).not.toMatch(/recommend|best option for you|you should/i)
  })
})

describe('home calculator model', () => {
  it('works out the same figures in the card as saoi-api did, from the rules it sent', () => {
    const inputs = model.fromArguments(live.inputs, '2026-11')
    const figures = model.figures(inputs, live.rules, '2026-11')
    expect(figures.maxLoanEur).toBe(live.figures.maxLoanEur)
    expect(figures.loanEur).toBe(live.figures.loanEur)
    expect(figures.depositNeededEur).toBe(live.figures.depositNeededEur)
    expect(figures.neededAtKeysEur).toBe(live.figures.neededAtKeysEur)
    expect(figures.reachedOn).toBe(live.figures.depositReachedOn)
    expect(figures.targetMet).toBe(live.figures.targetDateMet)
  })

  it('caps the loan by joint income and counts Help to Buy for a new build once tax paid is given', () => {
    const base = model.defaults('2026-11')
    const capped = model.figures(
      { ...base, annualGrossIncomeEur: 50_000, secondIncomeEur: 20_000, targetPriceEur: 350_000 },
      live.rules,
      '2026-11',
    )
    expect(capped.maxLoanEur).toBe(280_000)
    expect(capped.depositNeededEur).toBe(70_000)
    const built = model.figures(
      {
        ...base,
        annualGrossIncomeEur: 100_000,
        targetPriceEur: 400_000,
        propertyKind: 'new_build',
        taxPaidLastFourYearsEur: 50_000,
      },
      live.rules,
      '2026-11',
    )
    expect(built.helpToBuyEur).toBe(35_000)
    expect(built.neededAtKeysEur).toBe(12_000)
  })

  it('prefills from the tool arguments and keeps the rest at defaults', () => {
    const inputs = model.fromArguments(
      { depositSavedEur: 40_000, rateType: 'fixed', propertyKind: 'self_build' },
      '2026-11',
    )
    expect(inputs.depositSavedEur).toBe(40_000)
    expect(inputs.rateType).toBe('fixed')
    expect(inputs.propertyKind).toBe('new_build')
    expect(inputs.targetDate).toBe('2028-11')
  })

  it('sorts the options by the metric the customer picks, with every option kept', () => {
    const home = recorded.planHome.home
    if (home === null) throw new Error('recording has no home')
    for (const sort of ['five_year_cost', 'keys_date', 'monthly_repayment'] as const) {
      const rows = model.rows(home, sort)
      expect(rows).toHaveLength(home.pathways.length)
    }
    const monthly = model
      .rows(home, 'monthly_repayment')
      .map((row) => Number(row.monthly.replace(/[€,]/g, '')))
    expect([...monthly].sort((a, b) => a - b)).toEqual(monthly)
  })

  it('tells the model what was entered and not to pick an option', () => {
    const text = model.contextText(model.defaults('2026-11'), 'keys_date', 49)
    expect(text).toMatch(/49 options sorted by keys date/)
    expect(text).toMatch(/do not pick one for the customer/)
  })
})

describe('one step at a time (round 2)', () => {
  it('gives one headline line and a one-line summary of the inputs', () => {
    const inputs = {
      ...model.defaults('2026-11'),
      depositSavedEur: 25_000,
      monthlySavingEur: 1_200,
      annualGrossIncomeEur: 90_000,
      targetPriceEur: 350_000,
    }
    const figures = model.figures(inputs, live.rules, '2026-11')
    expect(model.headline(inputs, figures)).toMatch(
      /^You could borrow up to €360,000 · deposit ready around [A-Z][a-z]{2} \d{4}/,
    )
    expect(model.summary(inputs)).toBe('€25k saved · €1,200/mo · €90k · €350k')
  })

  it('leads each row with the figure it is sorted by, and says when every keys date is the same', () => {
    const home = recorded.planHome.home
    if (home === null) throw new Error('recording has no home')
    expect(model.rows(home, 'monthly_repayment')[0]?.lead).toMatch(/^€[\d,]+\/mo$/)
    expect(model.rows(home, 'five_year_cost')[0]?.second).toMatch(/^€[\d,]+\/mo$/)
    expect(model.rows(home, 'keys_date')[0]?.lead).toMatch(/^[A-Z][a-z]{2} \d{4}$/)
    expect(model.sharedKeys(home)).toMatch(/^[A-Z][a-z]{2} \d{4}$/)
  })

  it('keeps the warnings and the statement in the card, outside any expander', () => {
    const html = homeCalculatorHtml()
    expect(html).toMatch(/ui:\/\/saoi|Saoi/)
    expect(html).toMatch(/See the breakdown/)
    expect(html).toMatch(/More details/)
    expect(html).toMatch(/More filters/)
    expect(html).toMatch(/How we worked this out/)
  })
})

describe('round 3: the headline and the options agree', () => {
  const home = recorded.planHome.home
  if (home === null) throw new Error('recording has no home')
  // The inputs the recording was made with: €25,000 saved, €800 a month, €90,000, €350,000.
  const inputs = {
    ...model.defaults('2026-11'),
    depositSavedEur: 25_000,
    monthlySavingEur: 800,
    annualGrossIncomeEur: 90_000,
    targetPriceEur: 350_000,
    targetDate: '2028-11',
  }
  const figures = model.figures(inputs, live.rules, '2026-11')

  it('never shows a keys month earlier than the deposit-ready month for the same inputs', () => {
    const shown = model.headline(inputs, figures, home.keysOn)
    const ready = /deposit ready around ([A-Z][a-z]{2} \d{4})/.exec(shown)?.[1]
    expect(ready).toBe(model.month(home.keysOn))
    for (const row of model.rows(home, 'keys_date')) {
      const keys = home.pathways.find((option) => option.mortgage.name === row.product)?.keysOn ?? ''
      expect(keys >= (home.keysOn ?? '')).toBe(true)
    }
  })

  it('labels the card’s own estimate as before interest, which is never earlier than the options’ month', () => {
    expect(model.headline(inputs, figures)).toMatch(/\(before interest\)/)
    expect((figures.reachedOn ?? '') >= (home.keysOn ?? '')).toBe(true)
  })

  it('names each product in plain words and keeps the lender’s name for Conditions', () => {
    const boi = model.rows(home, 'five_year_cost').find((row) => row.product === '4 Year Fixed HVM BER C')
    expect(boi?.name).toBe('4-year fixed, BER C, loans €250k+')
  })
})

describe('round 4: routes, the conditional Help to Buy and rent (card v4)', () => {
  const secondHand = recorded.homeCalculatorSecondHand
  const newBuild = recorded.homeCalculatorNewBuild

  it('keeps the card’s figures equal to saoi-api’s for both recorded examples', () => {
    for (const live of [secondHand, newBuild]) {
      const inputs = model.fromArguments(live.inputs, '2026-11')
      const figures = model.figures(inputs, live.rules, '2026-11')
      expect(figures.maxLoanEur).toBe(live.figures.maxLoanEur)
      expect(figures.loanEur).toBe(live.figures.loanEur)
      expect(figures.depositNeededEur).toBe(live.figures.depositNeededEur)
      expect(figures.stampDutyEur).toBe(live.figures.stampDutyEur)
      expect(figures.helpToBuyEur).toBe(live.figures.helpToBuyEur)
      expect(figures.helpToBuyConditional).toBe(live.figures.helpToBuyConditional)
      expect(figures.neededAtKeysEur).toBe(live.figures.neededAtKeysEur)
      expect(figures.reachedOn).toBe(live.figures.depositReachedOn)
      expect(figures.targetMet).toBe(live.figures.targetDateMet)
    }
  })

  it('leaves a conditional Help to Buy out of the headline, even beside the options’ month', () => {
    const inputs = model.fromArguments(newBuild.inputs, '2026-11')
    const figures = model.figures(inputs, newBuild.rules, '2026-11')
    expect(figures.helpToBuyConditional).toBe(true)
    expect(figures.neededAtKeysEur).toBe(47_000)
    // saoi_build_plan counts Help to Buy at its most; the headline must not take that month.
    const shown = model.headline(inputs, figures, '2026-12')
    expect(shown).toMatch(/deposit ready around Apr 2028 \(before interest\)/)
    expect(shown).not.toMatch(/Dec 2026/)
    const counted = model.figures({ ...inputs, taxPaidLastFourYearsEur: 20_000 }, newBuild.rules, '2026-11')
    expect(counted.helpToBuyConditional).toBe(false)
    expect(counted.helpToBuyEur).toBe(20_000)
    expect(counted.neededAtKeysEur).toBe(27_000)
  })

  it('starts folded only when the host gave deposit, monthly saving, income and price', () => {
    expect(model.startsFolded(secondHand.inputs)).toBe(true)
    expect(model.startsFolded({ depositSavedEur: 30_000, targetPriceEur: 400_000 })).toBe(false)
    expect(model.startsFolded(null)).toBe(false)
  })

  it('asks only the facts still missing, rent last', () => {
    expect(model.missingFacts(model.given(secondHand.inputs))).toEqual(['firstTimeBuyer', 'monthlyRentEur'])
    expect(model.missingFacts([])).toEqual(['firstTimeBuyer', 'propertyKind', 'monthlyRentEur'])
  })

  it('sends county and rent to saoi_home_calculator and leaves unanswered facts for it to ask', () => {
    const inputs = {
      ...model.fromArguments(secondHand.inputs, '2026-11'),
      county: 'fingal',
      monthlyRentEur: 1_800,
    }
    const body = model.homeCalculatorBody(inputs, model.given(secondHand.inputs))
    expect(body).toMatchObject({
      depositSavedEur: 30_000,
      secondIncomeEur: 40_000,
      propertyKind: 'second_hand',
      county: 'fingal',
      monthlyRentEur: 1_800,
      currentBank: 'Bank of Ireland',
    })
    expect(body).not.toHaveProperty('firstTimeBuyer')
    expect(model.counties()).toHaveLength(30)
    expect(model.fromArguments({ county: 'atlantis' }, '2026-11').county).toBe('')
  })

  it('shows three routes in saoi-api’s order and keeps the rest behind More routes', () => {
    const { shown, more } = model.splitRoutes(secondHand.routes)
    expect(shown.map((route) => route.line)).toEqual(secondHand.routes.slice(0, 3).map((route) => route.line))
    expect(more).toHaveLength(3)
    expect(secondHand.presentation).toContain('More routes: 3')
  })

  it('matches each missing question to the one control that answers it', () => {
    const missing = new Map(newBuild.routes.map((route) => [route.id, route.missing ?? '']))
    expect(model.controlFor(missing.get('first_home_scheme') ?? '')).toBe('county')
    expect(model.controlFor(missing.get('new_build_help_to_buy') ?? '')).toBe('taxPaid')
    expect(
      model.controlFor('Is anyone buying with you? The income ceiling is €80,000 single, €85,000 joint.'),
    ).toBe('joint')
    expect(model.controlFor('Which part of Galway is the home in? (city or county)')).toBe('county')
    expect(
      model.controlFor('What is the gross income a year, before tax? If buying with someone, theirs too.'),
    ).toBeNull()
  })

  it('sets rent beside the repayments shown, in saoi-api’s wording', () => {
    expect(model.rentLine(1_800, [1_634.2, 1_654.1, 1_634])).toBe(
      'Rent €1,800 a month against a €1,634 to €1,654 repayment',
    )
    expect(model.rentLine(1_800, [1_620])).toBe('Rent €1,800 a month against a €1,620 repayment')
    expect(model.rentLine(null, [1_620])).toBeNull()
  })

  it('never words a route as a pick', () => {
    for (const route of [...secondHand.routes, ...newBuild.routes]) {
      expect(model.statusWord(route.status)).not.toMatch(/best|faster|recommended/i)
      expect(route.line).not.toMatch(/best|faster|recommended/i)
    }
  })
})
