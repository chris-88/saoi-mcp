/**
 * Thin HTTP client for Saoi: Supabase auth (to mint and sign in the synthetic customer) and the
 * `saoi-api` service's `/api` routes (sessions, turns, case actions, snapshot). Request and
 * response types come from the service's OpenAPI document (`npm run gen`).
 *
 * The handle is a documented prototype shortcut (OAuth comes later): an opaque string that
 * encodes the synthetic credential of a user minted at `start`. Handles are never logged.
 */

import type { components } from './generated/saoi-api.js'

export class SaoiError extends Error {}

type Schemas = components['schemas']

export interface SaoiClientOptions {
  /** Supabase gateway, used only for auth. */
  readonly baseUrl: string
  /** The saoi-api service, e.g. http://saoi-api:3000 (no trailing /api). */
  readonly apiUrl: string
  readonly anonKey: string
  readonly serviceRoleKey: string
  readonly timeoutMs: number
  readonly fetch?: typeof fetch
}

export interface SaoiCard {
  readonly type?: string
  readonly [key: string]: unknown
}

export interface TurnResult {
  readonly reply: string
  readonly cards: readonly unknown[]
}

export interface ApplicationRow {
  readonly id: string
  readonly product: string
  readonly display_name: string | null
  readonly state: string
  readonly catalogue_id: string | null
}

/** What the tools need from Saoirse. Tests mock this. */
export interface SaoiApi {
  start(source: string | undefined): Promise<{ handle: string; caseId: string }>
  say(handle: string, message: string): Promise<TurnResult>
  act(
    handle: string,
    action: Record<string, unknown>,
  ): Promise<{ done: unknown; summary: string; turn: TurnResult }>
  status(handle: string): Promise<{ caseId: string; applications: readonly ApplicationRow[] }>
}

interface Credential {
  readonly email: string
  readonly password: string
}

export function encodeHandle(credential: Credential): string {
  return Buffer.from(JSON.stringify(credential), 'utf8').toString('base64url')
}

export function decodeHandle(handle: string): Credential | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(handle, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { email, password } = parsed as Record<string, unknown>
    return typeof email === 'string' && typeof password === 'string' ? { email, password } : null
  } catch {
    return null
  }
}

const NOT_OURS = 'That handle is not a conversation this server started.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Saoirse's reply as the browser would read it: text with withdrawn rounds taken back, plus cards. */
export function readTurn(raw: string): TurnResult {
  let reply = ''
  const cards: unknown[] = []
  let failure: string | null = null
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let event: unknown
    try {
      event = JSON.parse(line.slice(6))
    } catch {
      continue
    }
    if (!isRecord(event)) continue
    if (event['type'] === 'text_delta' && typeof event['text'] === 'string') reply += event['text']
    else if (event['type'] === 'retract' && typeof event['length'] === 'number')
      reply = reply.slice(0, Math.max(0, reply.length - event['length']))
    else if (event['type'] === 'card') cards.push(event['card'])
    else if (event['type'] === 'error') {
      const err = event['error']
      failure =
        isRecord(err) && typeof err['message'] === 'string' ? err['message'] : 'Saoirse could not reply.'
    }
  }
  if (failure !== null) throw new SaoiError(failure)
  return { reply: reply.trim(), cards }
}

/** A card action an agent may take, mapped to one saoi-api route each. */
type Action = Record<string, unknown> & { action?: unknown }

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The route and body for an `act` action. Unknown actions are refused before any call. */
function routeFor(caseId: string, action: Action): { path: string; body: unknown } {
  const base = `/api/cases/${encodeURIComponent(caseId)}`
  const app = `${base}/applications/${encodeURIComponent(str(action['applicationId']))}`
  switch (action['action']) {
    case 'select_products':
      return { path: `${base}/products/select`, body: { products: action['products'] } }
    case 'decide_plan':
      return {
        path: `${base}/plans/${encodeURIComponent(str(action['planId']))}/decisions`,
        body: { decision: action['decision'] },
      }
    case 'submit_application':
      return { path: `${app}/submit`, body: { confirmations: action['confirmations'] ?? [] } }
    case 'pause_application':
      return { path: `${app}/pause`, body: {} }
    case 'resume_application':
      return { path: `${app}/resume`, body: {} }
    case 'decline_product':
      return { path: `${base}/products/${encodeURIComponent(str(action['product']))}/decline`, body: {} }
    case 'link_accounts':
      return { path: `${base}/linked-accounts`, body: { bank: action['bank'], scope: action['scope'] } }
    case 'initiate_transfer':
      return {
        path: `${base}/transfers`,
        body: {
          fromAccountId: action['fromAccountId'],
          toApplicationId: action['toApplicationId'] ?? null,
          amount: action['amount'],
          cadence: action['cadence'] ?? 'once',
        },
      }
    default:
      throw new SaoiError('That action is not one Saoirse offers.')
  }
}

export class SaoiClient implements SaoiApi {
  private readonly doFetch: typeof fetch

  constructor(private readonly options: SaoiClientOptions) {
    this.doFetch = options.fetch ?? fetch
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    return this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs) })
  }

  private async signIn(handle: string): Promise<string> {
    const credential = decodeHandle(handle)
    if (credential === null) throw new SaoiError(NOT_OURS)
    const response = await this.request(`${this.options.baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.options.anonKey },
      body: JSON.stringify(credential),
    })
    if (!response.ok) throw new SaoiError(NOT_OURS)
    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body['access_token'] !== 'string') throw new SaoiError(NOT_OURS)
    return body['access_token']
  }

  /** Call a saoi-api route as the customer. The caller reads the response. */
  private api(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    return this.request(`${this.options.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  /** A JSON route: the body on success, a SaoiError carrying the API's own message otherwise. */
  private async json(response: Response): Promise<unknown> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new SaoiError(`Saoirse service error (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      const error = isRecord(body) ? (body as Partial<Schemas['ErrorResponse']>).error : undefined
      throw new SaoiError(
        typeof error?.message === 'string'
          ? error.message
          : `Saoirse service error (HTTP ${response.status}).`,
      )
    }
    return body
  }

  private async caseFor(token: string, source?: string): Promise<string> {
    const request: Schemas['StartSession'] = { mode: 'new', ...(source === undefined ? {} : { source }) }
    const data = await this.json(await this.api(token, 'POST', '/api/sessions', request))
    if (!isRecord(data) || typeof data['caseId'] !== 'string')
      throw new SaoiError('Saoirse did not return a case.')
    return data['caseId']
  }

  private async turn(
    token: string,
    caseId: string,
    request: Schemas['SaoirseTurnRequest'],
  ): Promise<TurnResult> {
    const response = await this.api(token, 'POST', `/api/cases/${encodeURIComponent(caseId)}/turns`, request)
    if (!response.ok) await this.json(response)
    return readTurn(await response.text())
  }

  async start(source: string | undefined): Promise<{ handle: string; caseId: string }> {
    const credential: Credential = {
      email: `agent-${crypto.randomUUID()}@agent.saoi.invalid`,
      password: crypto.randomUUID() + crypto.randomUUID(),
    }
    const created = await this.request(`${this.options.baseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.options.serviceRoleKey,
        Authorization: `Bearer ${this.options.serviceRoleKey}`,
      },
      body: JSON.stringify({ ...credential, email_confirm: true, user_metadata: { agent: true } }),
    })
    if (!created.ok) throw new SaoiError(`Could not start: auth service returned HTTP ${created.status}.`)
    const handle = encodeHandle(credential)
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token, source ?? 'mcp')
    return { handle, caseId }
  }

  async say(handle: string, message: string): Promise<TurnResult> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    return this.turn(token, caseId, { trigger: 'message', message })
  }

  async act(
    handle: string,
    action: Record<string, unknown>,
  ): Promise<{ done: unknown; summary: string; turn: TurnResult }> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    const { path, body } = routeFor(caseId, action)
    const done = await this.json(await this.api(token, 'POST', path, body))
    const summary = isRecord(done) && typeof done['summary'] === 'string' ? done['summary'] : 'Done.'
    // The app reports a tap to Saoirse as an action turn, so the agent gets the reply a person would.
    const turn = await this.turn(token, caseId, { trigger: 'action', message: summary })
    return { done, summary, turn }
  }

  async status(handle: string): Promise<{ caseId: string; applications: readonly ApplicationRow[] }> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    const data = await this.json(
      await this.api(token, 'GET', `/api/cases/${encodeURIComponent(caseId)}/snapshot`),
    )
    const rows = isRecord(data) && Array.isArray(data['applications']) ? data['applications'] : []
    const applications = (rows as Schemas['CaseSnapshot']['applications']).map((row) => ({
      id: row.id,
      product: row.product,
      display_name: null,
      state: row.state,
      catalogue_id: row.catalogue_id,
    }))
    return { caseId, applications }
  }
}
