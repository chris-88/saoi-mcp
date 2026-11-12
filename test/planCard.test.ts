import { Script } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planCardModel } from '../src/ui/planCardModel.js'
import { HOME_CALCULATOR_URI } from '../src/ui/homeCalculatorResource.js'
import { claudeUiDomain, MCP_APP_MIME_TYPE, PLAN_CARD_URI, planCardHtml } from '../src/ui/planCardResource.js'
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
  it('saoi_money_check and saoi_build_plan name the plan card, saoi_home_calculator its own', async () => {
    const tools = (await result(await modernPost(srv.url, 'tools/list')))['tools'] as {
      name: string
      _meta?: Record<string, unknown>
    }[]
    const withUi = tools.filter((tool) => tool._meta?.['ui'] !== undefined)
    expect(withUi.map((tool) => tool.name).sort()).toEqual([
      'saoi_build_plan',
      'saoi_home_calculator',
      'saoi_money_check',
    ])
    expect(withUi.find((tool) => tool.name === 'saoi_build_plan')?._meta).toEqual({
      ui: { resourceUri: PLAN_CARD_URI },
      'ui/resourceUri': PLAN_CARD_URI,
    })
    expect(withUi.find((tool) => tool.name === 'saoi_home_calculator')?._meta).toEqual({
      ui: { resourceUri: HOME_CALCULATOR_URI },
      'ui/resourceUri': HOME_CALCULATOR_URI,
    })
  })

  it('tells the model how long a saved link is held, as saoi keeps it', () => {
    const html = planCardHtml()
    expect(PLAN_CARD_URI).toBe('ui://saoi/plan-card-v11.html')
    expect(html).not.toMatch(/seven days/)
    expect(html).toMatch(
      /held for 24 hours and deleted then if unopened; once opened, the plan is kept with the Saoi app conversation it opens into/,
    )
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
        domain: '9235ca3f8bcb93b4fb0ef0094165a0d9.claudemcpcontent.com',
      },
    })
    expect(content?.text).toMatch(/^<!DOCTYPE html>/)
    expect(content?.text).not.toMatch(/<script[^>]+src=/)
    expect(content?.text).not.toMatch(/<link[^>]+href=/)
  })

  it('derives Claude’s ui.domain from the exact connector URL, as Claude’s guide computes it', () => {
    // The guide's own worked example.
    expect(claudeUiDomain('https://example.com/mcp')).toBe(
      'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com',
    )
    expect(claudeUiDomain('https://mcp.saoi.ie/mcp')).toBe(
      '9235ca3f8bcb93b4fb0ef0094165a0d9.claudemcpcontent.com',
    )
    // A trailing slash is a different URL, so a different origin.
    expect(claudeUiDomain('https://mcp.saoi.ie/mcp/')).not.toBe(claudeUiDomain('https://mcp.saoi.ie/mcp'))
  })

  it('sets the same ui.domain on both cards, in the listing and the read', async () => {
    const domain = '9235ca3f8bcb93b4fb0ef0094165a0d9.claudemcpcontent.com'
    const list = (await result(await modernPost(srv.url, 'resources/list')))['resources'] as {
      uri: string
      _meta?: { ui?: { domain?: string } }
    }[]
    for (const uri of [PLAN_CARD_URI, HOME_CALCULATOR_URI]) {
      expect(list.find((r) => r.uri === uri)?._meta?.ui?.domain, uri).toBe(domain)
      const read = await result(await modernPost(srv.url, 'resources/read', { uri }, uri))
      const [content] = read['contents'] as { _meta?: { ui?: { domain?: string } } }[]
      expect(content?._meta?.ui?.domain, uri).toBe(domain)
    }
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

describe('plan card model: the position and the compact view (after the fourth Claude test)', () => {
  const presented = recorded.planPresented

  it('names what the position includes', () => {
    const view = planCardModel(presented)
    expect(view.position?.heading).toBe('In all at Nov 2028')
    expect(view.position?.total).toBe('€42,850')
    expect(view.position?.parts[0]).toEqual({ label: 'Towards house deposit', value: '€42,850' })
    expect(view.position?.note).toBe('Nothing still owed on the debts given')
  })

  it('shows the buffer and what is still owed as parts, and says when no debts were given', () => {
    const position = {
      at: '2028-11',
      total: 35_000,
      towardsGoal: 33_000,
      buffer: 5_142,
      owed: 3_142,
      owedIsCeiling: false,
      debtsGiven: true,
      line: 'x',
    }
    const kept = planCardModel({ ...presented, position })
    expect(kept.position?.heading).toBe('Net position at Nov 2028')
    expect(kept.position?.parts.map((part) => part.label)).toEqual([
      'Towards house deposit',
      'Emergency buffer',
      'Still owed',
    ])
    expect(kept.position?.parts[2]?.value).toBe('−€3,142')
    const none = planCardModel({
      ...presented,
      position: { ...position, owed: 0, debtsGiven: false },
      plan: { ...presented.plan, situation: { ...presented.plan.situation, debts: [] } },
      debtScenarios: [],
    })
    expect(none.position?.heading).toBe('In all at Nov 2028')
    expect(none.position?.note).toBe('No debts given')
    expect(JSON.stringify(none.scenarios)).not.toMatch(/net position/)
  })

  it('gives one short line per product: provider and amount', () => {
    const view = planCardModel(presented)
    expect(view.products[0]?.line).toBe('MoCo · €16,000')
    expect(view.products[1]?.line).toMatch(/^AIB · €[\d,]+ a month$/)
  })

  it('has no position for a result from before saoi-api carried it', () => {
    expect(planCardModel(recorded.plan).position).toBeNull()
  })
})

describe('plan card model: assumed repayments and alternatives (after test 5)', () => {
  const view = planCardModel(recorded.planAlternatives)

  it('shows the "Assumed:" repayment line', () => {
    expect(view.assumed).toEqual([recorded.planAlternatives.assumedRepayments[0]?.note])
    expect(view.assumed[0]).toMatch(/^Assumed: the car loan’s €9,000 repaid evenly over 24 months/)
  })

  it('gives one compact row per alternative, with its total and the difference', () => {
    expect(view.alternatives).toHaveLength(1)
    const row = view.alternatives[0]
    expect(row?.name).toBe('Keep €6,000 aside, keep the loan')
    expect(row?.changes).toBe('the car loan kept, a €6,000 emergency buffer')
    expect(row?.total).toMatch(/^€[\d,]+ towards the goal at Nov 2028$/)
    expect(row?.held).toMatch(/^€[\d,]+ held in all$/)
    expect(row?.difference).toMatch(/^€[\d,]+ (more|less)$/)
  })

  it('has neither for a result from before saoi-api carried them', () => {
    const older = planCardModel(recorded.plan)
    expect(older.assumed).toEqual([])
    expect(older.alternatives).toEqual([])
  })
})

describe('plan card model: every option for a home', () => {
  const view = planCardModel(recorded.planHome)

  it('carries every option with the figures each sort uses, and no pick', () => {
    expect(view.home?.headline).toMatch(
      /^At these figures, the deposit and buying costs are in place around /,
    )
    expect(view.home?.rows).toHaveLength(recorded.planHome.home?.pathways.length ?? -1)
    expect(view.home?.rows.length).toBeGreaterThan(3)
    expect(view.home?.rows[0]?.cost).toMatch(/^€[\d,]+ \/ 5 yrs$/)
    expect(view.home?.rows[0]?.keys).toMatch(/^keys [A-Z][a-z]{2} \d{4}$/)
    expect(view.home?.rows[0]?.kind).toMatch(/^(\d+-year fixed|variable)$/)
    expect(view.home?.sortBy).toBe('five_year_cost')
    expect(view.home?.warnings).toHaveLength(3)
    expect(view.home?.assumptions).toMatch(/^Showing first-time-buyer rates/)
    expect(view.runnersUp.length).toBeGreaterThan(0)
    expect(view.footer.join(' ')).toMatch(/not regulated by the Central Bank of Ireland/)
    const words = JSON.stringify({ ...view, plan: null })
    expect(words).not.toMatch(/cheapest|Your home: keys|your path|recommend|make this plan happen/i)
  })

  it('has none for a plan whose goal is not a home', () => {
    expect(planCardModel(recorded.plan).home).toBeNull()
  })
})

describe('plan card model: the save call grows with the plan', () => {
  it('keeps the button, labels it by completeness, and shows what is coming only as coming', () => {
    const view = planCardModel(recorded.planHome)
    expect(view.save.label).toBe(recorded.planHome.saveCall.label)
    expect(view.completeness).toMatch(/^Plan based on \d of \d answers\.$/)
    expect(view.save.today).toMatch(/^Today the app /)
    expect(view.save.today).not.toMatch(/partner|reminder|checklist|document/)
  })

  it('falls back to the plain button for older results', () => {
    const older = planCardModel(recorded.plan)
    expect(older.save.label).toBe('Save this comparison')
    expect(older.completeness).toBeNull()
  })
})
