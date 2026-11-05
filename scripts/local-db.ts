/*
 * Local PostgreSQL for development and tests, no installation needed (npm run db:local).
 * Data persists in data/pg between runs. Not used in production (Render provides PostgreSQL).
 *
 * Login, port and database name come from DATABASE_URL in .env (see .env.example). The login is fixed when
 * data/pg is first created; the test database is the same name with `_test` added.
 */
import EmbeddedPostgres from 'embedded-postgres'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'data', 'pg')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // no .env file
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  process.exit(1)
}
const url = new URL(process.env.DATABASE_URL)
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`DATABASE_URL points at ${url.hostname}; the local database only runs on 127.0.0.1.`)
  process.exit(1)
}
const port = Number(url.port || 5432)
const name = decodeURIComponent(url.pathname.slice(1))
const databases = [name, `${name}_test`]

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port,
  persistent: true,
  onLog: () => {},
})

const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'))
if (fresh) await pg.initialise()
await pg.start()
for (const name of databases) {
  try {
    await pg.createDatabase(name)
  } catch {
    // already exists
  }
}
console.log(`Local PostgreSQL running on 127.0.0.1:${port} (databases: ${databases.join(', ')}). Ctrl+C to stop.`)

const stop = async () => {
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
