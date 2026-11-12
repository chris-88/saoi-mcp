import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeCalculatorResult } from '../src/saoiClient.js'
import { saoiPrompt, SERVER_INSTRUCTIONS } from '../src/tools.js'
import { homeCalculatorModel } from '../src/ui/homeCalculatorModel.js'
import { mockSaoi, modernPost, recorded, rpc, run, type Running } from './helpers.js'

/**
 * The core-information gate, end to end through the tool handler (spec "The first thought"):
 * the card and its figures only once funds saved, monthly saving, income and a price or a date
 * are in; before that, one or two questions and nothing else. saoi-api is stubbed with the gate
 * it returns for each case; the recorded figures stay in the stub so the test proves the server
 * holds them back, not that the stub left them out.
 */

/** saoi's `ADVICE_WORDS` (`_shared/market/disclosures.ts`), the test every customer-facing string meets. */
const ADVICE_WORDS =
  /\b(recommend(ed|s|ation)?|your path|the best option for you|right for you|you should|make this plan happen|fastest combination|Your home: keys)\b/i
/** The instruction verbs Saoi never puts to the customer. */
const INSTRUCTIONS = /\b(you should|clear|set up|switch|open|ask)\b/i

type Missing = HomeCalculatorResult['gate']['missing'][number]
const Q: Record<Missing['key'], Omit<Missing, 'askNow'>> = {
  depositSavedEur: {
    key: 'depositSavedEur',
    question: 'How much have you saved towards the home so far?',
    moves: 'It sets the month the money for the keys is ready.',
  },
  monthlySavingEur: {
    key: 'monthlySavingEur',
    question: 'How much can you put aside each month?',
    moves: 'It sets how fast the deposit grows.',
  },
  annualGrossIncomeEur: {
    key: 'annualGrossIncomeEur',
    question: 'What is your gross income a year, before tax?',
    moves: 'It sets how much the limits allow.',
  },
  secondIncomeEur: {
    key: 'secondIncomeEur',
    question: 'What does the person buying with you earn a year, before tax?',
    moves: 'It sets how much the limits allow for the two of you.',
  },
  targetPriceEur: {
    key: 'targetPriceEur',
    question: 'What price do you have in mind, or when would you like the keys?',
    moves: 'It sets the deposit and the cash needed at the keys.',
  },
  targetDate: {
    key: 'targetDate',
    question: 'When would you like the keys?',
    moves: 'It sets the date the saving is measured against.',
  },
}

const closed = (...keys: Missing['key'][]): HomeCalculatorResult => ({
  ...recorded.homeCalculatorSecondHand,
  gate: { ready: false, missing: keys.map((key, index) => ({ ...Q[key], askNow: index < 2 })) },
  presentation: keys.slice(0, 2).map((key) => `${Q[key].question} ${Q[key].moves}`),
})
const open: HomeCalculatorResult = {
  ...recorded.homeCalculatorSecondHand,
  gate: { ready: true, missing: [] },
}

type Rpc = { result?: Record<string, unknown> }
let saoi: ReturnType<typeof mockSaoi>
let srv: Running
beforeEach(async () => {
  saoi = mockSaoi()
  srv = await run(saoi)
})
afterEach(async () => {
  await srv.close()
})

const call = async (args: Record<string, unknown>): Promise<Rpc> =>
  await rpc(
    await modernPost(
      srv.url,
      'tools/call',
      { name: 'saoi_home_calculator', arguments: args },
      'saoi_home_calculator',
    ),
  )
const text = (body: Rpc): string => (body.result?.['content'] as { text: string }[])[0]?.text ?? ''
/** The card renders from structuredContent: present when it carries the figures and rules. */
const card = (body: Rpc): boolean => {
  const content = body.result?.['structuredContent'] as Record<string, unknown> | undefined
  return content?.['rules'] !== undefined && content['figures'] !== undefined
}
const present = (said: string): string[] =>
  (said.split('\nDetail:\n')[0] ?? '')
    .split('\n')
    .slice(1)
    .filter((line) => line.startsWith('- '))

/** No figure the customer could be quoted: no euro, no rate, no digit at all. */
const expectNoFigures = (said: string): void => {
  expect(said).not.toContain('€')
  expect(said).not.toMatch(/\d+(\.\d+)?\s?%/)
  expect(said).not.toMatch(/\d/)
  expect(said).not.toMatch(/Assumed|First-time buyer, as nothing|Warning:|app\.saoi\.ie|Save this/i)
}

describe('golden check: the core-information gate in saoi_home_calculator', () => {
  it('(a) nothing said: no card, only the two questions that move the figures most', async () => {
    saoi.homeCalculator.mockResolvedValueOnce(
      closed('depositSavedEur', 'annualGrossIncomeEur', 'monthlySavingEur', 'targetPriceEur'),
    )
    const body = await call({})
    expect(saoi.homeCalculator).toHaveBeenCalledWith({}, undefined)
    expect(card(body)).toBe(false)
    const said = text(body)
    expect(present(said)).toEqual([
      `- ${Q.depositSavedEur.question} ${Q.depositSavedEur.moves}`,
      `- ${Q.annualGrossIncomeEur.question} ${Q.annualGrossIncomeEur.moves}`,
    ])
    expect(said).toMatch(/Still to ask after these, one or two at a time: How much can you put aside/)
    expect(said).toMatch(/pass everything the customer has said so far, these answers included/)
    expectNoFigures(said)
    expect(body.result?.['structuredContent']).toEqual({
      gate: closed('depositSavedEur', 'annualGrossIncomeEur', 'monthlySavingEur', 'targetPriceEur').gate,
      statement: recorded.homeCalculatorSecondHand.statement,
    })
  })

  it('(b) funds, monthly saving, income and price: the card, as today', async () => {
    saoi.homeCalculator.mockResolvedValueOnce(open)
    const args = {
      depositSavedEur: 30000,
      monthlySavingEur: 1000,
      annualGrossIncomeEur: 100000,
      targetPriceEur: 400000,
    }
    const body = await call(args)
    expect(saoi.homeCalculator).toHaveBeenCalledWith(args, undefined)
    expect(card(body)).toBe(true)
    expect(body.result?.['structuredContent']).toEqual(open)
    expect(text(body)).toMatch(/Needed at the keys: €47,000/)
  })

  it('(c) funds, monthly saving and a date only: no card, the income question alone', async () => {
    saoi.homeCalculator.mockResolvedValueOnce(closed('annualGrossIncomeEur'))
    const body = await call({ depositSavedEur: 30000, monthlySavingEur: 1000, targetDate: '2028-06' })
    expect(card(body)).toBe(false)
    const said = text(body)
    expect(present(said)).toEqual([`- ${Q.annualGrossIncomeEur.question} ${Q.annualGrossIncomeEur.moves}`])
    expect(said).not.toMatch(/Still to ask after these/)
    expectNoFigures(said)
  })

  it('buying together with no second income: asks for it, and passes buyingTogether through', async () => {
    saoi.homeCalculator.mockResolvedValueOnce(closed('secondIncomeEur'))
    const args = {
      depositSavedEur: 30000,
      monthlySavingEur: 1000,
      annualGrossIncomeEur: 60000,
      buyingTogether: true,
      targetPriceEur: 400000,
    }
    const body = await call(args)
    expect(saoi.homeCalculator).toHaveBeenCalledWith(args, undefined)
    expect(card(body)).toBe(false)
    expect(present(text(body))).toEqual([`- ${Q.secondIncomeEur.question} ${Q.secondIncomeEur.moves}`])
  })

  it('a result from before saoi-api carried the gate still shows the card', async () => {
    const body = await call({ targetPriceEur: 400000 })
    expect(card(body)).toBe(true)
  })

  it('logs the card as not shown while the gate is closed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      saoi.homeCalculator.mockResolvedValueOnce(closed('annualGrossIncomeEur'))
      await call({})
      saoi.homeCalculator.mockResolvedValueOnce(open)
      await call({})
      const lines = log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('tool_call'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(lines.map((line) => line['ui'])).toEqual([false, true])
    } finally {
      log.mockRestore()
    }
  })

  it('no advice words and no instruction verbs in what the gate puts to the customer', async () => {
    saoi.homeCalculator.mockResolvedValueOnce(
      closed('depositSavedEur', 'annualGrossIncomeEur', 'monthlySavingEur', 'targetPriceEur'),
    )
    for (const line of present(text(await call({})))) {
      expect(line).not.toMatch(ADVICE_WORDS)
      expect(line).not.toMatch(INSTRUCTIONS)
    }
  })
})

describe('the card is the end of the conversation in the host', () => {
  it('says so in the instructions, the tool description, the prompt and the card’s context', async () => {
    const listed = (await rpc(await modernPost(srv.url, 'tools/list'))) as Rpc
    const tool = (listed.result?.['tools'] as { name: string; description: string }[]).find(
      (t) => t.name === 'saoi_home_calculator',
    )
    const context = homeCalculatorModel().contextText(
      homeCalculatorModel().defaults('2026-11'),
      'keys_date',
      3,
    )
    for (const [where, words] of [
      ['instructions', SERVER_INSTRUCTIONS],
      ['description', tool?.description ?? ''],
      ['prompt', saoiPrompt(undefined)],
      ['context', context],
    ] as const) {
      const flat = words.replace(/\s+/g, ' ')
      expect(flat, where).toMatch(/"Compare all product options and supports"/)
      expect(flat, where).toMatch(/again only when (the customer|I) changes? a figure/)
    }
    const description = tool?.description ?? ''
    expect(description).toMatch(/pass everything they have said so far in the conversation/)
    expect(description).toMatch(/the call after they answer a question passes the gate/)
    expect(description).toMatch(/not by another tool call or a narrative/)
    expect(SERVER_INSTRUCTIONS.replace(/\s+/g, ' ')).toMatch(
      /"tell me more", "what about the other supports", "which mortgage"/,
    )
  })
})
