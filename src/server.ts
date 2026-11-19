import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node'
import type { SaoiApi } from './saoiClient.js'
import { DEFAULT_PUBLIC_URL, type Config } from './config.js'
import { ICON_PNG, ICON_SVG } from './icon.js'
import { registerPrompts, registerResources, registerTools, SERVER_INSTRUCTIONS } from './tools.js'
import { NO_TELEMETRY, requestFacts, telemetryFor, type CallTelemetry, type Sender } from './telemetry.js'

export const VERSION = '0.20.0'

/** What a host shows for this server: its name, the website and the mark, served from `publicUrl`'s origin. */
export function serverInfo(publicUrl: string) {
  const origin = new URL(publicUrl).origin
  return {
    name: 'saoi',
    title: 'Saoi',
    version: VERSION,
    websiteUrl: 'https://saoi.ie',
    icons: [
      { src: `${origin}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: `${origin}/icon.png`, mimeType: 'image/png', sizes: ['192x192'] },
    ],
  }
}

/** One server per request (stateless), bound to the end user's address for saoi-api's rate limit. */
export function createSaoiServer(
  saoi: SaoiApi,
  ip?: string,
  publicUrl: string = DEFAULT_PUBLIC_URL,
  telemetry: CallTelemetry = NO_TELEMETRY,
): McpServer {
  const server = new McpServer(serverInfo(publicUrl), { instructions: SERVER_INSTRUCTIONS })
  registerTools(server, saoi, ip, telemetry)
  registerResources(server, saoi, publicUrl, ip, telemetry)
  registerPrompts(server, telemetry)
  return server
}

/** Where the AI usage record goes, and the salt for its session key. Absent: nothing is recorded. */
export interface TelemetryOptions {
  readonly send: Sender
  readonly salt: string
}

/**
 * The end user's address: Cloudflare's header (the tunnel sets it; a client cannot), then the
 * first forwarded hop. Undefined when neither is there (a local call).
 */
export function callerAddress(headers: Pick<Headers, 'get'> | undefined): string | undefined {
  const cloudflare = headers?.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded ? forwarded : undefined
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
 * HTTP front: `GET /health`, `GET /icon.svg` and `/icon.png` (the server's icons),
 * `GET /.well-known/openai-apps-challenge` (OpenAI's domain check, when configured), `POST /mcp`. Host and Origin are validated on every request.
 * The MCP handler serves both the 2026-07-28 per-request path and the legacy `initialize`
 * path statelessly; a fresh server instance is built per request.
 */
export function createHttpServer(
  config: Pick<
    Config,
    'allowedHosts' | 'allowedOrigins' | 'keepAliveMs' | 'publicUrl' | 'openaiAppsChallenge'
  >,
  saoi: SaoiApi,
  telemetry?: TelemetryOptions,
): Server {
  const handler = createMcpHandler(
    (ctx) => {
      const headers = ctx.requestInfo?.headers
      const ip = callerAddress(headers)
      // Without a key nothing is sent, but the host is still known for a saved plan's `client`.
      const calls = telemetryFor(
        telemetry?.send ?? (() => undefined),
        requestFacts(headers, ip, telemetry?.salt ?? ''),
      )
      return createSaoiServer(saoi, ip, config.publicUrl, calls)
    },
    {
      legacy: 'stateless',
      responseMode: 'auto',
      keepAliveMs: config.keepAliveMs,
      onerror: (error) => {
        console.error('mcp error:', error.name)
      },
    },
  )
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
      if (path === '/.well-known/openai-apps-challenge' && req.method === 'GET') {
        const token = config.openaiAppsChallenge
        if (token === undefined) {
          json(res, 404, { error: 'Not found' })
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(token)
        return
      }
      if ((path === '/icon.svg' || path === '/icon.png') && req.method === 'GET') {
        const svg = path === '/icon.svg'
        res.writeHead(200, {
          'Content-Type': svg ? 'image/svg+xml' : 'image/png',
          'Cache-Control': 'public, max-age=86400',
        })
        res.end(svg ? ICON_SVG : ICON_PNG)
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
