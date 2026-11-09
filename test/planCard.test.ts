import { Script } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planCardModel } from '../src/ui/planCardModel.js'
import { MCP_APP_MIME_TYPE, PLAN_CARD_URI, planCardHtml } from '../src/ui/planCardResource.js'
import { mockSaoi, modernPost, recorded, rpc, run, type Running } from './helpers.js'

type Result = Record<string, unknown>
const result = async (res: Response): Promise<Result> => ((await rpc(res))['result'] ?? {}) as Result

let srv: Running
beforeEach(async () => {
  srv = await run(mockSaoi())
})
afterEach(async () => {
  await srv.close()
})

describe('plan card over the protocol', () => {
  it('saoi_money_check and saoi_build_plan name the card; no other tool does', async () => {
    const tools = (await result(await modernPost(srv.url, 'tools/list')))['tools'] as {
      name: string
      _meta?: Record<string, unknown>
    }[]
    const withUi = tools.filter((tool) => tool._meta?.['ui'] !== undefined)
    expect(withUi.map((tool) => tool.name).sort()).toEqual(['saoi_build_plan', 'saoi_money_check'])
    expect(withUi[0]?._meta).toEqual({ ui: { resourceUri: PLAN_CARD_URI }, 'ui/resourceUri': PLAN_CARD_URI })
  })

  it('lists and serves the card as an MCP App resource with no external origins but Claude’s fonts', async () => {
    const list = (await result(await modernPost(srv.url, 'resources/list')))['resources'] as {
      uri: string
      mimeType: string
    }[]
    expect(list.find((r) => r.uri === PLAN_CARD_URI)?.mimeType).toBe(MCP_APP_MIME_TYPE)

    const read = await result(
      await modernPost(srv.url, 'resources/read', { uri: PLAN_CARD_URI }, PLAN_CARD_URI),
    )
    const [content] = read['contents'] as { uri: string; mimeType: string; text: string; _meta: unknown }[]
    expect(content?.uri).toBe(PLAN_CARD_URI)
    expect(content?.mimeType).toBe('text/html;profile=mcp-app')
    expect(content?._meta).toEqual({
      ui: {
        prefersBorder: false,
        csp: { connectDomains: [], resourceDomains: ['https://assets.claude.ai'] },
      },
    })
    expect(content?.text).toMatch(/^<!DOCTYPE html>/)
    expect(content?.text).not.toMatch(/<script[^>]+src=/)
    expect(content?.text).not.toMatch(/<link[^>]+href=/)
  })

  it('returns the plan as structured content for the card, and the text for everyone else', async () => {
    const called = await result(
      await modernPost(
        srv.url,
        'tools/call',
        {
          name: 'saoi_build_plan',
          arguments: {
            situation: {},
            goals: [{ id: 'deposit', kind: 'house_deposit', label: 'House deposit' }],
          },
        },
        'saoi_build_plan',
      ),
    )
    expect(called['structuredContent']).toEqual(recorded.planPresented)
    expect((called['content'] as { text: string }[])[0]?.text).toMatch(/House deposit by November 2028/)
  })
})

describe('plan card document', () => {
  it('carries a script that parses as plain JavaScript (no types, no imports)', () => {
    const html = planCardHtml()
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? ''
    expect(script).toMatch(/ui\/initialize/)
    expect(script).not.toMatch(/\bimport\b|\bexport\b/)
    expect(() => new Script(script)).not.toThrow()
  })
})

describe('plan card model', () => {
  const view = planCardModel(recorded.plan)

  it('leads with the money found and what is not counted', () => {
    expect(view.moneyFound.headline).toBe(recorded.plan.moneyFound.headline)
    expect(view.moneyFound.notCounted[0]).toMatch(
      /^Not counted: €16,000 in MoCo EasySaver \(€225 a year\)\. /,
    )
  })

  it('shows each product with its figures, flags and deposit guarantee', () => {
    const moco = view.products[0]
    expect(moco).toMatchObject({
      name: 'MoCo EasySaver',
      provider: 'MoCo',
      rate: '2.1% AER',
      amounts: '€16,000 placed',
      projected: '€453.41 interest after DIRT over 24 months; balance €16,453.41',
      guarantee: 'Deposit guarantee: Austrian deposit guarantee (Einlagensicherung AUSTRIA), up to €100,000',
      guaranteeKnown: true,
    })
    expect(moco?.checks.some((check) => /deposit guarantee/i.test(check))).toBe(false)
    expect(moco?.checks.some((check) => /^Check eligibility with MoCo/.test(check))).toBe(true)
    expect(view.products[1]?.amounts).toBe('€586 a month')
  })

  it('gives the net position per scenario, marking the one in the plan', () => {
    expect(view.scenarios.map((s) => s.heading)).toEqual([
      'Car loan: net position at Nov 2028',
      'Locked or instant access: net position at Nov 2028',
    ])
    expect(view.scenarios[0]?.rows).toEqual([
      { label: 'Car loan cleared from the lump sum', net: '€42,918.94', note: 'goal May 2028', inPlan: true },
      {
        label: 'Car loan kept',
        net: '€41,927.22',
        note: '€3,385.33 still owed · goal Nov 2027',
        inPlan: false,
      },
    ])
    expect(view.scenarios[1]?.rows[1]).toMatchObject({ net: '€42,953.74', inPlan: false })
  })

  it('says beside the button only what the app does today', () => {
    expect(view.app).toMatch(/opens as a card, Saoirse knows it/)
    expect(view.app).not.toMatch(/alert|remind/i)
  })

  it('carries the CCPC attribution once, the ranking basis, and no instruction', () => {
    expect(view.attributions).toEqual(['Source: Competition and Consumer Protection Commission, www.ccpc.ie'])
    expect(view.basis).toMatch(/^Ranked by highest net return: /)
    expect(JSON.stringify({ ...view, plan: null })).not.toMatch(/you should|pay off/i)
  })

  it('uses a draft link into app.saoi.ie when the result has one, and no other', () => {
    expect(view.draftUrl).toBeNull()
    const withDraft = {
      ...recorded.plan,
      saveLink: { url: 'https://app.saoi.ie/#/plan/abc', expiresAt: '2026-11-10T15:00:00Z' },
    }
    expect(planCardModel(withDraft).draftUrl).toBe('https://app.saoi.ie/#/plan/abc')
    const elsewhere = {
      ...recorded.plan,
      saveLink: { url: 'https://evil.example/#/plan/abc', expiresAt: '2026-11-10T15:00:00Z' },
    }
    expect(planCardModel(elsewhere).draftUrl).toBeNull()
    const unheld = { ...recorded.plan, saveLink: null }
    expect(planCardModel(unheld).draftUrl).toBeNull()
  })
})
