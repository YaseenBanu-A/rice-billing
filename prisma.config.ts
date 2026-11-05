// Prisma CLI configuration (migrations, generate). The app itself connects in server/db.ts.
import { defineConfig } from 'prisma/config'

try {
  process.loadEnvFile('.env') // local development only; real environment variables win
} catch {
  // no .env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // from .env or the environment; `prisma generate` (install/build) works without it, migrations need it
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
})
