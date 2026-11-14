import { SaoiClient } from './saoiClient.js'
import { loadConfig } from './config.js'
import { createHttpServer } from './server.js'
import { httpSender } from './telemetry.js'

const config = loadConfig()
const saoi = new SaoiClient({ apiUrl: config.saoiApiUrl, timeoutMs: config.saoiTimeoutMs })
const key = config.telemetryKey
const telemetry =
  key === undefined
    ? undefined
    : { send: httpSender({ apiUrl: config.saoiApiUrl, key }), salt: config.telemetrySalt ?? key }
const server = createHttpServer(config, saoi, telemetry)
server.listen(config.port, () => {
  console.log(`saoi-mcp listening on :${config.port}${telemetry === undefined ? ' (no usage record)' : ''}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5_000).unref()
  })
}
