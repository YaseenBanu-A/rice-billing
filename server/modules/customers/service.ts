import type { Customer } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import { n, nul, opt, round2 } from '../../lib/num.ts'
import { asObject, emailError, fail, gstinError, phoneDigits, phoneError, text } from '../../lib/validate.ts'

type Row = { id: string; name: string; phone: string; email: string | null; address: string | null; gstin: string | null }

export const toCustomer = (r: Row, stats?: { outstanding: number; billCount: number }): Customer => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: opt(r.email),
  address: opt(r.address),
  gstin: opt(r.gstin),
  ...(stats ?? {}),
})

export function validateCustomer(raw: unknown) {
  const b = asObject(raw)
  const c = {
    name: text(b.name, 120),
    phone: text(b.phone, 40),
    email: text(b.email, 120),
    address: text(b.address, 500),
    gstin: text(b.gstin, 15).toUpperCase(),
  }
  fail({ name: !c.name ? 'Name is required' : '', phone: phoneError(c.phone, true), email: emailError(c.email), gstin: gstinError(c.gstin) })
  return c
}

type CustomerData = ReturnType<typeof validateCustomer>
const dataOf = (c: CustomerData) => ({ name: c.name, phone: c.phone, phoneDigits: phoneDigits(c.phone), email: nul(c.email), address: nul(c.address), gstin: nul(c.gstin) })

async function assertPhoneFree(db: Tx, phone: string, exceptId = '') {
  const other = await db.customer.findUnique({ where: { phoneDigits: phoneDigits(phone) }, select: { id: true } })
  if (other && other.id !== exceptId) throw conflict('Another customer already has this phone number', 'duplicate_phone')
}

/** Unpaid balance and bill count per customer (cancelled bills excluded) */
async function statsFor(ids: string[]) {
  const rows = await prisma.invoice.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, cancelledAt: null }, _sum: { balance: true }, _count: true })
  return new Map(rows.map((r) => [r.customerId!, { outstanding: round2(n(r._sum.balance)), billCount: r._count }]))
}

export async function listCustomers(q = '', withStats = false): Promise<Customer[]> {
  const term = q.trim()
  const digits = phoneDigits(term)
  const rows = await prisma.customer.findMany({
    where: term
      ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }, ...(digits ? [{ phoneDigits: { contains: digits } }] : [])] }
      : undefined,
    orderBy: { name: 'asc' },
  })
  if (!withStats) return rows.map((r) => toCustomer(r))
  const stats = await statsFor(rows.map((r) => r.id))
  return rows.map((r) => toCustomer(r, stats.get(r.id) ?? { outstanding: 0, billCount: 0 }))
}

export async function getCustomer(id: string): Promise<Customer> {
  const r = await prisma.customer.findUnique({ where: { id } })
  if (!r) throw notFound('Customer')
  return toCustomer(r, (await statsFor([id])).get(id) ?? { outstanding: 0, billCount: 0 })
}

/** Used when a bill is saved with "Save as new customer" */
export async function insertCustomer(tx: Tx, c: CustomerData, actor: Actor | null) {
  await assertPhoneFree(tx, c.phone)
  const r = await tx.customer.create({ data: dataOf(c) })
  await audit(tx, actor, 'customer.create', 'customer', r.id, { name: c.name, phone: c.phone })
  return r
}

export const createCustomer = (raw: unknown, actor: Actor) => transaction(async (tx) => toCustomer(await insertCustomer(tx, validateCustomer(raw), actor)))

export function updateCustomer(id: string, raw: unknown, actor: Actor) {
  const c = validateCustomer(raw)
  return transaction(async (tx) => {
    if (!(await tx.customer.findUnique({ where: { id } }))) throw notFound('Customer')
    await assertPhoneFree(tx, c.phone, id)
    const r = await tx.customer.update({ where: { id }, data: dataOf(c) })
    await audit(tx, actor, 'customer.update', 'customer', id, { name: c.name, phone: c.phone })
    return toCustomer(r)
  })
}

/** Bills keep the customer's name and phone, so deleting only removes the link. Not allowed while money is owed. */
export async function deleteCustomer(id: string, actor: Actor) {
  const c = await getCustomer(id)
  if ((c.outstanding ?? 0) > 0) throw conflict(`${c.name} still owes ${c.outstanding}. Settle the balance before deleting.`)
  await transaction(async (tx) => {
    await tx.customer.delete({ where: { id } })
    await audit(tx, actor, 'customer.delete', 'customer', id, { name: c.name, phone: c.phone })
  })
}
