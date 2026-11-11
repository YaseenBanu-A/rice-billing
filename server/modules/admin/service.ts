import { computeTotals } from '../../../shared/billing.ts'
import type { Backup } from '../../../shared/types.ts'
import { prisma, type Tx } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { badRequest } from '../../lib/errors.ts'
import { n, round2, toDateKey } from '../../lib/num.ts'
import { asObject, isoDate, number, phoneDigits, text } from '../../lib/validate.ts'
import { linkExpenseCategories } from '../expenses/service.ts'
import { syncInvoice } from '../invoices/service.ts'

/*
 * Backup = every business table (users, sign-ins and the audit log are not included).
 * Tables are listed parents first, so a restore can insert in this order and delete in reverse.
 */
const TABLES = [
  'companySettings',
  'taxRate',
  'counter',
  'category',
  'customer',
  'supplier',
  'product',
  'invoice',
  'invoiceItem',
  'salesReturn',
  'salesReturnItem',
  'purchase',
  'purchaseItem',
  'payment',
  'stockMovement',
  'expenseCategory',
  'expense',
  'expenseAttachment',
] as const
type Table = (typeof TABLES)[number]

/** Tables added after the first backup format: a backup made before them simply doesn't have them. */
const ADDED_LATER = new Set<Table>(['expenseCategory', 'expenseAttachment'])

/** Rows per insert; receipts are large, so fewer at a time */
const batchSize = (t: Table) => (t === 'expenseAttachment' ? 20 : 1000)

/** columns that point at a user; cleared on restore if that user doesn't exist here */
const USER_REFS = ['createdById', 'userId']

type Delegate = { findMany: (a?: object) => Promise<unknown[]>; deleteMany: () => Promise<unknown>; createMany: (a: { data: object[] }) => Promise<unknown> }
const model = (db: Tx, t: Table) => (db as unknown as Record<Table, Delegate>)[t]

const plain = (rows: unknown[]) => JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>[]

export async function exportAll(): Promise<Backup> {
  const tables: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    const rows = await model(prisma, t).findMany()
    // receipt files travel as base64 text inside the JSON backup
    tables[t] = t === 'expenseAttachment' ? plain((rows as { data: Uint8Array }[]).map((r) => ({ ...r, data: Buffer.from(r.data).toString('base64') }))) : plain(rows)
  }
  return { app: 'aj-rice-billing', version: 2, exportedAt: new Date().toISOString(), tables }
}

async function wipe(tx: Tx, keepSettings: boolean, keep: Set<Table> = new Set()) {
  for (const t of [...TABLES].reverse()) {
    if (keepSettings && (t === 'companySettings' || t === 'taxRate' || t === 'expenseCategory')) continue
    if (keep.has(t)) continue
    await model(tx, t).deleteMany()
  }
}

const longTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn, { maxWait: 10_000, timeout: 300_000 })

/** Replaces all business data with the backup: either everything is restored or nothing changes. */
export async function restore(raw: unknown, actor: Actor) {
  const b = asObject(raw, 'Backup file')
  if (b.app === 'simple-billing' && b.version === 1) return importLegacy(b, actor)
  if (b.app !== 'aj-rice-billing' || b.version !== 2) throw badRequest('This is not a billing backup file')
  const tables = asObject(b.tables, 'Backup tables')
  for (const t of TABLES) if (!Array.isArray(tables[t]) && !ADDED_LATER.has(t)) throw badRequest(`Backup file is damaged: "${t}" is missing`)
  // a backup from before expense categories existed: keep this shop's categories and link the expenses to them
  const keep = new Set<Table>(Array.isArray(tables.expenseCategory) ? [] : ['expenseCategory'])

  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id))
  return longTx(async (tx) => {
    await wipe(tx, false, keep)
    const counts: Record<string, number> = {}
    for (const t of TABLES) {
      if (keep.has(t)) continue
      const rows = ((tables[t] ?? []) as Record<string, unknown>[]).map((r) => {
        const row = { ...r }
        for (const k of USER_REFS) if (k in row && row[k] && !userIds.has(row[k] as string)) row[k] = null
        if (t === 'stockMovement') delete row.id // auto-numbered
        if (t === 'expenseAttachment') {
          if (typeof row.data !== 'string') throw badRequest('Backup file is damaged: a receipt file is unreadable')
          row.data = new Uint8Array(Buffer.from(row.data, 'base64'))
        }
        return row
      })
      const size = batchSize(t)
      for (let i = 0; i < rows.length; i += size) await model(tx, t).createMany({ data: rows.slice(i, i + size) })
      counts[t] = rows.length
    }
    await linkExpenseCategories(tx)
    await audit(tx, actor, 'data.restore', 'backup', undefined, { exportedAt: b.exportedAt, counts })
    return { bills: counts.invoice, customers: counts.customer }
  })
}

/**
 * Imports a backup from the earlier version of this app (SQLite, before PostgreSQL): settings, products,
 * customers and bills with their payments. Stock starts at zero for imported products.
 */
async function importLegacy(b: Record<string, unknown>, actor: Actor) {
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const settings = asObject(b.settings ?? {}, 'settings')
  const userIds = actor.id
  return longTx(async (tx) => {
    await wipe(tx, true)
    if (text(settings.invoicePrefix, 10)) await tx.companySettings.update({ where: { id: 1 }, data: { invoicePrefix: text(settings.invoicePrefix, 10) } })

    const productIds = new Set<string>()
    for (const p of list(b.products)) {
      const r = await tx.product.create({
        data: { name: text(p.name, 160) || 'Product', sku: text(p.sku, 40).toUpperCase() || `OLD-${productIds.size + 1}`, price: round2(number(p.price) || 0), gstRate: number(p.gstRate) || 0 },
      })
      productIds.add(r.id)
    }
    const customerMap = new Map<string, string>()
    for (const c of list(b.customers)) {
      const digits = phoneDigits(text(c.phone, 40))
      if (!digits || [...customerMap.values()].length > 100_000) continue
      const exists = await tx.customer.findUnique({ where: { phoneDigits: digits } })
      const r = exists ?? (await tx.customer.create({ data: { name: text(c.name, 120) || 'Customer', phone: text(c.phone, 40), phoneDigits: digits, email: text(c.email, 120) || null, address: text(c.address, 500) || null } }))
      customerMap.set(text(c.id, 64), r.id)
    }
    let maxSeq = 0
    for (const bill of list(b.bills)) {
      const items = list(bill.items).map((it) => ({ name: text(it.name, 160) || 'Item', sku: text(it.sku, 40), price: number(it.price) || 0, quantity: number(it.quantity) || 1, unit: text(it.unit, 20), bags: it.bags == null ? null : number(it.bags), gstRate: number(it.gstRate) || 0 }))
      if (!items.length) continue
      const cust = asObject(bill.customer ?? {}, 'customer')
      const discountType = bill.discountType === 'amount' ? 'amount' : 'percent'
      const totals = computeTotals({ items, discountType, discountValue: number(bill.discountValue) || 0, gstInclusive: bill.gstInclusive === true, amountPaid: number(bill.amountPaid) || 0 })
      const date = isoDate(bill.date)
      const invoiceNo = text(bill.invoiceNo, 40) || `OLD-${maxSeq + 1}`
      maxSeq = Math.max(maxSeq, Number(invoiceNo.match(/(\d+)$/)?.[1] ?? 0))
      const inv = await tx.invoice.create({
        data: {
          invoiceNo,
          date,
          dateKey: toDateKey(date),
          customerId: customerMap.get(text(cust.id, 64)) ?? null,
          customerName: text(cust.name, 120) || 'Walk-in Customer',
          customerPhone: text(cust.phone, 40),
          customerAddress: text(cust.address, 500) || null,
          discountType,
          discountValue: number(bill.discountValue) || 0,
          gstInclusive: bill.gstInclusive === true,
          paymentMethod: text(bill.paymentMethod, 20) || 'Cash',
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxable: totals.taxable,
          gst: totals.gst,
          grandTotal: totals.grandTotal,
          balance: totals.grandTotal,
          status: 'Unpaid',
          changeReturned: totals.change,
          notes: text(bill.notes, 1000) || null,
          createdById: userIds,
          createdAt: isoDate(bill.createdAt, date),
          items: { create: items.map((it, position) => ({ ...it, position })) },
        },
      })
      const paid = Math.min(totals.paid, totals.grandTotal)
      if (paid > 0)
        await tx.payment.create({ data: { invoiceId: inv.id, amount: paid, method: inv.paymentMethod === 'Credit' ? 'Cash' : inv.paymentMethod, date, dateKey: toDateKey(date), note: 'Imported' } })
      await syncInvoice(tx, inv.id)
    }
    const counter = Math.max(maxSeq, Math.floor(n(b.invoiceCounter)))
    await tx.counter.upsert({ where: { name: 'invoice' }, create: { name: 'invoice', value: counter }, update: { value: counter } })
    await audit(tx, actor, 'data.import_legacy', 'backup', undefined, { bills: list(b.bills).length, customers: customerMap.size, products: productIds.size })
    return { bills: list(b.bills).length, customers: customerMap.size }
  })
}

/** Deletes all business data. Users, company settings, tax rates and expense categories are kept. */
export async function resetAll(actor: Actor) {
  await longTx(async (tx) => {
    await wipe(tx, true)
    await audit(tx, actor, 'data.reset', 'backup')
  })
}
