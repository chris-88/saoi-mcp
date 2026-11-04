import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { vi } from 'vitest'
import type { BazApi } from '../src/bazClient.js'
import { createHttpServer } from '../src/server.js'

export const mockBaz = (): { [K in keyof BazApi]: ReturnType<typeof vi.fn<BazApi[K]>> } => ({
  start: vi.fn<BazApi['start']>(() => Promise.resolve({ handle: 'h'.repeat(40), caseId: 'case-1' })),
  say: vi.fn<BazApi['say']>(() =>
    Promise.resolve({ reply: 'Hello from Baz', cards: [{ type: 'plan_proposal' }] }),
  ),
  act: vi.fn<BazApi['act']>(() =>
    Promise.resolve({
      done: { summary: 'Plan kept' },
      summary: 'Plan kept',
      turn: { reply: 'Great.', cards: [] },
    }),
  ),
  status: vi.fn<BazApi['status']>(() =>
    Promise.resolve({
      caseId: 'case-1',
      applications: [
        { id: 'a1', product: 'savings', display_name: 'Rainy day', state: 'in_progress', catalogue_id: null },
      ],
    }),
  ),
})

export interface Running {
  readonly url: string
  readonly server: Server
  close(): Promise<void>
}

export async function run(baz: BazApi): Promise<Running> {
  const server = createHttpServer(
    {
      allowedHosts: ['mcp.chrisquinn.ie', 'localhost', '127.0.0.1'],
      allowedOrigins: ['claude.ai', 'localhost'],
      keepAliveMs: 25_000,
    },
    baz,
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
