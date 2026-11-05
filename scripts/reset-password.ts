/*
 * Sets a new password for a user (e.g. the administrator forgot theirs) and signs them out everywhere.
 *
 *   npm run user:reset-password -- admin              → generates a random password and prints it
 *   npm run user:reset-password -- admin NewPass123   → sets this password
 *
 * On Render: web service → Shell → run the same command (DATABASE_URL is already set there).
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '../server/db.ts'
import { hashPassword, passwordError } from '../server/modules/auth/password.ts'

const [username, given] = process.argv.slice(2)
if (!username) {
  console.error('Usage: npm run user:reset-password -- <username> [new password]')
  process.exit(1)
}
const password = given ?? randomBytes(9).toString('base64url')
const err = passwordError(password)
if (err) {
  console.error(err)
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } })
if (!user) {
  const all = await prisma.user.findMany({ select: { username: true } })
  console.error(`No user "${username}". Users: ${all.map((u) => u.username).join(', ') || '(none)'}`)
  process.exit(1)
}
await prisma.$transaction([
  prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 }, active: true } }),
  prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  prisma.auditLog.create({ data: { action: 'user.password_reset_cli', entity: 'user', entityId: user.id } }),
])
await prisma.$disconnect()
console.log(`\n  Password for "${user.username}" has been reset.\n  Username: ${user.username}\n  Password: ${password}\n`)
