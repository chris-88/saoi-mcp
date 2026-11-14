import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askedOf,
  clientInfoOf,
  hostOf,
  httpSender,
  incomeBand,
  priceBand,
  rentBand,
  requestFacts,
  savedPlanIdOf,
  sessionKeyOf,
  telemetryFor,
  type McpCallEvent,
} from '../src/telemetry.js'
import { legacyPost, mockSaoi, modernPost, recorded, rpc, run, type Running } from './helpers.js'

describe('hostOf', () => {
  it.each([
    ['Claude-User', null, 'claude'],
    ['python-httpx/0.27 (Anthropic)', null, 'claude'],
    [null, 'claude-ai', 'claude'],
    ['openai-mcp/1.0.0', null, 'chatgpt'],
    ['Mozilla/5.0 ChatGPT-User/1.0', null, 'chatgpt'],
    ['Google-Gemini', null, 'gemini'],
    [null, 'gemini-cli', 'gemini'],
    ['Cursor/1.2 (claude)', null, 'cursor'],
    ['node', null, 'other'],
    [null, null, 'other'],
  ])('%s / %s is %s', (ua, client, host) => {
    expect(hostOf(ua, client)).toBe(host)
  })
})

describe('the session key', () => {
  const day = new Date('2026-11-14T10:00:00Z')

  it('is a salted sha256 that never contains the address, the same all day', () => {
    const key = sessionKeyOf('salt', '203.0.113.9', 'Claude-User', day)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('203.0.113.9')
    expect(sessionKeyOf('salt', '203.0.113.9', 'Claude-User', new Date('2026-11-14T23:59:00Z'))).toBe(key)
    expect(sessionKeyOf('salt', '203.0.113.9', 'Claude-User', new Date('2026-11-15T00:00:00Z'))).not.toBe(key)
    expect(sessionKeyOf('other', '203.0.113.9', 'Claude-User', day)).not.toBe(key)
  })

  it('is null with neither an address nor a user agent', () => {
    expect(sessionKeyOf('salt', undefined, null, day)).toBeNull()
  })

  it('comes with the user agent, cut to 200, from the request', () => {
    const headers = new Headers({ 'user-agent': 'x'.repeat(300) })
    const facts = requestFacts(headers, '203.0.113.9', 'salt', day)
    expect(facts.userAgent).toBe('x'.repeat(200))
    expect(facts.sessionKey).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('bands', () => {
  it('match saoi’s run-bands', () => {
    expect([39_999, 40_000, 99_999, 150_000].map(incomeBand)).toEqual(['<40k', '40-60k', '80-100k', '150k+'])
    expect([249_999, 250_000, 449_999, 600_000].map(priceBand)).toEqual([
      '<250k',
      '250-350k',
      '350-450k',
      '600k+',
    ])
    expect([999, 1_000, 2_499, 2_500].map(rentBand)).toEqual(['<1000', '1000-1500', '2000-2500', '2500+'])
  })
})

describe('askedOf', () => {
  it('keeps the search filters verbatim and never the amounts', () => {
    const asked = askedOf('saoi_search_products', {
      category: 'deposit',
      amount: 25_000,
      monthlyAmount: 500,
      horizonMonths: 24,
      providers: ['boi', 'aib'],
      propertyValue: 420_000,
    })
    expect(asked).toEqual({
      category: 'deposit',
      horizonMonths: 24,
      providers: ['boi', 'aib'],
      price: '350-450k',
    })
  })

  it('bands the home calculator’s figures, both incomes together', () => {
    expect(
      askedOf('saoi_home_calculator', {
        depositSavedEur: 30_000,
        annualGrossIncomeEur: 60_000,
        secondIncomeEur: 40_000,
        targetPriceEur: 400_000,
        monthlyRentEur: 1_800,
        buyingTogether: true,
        propertyKind: 'second_hand',
      }),
    ).toEqual({
      income: '100-150k',
      price: '350-450k',
      rent: '1500-2000',
      goalKinds: ['house_deposit'],
      propertyKind: 'second_hand',
      buyingTogether: true,
    })
  })

  it('takes a plan call’s goal kinds and banded situation', () => {
    expect(
      askedOf('saoi_build_plan', {
        situation: {
          income: { annualGross: 72_000 },
          outgoings: { rentMonthly: 1_400 },
          savings: [{ balance: 9 }],
        },
        goals: [{ kind: 'house_deposit' }, { kind: 'emergency_fund' }],
        homePrice: 380_000,
      }),
    ).toEqual({
      income: '60-80k',
      price: '350-450k',
      rent: '1000-1500',
      goalKinds: ['house_deposit', 'emergency_fund'],
    })
  })

  it('keeps a product id, and nothing for a tool it does not know', () => {
    expect(askedOf('saoi_product', { id: 'boi:savings.supersaver' })).toEqual({
      id: 'boi:savings.supersaver',
    })
    expect(askedOf('saoi_debt', { debts: [{ balance: 9_000 }] })).toEqual({})
  })
})

describe('clientInfoOf and savedPlanIdOf', () => {
  it('reads the clientInfo from the per-request envelope, null without one', () => {
    const ctx = {
      mcpReq: { envelope: { 'io.modelcontextprotocol/clientInfo': { name: 'claude-ai', version: '1' } } },
    }
    expect(clientInfoOf(ctx)).toEqual({ name: 'claude-ai', version: '1' })
    expect(clientInfoOf({ mcpReq: {} })).toBeNull()
    expect(clientInfoOf(undefined)).toBeNull()
  })

  it('finds the plan behind a draft, a money check’s plan or a save', () => {
    expect(savedPlanIdOf({ saveLink: { url: 'x', planId: 'p1' } })).toBe('p1')
    expect(savedPlanIdOf({ plan: { saveLink: { url: 'x', planId: 'p2' } } })).toBe('p2')
    expect(savedPlanIdOf({ claimUrl: 'x', planId: 'p3' })).toBe('p3')
    expect(savedPlanIdOf({ saveLink: null })).toBeNull()
  })
})

describe('httpSender', () => {
  it('posts with the key, never throws, and logs a run of failures once', async () => {
    const log = vi.fn()
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new Error('down')))
    const send = httpSender({ apiUrl: 'http://api', key: 'k'.repeat(16), fetch: fetchMock, log })
    const event = { kind: 'tool', name: 'saoi_debt' } as unknown as McpCallEvent
    send(event)
    send(event)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api/api/telemetry/mcp')
    expect((init?.headers as Record<string, string>)['X-Internal-Key']).toBe('k'.repeat(16))
  })

  it('a failed record never touches the call: telemetryFor swallows a throwing sender', () => {
    const calls = telemetryFor(
      () => {
        throw new Error('boom')
      },
      { userAgent: null, sessionKey: null },
    )
    expect(() => {
      calls.record({ kind: 'tool', name: 'x', outcome: 'ok', ms: 1 })
    }).not.toThrow()
  })
})

describe('the record, through the server', () => {
  let saoi: ReturnType<typeof mockSaoi>
  let srv: Running
  let events: McpCallEvent[]

  beforeEach(async () => {
    saoi = mockSaoi()
    events = []
    srv = await run(saoi, undefined, {
      send: (event) => {
        events.push(event)
      },
      salt: 'test-salt',
    })
  })
  afterEach(async () => {
    await srv.close()
  })

  const call = async (name: string, args: Record<string, unknown>, headers: Record<string, string>) =>
    rpc(await modernPost(srv.url, 'tools/call', { name, arguments: args }, name, headers))

  it('records a gated home calculator call with the missing figures, the host and no card', async () => {
    saoi.homeCalculator.mockResolvedValueOnce({
      ...recorded.homeCalculatorSecondHand,
      gate: {
        ready: false,
        missing: [
          { key: 'annualGrossIncomeEur', question: 'q', moves: 'm', askNow: true },
          { key: 'monthlySavingEur', question: 'q', moves: 'm', askNow: true },
        ],
      },
    })
    await call(
      'saoi_home_calculator',
      { depositSavedEur: 30_000, targetPriceEur: 400_000 },
      { 'User-Agent': 'Claude-User', 'CF-Connecting-IP': '203.0.113.9' },
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'tool',
      name: 'saoi_home_calculator',
      host: 'claude',
      userAgent: 'Claude-User',
      clientName: 'test',
      clientVersion: '0',
      outcome: 'gated',
      card: false,
      gateMissing: ['annualGrossIncomeEur', 'monthlySavingEur'],
      asked: { price: '350-450k', goalKinds: ['house_deposit'] },
      savedPlanId: null,
    })
    expect(events[0]?.sessionKey).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(events[0])).not.toContain('203.0.113.9')
    expect(JSON.stringify(events[0])).not.toContain('30000')
  })

  it('records a plan with its card and the held plan, and saves a plan as the host', async () => {
    saoi.buildPlan.mockResolvedValueOnce({
      ...recorded.planPresented,
      saveLink: { url: 'https://app.saoi.ie/?plan=x', expiresAt: 'y', planId: 'plan-1' },
    })
    await call(
      'saoi_build_plan',
      { situation: {}, goals: [{ id: 'g', kind: 'house_deposit', label: 'House', targetAmount: 40_000 }] },
      { 'User-Agent': 'openai-mcp/1.0.0' },
    )
    expect(events[0]).toMatchObject({ host: 'chatgpt', outcome: 'ok', card: true, savedPlanId: 'plan-1' })

    await call('saoi_save_plan', { plan: recorded.plan.plan }, { 'User-Agent': 'openai-mcp/1.0.0' })
    expect(saoi.savePlan).toHaveBeenCalledWith({ plan: recorded.plan.plan }, undefined, 'chatgpt')
  })

  it('records an error as an error', async () => {
    saoi.debt.mockRejectedValueOnce(new Error('boom'))
    await call(
      'saoi_debt',
      { debts: [{ id: 'car', label: 'Car', kind: 'car_finance', balance: 9000, ratePct: 9 }] },
      {},
    )
    expect(events[0]).toMatchObject({ name: 'saoi_debt', outcome: 'error', host: 'other', card: false })
  })

  it('records a resource read and a prompt get, legacy path without clientInfo', async () => {
    await rpc(
      await legacyPost(srv.url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'saoi://about/earnings' },
      }),
    )
    await rpc(
      await legacyPost(srv.url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/get',
        params: { name: 'money-check-up', arguments: { focus: 'saving for a house' } },
      }),
    )
    expect(events.map((event) => [event.kind, event.name, event.asked, event.clientName])).toEqual([
      ['resource', 'saoi://about/earnings', { topic: 'earnings' }, null],
      ['prompt', 'money-check-up', { focus: 'saving for a house' }, null],
    ])
  })
})
