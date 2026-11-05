import { PrismaPg } from '@prisma/adapter-pg'
import { config } from './config.ts'
import { PrismaClient } from './generated/prisma/client.ts'

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL_SIZE ?? 10) }),
})

/** The client inside an interactive transaction (also accepted: the plain client) */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>

/** Runs `fn` in one database transaction: everything is saved, or nothing is. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 })
}
