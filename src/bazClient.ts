/**
 * Thin HTTP client for the Baz services on the self-hosted Supabase stack: auth, the
 * `session`, `baz-turn` and `case-action` edge functions, and the applications table.
 *
 * The handle is a documented prototype shortcut (OAuth comes later): an opaque string that
 * encodes the synthetic credential of a user minted at `start`. Handles are never logged.
 */

export class BazError extends Error {}

export interface BazClientOptions {
  readonly baseUrl: string
  readonly anonKey: string
  readonly serviceRoleKey: string
  readonly timeoutMs: number
  readonly fetch?: typeof fetch
}

export interface BazCard {
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

/** What the tools need from Baz. Tests mock this. */
export interface BazApi {
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

type Envelope = { ok: true; data: unknown } | { ok: false; error: { code?: string; message?: string } }

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

/** Baz's reply as the browser would read it: text with withdrawn rounds taken back, plus cards. */
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
      failure = isRecord(err) && typeof err['message'] === 'string' ? err['message'] : 'Baz could not reply.'
    }
  }
  if (failure !== null) throw new BazError(failure)
  return { reply: reply.trim(), cards }
}

export class BazClient implements BazApi {
  private readonly doFetch: typeof fetch

  constructor(private readonly options: BazClientOptions) {
    this.doFetch = options.fetch ?? fetch
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return this.doFetch(`${this.options.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
  }

  private async signIn(handle: string): Promise<string> {
    const credential = decodeHandle(handle)
    if (credential === null) throw new BazError(NOT_OURS)
    const response = await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.options.anonKey },
      body: JSON.stringify(credential),
    })
    if (!response.ok) throw new BazError(NOT_OURS)
    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body['access_token'] !== 'string') throw new BazError(NOT_OURS)
    return body['access_token']
  }

  private asCustomer(token: string, fn: string, body: unknown): Promise<Response> {
    return this.request(`/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.options.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  }

  private async envelope(response: Response): Promise<unknown> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new BazError(`Baz service error (HTTP ${response.status}).`)
    }
    const envelope = body as Envelope
    if (!isRecord(envelope) || !envelope.ok) {
      const message = isRecord(envelope) && isRecord(envelope.error) ? envelope.error.message : undefined
      throw new BazError(
        typeof message === 'string' ? message : `Baz service error (HTTP ${response.status}).`,
      )
    }
    return envelope.data
  }

  private async caseFor(token: string, source?: string): Promise<string> {
    const data = await this.envelope(
      await this.asCustomer(token, 'session', {
        action: 'start',
        mode: 'new',
        ...(source === undefined ? {} : { source }),
      }),
    )
    if (!isRecord(data) || typeof data['caseId'] !== 'string')
      throw new BazError('Baz did not return a case.')
    return data['caseId']
  }

  async start(source: string | undefined): Promise<{ handle: string; caseId: string }> {
    const credential: Credential = {
      email: `agent-${crypto.randomUUID()}@agent.baz.invalid`,
      password: crypto.randomUUID() + crypto.randomUUID(),
    }
    const created = await this.request('/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.options.serviceRoleKey,
        Authorization: `Bearer ${this.options.serviceRoleKey}`,
      },
      body: JSON.stringify({ ...credential, email_confirm: true, user_metadata: { agent: true } }),
    })
    if (!created.ok) throw new BazError(`Could not start: auth service returned HTTP ${created.status}.`)
    const handle = encodeHandle(credential)
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token, source ?? 'mcp')
    return { handle, caseId }
  }

  async say(handle: string, message: string): Promise<TurnResult> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    return readTurn(await (await this.asCustomer(token, 'baz-turn', { caseId, message })).text())
  }

  async act(
    handle: string,
    action: Record<string, unknown>,
  ): Promise<{ done: unknown; summary: string; turn: TurnResult }> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    const done = await this.envelope(await this.asCustomer(token, 'case-action', { ...action, caseId }))
    const summary = isRecord(done) && typeof done['summary'] === 'string' ? done['summary'] : 'Done.'
    // The app reports a tap to Baz as an action turn, so the agent gets the reply a person would.
    const turn = readTurn(
      await (
        await this.asCustomer(token, 'baz-turn', { caseId, trigger: 'action', message: summary })
      ).text(),
    )
    return { done, summary, turn }
  }

  async status(handle: string): Promise<{ caseId: string; applications: readonly ApplicationRow[] }> {
    const token = await this.signIn(handle)
    const caseId = await this.caseFor(token)
    const query = new URLSearchParams({
      select: 'id,product,display_name,state,catalogue_id',
      case_id: `eq.${caseId}`,
    })
    const response = await this.request(`/rest/v1/applications?${query.toString()}`, {
      headers: { apikey: this.options.anonKey, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new BazError(`Could not read applications (HTTP ${response.status}).`)
    const rows: unknown = await response.json()
    return { caseId, applications: Array.isArray(rows) ? (rows as ApplicationRow[]) : [] }
  }
}
