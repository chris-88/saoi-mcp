import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { BazClient, decodeHandle, encodeHandle, readTurn } from '../src/bazClient.js'

describe('handles', () => {
  it('round-trips and rejects junk', () => {
    const handle = encodeHandle({ email: 'a@b.invalid', password: 'p' })
    expect(decodeHandle(handle)).toEqual({ email: 'a@b.invalid', password: 'p' })
    expect(decodeHandle('not-a-handle')).toBeNull()
  })
})

describe('readTurn', () => {
  it('assembles text, honours retract, collects cards, throws on error events', () => {
    const sse = [
      'data: {"type":"text_delta","text":"Hello wrong"}',
      'data: {"type":"retract","length":6}',
      'data: {"type":"text_delta","text":" there"}',
      'data: {"type":"card","card":{"type":"review"}}',
    ].join('\n')
    expect(readTurn(sse)).toEqual({ reply: 'Hello there', cards: [{ type: 'review' }] })
    expect(() => readTurn('data: {"type":"error","error":{"message":"nope"}}')).toThrow('nope')
  })
})

describe('BazClient', () => {
  it('rejects a handle it did not mint without calling the network', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new BazClient({
      baseUrl: 'http://x',
      apiUrl: 'http://api',
      anonKey: 'a',
      serviceRoleKey: 's',
      timeoutMs: 1000,
      fetch: fetchMock,
    })
    await expect(client.say('garbage-garbage-garbage', 'hi')).rejects.toThrow(/not a conversation/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readTurn on a recorded baz-api turn', () => {
  const recording = JSON.parse(
    readFileSync(new URL('./recordings/baz-turn-opening.json', import.meta.url), 'utf8'),
  ) as { turns: string[] }

  it('reads text and the data notice card from the opening turn', () => {
    const turn = readTurn(recording.turns[0] ?? '')
    expect(turn.reply).toMatch(/^First home with your wife/)
    expect(turn.reply).toMatch(/specific thing you want to sort today\?$/)
    expect(turn.cards).toHaveLength(1)
    expect(turn.cards[0]).toMatchObject({ type: 'data_notice' })
  })

  it('reads every recorded turn without error', () => {
    for (const raw of recording.turns) expect(readTurn(raw).reply.length).toBeGreaterThan(0)
  })
})

describe('BazClient routes', () => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const sse = (): Response =>
    new Response('data: {"type":"text_delta","text":"ok"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  const handle = encodeHandle({ email: 'a@b.invalid', password: 'p' })
  const caseId = '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11'

  function setup(): { client: BazClient; calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = input as string
      calls.push({ url, init })
      if (url.includes('/auth/v1/token')) return Promise.resolve(json({ access_token: 'tok' }))
      if (url.endsWith('/api/sessions')) return Promise.resolve(json({ caseId }))
      if (url.endsWith('/turns')) return Promise.resolve(sse())
      if (url.endsWith('/snapshot'))
        return Promise.resolve(
          json({
            caseId,
            applications: [{ id: 'a1', product: 'savings', state: 'in_progress', catalogue_id: null }],
          }),
        )
      if (url.endsWith('/pause')) return Promise.resolve(json({ applications: [], summary: 'Paused.' }))
      return Promise.resolve(json({ ok: false, error: { code: 'not_found', message: 'No such thing' } }, 404))
    })
    return {
      client: new BazClient({
        baseUrl: 'http://sb',
        apiUrl: 'http://api',
        anonKey: 'a',
        serviceRoleKey: 's',
        timeoutMs: 1000,
        fetch: fetchMock,
      }),
      calls,
    }
  }

  it('say posts a message turn to /api/cases/:id/turns with the bearer token', async () => {
    const { client, calls } = setup()
    expect((await client.say(handle, 'hi')).reply).toBe('ok')
    const turn = calls.find((call) => call.url.endsWith('/turns'))
    expect(turn?.url).toBe(`http://api/api/cases/${caseId}/turns`)
    expect(JSON.parse(turn?.init?.body as string)).toEqual({ trigger: 'message', message: 'hi' })
    expect(new Headers(turn?.init?.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('act hits the action route then reports an action turn', async () => {
    const { client, calls } = setup()
    const result = await client.act(handle, { action: 'pause_application', applicationId: 'app-1' })
    expect(result.summary).toBe('Paused.')
    expect(calls.map((call) => call.url).filter((url) => url.includes('/cases/'))).toEqual([
      `http://api/api/cases/${caseId}/applications/app-1/pause`,
      `http://api/api/cases/${caseId}/turns`,
    ])
  })

  it('act refuses an unknown action without calling a route', async () => {
    const { client, calls } = setup()
    await expect(client.act(handle, { action: 'nope' })).rejects.toThrow(/not one Baz offers/)
    expect(calls.some((call) => call.url.includes('/cases/'))).toBe(false)
  })

  it('status reads the snapshot', async () => {
    const { client } = setup()
    const status = await client.status(handle)
    expect(status.caseId).toBe(caseId)
    expect(status.applications).toEqual([
      { id: 'a1', product: 'savings', display_name: null, state: 'in_progress', catalogue_id: null },
    ])
  })

  it('surfaces the API error message', async () => {
    const { client } = setup()
    await expect(client.act(handle, { action: 'resume_application', applicationId: 'x' })).rejects.toThrow(
      'No such thing',
    )
  })
})
