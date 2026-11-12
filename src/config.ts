/** Runtime configuration, read once from the environment. No secrets: saoi-api's routes are public. */
export interface Config {
  readonly port: number
  readonly saoiApiUrl: string
  readonly saoiTimeoutMs: number
  readonly allowedHosts: readonly string[]
  readonly allowedOrigins: readonly string[]
  readonly keepAliveMs: number
  /** The exact URL connectors are configured with; the server's icons are served from its origin. */
  readonly publicUrl: string
}

export const DEFAULT_PUBLIC_URL = 'https://mcp.saoi.ie/mcp'

const list = (value: string | undefined, fallback: readonly string[]): readonly string[] => {
  if (value === undefined || value.trim() === '') return fallback
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

const optional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** A URL kept exactly as written (Claude hashes the string), checked once at start-up. */
const url = (value: string): string => {
  if (!URL.canParse(value)) throw new Error(`PUBLIC_URL is not a URL: ${value}`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env['PORT'] ?? 3000),
    saoiApiUrl: (env['SAOI_API_URL'] ?? 'http://saoi-api:3000').replace(/\/+$/, ''),
    saoiTimeoutMs: Number(env['SAOI_TIMEOUT_MS'] ?? 30_000),
    allowedHosts: list(env['ALLOWED_HOSTS'], [
      'mcp.saoi.ie',
      'mcp.chrisquinn.ie',
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]),
    allowedOrigins: list(env['ALLOWED_ORIGINS'], [
      'mcp.saoi.ie',
      'mcp.chrisquinn.ie',
      'claude.ai',
      'claude.com',
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]),
    keepAliveMs: Number(env['KEEPALIVE_MS'] ?? 25_000),
    publicUrl: url(optional(env['PUBLIC_URL']) ?? DEFAULT_PUBLIC_URL),
  }
}
