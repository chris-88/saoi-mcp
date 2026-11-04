/** Runtime configuration, read once from the environment. Values are never logged. */
export interface Config {
  readonly port: number
  readonly bazBaseUrl: string
  readonly bazAnonKey: string
  readonly bazServiceRoleKey: string
  readonly bazTimeoutMs: number
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
    bazBaseUrl: required(env, 'BAZ_BASE_URL').replace(/\/+$/, ''),
    bazAnonKey: required(env, 'BAZ_ANON_KEY'),
    bazServiceRoleKey: required(env, 'BAZ_SERVICE_ROLE_KEY'),
    bazTimeoutMs: Number(env['BAZ_TIMEOUT_MS'] ?? 60_000),
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
