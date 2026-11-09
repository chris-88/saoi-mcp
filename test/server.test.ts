import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaoiError } from '../src/saoiClient.js'
import { legacyPost, mockSaoi, modernPost, recorded, rpc, run, type Running } from './helpers.js'

type Rpc = { result?: Record<string, unknown>; error?: { code: number } }
const asRpc = async (res: Response): Promise<Rpc> => await rpc(res)

let saoi: ReturnType<typeof mockSaoi>
let srv: Running
beforeEach(async () => {
  saoi = mockSaoi()
  srv = await run(saoi)
})
afterEach(async () => {
  await srv.close()
})

describe('http surface', () => {
  it('GET /health returns ok and version', async () => {
    const res = await fetch(`${srv.url}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: '0.6.0' })
  })

  it('rejects a disallowed Origin with 403', async () => {
    const res = await legacyPost(
      srv.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Origin: 'https://evil.example' },
    )
    expect(res.status).toBe(403)
  })

  it('accepts an allowed Origin and a request with no Origin', async () => {
    const res = await legacyPost(
      srv.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Origin: 'https://claude.ai' },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://claude.ai')
  })

  it('rejects an unknown Host with 403', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${srv.url}/health`, { headers: { Host: 'evil.example' } }, (res) => {
        resolve(res.statusCode ?? 0)
        res.resume()
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('answers GET /mcp with 405 (stateless) and unknown paths with 404', async () => {
    expect((await fetch(`${srv.url}/mcp`, { headers: { Accept: 'text/event-stream' } })).status).toBe(405)
    expect((await fetch(`${srv.url}/nope`)).status).toBe(404)
  })

  it('sets X-Accel-Buffering: no on /mcp', async () => {
    const res = await legacyPost(srv.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })
})

describe('protocol eras', () => {
  it('serves the legacy initialize path', async () => {
    const res = await legacyPost(srv.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    const body = await asRpc(res)
    expect(body.result?.['serverInfo']).toMatchObject({ name: 'saoi' })
    const instructions = String(body.result?.['instructions'])
    expect(instructions).toMatch(/Present options with their figures; the customer decides/)
    expect(instructions).toMatch(/Present to the customer/)
    expect(instructions).toMatch(/Call saoi_money_check OR saoi_build_plan, once, per reply; never both/)
    expect(instructions).toMatch(/pass up to three `alternatives` in the same call/)
    expect(instructions).not.toMatch(/call the tool again with the/)
    expect(instructions).toMatch(/Call saoi_money_check as soon as the customer talks about their own money/)
    expect(instructions).toMatch(/searching the web/)
    expect(instructions).toMatch(/24 hours behind a single-use link/)
    expect(instructions).toMatch(/coming, not built/)
    expect(instructions).not.toMatch(/partner/)
    expect(instructions).toMatch(/Nothing else is stored/)
  })

  it('serves server/discover on the 2026-07-28 path', async () => {
    const body = await asRpc(await modernPost(srv.url, 'server/discover'))
    expect(body.result?.['supportedVersions']).toContain('2026-07-28')
  })

  it('rejects a mismatched Mcp-Method header', async () => {
    const res = await modernPost(srv.url, 'tools/list', {}, undefined, { 'Mcp-Method': 'tools/call' })
    expect(res.status).toBe(400)
  })
})

describe('tools/list', () => {
  const expectedNames = [
    'saoi_build_plan',
    'saoi_debt',
    'saoi_first_home',
    'saoi_money_check',
    'saoi_mortgage',
    'saoi_product',
    'saoi_review_situation',
    'saoi_save_plan',
    'saoi_savings_projection',
    'saoi_search_products',
  ]

  it.each([
    ['modern', () => modernPost(srv.url, 'tools/list')],
    ['legacy', () => legacyPost(srv.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })],
  ])('lists the ten saoi tools with object schemas from the OpenAPI document (%s)', async (_era, call) => {
    const body = await asRpc(await call())
    const tools = body.result?.['tools'] as {
      name: string
      description: string
      inputSchema: { type: string; properties: Record<string, { description?: string }>; oneOf?: unknown }
      annotations?: { readOnlyHint?: boolean }
    }[]
    expect(tools.map((t) => t.name).sort()).toEqual(expectedNames)
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.oneOf, `${tool.name} has no top-level oneOf`).toBeUndefined()
      expect(tool.description.toLowerCase()).not.toMatch(/you should/)
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(
        !['saoi_save_plan', 'saoi_build_plan', 'saoi_money_check'].includes(tool.name),
      )
    }
    const mortgage = tools.find((t) => t.name === 'saoi_mortgage')
    expect(Object.keys(mortgage?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['mode', 'annualGrossIncome', 'balance']),
    )
    expect(tools.find((t) => t.name === 'saoi_search_products')?.description).toMatch(
      /Information, not advice/,
    )
    expect(tools.find((t) => t.name === 'saoi_save_plan')?.inputSchema.properties).not.toHaveProperty(
      'client',
    )
  })
})

describe('resources and prompts', () => {
  it('lists and reads how Saoi ranks and earns', async () => {
    const list = await asRpc(await modernPost(srv.url, 'resources/list'))
    const uris = (list.result?.['resources'] as { uri: string }[]).map((r) => r.uri).sort()
    expect(uris).toEqual(['saoi://about/earnings', 'saoi://about/ranking', 'ui://saoi/plan-card-v4.html'])
    const read = await asRpc(
      await modernPost(srv.url, 'resources/read', { uri: 'saoi://about/ranking' }, 'saoi://about/ranking'),
    )
    const contents = read.result?.['contents'] as { text: string; mimeType: string }[]
    expect(contents[0]?.mimeType).toBe('text/markdown')
    expect(contents[0]?.text).toMatch(/How Saoi ranks/)
    expect(saoi.about).toHaveBeenCalledWith('ranking', undefined)
  })

  it('offers the money check-up prompt, which never asks for advice language', async () => {
    const list = await asRpc(await modernPost(srv.url, 'prompts/list'))
    expect((list.result?.['prompts'] as { name: string }[]).map((p) => p.name)).toEqual(['money-check-up'])
    const got = await asRpc(
      await modernPost(
        srv.url,
        'prompts/get',
        { name: 'money-check-up', arguments: { focus: 'a house' } },
        'money-check-up',
      ),
    )
    const text = (got.result?.['messages'] as { content: { text: string } }[])[0]?.content.text ?? ''
    expect(text).toMatch(/saoi_money_check[\s\S]*saoi_build_plan[\s\S]*Save this plan to the Saoi app/)
    expect(text).toMatch(/never as instructions, advice or "you should"/)
    expect(text).toMatch(/One plan call per reply/)
    expect(text).toMatch(/a house/)
  })
})

const DEBT = { id: 'car-loan', label: 'Car loan', kind: 'car_finance', balance: 9000, ratePct: 9 }
const GOAL = {
  id: 'deposit',
  kind: 'house_deposit',
  label: 'House deposit',
  targetAmount: 35000,
  targetDate: '2028-11',
}

describe('tools/call', () => {
  const call = async (
    name: string,
    args: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<Rpc> => asRpc(await modernPost(srv.url, 'tools/call', { name, arguments: args }, name, headers))
  const text = (body: Rpc): string => (body.result?.['content'] as { text: string }[])[0]?.text ?? ''

  it('saoi_search_products passes the body through and renders the ranking, flags and attribution', async () => {
    const body = await call('saoi_search_products', { category: 'deposit', amount: 25000, horizonMonths: 24 })
    expect(saoi.search).toHaveBeenCalledWith(
      { category: 'deposit', amount: 25000, horizonMonths: 24 },
      undefined,
    )
    expect(text(body)).toMatch(/Ranked by highest net return/)
    expect(text(body)).toMatch(/Check eligibility/)
    expect(text(body)).toMatch(/Competition and Consumer Protection Commission/)
    expect(body.result?.['structuredContent']).toMatchObject({ ranking: { objective: 'highest_net_return' } })
  })

  it('logs one line per tool call: tool, duration, outcome, card; nothing about the customer', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await call(
        'saoi_money_check',
        { situation: { monthlySaving: 800 } },
        { 'CF-Connecting-IP': '203.0.113.9' },
      )
      saoi.search.mockRejectedValueOnce(new SaoiError('The request is not valid.', 400, []))
      await call('saoi_search_products', { category: 'deposit', amount: 25000 })
      const lines = log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('tool_call'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatchObject({
        event: 'tool_call',
        tool: 'saoi_money_check',
        outcome: 'ok',
        ui: true,
      })
      expect(lines[1]).toMatchObject({ tool: 'saoi_search_products', outcome: 'error', ui: false })
      expect(typeof lines[0]?.['ms']).toBe('number')
      expect(Object.keys(lines[0] ?? {}).sort()).toEqual(['event', 'ms', 'outcome', 'tool', 'ui'])
      const text = log.mock.calls.flat().join(' ')
      expect(text).not.toMatch(/203\.0\.113\.9|25000|800|€/)
    } finally {
      log.mockRestore()
    }
  })

  it('forwards the caller’s address from CF-Connecting-IP', async () => {
    await call('saoi_review_situation', { situation: {} }, { 'CF-Connecting-IP': '203.0.113.9' })
    expect(saoi.review).toHaveBeenCalledWith({ situation: {} }, '203.0.113.9')
  })

  it('renders every calculation', async () => {
    expect(text(await call('saoi_review_situation', { situation: {} }))).toMatch(/€25,000 in Current account/)
    expect(text(await call('saoi_product', { id: 'boi:savings.supersaver' }))).toMatch(/Rate history/)
    expect(text(await call('saoi_savings_projection', { horizonMonths: 24, lumpSum: 16000 }))).toMatch(
      /is reached in/,
    )
    expect(text(await call('saoi_mortgage', { mode: 'affordability' }))).toMatch(/Central Bank limits/)
    saoi.mortgage.mockResolvedValueOnce(recorded.switch)
    expect(text(await call('saoi_mortgage', { mode: 'switch' }))).toMatch(/break-even/)
    expect(text(await call('saoi_debt', { debts: [DEBT] }))).toMatch(/Payoff order/)
    const plan = text(await call('saoi_build_plan', { situation: {}, goals: [GOAL] }))
    expect(plan).toMatch(/House deposit by November 2028/)
    expect(plan).toMatch(/^Present to the customer:\n- Money found: /)
    expect(plan).toMatch(/Save this plan to the Saoi app: https:\/\/app\.saoi\.ie\/#\/plan\//)
    expect(plan).toMatch(/€[\d,]+ in all at November 2028: /)
    expect(plan).toMatch(/Locked or accessible: /)
    expect(plan).toMatch(/What if:\n- /)
    expect(plan).toMatch(/Deposit guarantee: /)
    expect(plan).toMatch(/Help to Buy: /)
    expect(plan).not.toMatch(/pay off first/)
    expect(text(await call('saoi_review_situation', { situation: {} }))).toMatch(
      /^Present to the customer:\n- (Money found|No money found)/,
    )
    const home = text(await call('saoi_first_home', { annualGrossIncome: 62000, deposit: 35000 }))
    expect(home).toMatch(/^Present to the customer:\n- Help to Buy: /)
    expect(home).toMatch(/revenue\.ie/)
    expect(home).toMatch(/centralbank\.ie/)
    const entry = text(await call('saoi_money_check', {}))
    expect(entry).toMatch(/^Present to the customer:\n/)
    expect(entry).toMatch(/Save this plan to the Saoi app/)
    for (const [name, args] of [
      ['saoi_search_products', { category: 'deposit' }],
      ['saoi_debt', { debts: [DEBT] }],
      ['saoi_mortgage', { mode: 'affordability' }],
    ] as const) {
      expect(text(await call(name, args))).toMatch(/^Present to the customer:\n/)
    }
  })

  it('saoi_save_plan returns a 24-hour link', async () => {
    const body = await call('saoi_save_plan', { plan: recorded.plan.plan })
    expect(saoi.savePlan).toHaveBeenCalledWith({ plan: recorded.plan.plan }, undefined)
    expect(text(body)).toMatch(/app\.saoi\.ie\/#\/plan\//)
    expect(text(body)).toMatch(/held for 24 hours so it can be opened, then deleted unless opened/)
  })

  it('turns a saoi-api refusal into an isError result with its details', async () => {
    saoi.search.mockRejectedValueOnce(
      new SaoiError('The request is not valid.', 400, ['category: Invalid option']),
    )
    const body = await call('saoi_search_products', { category: 'deposit' })
    expect(body.result?.['isError']).toBe(true)
    expect(text(body)).toMatch(/category: Invalid option/)
  })

  it('says when the address is being limited', async () => {
    saoi.search.mockRejectedValueOnce(new SaoiError('Too many', 429, [], '30'))
    expect(text(await call('saoi_search_products', { category: 'deposit' }))).toMatch(
      /Try again in 30 seconds/,
    )
  })

  it('rejects input that fails the generated schema without calling saoi-api', async () => {
    const body = await call('saoi_search_products', { category: 'pension' })
    expect(saoi.search).not.toHaveBeenCalled()
    expect(body.error !== undefined || body.result?.['isError'] === true).toBe(true)
  })
})
