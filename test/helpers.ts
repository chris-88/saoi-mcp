import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type {
  About,
  BuildPlanResult,
  DebtResult,
  FirstHomeResult,
  HomeCalculatorResult,
  MoneyCheckResult,
  MortgageResult,
  ProductDetail,
  ProjectionResult,
  ReviewResult,
  SaoiApi,
  SavePlanResult,
  SearchResult,
} from '../src/saoiClient.js'
import { createHttpServer } from '../src/server.js'

const recording = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./recordings/${name}.json`, import.meta.url), 'utf8'))

/** saoi-api's own answers, recorded live on 2026-11-09 for the design note's worked example. */
export const recorded = {
  search: recording('search') as SearchResult,
  product: recording('product') as ProductDetail,
  review: recording('review') as ReviewResult,
  projection: recording('projection') as ProjectionResult,
  affordability: recording('afford') as MortgageResult,
  switch: recording('switch') as MortgageResult,
  debt: recording('debt') as DebtResult,
  plan: recording('plan') as BuildPlanResult,
  firstHome: recording('first-home') as FirstHomeResult,
  moneyCheck: recording('money-check') as MoneyCheckResult,
  /** The same calls after results gained `presentation` and the 24-hour `saveLink`. */
  planPresented: recording('plan-presented') as BuildPlanResult,
  /** The fourth-test scenario from the branch engine: an assumed repayment and one alternative. */
  planAlternatives: recording('plan-alternatives') as BuildPlanResult,
  /** A first home (live, 2026-11-10, after the comparison change): every option, filtered and sorted. */
  planHome: recording('plan-home') as BuildPlanResult,
  /** The home calculator (live, 2026-11-10), from before it carried routes. */
  homeCalculator: recording('home-calculator') as HomeCalculatorResult,
  /**
   * The home calculator with routes (live, 2026-11-10, saoi 4674fda): €400,000 second-hand, €30,000
   * saved, €1,000 a month, €60,000 and €40,000, keys by 2028-06, Bank of Ireland.
   */
  homeCalculatorSecondHand: recording('home-calculator-second-hand') as HomeCalculatorResult,
  /** The same as a new build, no tax paid given: Help to Buy is conditional. */
  homeCalculatorNewBuild: recording('home-calculator-new-build') as HomeCalculatorResult,
  /** saoi_first_home with routes and rent (live, 2026-11-10): joint, Dublin City, €1,800 rent. */
  firstHomeRoutes: recording('first-home-routes') as FirstHomeResult,
  reviewPresented: recording('review-presented') as ReviewResult,
  firstHomePresented: recording('first-home-presented') as FirstHomeResult,
  ranking: recording('ranking') as About,
  saved: recording('saved') as SavePlanResult,
}

export const mockSaoi = (): { [K in keyof SaoiApi]: ReturnType<typeof vi.fn<SaoiApi[K]>> } => ({
  search: vi.fn<SaoiApi['search']>(() => Promise.resolve(recorded.search)),
  product: vi.fn<SaoiApi['product']>(() => Promise.resolve(recorded.product)),
  about: vi.fn<SaoiApi['about']>(() => Promise.resolve(recorded.ranking)),
  review: vi.fn<SaoiApi['review']>(() => Promise.resolve(recorded.reviewPresented)),
  projection: vi.fn<SaoiApi['projection']>(() => Promise.resolve(recorded.projection)),
  mortgage: vi.fn<SaoiApi['mortgage']>(() => Promise.resolve(recorded.affordability)),
  debt: vi.fn<SaoiApi['debt']>(() => Promise.resolve(recorded.debt)),
  buildPlan: vi.fn<SaoiApi['buildPlan']>(() => Promise.resolve(recorded.planPresented)),
  firstHome: vi.fn<SaoiApi['firstHome']>(() => Promise.resolve(recorded.firstHomePresented)),
  moneyCheck: vi.fn<SaoiApi['moneyCheck']>(() => Promise.resolve(recorded.moneyCheck)),
  homeCalculator: vi.fn<SaoiApi['homeCalculator']>(() => Promise.resolve(recorded.homeCalculator)),
  savePlan: vi.fn<SaoiApi['savePlan']>(() => Promise.resolve(recorded.saved)),
})

export interface Running {
  readonly url: string
  readonly server: Server
  close(): Promise<void>
}

export async function run(saoi: SaoiApi): Promise<Running> {
  const server = createHttpServer(
    {
      allowedHosts: ['mcp.saoi.ie', 'localhost', '127.0.0.1'],
      allowedOrigins: ['claude.ai', 'localhost'],
      keepAliveMs: 25_000,
    },
    saoi,
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

/** A legacy (2025-era) stateless JSON-RPC POST. */
export function legacyPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

/** A 2026-07-28 per-request POST with the envelope and mirrored headers. */
export function modernPost(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': method,
      ...(name === undefined ? {} : { 'Mcp-Name': name }),
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

/** Reads a JSON-RPC response whether the server answered application/json or text/event-stream. */
export async function rpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const data = text.startsWith('{')
    ? text
    : (text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6) ?? '{}')
  return JSON.parse(data) as Record<string, unknown>
}
