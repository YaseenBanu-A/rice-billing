import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 128

/** scrypt with a random salt, stored as `scrypt$N$r$p$salt$hash` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 32, PARAMS)
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hex] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hex) return false
  const expected = Buffer.from(hex, 'hex')
  const actual = await scrypt(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Same work as a real check, so a wrong username takes as long as a wrong password. */
let dummy: string | undefined
export async function burnTime(password: string) {
  dummy ??= await hashPassword('timing-equaliser')
  await verifyPassword(password, dummy)
}

export function passwordError(pw: string): string {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`
  if (pw.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters`
  return ''
}
