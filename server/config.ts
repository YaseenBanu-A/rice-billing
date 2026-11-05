import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Local development: settings may come from a .env file (never committed). Real environment variables win.
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'))
} catch {
  // no .env file: fine
}

// Day boundaries (today's sales, date filters) follow the shop's clock, not the server's (Render runs in UTC).
process.env.TZ ||= 'Asia/Kolkata'

const env = process.env
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const production = env.NODE_ENV === 'production'

function fail(message: string): never {
  console.error(`\n  x ${message}\n`)
  process.exit(1)
}

if (!env.DATABASE_URL) fail(production ? 'DATABASE_URL must be set in production.' : 'DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
if (production && (env.JWT_SECRET ?? '').length < 32) fail('JWT_SECRET must be set to at least 32 random characters in production.')

export const config = {
  port: Number(env.PORT ?? 3001),
  // localhost only unless told otherwise (Render sets HOST=0.0.0.0)
  host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
  databaseUrl: env.DATABASE_URL!,
  // without a fixed secret (development), access tokens end on restart and are silently refreshed
  jwtSecret: env.JWT_SECRET ?? randomBytes(32).toString('hex'),
  accessTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC ?? 15 * 60),
  refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  /** extra origins allowed to call the API (only needed if the frontend is hosted separately) */
  corsOrigins: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  adminUsername: (env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD,
  adminName: env.ADMIN_NAME ?? 'Administrator',
  staticDir: path.join(root, 'dist'),
  secureCookies: production,
  logRequests: env.LOG_REQUESTS !== 'false',
}
