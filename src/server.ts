import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node'
import type { SaoiApi } from './saoiClient.js'
import type { Config } from './config.js'
import { registerTools, SERVER_INSTRUCTIONS } from './tools.js'

export const VERSION = '0.1.0'

export function createSaoiServer(saoi: SaoiApi): McpServer {
  const server = new McpServer(
    { name: 'saoirse', title: 'Saoirse (Saoi)', version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  )
  registerTools(server, saoi)
  return server
}

type Guard = (req: IncomingMessage, res: ServerResponse) => boolean

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

/**
 * HTTP front: `GET /health`, `POST /mcp`. Host and Origin are validated on every request.
 * The MCP handler serves both the 2026-07-28 per-request path and the legacy `initialize`
 * path statelessly; a fresh server instance is built per request.
 */
export function createHttpServer(
  config: Pick<Config, 'allowedHosts' | 'allowedOrigins' | 'keepAliveMs'>,
  saoi: SaoiApi,
): Server {
  const handler = createMcpHandler(() => createSaoiServer(saoi), {
    legacy: 'stateless',
    responseMode: 'auto',
    keepAliveMs: config.keepAliveMs,
    onerror: (error) => {
      console.error('mcp error:', error.name)
    },
  })
  const mcp = toNodeHandler(handler, {
    onerror: (error) => {
      console.error('mcp adapter error:', error.name)
    },
  })
  const validateHost: Guard = hostHeaderValidation([...config.allowedHosts])
  const validateOrigin: Guard = originValidation([...config.allowedOrigins])

  return createServer((req, res) => {
    void (async () => {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return
      const path = (req.url ?? '/').split('?')[0]

      if (path === '/health' && req.method === 'GET') {
        json(res, 200, { ok: true, version: VERSION })
        return
      }
      if (path !== '/mcp') {
        json(res, 404, { error: 'Not found' })
        return
      }
      const origin = req.headers.origin
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
        res.setHeader(
          'Access-Control-Allow-Headers',
          'content-type, accept, mcp-protocol-version, mcp-method, mcp-name',
        )
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      res.setHeader('X-Accel-Buffering', 'no')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      await mcp(req, res)
    })().catch((error: unknown) => {
      console.error('http error:', error instanceof Error ? error.name : 'unknown')
      if (!res.headersSent) json(res, 500, { error: 'Internal error' })
      else res.end()
    })
  })
}
