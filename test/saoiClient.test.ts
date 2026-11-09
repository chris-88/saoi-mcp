import { describe, expect, it, vi } from 'vitest'
import { SaoiClient, SaoiError } from '../src/saoiClient.js'

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers })))

describe('SaoiClient', () => {
  it('posts the body to the route and forwards the caller’s address', async () => {
    const fetchMock = respond(200, { ok: 1 })
    const client = new SaoiClient({ apiUrl: 'http://api', timeoutMs: 1000, fetch: fetchMock })
    await client.search({ category: 'loan' }, '203.0.113.9')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api/api/market/search')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"category":"loan"}')
    expect((init?.headers as Record<string, string>)['X-Forwarded-For']).toBe('203.0.113.9')
  })

  it('sends no forwarded address when it has none, and encodes a product id', async () => {
    const fetchMock = respond(200, {})
    const client = new SaoiClient({ apiUrl: 'http://api', timeoutMs: 1000, fetch: fetchMock })
    await client.product('boi:savings.supersaver')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api/api/market/products/boi%3Asavings.supersaver')
    expect(init?.headers).not.toHaveProperty('X-Forwarded-For')
  })

  it('marks a saved plan as from the MCP', async () => {
    const fetchMock = respond(201, { claimUrl: 'x', expiresAt: 'y' })
    const client = new SaoiClient({ apiUrl: 'http://api', timeoutMs: 1000, fetch: fetchMock })
    await client.savePlan({ plan: { version: 1 } })
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      plan: { version: 1 },
      client: 'mcp',
    })
  })

  it('turns a refusal into a SaoiError carrying its message, details and Retry-After', async () => {
    const client = new SaoiClient({
      apiUrl: 'http://api',
      timeoutMs: 1000,
      fetch: respond(
        429,
        { ok: false, error: { code: 'rate_limited', message: 'Too many requests.', details: ['x'] } },
        { 'Retry-After': '12' },
      ),
    })
    const error = await client.debt({}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SaoiError)
    expect(error).toMatchObject({
      message: 'Too many requests.',
      status: 429,
      details: ['x'],
      retryAfter: '12',
    })
  })
})
