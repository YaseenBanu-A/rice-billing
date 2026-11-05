import type { RequestHandler } from 'express'
import { can, type Permission } from '../../shared/permissions.ts'
import { prisma } from '../db.ts'
import type { AuthUser } from '../express.d.ts'
import { HttpError } from '../lib/errors.ts'
import { verifyAccess } from '../modules/auth/tokens.ts'

/** Loads the signed-in user, re-checking the database so deactivated users and changed passwords lock out at once. */
export async function userFromToken(token: string | undefined): Promise<AuthUser | 'expired' | null> {
  if (!token) return null
  const claims = verifyAccess(token)
  if (claims === null || claims === 'expired') return claims
  const u = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, username: true, name: true, role: true, active: true, tokenVersion: true } })
  if (!u || !u.active || u.tokenVersion !== claims.tv) return null
  return { id: u.id, username: u.username, name: u.name, role: u.role }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined
  const user = await userFromToken(token)
  if (user === 'expired') return next(new HttpError(401, 'Session expired', undefined, 'token_expired'))
  if (!user) return next(new HttpError(401, 'Please sign in', undefined, 'unauthenticated'))
  req.user = user
  next()
}

/** Server-side permission check; the app's hidden buttons are only a convenience. */
export const requirePermission =
  (...perms: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in', undefined, 'unauthenticated'))
    if (!perms.every((p) => can(req.user!.role, p))) return next(new HttpError(403, 'You do not have permission to do this', undefined, 'forbidden'))
    next()
  }
