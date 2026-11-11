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
  // Migrations need a direct (non-pooled) connection: Prisma's migration lock does not work through a connection
  // pooler such as Neon's "-pooler" host. DIRECT_DATABASE_URL is that direct connection; without it (local
  // development), DATABASE_URL is used. The app itself always uses DATABASE_URL (server/db.ts).
  // `prisma generate` (install/build) works without either; migrations need one.
  ...((process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL)
    ? { datasource: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } }
    : {}),
})
