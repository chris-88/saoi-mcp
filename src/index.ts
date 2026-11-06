import { SaoiClient } from './saoiClient.js'
import { loadConfig } from './config.js'
import { createHttpServer } from './server.js'

const config = loadConfig()
const saoi = new SaoiClient({
  baseUrl: config.saoiBaseUrl,
  apiUrl: config.saoiApiUrl,
  anonKey: config.saoiAnonKey,
  serviceRoleKey: config.saoiServiceRoleKey,
  timeoutMs: config.saoiTimeoutMs,
})
const server = createHttpServer(config, saoi)
server.listen(config.port, () => {
  console.log(`saoi-mcp listening on :${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}
