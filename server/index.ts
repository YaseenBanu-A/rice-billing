import { config } from './config.ts' // first: sets the shop time zone
import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { prisma } from './db.ts'
import { log } from './lib/logger.ts'
import { ensureAdmin } from './modules/auth/service.ts'
import { pruneRefreshTokens } from './modules/auth/tokens.ts'
import { ensureSettings } from './modules/settings/service.ts'
import { closeRealtime, initRealtime } from './realtime.ts'

try {
  await prisma.$queryRaw`SELECT 1`
} catch (err) {
  console.error(`\n  x Cannot connect to the database. Check DATABASE_URL (local: run "npm run db:local").\n    ${String(err).split('\n')[0]}\n`)
  process.exit(1)
}
await ensureSettings()
await ensureAdmin()

const server = createServer(createApp())
initRealtime(server)

server.listen(config.port, config.host, () => {
  log.info(`A.J RICE TRADERS billing server running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`, {
    timeZone: process.env.TZ,
  })
})

// clean up expired sign-ins once an hour
const prune = setInterval(() => pruneRefreshTokens(prisma).catch((err) => log.error('token prune failed', { err: String(err) })), 3600_000)
prune.unref()

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info(`${signal} received, shutting down`)
  clearInterval(prune)
  await closeRealtime() // also stops the HTTP server
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
