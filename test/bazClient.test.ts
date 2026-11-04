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
      anonKey: 'a',
      serviceRoleKey: 's',
      timeoutMs: 1000,
      fetch: fetchMock,
    })
    await expect(client.say('garbage-garbage-garbage', 'hi')).rejects.toThrow(/not a conversation/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
