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

  it('caps the loan by joint income and adds Help to Buy for a new build', () => {
    const base = model.defaults('2026-11')
    const capped = model.figures(
      { ...base, annualGrossIncomeEur: 50_000, secondIncomeEur: 20_000, targetPriceEur: 350_000 },
      live.rules,
      '2026-11',
    )
    expect(capped.maxLoanEur).toBe(280_000)
    expect(capped.depositNeededEur).toBe(70_000)
    const built = model.figures(
      { ...base, annualGrossIncomeEur: 100_000, targetPriceEur: 400_000, propertyKind: 'new_build' },
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
