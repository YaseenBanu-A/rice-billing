import type { Supplier } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import { n, nul, opt, round2 } from '../../lib/num.ts'
import { asObject, emailError, fail, gstinError, phoneDigits, phoneError, text } from '../../lib/validate.ts'

type Row = { id: string; name: string; phone: string; email: string | null; address: string | null; gstin: string | null }

const toSupplier = (r: Row, stats?: { outstanding: number; purchaseCount: number }): Supplier => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: opt(r.email),
  address: opt(r.address),
  gstin: opt(r.gstin),
  ...(stats ?? {}),
})

function validate(raw: unknown) {
  const b = asObject(raw)
  const s = { name: text(b.name, 120), phone: text(b.phone, 40), email: text(b.email, 120), address: text(b.address, 500), gstin: text(b.gstin, 15).toUpperCase() }
  fail({ name: !s.name ? 'Name is required' : '', phone: phoneError(s.phone, false), email: emailError(s.email), gstin: gstinError(s.gstin) })
  return { name: s.name, phone: s.phone, phoneDigits: s.phone ? phoneDigits(s.phone) : null, email: nul(s.email), address: nul(s.address), gstin: nul(s.gstin) }
}

async function assertPhoneFree(db: Tx, digits: string | null, exceptId = '') {
  if (!digits) return
  const other = await db.supplier.findUnique({ where: { phoneDigits: digits }, select: { id: true } })
  if (other && other.id !== exceptId) throw conflict('Another supplier already has this phone number', 'duplicate_phone')
}

async function statsFor(ids: string[]) {
  const rows = await prisma.purchase.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids }, cancelledAt: null }, _sum: { balance: true }, _count: true })
  return new Map(rows.map((r) => [r.supplierId, { outstanding: round2(n(r._sum.balance)), purchaseCount: r._count }]))
}

export async function listSuppliers(q = ''): Promise<Supplier[]> {
  const term = q.trim()
  const digits = phoneDigits(term)
  const rows = await prisma.supplier.findMany({
    where: term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(digits ? [{ phoneDigits: { contains: digits } }] : [])] } : undefined,
    orderBy: { name: 'asc' },
  })
  const stats = await statsFor(rows.map((r) => r.id))
  return rows.map((r) => toSupplier(r, stats.get(r.id) ?? { outstanding: 0, purchaseCount: 0 }))
}

export async function createSupplier(raw: unknown, actor: Actor) {
  const data = validate(raw)
  return transaction(async (tx) => {
    await assertPhoneFree(tx, data.phoneDigits)
    const r = await tx.supplier.create({ data })
    await audit(tx, actor, 'supplier.create', 'supplier', r.id, { name: data.name })
    return toSupplier(r)
  })
}

export async function updateSupplier(id: string, raw: unknown, actor: Actor) {
  const data = validate(raw)
  return transaction(async (tx) => {
    if (!(await tx.supplier.findUnique({ where: { id } }))) throw notFound('Supplier')
    await assertPhoneFree(tx, data.phoneDigits, id)
    const r = await tx.supplier.update({ where: { id }, data })
    await audit(tx, actor, 'supplier.update', 'supplier', id, { name: data.name })
    return toSupplier(r)
  })
}

export async function deleteSupplier(id: string, actor: Actor) {
  const s = await prisma.supplier.findUnique({ where: { id } })
  if (!s) throw notFound('Supplier')
  if (await prisma.purchase.count({ where: { supplierId: id } })) throw conflict(`${s.name} has purchases recorded and cannot be deleted`)
  await transaction(async (tx) => {
    await tx.supplier.delete({ where: { id } })
    await audit(tx, actor, 'supplier.delete', 'supplier', id, { name: s.name })
  })
}
