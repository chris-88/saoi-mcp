/**
 * The AI usage record (design `2026-11-14-saoi-ai-usage-analytics-design`): after every tool
 * call, prompt get and resource read, one event to saoi-api's `POST /api/telemetry/mcp`, which
 * keeps it as an `mcp_calls` row. Which assistant called (`host`), which tool, how it went, and
 * what was asked: free-text fields verbatim, figures only as bands. Never a name, an address or
 * an account: `sessionKey` is a salted hash of address, user agent and UTC day, and the address
 * itself never leaves this server.
 *
 * Fire and forget: the post starts after the result is built, has a short timeout, and a failure
 * is logged once and never reaches the host's call.
 */

import { createHash } from 'node:crypto'
import * as z from 'zod/v4'

export const MCP_HOSTS = ['claude', 'chatgpt', 'gemini', 'cursor', 'other'] as const
export type McpHost = (typeof MCP_HOSTS)[number]
export type CallKind = 'tool' | 'prompt' | 'resource'
export type CallOutcome = 'ok' | 'error' | 'gated'
export type Asked = Record<string, string | number | boolean | null | string[]>

/** The body of `POST /api/telemetry/mcp` (saoi `_shared/contracts/telemetry.ts`). */
export interface McpCallEvent {
  readonly kind: CallKind
  readonly name: string
  readonly host: McpHost
  readonly userAgent: string | null
  readonly clientName: string | null
  readonly clientVersion: string | null
  readonly sessionKey: string | null
  readonly outcome: CallOutcome
  readonly ms: number
  readonly card: boolean
  readonly gateMissing: readonly string[]
  readonly asked: Asked
  readonly savedPlanId: string | null
}

/** The raw user agent is cut to this length, as the table keeps it. */
const USER_AGENT_MAX = 200

/**
 * Which assistant called, from the user agent and the MCP clientInfo name. The map grows: the
 * console lists the user agents that land in `other`.
 */
export function hostOf(userAgent: string | null | undefined, clientName: string | null | undefined): McpHost {
  const seen = `${userAgent ?? ''} ${clientName ?? ''}`.toLowerCase()
  if (seen.includes('cursor')) return 'cursor'
  if (/claude|anthropic/.test(seen)) return 'claude'
  if (/openai|chatgpt/.test(seen)) return 'chatgpt'
  if (/gemini|google/.test(seen)) return 'gemini'
  return 'other'
}

/**
 * Groups a conversation loosely without keeping an address: sha256 of the salt, the address, the
 * user agent and the UTC day. Null with neither an address nor a user agent.
 */
export function sessionKeyOf(
  salt: string,
  ip: string | undefined,
  userAgent: string | null,
  now: Date = new Date(),
): string | null {
  if (ip === undefined && userAgent === null) return null
  return createHash('sha256')
    .update(`${salt}|${ip ?? ''}|${userAgent ?? ''}|${now.toISOString().slice(0, 10)}`)
    .digest('hex')
}

// The bands are saoi's (`_shared/domain/market/run-bands.ts`), copied: this repo shares no code
// with saoi. Each band includes its lower bound.

/** Gross income a year, both applicants together. */
export function incomeBand(eur: number): string {
  if (eur < 40_000) return '<40k'
  if (eur < 60_000) return '40-60k'
  if (eur < 80_000) return '60-80k'
  if (eur < 100_000) return '80-100k'
  if (eur < 150_000) return '100-150k'
  return '150k+'
}

/** A home's price. */
export function priceBand(eur: number): string {
  if (eur < 250_000) return '<250k'
  if (eur < 350_000) return '250-350k'
  if (eur < 450_000) return '350-450k'
  if (eur < 600_000) return '450-600k'
  return '600k+'
}

/** Rent a month. */
export function rentBand(eur: number): string {
  if (eur < 1_000) return '<1000'
  if (eur < 1_500) return '1000-1500'
  if (eur < 2_000) return '1500-2000'
  if (eur < 2_500) return '2000-2500'
  return '2500+'
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const str = (value: unknown, max = 200): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)
const rec = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** Drops the keys with nothing in them. */
const compact = (entries: Record<string, string | number | boolean | string[] | undefined>): Asked =>
  Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, string | number | boolean | string[]] =>
        entry[1] !== undefined && !(Array.isArray(entry[1]) && entry[1].length === 0),
    ),
  )

const sum = (...values: (number | undefined)[]): number | undefined => {
  const given = values.filter((value): value is number => value !== undefined)
  return given.length === 0 ? undefined : given.reduce((a, b) => a + b, 0)
}

const band = (eur: number | undefined, of: (eur: number) => string): string | undefined =>
  eur === undefined ? undefined : of(eur)

/** The search filters kept verbatim: what was asked for, none of them the customer's money. */
const SEARCH_WORDS = [
  'category',
  'access',
  'objective',
  'purpose',
  'buyerType',
  'ber',
  'horizonMonths',
  'termYears',
  'termMonths',
  'maxNoticeDays',
] as const

/** What a plan call's situation says, banded: income, rent, the goals' kinds, the home. */
function planAsked(args: Record<string, unknown>): Asked {
  const situation = rec(args['situation'])
  const goals = Array.isArray(args['goals']) ? args['goals'] : []
  return compact({
    income: band(num(rec(situation['income'])['annualGross']), incomeBand),
    price: band(num(args['homePrice']), priceBand),
    rent: band(num(rec(situation['outgoings'])['rentMonthly']) ?? num(args['monthlyRentEur']), rentBand),
    goalKinds: goals.flatMap((goal) => {
      const kind = str(rec(goal)['kind'], 40)
      return kind === undefined ? [] : [kind]
    }),
    propertyKind: str(args['propertyKind'], 40),
    buyingTogether: bool(args['buyingTogether']),
  })
}

/**
 * What a tool was asked: free text verbatim (the search filters, a product id), figures as bands
 * (income, price, rent), the goals' kinds, the kind of home and buying together. Never a raw
 * figure.
 */
export function askedOf(tool: string, input: unknown): Asked {
  const args = rec(input)
  switch (tool) {
    case 'saoi_search_products': {
      const words = Object.fromEntries(SEARCH_WORDS.map((key) => [key, str(args[key]) ?? num(args[key])]))
      const providers = Array.isArray(args['providers'])
        ? args['providers'].flatMap((provider) => {
            const name = str(provider, 100)
            return name === undefined ? [] : [name]
          })
        : []
      return compact({
        ...words,
        providers: providers.slice(0, 20),
        price: band(num(args['propertyValue']), priceBand),
      })
    }
    case 'saoi_product':
      return compact({ id: str(args['id']) })
    case 'saoi_home_calculator':
      return compact({
        income: band(sum(num(args['annualGrossIncomeEur']), num(args['secondIncomeEur'])), incomeBand),
        price: band(num(args['targetPriceEur']), priceBand),
        rent: band(num(args['monthlyRentEur']), rentBand),
        goalKinds: ['house_deposit'],
        propertyKind: str(args['propertyKind'], 40),
        buyingTogether: bool(args['buyingTogether']),
      })
    case 'saoi_first_home':
      return compact({
        income: band(num(args['annualGrossIncome']), incomeBand),
        price: band(num(args['propertyPrice']), priceBand),
        rent: band(num(args['monthlyRentEur']), rentBand),
        goalKinds: ['house_deposit'],
        propertyKind: str(args['propertyKind'], 40),
        buyingTogether: bool(args['jointApplication']),
      })
    case 'saoi_mortgage':
      return compact({
        mode: str(args['mode'], 40),
        buyer: str(args['buyer'], 40),
        income: band(num(args['annualGrossIncome']), incomeBand),
        price: band(num(args['propertyValue']), priceBand),
      })
    case 'saoi_money_check':
    case 'saoi_build_plan':
    case 'saoi_review_situation':
      return planAsked(args)
    default:
      return {}
  }
}

const clientInfoSchema = z.object({ name: z.string().max(100), version: z.string().max(50) })

/**
 * The MCP clientInfo, where the SDK exposes it: the 2026-07-28 per-request envelope on the
 * handler's context. On the stateless legacy path `initialize` was another request, so it is null.
 */
export function clientInfoOf(ctx: unknown): { name: string; version: string } | null {
  const envelope = rec(rec(rec(ctx)['mcpReq'])['envelope'])
  const parsed = clientInfoSchema.safeParse(envelope['io.modelcontextprotocol/clientInfo'])
  return parsed.success ? parsed.data : null
}

const savedPlanSchema = z.union([
  z.object({ saveLink: z.object({ planId: z.string() }) }),
  z.object({ plan: z.object({ saveLink: z.object({ planId: z.string() }) }) }),
  z.object({ planId: z.string() }),
])

/** The saved plan behind a result's save link: build-plan and money-check drafts, or a save. */
export function savedPlanIdOf(structured: unknown): string | null {
  const parsed = savedPlanSchema.safeParse(structured)
  if (!parsed.success) return null
  const value = parsed.data
  if ('saveLink' in value) return value.saveLink.planId
  if ('plan' in value) return value.plan.saveLink.planId
  return value.planId
}

/** What one call adds to the request's context. */
export interface CallRecord {
  readonly kind: CallKind
  readonly name: string
  readonly outcome: CallOutcome
  readonly ms: number
  readonly card?: boolean
  readonly gateMissing?: readonly string[]
  readonly asked?: Asked
  readonly savedPlanId?: string | null
  /** The handler's context, for the clientInfo in the envelope. */
  readonly ctx?: unknown
}

/** Records one call. Never throws and never waits. */
export type Recorder = (call: CallRecord) => void

/** Sends one event. Never throws and never waits. */
export type Sender = (event: McpCallEvent) => void

export interface SenderOptions {
  /** The saoi-api service, e.g. http://saoi-api:3000. */
  readonly apiUrl: string
  /** saoi-api's `INTERNAL_JOB_KEY`, sent as `X-Internal-Key`. */
  readonly key: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
}

/**
 * Posts each event to saoi-api. A failure is logged the first time only, so a saoi-api outage
 * does not fill the log; a success re-arms it.
 */
export function httpSender(options: SenderOptions): Sender {
  const fetchImpl = options.fetch ?? fetch
  const log =
    options.log ??
    ((line: string) => {
      console.error(line)
    })
  let failing = false
  const failed = (reason: string): void => {
    if (failing) return
    failing = true
    log(JSON.stringify({ event: 'telemetry_failed', reason }))
  }
  return (event) => {
    void Promise.resolve()
      .then(() =>
        fetchImpl(`${options.apiUrl}/api/telemetry/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Key': options.key },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
        }),
      )
      .then((res) => {
        if (res.ok) failing = false
        else failed(`status ${String(res.status)}`)
      })
      .catch((error: unknown) => {
        failed(error instanceof Error ? error.name : 'unknown')
      })
  }
}

/** The request this server instance serves: what every call it records shares. */
export interface RequestFacts {
  readonly userAgent: string | null
  readonly sessionKey: string | null
}

/** One request's record keeping: each call's event, and which assistant a call came from. */
export interface CallTelemetry {
  readonly record: Recorder
  /** The host for a call, from the request's user agent and the call's clientInfo. */
  readonly hostOf: (ctx: unknown) => McpHost
}

export const NO_TELEMETRY: CallTelemetry = { record: () => undefined, hostOf: () => 'other' }

/** Record keeping for one HTTP request: the request's facts, the call's own, the host from both. */
export function telemetryFor(send: Sender, request: RequestFacts): CallTelemetry {
  const host = (ctx: unknown): McpHost => hostOf(request.userAgent, clientInfoOf(ctx)?.name)
  return {
    hostOf: host,
    record: (call) => {
      try {
        const client = clientInfoOf(call.ctx)
        send({
          kind: call.kind,
          name: call.name,
          host: host(call.ctx),
          userAgent: request.userAgent,
          clientName: client?.name ?? null,
          clientVersion: client?.version ?? null,
          sessionKey: request.sessionKey,
          outcome: call.outcome,
          ms: Math.max(0, Math.round(call.ms)),
          card: call.card ?? false,
          gateMissing: call.gateMissing ?? [],
          asked: call.asked ?? {},
          savedPlanId: call.savedPlanId ?? null,
        })
      } catch {
        // A record is never worth a failed call.
      }
    },
  }
}

/** The request's facts from its headers: the user agent, cut, and the session key. */
export function requestFacts(
  headers: Pick<Headers, 'get'> | undefined,
  ip: string | undefined,
  salt: string,
  now: Date = new Date(),
): RequestFacts {
  const raw = headers?.get('user-agent')?.trim()
  const userAgent = raw === undefined || raw === '' ? null : raw.slice(0, USER_AGENT_MAX)
  return { userAgent, sessionKey: sessionKeyOf(salt, ip, userAgent, now) }
}
