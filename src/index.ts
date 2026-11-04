import { BazClient } from './bazClient.js'
import { loadConfig } from './config.js'
import { createHttpServer } from './server.js'

const config = loadConfig()
const baz = new BazClient({
  baseUrl: config.bazBaseUrl,
  anonKey: config.bazAnonKey,
  serviceRoleKey: config.bazServiceRoleKey,
  timeoutMs: config.bazTimeoutMs,
})
const server = createHttpServer(config, baz)
server.listen(config.port, () => {
  console.log(`baz-mcp listening on :${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}
