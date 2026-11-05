import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../../config.ts'
import type { Tx } from '../../db.ts'
import type { Role } from '../../../shared/types.ts'

/*
 * Two tokens:
 *  - access token: short-lived JWT (15 min) held in the app's memory and sent as `Authorization: Bearer`
 *  - refresh token: random, long-lived, in an HttpOnly cookie only the /api/auth routes receive.
 *    Stored hashed. Every refresh replaces it (rotation); presenting an already-replaced token means it
 *    was copied, so the whole sign-in "family" is revoked.
 */

export const REFRESH_COOKIE = 'ajr_refresh'
const ISSUER = 'aj-rice-billing'
/** two tabs refreshing at the same instant both present the same token; allow that briefly */
const REUSE_GRACE_MS = Number(process.env.REFRESH_REUSE_GRACE_MS ?? 30_000)

export interface AccessClaims {
  sub: string
  role: Role
  tv: number
}

export function signAccess(user: { id: string; role: Role; tokenVersion: number }): string {
  return jwt.sign({ role: user.role, tv: user.tokenVersion }, config.jwtSecret, {
    subject: user.id,
    issuer: ISSUER,
    expiresIn: config.accessTtlSec,
    algorithm: 'HS256',
  })
}

/** Returns the claims, `'expired'`, or null for an invalid token. */
export function verifyAccess(token: string): AccessClaims | 'expired' | null {
  try {
    const c = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, algorithms: ['HS256'] }) as jwt.JwtPayload
    if (typeof c.sub !== 'string' || typeof c.tv !== 'number') return null
    return { sub: c.sub, role: c.role as Role, tv: c.tv }
  } catch (err) {
    return err instanceof jwt.TokenExpiredError ? 'expired' : null
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function readRefreshCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === REFRESH_COOKIE) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export function setRefreshCookie(res: Response, token: string, maxAgeSec: number) {
  res.append(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${config.secureCookies ? '; Secure' : ''}`,
  )
}

export const clearRefreshCookie = (res: Response) => setRefreshCookie(res, '', 0)

export async function issueRefresh(db: Tx, userId: string, req: Request, family: string = randomUUID()): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      family,
      expiresAt: new Date(Date.now() + config.refreshTtlDays * 86_400_000),
      userAgent: (req.get('user-agent') ?? '').slice(0, 200) || null,
      ip: req.ip ?? null,
    },
  })
  return token
}

export type RefreshResult = { userId: string; newToken?: string } | { error: 'invalid' | 'reused' }

/** Validates and rotates a refresh token. */
export async function rotateRefresh(db: Tx, token: string, req: Request): Promise<RefreshResult> {
  const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!row || row.expiresAt < new Date()) return { error: 'invalid' }
  if (row.revokedAt) {
    if (Date.now() - row.revokedAt.getTime() < REUSE_GRACE_MS) return { userId: row.userId } // concurrent refresh
    await db.refreshToken.updateMany({ where: { family: row.family, revokedAt: null }, data: { revokedAt: new Date() } })
    return { error: 'reused' }
  }
  // only one of two racing requests wins the revoke
  const { count } = await db.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } })
  if (count === 0) return { userId: row.userId }
  return { userId: row.userId, newToken: await issueRefresh(db, row.userId, req, row.family) }
}

export async function revokeRefresh(db: Tx, token: string) {
  await db.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } })
}

export async function revokeAllForUser(db: Tx, userId: string, exceptFamily?: string) {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(exceptFamily ? { NOT: { family: exceptFamily } } : {}) },
    data: { revokedAt: new Date() },
  })
}

export async function familyOf(db: Tx, token: string): Promise<string | undefined> {
  return (await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, select: { family: true } }))?.family
}

/** Old, expired or long-revoked tokens are deleted now and then. */
export async function pruneRefreshTokens(db: Tx) {
  const cutoff = new Date(Date.now() - 7 * 86_400_000)
  await db.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] } })
}
