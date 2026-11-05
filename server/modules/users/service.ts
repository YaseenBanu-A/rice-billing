import type { Role } from '../../../shared/types.ts'
import { prisma, transaction } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import { asObject, fail, text } from '../../lib/validate.ts'
import { hashPassword, passwordError } from '../auth/password.ts'
import { toUser } from '../auth/service.ts'
import { revokeAllForUser } from '../auth/tokens.ts'

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'CASHIER']
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/

function validate(raw: unknown, creating: boolean) {
  const b = asObject(raw)
  const u = {
    username: text(b.username, 30).toLowerCase(),
    name: text(b.name, 80),
    role: b.role as Role,
    active: b.active !== false,
    password: typeof b.password === 'string' ? b.password : '',
  }
  fail({
    username: creating && !USERNAME_RE.test(u.username) ? 'Username: 3-30 lowercase letters, digits, dot, dash or underscore' : '',
    name: !u.name ? 'Name is required' : '',
    role: !ROLES.includes(u.role) ? 'Choose a role' : '',
    password: creating || u.password ? passwordError(u.password) : '',
  })
  return u
}

export const listUsers = async () => (await prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })).map(toUser)

export async function createUser(raw: unknown, actor: Actor) {
  const u = validate(raw, true)
  if (await prisma.user.findUnique({ where: { username: u.username } })) throw conflict('This username is already taken')
  return transaction(async (tx) => {
    const created = await tx.user.create({ data: { username: u.username, name: u.name, role: u.role, active: u.active, passwordHash: await hashPassword(u.password) } })
    await audit(tx, actor, 'user.create', 'user', created.id, { username: u.username, role: u.role })
    return toUser(created)
  })
}

/** Role, name, active flag and (optionally) a new password. Deactivating or resetting signs the user out everywhere. */
export async function updateUser(id: string, raw: unknown, actor: Actor) {
  const u = validate(raw, false)
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) throw notFound('User')
  if (id === actor.id && (!u.active || u.role !== existing.role)) throw conflict('You cannot change your own role or deactivate yourself')
  if (existing.role === 'ADMIN' && (u.role !== 'ADMIN' || !u.active)) {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } })
    if (admins <= 1) throw conflict('There must be at least one active administrator')
  }
  const signOut = !u.active || !!u.password || u.role !== existing.role
  return transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        name: u.name,
        role: u.role,
        active: u.active,
        ...(u.password ? { passwordHash: await hashPassword(u.password) } : {}),
        ...(signOut ? { tokenVersion: { increment: 1 } } : {}),
      },
    })
    if (signOut) await revokeAllForUser(tx, id)
    await audit(tx, actor, 'user.update', 'user', id, { name: u.name, role: u.role, active: u.active, passwordReset: !!u.password })
    return { user: toUser(updated), signedOut: signOut }
  })
}
