import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { legacyPost, mockSaoi, modernPost, rpc, run, type Running } from './helpers.js'

type Rpc = { result?: Record<string, unknown>; error?: { code: number } }
const asRpc = async (res: Response): Promise<Rpc> => await rpc(res)
const HANDLE = 'h'.repeat(40)

let saoi: ReturnType<typeof mockSaoi>
let srv: Running
beforeEach(async () => {
  saoi = mockSaoi()
  srv = await run(saoi)
})
afterEach(async () => {
  await srv.close()
})

describe('http surface', () => {
  it('GET /health returns ok and version', async () => {
    const res = await fetch(`${srv.url}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: '0.1.0' })
  })

  it('rejects a disallowed Origin with 403', async () => {
    const res = await legacyPost(
      srv.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Origin: 'https://evil.example' },
    )
    expect(res.status).toBe(403)
  })

  it('accepts an allowed Origin and a request with no Origin', async () => {
    const res = await legacyPost(
      srv.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Origin: 'https://claude.ai' },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://claude.ai')
  })

  it('rejects an unknown Host with 403', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${srv.url}/health`, { headers: { Host: 'evil.example' } }, (res) => {
        resolve(res.statusCode ?? 0)
        res.resume()
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('answers GET /mcp with 405 (stateless) and unknown paths with 404', async () => {
    expect((await fetch(`${srv.url}/mcp`, { headers: { Accept: 'text/event-stream' } })).status).toBe(405)
    expect((await fetch(`${srv.url}/nope`)).status).toBe(404)
  })

  it('sets X-Accel-Buffering: no on /mcp', async () => {
    const res = await legacyPost(srv.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })
})

describe('protocol eras', () => {
  it('serves the legacy initialize path', async () => {
    const res = await legacyPost(srv.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    const body = await asRpc(res)
    expect(body.result?.['serverInfo']).toMatchObject({ name: 'saoirse' })
  })

  it('serves server/discover on the 2026-07-28 path', async () => {
    const body = await asRpc(await modernPost(srv.url, 'server/discover'))
    expect(body.result?.['supportedVersions']).toContain('2026-07-28')
  })

  it('rejects a mismatched Mcp-Method header', async () => {
    const res = await modernPost(srv.url, 'tools/list', {}, undefined, { 'Mcp-Method': 'tools/call' })
    expect(res.status).toBe(400)
  })
})

describe('tools/list', () => {
  const expectedNames = ['saoirse_act', 'saoirse_say', 'saoirse_start', 'saoirse_status']

  it.each([
    ['modern', () => modernPost(srv.url, 'tools/list')],
    ['legacy', () => legacyPost(srv.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })],
  ])('lists four tools with object schemas and descriptions (%s)', async (_era, call) => {
    const body = await asRpc(await call())
    const tools = body.result?.['tools'] as {
      name: string
      description: string
      inputSchema: { type: string; properties: Record<string, { description?: string }> }
      annotations?: { readOnlyHint?: boolean }
    }[]
    expect(tools.map((t) => t.name).sort()).toEqual(expectedNames)
    for (const tool of tools) {
      expect(tool.description).toMatch(/synthetic/i)
      expect(tool.inputSchema.type).toBe('object')
      for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
        expect(schema.description, `${tool.name}.${field} needs a description`).toBeTruthy()
      }
    }
    expect(tools.find((t) => t.name === 'saoirse_status')?.annotations?.readOnlyHint).toBe(true)
  })
})

describe('tools/call', () => {
  const call = async (name: string, args: Record<string, unknown>): Promise<Rpc> =>
    asRpc(await modernPost(srv.url, 'tools/call', { name, arguments: args }, name))

  it('saoirse_start calls the client and returns a handle', async () => {
    const body = await call('saoirse_start', { source: 'test' })
    expect(saoi.start).toHaveBeenCalledWith('test')
    expect(body.result?.['structuredContent']).toMatchObject({
      caseId: 'case-1',
      opening: 'What are you trying to do?',
    })
  })

  it('saoirse_say relays the message and lists card actions', async () => {
    const body = await call('saoirse_say', { handle: HANDLE, message: 'I want to save' })
    expect(saoi.say).toHaveBeenCalledWith(HANDLE, 'I want to save')
    const text = (body.result?.['content'] as { text: string }[])[0]?.text ?? ''
    expect(text).toContain('Hello from Saoirse')
    expect(text).toContain('decide_plan')
  })

  it('saoirse_act validates per-action fields then calls the client', async () => {
    const planId = '123e4567-e89b-42d3-a456-426614174000'
    const body = await call('saoirse_act', {
      handle: HANDLE,
      action: 'decide_plan',
      planId,
      decision: 'keep',
    })
    expect(saoi.act).toHaveBeenCalledWith(HANDLE, { action: 'decide_plan', planId, decision: 'keep' })
    expect(body.result?.['isError']).toBeUndefined()
  })

  it('saoirse_act returns isError when an action is missing its fields', async () => {
    const body = await call('saoirse_act', { handle: HANDLE, action: 'decide_plan' })
    expect(body.result?.['isError']).toBe(true)
    expect(saoi.act).not.toHaveBeenCalled()
  })

  it('saoirse_status summarises applications', async () => {
    const body = await call('saoirse_status', { handle: HANDLE })
    expect((body.result?.['content'] as { text: string }[])[0]?.text).toBe('Rainy day: in progress')
  })

  it('maps a client failure to an isError result without leaking the handle', async () => {
    saoi.say.mockRejectedValueOnce(new Error(`boom ${HANDLE}`))
    const body = await call('saoirse_say', { handle: HANDLE, message: 'hi' })
    expect(body.result?.['isError']).toBe(true)
    expect(JSON.stringify(body)).not.toContain(HANDLE)
  })

  it('rejects input that fails the schema', async () => {
    const res = await modernPost(
      srv.url,
      'tools/call',
      { name: 'saoirse_say', arguments: { handle: 'short', message: 'x' } },
      'saoirse_say',
    )
    const body = await asRpc(res)
    expect(saoi.say).not.toHaveBeenCalled()
    expect(body.error !== undefined || body.result?.['isError'] === true).toBe(true)
  })
})
