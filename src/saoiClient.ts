/**
 * Thin HTTP client for saoi-api's public comparison routes (`/api/market/*`, `/api/calc/*`) and
 * `POST /api/plans`. No credentials: the routes are public and rate-limited per address, so the
 * caller's address is forwarded as `X-Forwarded-For` and the limit is per person, not one bucket
 * for everybody this server serves.
 *
 * Request bodies are passed through as the tool received them (the tool's input schema is the
 * route's, generated from the OpenAPI document) and saoi-api validates them. Response types are
 * generated from the same document (`npm run gen`).
 */

import type { components } from './generated/saoi-api.js'

type Schemas = components['schemas']

export type SearchResult = Schemas['MarketSearchResult']
export type ProductDetail = Schemas['MarketProductDetail']
export type About = Schemas['MarketAbout']
export type ReviewResult = Schemas['ReviewSituationResult']
export type ProjectionResult = Schemas['SavingsProjectionResult']
export type MortgageResult = Schemas['MortgageCalculationResult']
export type DebtResult = Schemas['DebtCalculationResult']
export type BuildPlanResult = Schemas['BuildPlanResult']
export type SavePlanResult = Schemas['SavePlanResponse']

/** A refusal from saoi-api, with what it says is wrong. Safe to show: saoi-api writes it for callers. */
export class SaoiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: readonly string[] = [],
    readonly retryAfter: string | null = null,
  ) {
    super(message)
  }
}

export type Body = Record<string, unknown>

/** What the tools need from saoi-api. Tests mock this. `ip` is the end user's address, if known. */
export interface SaoiApi {
  search(body: Body, ip?: string): Promise<SearchResult>
  product(id: string, ip?: string): Promise<ProductDetail>
  about(topic: 'ranking' | 'earnings', ip?: string): Promise<About>
  review(body: Body, ip?: string): Promise<ReviewResult>
  projection(body: Body, ip?: string): Promise<ProjectionResult>
  mortgage(body: Body, ip?: string): Promise<MortgageResult>
  debt(body: Body, ip?: string): Promise<DebtResult>
  buildPlan(body: Body, ip?: string): Promise<BuildPlanResult>
  savePlan(body: Body, ip?: string): Promise<SavePlanResult>
}

export interface SaoiClientOptions {
  /** The saoi-api service, e.g. http://saoi-api:3000 (no trailing /api). */
  readonly apiUrl: string
  readonly timeoutMs: number
  readonly fetch?: typeof fetch
}

interface ErrorBody {
  readonly error?: { readonly message?: string; readonly details?: readonly string[] }
}

export class SaoiClient implements SaoiApi {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: SaoiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
  }

  search(body: Body, ip?: string) {
    return this.call<SearchResult>('POST', '/api/market/search', body, ip)
  }
  product(id: string, ip?: string) {
    return this.call<ProductDetail>('GET', `/api/market/products/${encodeURIComponent(id)}`, undefined, ip)
  }
  about(topic: 'ranking' | 'earnings', ip?: string) {
    return this.call<About>('GET', `/api/market/about/${topic}`, undefined, ip)
  }
  review(body: Body, ip?: string) {
    return this.call<ReviewResult>('POST', '/api/calc/review-situation', body, ip)
  }
  projection(body: Body, ip?: string) {
    return this.call<ProjectionResult>('POST', '/api/calc/savings-projection', body, ip)
  }
  mortgage(body: Body, ip?: string) {
    return this.call<MortgageResult>('POST', '/api/calc/mortgage', body, ip)
  }
  debt(body: Body, ip?: string) {
    return this.call<DebtResult>('POST', '/api/calc/debt', body, ip)
  }
  buildPlan(body: Body, ip?: string) {
    return this.call<BuildPlanResult>('POST', '/api/calc/build-plan', body, ip)
  }
  savePlan(body: Body, ip?: string) {
    return this.call<SavePlanResult>('POST', '/api/plans', { ...body, client: 'mcp' }, ip)
  }

  private async call<T>(
    method: 'GET' | 'POST',
    route: string,
    body: Body | undefined,
    ip?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (ip !== undefined) headers['X-Forwarded-For'] = ip
    const res = await this.fetchImpl(`${this.options.apiUrl}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
    const text = await res.text()
    if (!res.ok) {
      let parsed: ErrorBody = {}
      try {
        parsed = JSON.parse(text) as ErrorBody
      } catch {
        // Not JSON (a proxy page): the status says enough.
      }
      throw new SaoiError(
        parsed.error?.message ?? `Saoi answered ${String(res.status)}.`,
        res.status,
        parsed.error?.details ?? [],
        res.headers.get('retry-after'),
      )
    }
    return JSON.parse(text) as T
  }
}
