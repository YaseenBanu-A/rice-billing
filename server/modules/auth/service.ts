import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import type { User } from '../../../shared/types.ts'
import { config, production } from '../../config.ts'
import { prisma, transaction } from '../../db.ts'
import { auditLater } from '../../lib/audit.ts'
import { badRequest, HttpError } from '../../lib/errors.ts'
import { log } from '../../lib/logger.ts'
import { iso } from '../../lib/num.ts'
import { burnTime, hashPassword, passwordError, verifyPassword } from './password.ts'
import { familyOf, issueRefresh, revokeAllForUser, revokeRefresh, rotateRefresh, signAccess } from './tokens.ts'

type UserRow = { id: string; username: string; name: string; role: User['role']; active: boolean; lastLoginAt: Date | null; createdAt: Date }

export const toUser = (u: UserRow): User => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  active: u.active,
  lastLoginAt: iso(u.lastLoginAt),
  createdAt: iso(u.createdAt),
})

export interface Session {
  accessToken: string
  refreshToken?: string
  user: User
}

export async function login(username: string, password: string, req: Request): Promise<Session> {
  const name = username.trim().toLowerCase()
  const user = name ? await prisma.user.findUnique({ where: { username: name } }) : null
  if (!user || !user.active) {
    await burnTime(password)
    auditLater(null, 'auth.login_failed', 'user', undefined, { username: name, ip: req.ip })
    throw new HttpError(401, 'Incorrect username or password', { password: 'Incorrect username or password' }, 'bad_credentials')
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    auditLater({ id: user.id, name: user.name, ip: req.ip }, 'auth.login_failed', 'user', user.id)
    throw new HttpError(401, 'Incorrect username or password', { password: 'Incorrect username or password' }, 'bad_credentials')
  }
  const refreshToken = await issueRefresh(prisma, user.id, req)
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  auditLater({ id: user.id, name: user.name, ip: req.ip }, 'auth.login', 'user', user.id)
  return { accessToken: signAccess(user), refreshToken, user: toUser(updated) }
}

export async function refresh(token: string | undefined, req: Request): Promise<Session> {
  if (!token) throw new HttpError(401, 'Please sign in', undefined, 'unauthenticated')
  const result = await transaction((tx) => rotateRefresh(tx, token, req))
  if ('error' in result) {
    if (result.error === 'reused') log.warn('refresh token reuse detected; sign-in revoked', { ip: req.ip })
    throw new HttpError(401, 'Please sign in again', undefined, 'unauthenticated')
  }
  const user = await prisma.user.findUnique({ where: { id: result.userId } })
  if (!user || !user.active) throw new HttpError(401, 'Please sign in again', undefined, 'unauthenticated')
  return { accessToken: signAccess(user), refreshToken: result.newToken, user: toUser(user) }
}

export async function logout(token: string | undefined) {
  if (token) await revokeRefresh(prisma, token)
}

/** Changing your password signs out every other device; this one gets fresh tokens. */
export async function changePassword(userId: string, current: string, next: string, refreshToken: string | undefined, req: Request): Promise<Session> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await verifyPassword(current, user.passwordHash)))
    throw new HttpError(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' })
  const err = passwordError(next)
  if (err) throw badRequest(err, { newPassword: err })
  if (next === current) throw badRequest('New password must be different from the current one', { newPassword: 'Same as current' })

  const family = refreshToken ? await familyOf(prisma, refreshToken) : undefined
  const updated = await transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), tokenVersion: { increment: 1 } } })
    await revokeAllForUser(tx, userId, family)
    return u
  })
  auditLater({ id: user.id, name: user.name, ip: req.ip }, 'auth.password_changed', 'user', user.id)
  return { accessToken: signAccess(updated), refreshToken: family ? undefined : await issueRefresh(prisma, userId, req), user: toUser(updated) }
}

/**
 * First start: create the administrator. In production ADMIN_PASSWORD must be set; locally a random
 * password is generated and printed once.
 */
export async function ensureAdmin() {
  if ((await prisma.user.count()) > 0) return
  let password = config.adminPassword
  if (!password) {
    if (production) {
      console.error('\n  x No users exist yet. Set ADMIN_PASSWORD (8+ characters) to create the first administrator.\n')
      process.exit(1)
    }
    password = randomBytes(9).toString('base64url')
    console.log(`\n  First administrator created.\n  Username: ${config.adminUsername}\n  Password: ${password}\n  (shown only once; change it in Settings -> Users)\n`)
  }
  const err = passwordError(password)
  if (err) {
    console.error(`\n  x ADMIN_PASSWORD: ${err}\n`)
    process.exit(1)
  }
  await prisma.user.create({ data: { username: config.adminUsername, name: config.adminName, role: 'ADMIN', passwordHash: await hashPassword(password) } })
  log.info('administrator account created', { username: config.adminUsername })
}
