/*
 * Test harness: runs the real server (separate process, like production) against a throw-away PostgreSQL
 * database. Needs the local database running: `npm run db:local` (creates `ajrice_test`).
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // no .env file
}
/** TEST_DATABASE_URL, or DATABASE_URL with `_test` added to the database name (created by `npm run db:local`). */
function testDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) in .env to run the tests')
  const u = new URL(process.env.DATABASE_URL)
  u.pathname = `${u.pathname}_test`
  return u.toString()
}
export const DB_URL = testDbUrl()
export const ADMIN = { username: 'admin', password: 'Test-Admin-Pass-1' }
const PORT = 3100 + Math.floor(Math.random() * 800)
export const BASE = `http://127.0.0.1:${PORT}`

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: DB_URL,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  ADMIN_USERNAME: ADMIN.username,
  ADMIN_PASSWORD: ADMIN.password,
  LOG_REQUESTS: 'false',
  REFRESH_REUSE_GRACE_MS: '0',
  LOGIN_RATE_LIMIT: '1000',
}

/** Empties the test database (never the real one), then applies all migrations. */
export async function resetDatabase() {
  if (!/_test(\?|$)/.test(DB_URL)) throw new Error('Refusing to wipe a database whose name does not end in _test')
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  await client.end()
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'pipe' })
}

let proc: ChildProcess | null = null
export let serverLog = ''

export async function startServer() {
  proc = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout!.on('data', (d) => (serverLog += d))
  proc.stderr!.on('data', (d) => (serverLog += d))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {
      // not up yet
    }
    if (proc.exitCode !== null) throw new Error(`server exited:\n${serverLog}`)
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not start:\n${serverLog}`)
}

export async function stopServer() {
  if (!proc) return
  const p = proc
  proc = null
  await new Promise<void>((resolve) => {
    p.once('exit', () => resolve())
    p.kill('SIGTERM')
    setTimeout(() => (p.exitCode === null ? p.kill('SIGKILL') : null), 5000)
  })
}

export interface Res<T = any> {
  status: number
  body: T
  cookie?: string
}

/** API call as the given user (access token), with the app's anti-CSRF header unless told otherwise. */
export async function call<T = any>(method: string, url: string, opts: { token?: string; body?: unknown; cookie?: string; noAppHeader?: boolean } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = {}
  if (!opts.noAppHeader) headers['X-Requested-With'] = 'ajrice'
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.cookie) headers.Cookie = opts.cookie
  const res = await fetch(`${BASE}/api${url}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const text = await res.text()
  const setCookie = res.headers.get('set-cookie') ?? undefined
  return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: setCookie?.split(';')[0] }
}

export async function login(username: string, password: string) {
  const r = await call('POST', '/auth/login', { body: { username, password } })
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.body)}`)
  return { token: r.body.accessToken as string, cookie: r.cookie!, user: r.body.user }
}

export const uuid = () => crypto.randomUUID()
