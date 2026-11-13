import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { can, type Permission } from '../../../shared/permissions.ts'
import { config } from '../../config.ts'
import { prisma } from '../../db.ts'
import { actorOf, type Actor } from '../../lib/audit.ts'
import { conflict } from '../../lib/errors.ts'

/*
 * Offline attribution: who really made a bill, payment or product change on a device without a connection.
 *
 * While online, each signed-in user gets a signed "attribution token" (GET /api/offline-attribution). The app
 * stores it with every change made offline. When the change is synced, possibly while someone else is signed
 * in on that device, the server checks the token and records the change under the person who made it.
 *
 *  - Signed with a key derived from JWT_SECRET (not the key itself) and its own audience, so it can never be
 *    used to sign in or call the API; it only names the creator of a change sent by an authenticated user.
 *  - The creator must still be active, must not have changed password or been signed out everywhere since
 *    (token version), and must be allowed to do what the change does. The sender's own permissions are
 *    checked as usual by the route.
 *  - If any check fails, the change is refused (409 creator_unverified) and nothing is saved; the app holds it
 *    for review instead of crediting it to whoever happens to be signed in.
 */

const AUDIENCE = 'offline-attribution'
const ISSUER = 'aj-rice-billing'
const TTL_DAYS = Number(process.env.OFFLINE_ATTRIBUTION_DAYS ?? 14)
const key = () => createHash('sha256').update(`offline-attribution:${config.jwtSecret}`).digest()

export function issueAttribution(user: { id: string; tokenVersion: number }) {
  const token = jwt.sign({ tv: user.tokenVersion }, key(), { subject: user.id, audience: AUDIENCE, issuer: ISSUER, expiresIn: `${TTL_DAYS}d`, algorithm: 'HS256' })
  return { token, expiresAt: new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString() }
}

/** GET /api/offline-attribution — the signed-in user's own token */
export async function attributionToken(req: Request, res: Response) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, tokenVersion: true } })
  res.setHeader('Cache-Control', 'private, no-store')
  res.json(issueAttribution(u))
}

const unverified = (why: string) => conflict(`The person who made this change offline could not be verified (${why}). It was not saved and is held for review.`, 'creator_unverified')

/**
 * Who a request's change should be recorded under: the sender, or (offline change synced by someone else) the
 * verified creator named by `token`, with the sender noted as `syncedBy` in the audit log.
 */
export async function attributedActor(req: Request, token: unknown, permission: Permission): Promise<Actor> {
  const sender = actorOf(req)
  if (token === undefined || token === null || token === '') return sender
  if (typeof token !== 'string' || token.length > 2000) throw unverified('invalid proof')
  let claims: jwt.JwtPayload
  try {
    claims = jwt.verify(token, key(), { audience: AUDIENCE, issuer: ISSUER, algorithms: ['HS256'] }) as jwt.JwtPayload
  } catch (err) {
    throw unverified(err instanceof jwt.TokenExpiredError ? 'proof expired: it was made offline too long ago' : 'invalid proof')
  }
  if (typeof claims.sub !== 'string' || typeof claims.tv !== 'number') throw unverified('invalid proof')
  if (claims.sub === sender.id) return sender
  const creator = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, name: true, role: true, active: true, tokenVersion: true } })
  if (!creator || !creator.active) throw unverified('that user is no longer active')
  if (creator.tokenVersion !== claims.tv) throw unverified("that user's password was changed or they were signed out since")
  if (!can(creator.role, permission)) throw unverified('that user is not allowed to do this')
  return { id: creator.id, name: creator.name, ip: sender.ip, syncedBy: { id: sender.id, name: sender.name } }
}
