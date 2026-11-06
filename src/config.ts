/** Runtime configuration, read once from the environment. Values are never logged. */
export interface Config {
  readonly port: number
  readonly saoiBaseUrl: string
  readonly saoiApiUrl: string
  readonly saoiAnonKey: string
  readonly saoiServiceRoleKey: string
  readonly saoiTimeoutMs: number
  readonly allowedHosts: readonly string[]
  readonly allowedOrigins: readonly string[]
  readonly keepAliveMs: number
}

const list = (value: string | undefined, fallback: readonly string[]): readonly string[] => {
  if (value === undefined || value.trim() === '') return fallback
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env['PORT'] ?? 3000),
    saoiBaseUrl: required(env, 'SAOI_BASE_URL').replace(/\/+$/, ''),
    saoiApiUrl: (env['SAOI_API_URL'] ?? 'http://saoi-api:3000').replace(/\/+$/, ''),
    saoiAnonKey: required(env, 'SAOI_ANON_KEY'),
    saoiServiceRoleKey: required(env, 'SAOI_SERVICE_ROLE_KEY'),
    saoiTimeoutMs: Number(env['SAOI_TIMEOUT_MS'] ?? 60_000),
    allowedHosts: list(env['ALLOWED_HOSTS'], ['mcp.chrisquinn.ie', 'localhost', '127.0.0.1', '[::1]']),
    allowedOrigins: list(env['ALLOWED_ORIGINS'], [
      'mcp.chrisquinn.ie',
      'claude.ai',
      'claude.com',
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]),
    keepAliveMs: Number(env['KEEPALIVE_MS'] ?? 25_000),
  }
}
