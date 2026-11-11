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

  it('names the statement and the three mortgage warnings, and never words a pick', () => {
    const html = homeCalculatorHtml()
    expect(html).toMatch(/not regulated by the Central Bank of Ireland and does not give advice/)
    expect(html).toMatch(/you may lose your home/)
    expect(html).toMatch(/monthly repayments may increase/)
    expect(html).toMatch(/your account will go into arrears/)
    expect(html).toMatch(/Estimates only; rates and offers are not confirmed/)
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

  it('tells the model what was entered and not to pick an option', () => {
    const text = model.contextText(model.defaults('2026-11'), 'keys_date', 49)
    expect(text).toMatch(/49 options sorted by keys date/)
    expect(text).toMatch(/do not pick one for the customer/)
  })
})

describe('one step at a time (round 2)', () => {
  it('gives one headline line, and the folded card’s month, fact line and progress', () => {
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
    expect(model.readyHeadline(inputs, figures)).toEqual({
      text: model.longMonth(figures.reachedOn ?? ''),
      note: 'Before interest',
    })
    expect(model.longMonth('2028-04')).toBe('April 2028')
    expect(model.factLine(inputs, figures)).toBe(
      `€350,000 second-hand, ${model.eur(figures.neededAtKeysEur)} needed at the keys`,
    )
    const progress = model.progress(inputs, figures)
    expect(progress.toGoEur).toBe(figures.neededAtKeysEur - 25_000)
    expect(progress.pct).toBeLessThan(100)
    const covered = model.progress({ ...inputs, depositSavedEur: 500_000 }, figures)
    expect(covered).toMatchObject({ covered: true, pct: 100, toGoEur: 0 })
    const never = model.figures({ ...inputs, monthlySavingEur: 0 }, live.rules, '2026-11')
    expect(model.readyHeadline(inputs, never)).toEqual({ text: 'Not reached at this pace', note: null })
  })

  it('builds the footer from what was assumed, the line under Open in Saoi and the rent line', () => {
    expect(model.assumedLine(['First-time buyer.', 'second-hand'])).toBe(
      'Assumed: First-time buyer, second-hand. Estimates only; rates and offers are not confirmed.',
    )
    expect(model.assumedLine([])).toBe('Estimates only; rates and offers are not confirmed.')
    expect(model.openLine(6)).toBe('Compare every option and all 6 routes with Saoirse')
    expect(model.openLine(0)).toBe('Compare every option with Saoirse')
    expect(model.rentNow(2_500)).toBe('Rent now €2,500 a month')
    expect(model.rentNow(null)).toBeNull()
  })

  it('keeps the breakdown and the extra inputs behind their expanders', () => {
    const html = homeCalculatorHtml()
    expect(html).toMatch(/ui:\/\/saoi|Saoi/)
    expect(html).toMatch(/See the breakdown/)
    expect(html).toMatch(/More details/)
    expect(html).toMatch(/More filters/)
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
    expect(model.readyHeadline(inputs, figures, home.keysOn).text).toBe(model.longMonth(home.keysOn ?? ''))
    for (const option of home.pathways) expect((option.keysOn ?? '') >= (home.keysOn ?? '')).toBe(true)
  })

  it('labels the card’s own estimate as before interest, which is never earlier than the options’ month', () => {
    expect(model.headline(inputs, figures)).toMatch(/\(before interest\)/)
    expect((figures.reachedOn ?? '') >= (home.keysOn ?? '')).toBe(true)
  })
})

describe('round 4: routes, the conditional Help to Buy and rent', () => {
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

  it('shows the two routes after the customer’s own kind, in saoi-api’s order', () => {
    const others = model.otherRoutes(secondHand.routes)
    expect(others.map((route) => route.id)).toEqual(secondHand.routes.slice(1, 3).map((route) => route.id))
    expect(others.map((route) => route.id)).not.toContain('second_hand')
    const htb = newBuild.routes[0]
    if (htb === undefined) throw new Error('recording has no routes')
    expect(model.routeDetail(htb)).toBe('keys Nov 2026 if your tax paid covers €35,000')
    expect(`${htb.name}: ${model.routeDetail(htb)}`).toBe(htb.line)
    expect(model.routeDetail({ ...htb, line: 'Given as is' })).toBe('Given as is')
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

  it('never words a route as a pick', () => {
    for (const route of [...secondHand.routes, ...newBuild.routes]) {
      expect(model.statusWord(route.status)).not.toMatch(/best|faster|recommended/i)
      expect(route.line).not.toMatch(/best|faster|recommended/i)
    }
  })
})
