import { computeTotals, returnValue, settlementStatus, toStockQty } from '../../../shared/billing.ts'
import type { Bill, BillInput, BillItem, BillPage, PaymentInput, PaymentStatus, PayMethod, ReturnInput } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import { dateKeyWhere } from '../../lib/http.ts'
import { allocateNumber, peekNumber } from '../../lib/numbering.ts'
import { iso, n, nOpt, nul, opt, round2, round3, toDateKey } from '../../lib/num.ts'
import { changeStock } from '../../lib/stock.ts'
import { phoneDigits } from '../../lib/validate.ts'
import { insertCustomer } from '../customers/service.ts'
import { activeRates, assertRate, getSettings } from '../settings/service.ts'

/* ---------- reading ---------- */

export const billInclude = {
  items: { orderBy: { position: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
  returns: { orderBy: { createdAt: 'asc' }, include: { items: true, user: { select: { name: true } } } },
  createdBy: { select: { name: true } },
} satisfies Prisma.InvoiceInclude

type Row = Prisma.InvoiceGetPayload<{ include: typeof billInclude }>

export function toBill(r: Row): Bill {
  const returned = new Map<string, number>()
  for (const ret of r.returns) for (const it of ret.items) returned.set(it.invoiceItemId, (returned.get(it.invoiceItemId) ?? 0) + n(it.quantity))

  const items: BillItem[] = r.items.map((it) => ({
    id: it.id,
    productId: it.productId ?? '',
    name: it.name,
    sku: it.sku,
    hsnCode: opt(it.hsnCode),
    price: n(it.price),
    quantity: n(it.quantity),
    unit: it.unit || undefined,
    bags: nOpt(it.bags),
    gstRate: n(it.gstRate),
    returnedQty: returned.get(it.id) ?? 0,
  }))
  const base = { items, discountType: r.discountType as Bill['discountType'], discountValue: n(r.discountValue), gstInclusive: r.gstInclusive }
  const paid = n(r.amountPaid)
  const returnTotal = n(r.returnTotal)
  const cancelled = !!r.cancelledAt
  // totals are derived from the stored lines so they can never drift from the items
  const totals = computeTotals({ ...base, amountPaid: paid + n(r.changeReturned) })
  totals.balance = cancelled ? 0 : round2(Math.max(totals.grandTotal - returnTotal - paid, 0))

  return {
    id: r.id,
    invoiceNo: r.invoiceNo,
    date: r.date.toISOString(),
    customer: { id: opt(r.customerId), name: r.customerName, phone: r.customerPhone, address: opt(r.customerAddress), gstin: opt(r.customerGstin) },
    ...base,
    paymentMethod: r.paymentMethod as Bill['paymentMethod'],
    amountPaid: paid,
    totals,
    status: cancelled ? 'Cancelled' : settlementStatus(totals.grandTotal - returnTotal, paid),
    notes: opt(r.notes),
    returnTotal,
    cancelled,
    cancelledAt: iso(r.cancelledAt),
    cancelReason: opt(r.cancelReason),
    payments: r.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: n(p.amount),
      method: p.method,
      date: p.date.toISOString(),
      reference: opt(p.reference),
      note: opt(p.note),
      userName: p.user?.name,
      createdAt: p.createdAt.toISOString(),
    })),
    returns: r.returns.map((ret) => ({
      id: ret.id,
      returnNo: ret.returnNo,
      date: ret.date.toISOString(),
      reason: opt(ret.reason),
      total: n(ret.total),
      refund: n(ret.refund),
      refundMethod: opt(ret.refundMethod),
      userName: ret.user?.name,
      items: ret.items.map((x) => ({ invoiceItemId: x.invoiceItemId, name: x.name, quantity: n(x.quantity), amount: n(x.amount) })),
    })),
    version: r.version,
    createdByName: r.createdBy?.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

async function loadBill(db: Tx, id: string): Promise<Bill> {
  const r = await db.invoice.findUnique({ where: { id }, include: billInclude })
  if (!r) throw notFound('Bill')
  return toBill(r)
}

export const getBill = (id: string) => loadBill(prisma, id)

export interface BillFilters {
  q?: string
  status?: PaymentStatus
  from?: string
  to?: string
  customerId?: string
  limit: number
  offset: number
}

export async function listBills(f: BillFilters): Promise<BillPage> {
  const term = f.q?.trim()
  const digits = term ? phoneDigits(term) : ''
  const where: Prisma.InvoiceWhereInput = {
    ...(term
      ? {
          OR: [
            { invoiceNo: { contains: term, mode: 'insensitive' } },
            { customerName: { contains: term, mode: 'insensitive' } },
            { customerPhone: { contains: term } },
            ...(digits.length >= 3 ? [{ customer: { phoneDigits: { contains: digits } } }] : []),
          ],
        }
      : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(dateKeyWhere(f.from, f.to) ? { dateKey: dateKeyWhere(f.from, f.to) } : {}),
  }
  const [rows, total, sums] = await Promise.all([
    prisma.invoice.findMany({ where, include: billInclude, orderBy: [{ date: 'desc' }, { invoiceNo: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { AND: [where, { cancelledAt: null }] }, _sum: { grandTotal: true, returnTotal: true, balance: true } }),
  ])
  return {
    items: rows.map(toBill),
    total,
    summary: { grandTotal: round2(n(sums._sum.grandTotal) - n(sums._sum.returnTotal)), balance: round2(n(sums._sum.balance)) },
  }
}

/** Item names billed before, with their latest rate and unit, for the item box suggestions */
export async function recentItemNames() {
  const rows = await prisma.$queryRaw<{ name: string; price: unknown; unit: string }[]>`
    SELECT name, price, unit FROM (
      SELECT DISTINCT ON (lower(ii.name)) ii.name, ii.price, ii.unit, i.date
      FROM "InvoiceItem" ii JOIN "Invoice" i ON i.id = ii."invoiceId"
      ORDER BY lower(ii.name), i.date DESC
    ) t ORDER BY date DESC LIMIT 300`
  return rows.map((r) => ({ name: r.name, price: n(r.price), unit: r.unit }))
}

const invoiceTaken = (db: Tx) => async (no: string) => !!(await db.invoice.findUnique({ where: { invoiceNo: no }, select: { id: true } }))

export async function nextInvoiceNo() {
  return peekNumber(prisma, 'invoice', (await getSettings()).invoicePrefix, invoiceTaken(prisma))
}

/* ---------- shared helpers ---------- */

/** Row lock: payments, edits, returns and cancellations of one bill happen one at a time. */
async function lockInvoice(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${id}::uuid FOR UPDATE`
  if (!rows.length) throw notFound('Bill')
}

/** "Credit" (pay later) isn't a way of paying; an advance on such a bill is taken as cash. */
const payMethodFor = (billMethod: string): PayMethod => (billMethod === 'Credit' ? 'Cash' : (billMethod as PayMethod))

/**
 * Recomputes a bill's stored figures from its lines, payments and returns, and bumps its version.
 * Every change to a bill ends here, so the stored totals used by reports always agree with the lines.
 */
export async function syncInvoice(tx: Tx, id: string) {
  const r = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } })
  const [pay, ret] = await Promise.all([
    tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } }),
    tx.salesReturn.aggregate({ where: { invoiceId: id }, _sum: { total: true } }),
  ])
  const paid = round2(n(pay._sum.amount))
  const returnTotal = round2(n(ret._sum.total))
  const totals = computeTotals({
    items: r.items.map((i) => ({ price: n(i.price), quantity: n(i.quantity), gstRate: n(i.gstRate) })),
    discountType: r.discountType as 'amount' | 'percent',
    discountValue: n(r.discountValue),
    gstInclusive: r.gstInclusive,
    amountPaid: 0,
  })
  const cancelled = !!r.cancelledAt
  const net = totals.grandTotal - returnTotal
  await tx.invoice.update({
    where: { id },
    data: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable: totals.taxable,
      gst: totals.gst,
      grandTotal: totals.grandTotal,
      amountPaid: paid,
      returnTotal,
      balance: cancelled ? 0 : round2(Math.max(net - paid, 0)),
      status: cancelled ? 'Cancelled' : settlementStatus(net, paid),
      version: { increment: 1 },
    },
  })
}

type ProductInfo = { id: string; name: string; unit: string; bagWeight: number | null; hsnCode: string; active: boolean }

async function loadProducts(tx: Tx, ids: string[]): Promise<Map<string, ProductInfo>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const rows = await tx.product.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, unit: true, bagWeight: true, hsnCode: true, active: true } })
  return new Map(rows.map((p) => [p.id, { ...p, bagWeight: p.bagWeight === null ? null : n(p.bagWeight) }]))
}

/** Quantity per product in the product's own stock unit */
function stockQtyByProduct(lines: { productId?: string | null; quantity: number; unit?: string | null }[], products: Map<string, ProductInfo>) {
  const out = new Map<string, number>()
  for (const l of lines) {
    const p = l.productId ? products.get(l.productId) : undefined
    if (!p) continue
    out.set(p.id, round3((out.get(p.id) ?? 0) + toStockQty(l.quantity, l.unit ?? undefined, p)))
  }
  return out
}

function computeFor(input: BillInput) {
  const totals = computeTotals(input)
  if (input.discountType === 'amount' && input.discountValue > totals.subtotal)
    throw badRequest('Discount cannot exceed the subtotal', { discountValue: 'Discount cannot exceed the subtotal' })
  return totals
}

async function checkItems(tx: Tx, input: BillInput, allowArchived: Set<string> = new Set()) {
  const rates = await activeRates(tx)
  for (const it of input.items) await assertRate(tx, it.gstRate, 'gstRate', rates)
  const products = await loadProducts(tx, input.items.map((i) => i.productId))
  for (const it of input.items) {
    if (!it.productId) continue
    const p = products.get(it.productId)
    if (!p) throw badRequest(`${it.name}: this product no longer exists. Remove it and add it again.`)
    if (!p.active && !allowArchived.has(p.id)) throw badRequest(`${it.name}: this product is archived`)
  }
  return products
}

const itemRows = (input: BillInput, products: Map<string, ProductInfo>) =>
  input.items.map((it, position) => ({
    position,
    productId: it.productId || null,
    name: it.name,
    sku: it.sku ?? '',
    hsnCode: it.hsnCode ?? (it.productId ? (products.get(it.productId)?.hsnCode ?? '') : ''),
    price: round2(it.price),
    quantity: round3(it.quantity),
    unit: it.unit ?? '',
    bags: it.bags ?? null,
    gstRate: it.gstRate,
  }))

/** Links the bill to a customer record, creating one when asked ("Save as new customer"). */
async function resolveCustomer(tx: Tx, input: BillInput, actor: Actor): Promise<string | null> {
  const c = input.customer
  if (c.id && (await tx.customer.findUnique({ where: { id: c.id }, select: { id: true } }))) return c.id
  if (!input.saveCustomer || !c.phone || c.name === 'Walk-in Customer') return null
  const existing = await tx.customer.findUnique({ where: { phoneDigits: phoneDigits(c.phone) }, select: { id: true } })
  if (existing) return existing.id
  return (await insertCustomer(tx, { name: c.name, phone: c.phone, email: '', address: c.address ?? '', gstin: c.gstin ?? '' }, actor)).id
}

const header = (input: BillInput, customerId: string | null) => ({
  date: new Date(input.date),
  dateKey: toDateKey(input.date),
  customerId,
  customerName: input.customer.name,
  customerPhone: input.customer.phone,
  customerAddress: nul(input.customer.address),
  customerGstin: nul(input.customer.gstin),
  discountType: input.discountType,
  discountValue: input.discountValue,
  gstInclusive: input.gstInclusive,
  paymentMethod: input.paymentMethod,
  notes: nul(input.notes),
})

const isUniqueClash = (e: unknown, field: string) => {
  const err = e as { code?: string; meta?: { target?: unknown; driverAdapterError?: unknown } }
  return err?.code === 'P2002' && JSON.stringify(err.meta ?? {}).includes(field)
}

/* ---------- create / edit ---------- */

/**
 * Creates a bill in one transaction: invoice number, lines, stock deduction, first payment and audit entry.
 * Resending the same `clientRequestId` (double click, retry after a network drop) returns the first bill.
 */
export async function createBill(input: BillInput, actor: Actor): Promise<{ bill: Bill; created: boolean }> {
  const settings = await getSettings()
  try {
    return await transaction(async (tx) => {
      if (input.clientRequestId) {
        const existing = await tx.invoice.findUnique({ where: { clientRequestId: input.clientRequestId }, include: billInclude })
        if (existing) return { bill: toBill(existing), created: false }
      }
      const totals = computeFor(input)
      const products = await checkItems(tx, input)
      const invoiceNo = await allocateNumber(tx, 'invoice', settings.invoicePrefix, invoiceTaken(tx))
      const customerId = await resolveCustomer(tx, input, actor)
      const paid = Math.min(totals.paid, totals.grandTotal)

      const inv = await tx.invoice.create({
        data: {
          ...header(input, customerId),
          invoiceNo,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxable: totals.taxable,
          gst: totals.gst,
          grandTotal: totals.grandTotal,
          balance: totals.grandTotal,
          status: 'Unpaid',
          changeReturned: round2(Math.max(totals.paid - totals.grandTotal, 0)),
          clientRequestId: input.clientRequestId ?? null,
          createdById: actor.id,
          items: { create: itemRows(input, products) },
        },
      })
      for (const [productId, qty] of stockQtyByProduct(input.items, products))
        await changeStock(tx, { productId, delta: -qty, type: 'SALE', invoiceId: inv.id, userId: actor.id }, settings.allowNegativeStock)
      if (paid > 0)
        await tx.payment.create({
          data: { invoiceId: inv.id, amount: paid, method: payMethodFor(input.paymentMethod), date: inv.date, dateKey: inv.dateKey, userId: actor.id, note: 'Paid at billing' },
        })
      await syncInvoice(tx, inv.id)
      await audit(tx, actor, 'invoice.create', 'invoice', inv.id, { invoiceNo, grandTotal: totals.grandTotal, paid, customer: input.customer.name })
      return { bill: await loadBill(tx, inv.id), created: true }
    })
  } catch (e) {
    // the same request arrived twice at the same moment: the other one won, return its bill
    if (input.clientRequestId && isUniqueClash(e, 'clientRequestId')) {
      const existing = await prisma.invoice.findUnique({ where: { clientRequestId: input.clientRequestId }, include: billInclude })
      if (existing) return { bill: toBill(existing), created: false }
    }
    throw e
  }
}

/**
 * Edits a saved bill (the invoice number stays). Stock is corrected by the difference per product, and
 * the amount received is brought to the new figure with a payment or refund entry, so history is kept.
 * `version` must match: if someone else changed the bill meanwhile, the edit is refused instead of overwriting.
 */
export async function updateBill(id: string, input: BillInput, actor: Actor): Promise<Bill> {
  const settings = await getSettings()
  return transaction(async (tx) => {
    await lockInvoice(tx, id)
    const old = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: true, _count: { select: { returns: true } } } })
    if (old.cancelledAt) throw conflict('This bill is cancelled and cannot be edited')
    if (old._count.returns) throw conflict('Goods have been returned against this bill, so it can no longer be edited')
    if (input.version !== undefined && input.version !== old.version)
      throw conflict('This bill was changed by someone else. Reload it to see the latest version.', 'version_conflict')

    const totals = computeFor(input)
    const oldLines = old.items.map((i) => ({ productId: i.productId, quantity: n(i.quantity), unit: i.unit }))
    // products already on the bill may be edited even if archived since
    const products = await checkItems(tx, input, new Set(old.items.map((i) => i.productId ?? '')))
    const allProducts = new Map([...(await loadProducts(tx, oldLines.map((l) => l.productId ?? ''))), ...products])
    const before = stockQtyByProduct(oldLines, allProducts)
    const after = stockQtyByProduct(input.items, allProducts)
    for (const pid of new Set([...before.keys(), ...after.keys()])) {
      const sold = round3((after.get(pid) ?? 0) - (before.get(pid) ?? 0))
      if (sold) await changeStock(tx, { productId: pid, delta: -sold, type: 'SALE_EDIT', invoiceId: id, userId: actor.id, note: `Bill ${old.invoiceNo} edited` }, settings.allowNegativeStock)
    }

    const customerId = await resolveCustomer(tx, input, actor)
    await tx.invoice.update({ where: { id }, data: { ...header(input, customerId), changeReturned: round2(Math.max(totals.paid - totals.grandTotal, 0)) } })
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
    await tx.invoiceItem.createMany({ data: itemRows(input, products).map((r) => ({ ...r, invoiceId: id })) })

    const current = round2(n((await tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } }))._sum.amount))
    const diff = round2(Math.min(totals.paid, totals.grandTotal) - current)
    if (Math.abs(diff) >= 0.01)
      await tx.payment.create({
        data: {
          invoiceId: id,
          kind: diff > 0 ? 'PAYMENT' : 'REFUND',
          amount: diff,
          method: payMethodFor(input.paymentMethod),
          date: new Date(),
          dateKey: toDateKey(new Date()),
          userId: actor.id,
          note: 'Bill edited',
        },
      })
    await syncInvoice(tx, id)
    await audit(tx, actor, 'invoice.update', 'invoice', id, { invoiceNo: old.invoiceNo, grandTotal: { from: n(old.grandTotal), to: totals.grandTotal }, items: input.items.length })
    return loadBill(tx, id)
  })
}

/* ---------- payments ---------- */

/** Records money received against a bill (partial or full). Can't exceed the balance due. */
export async function addPayment(id: string, p: PaymentInput, actor: Actor): Promise<{ bill: Bill; created: boolean }> {
  try {
    return await transaction(async (tx) => {
      if (p.clientRequestId) {
        const dup = await tx.payment.findUnique({ where: { clientRequestId: p.clientRequestId } })
        if (dup) return { bill: await loadBill(tx, dup.invoiceId ?? id), created: false }
      }
      await lockInvoice(tx, id)
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id } })
      if (inv.cancelledAt) throw conflict('This bill is cancelled')
      const balance = n(inv.balance)
      if (balance <= 0) throw conflict('This bill is already fully paid')
      if (p.amount > balance + 0.005) throw badRequest(`Amount is more than the balance due (${balance.toFixed(2)})`, { amount: 'More than balance due' })
      const date = new Date(p.date ?? Date.now())
      await tx.payment.create({
        data: {
          invoiceId: id,
          amount: p.amount,
          method: p.method,
          date,
          dateKey: toDateKey(date),
          reference: p.reference ?? null,
          note: p.note ?? null,
          clientRequestId: p.clientRequestId ?? null,
          userId: actor.id,
        },
      })
      await syncInvoice(tx, id)
      await audit(tx, actor, 'payment.create', 'invoice', id, { invoiceNo: inv.invoiceNo, amount: p.amount, method: p.method })
      return { bill: await loadBill(tx, id), created: true }
    })
  } catch (e) {
    if (p.clientRequestId && isUniqueClash(e, 'clientRequestId')) return { bill: await getBill(id), created: false }
    throw e
  }
}

/* ---------- cancel, delete, return ---------- */

/** Goods still with the customer, per product, in stock units: sold minus already returned */
async function unreturnedStock(tx: Tx, id: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: { include: { returnItems: true } } } })
  const lines = inv.items.map((i) => ({ productId: i.productId, unit: i.unit, quantity: n(i.quantity) - i.returnItems.reduce((s, r) => s + n(r.quantity), 0) }))
  return { inv, qty: stockQtyByProduct(lines, await loadProducts(tx, lines.map((l) => l.productId ?? ''))) }
}

/**
 * Cancels a bill: goods go back into stock, money received is refunded (recorded as a refund entry), and the
 * bill stays in history marked Cancelled with the reason. The invoice number is never reused.
 */
export async function cancelBill(id: string, body: { reason: string; refundMethod?: PayMethod }, actor: Actor): Promise<Bill> {
  return transaction(async (tx) => {
    await lockInvoice(tx, id)
    const { inv, qty } = await unreturnedStock(tx, id)
    if (inv.cancelledAt) throw conflict('This bill is already cancelled')
    for (const [productId, q] of qty)
      await changeStock(tx, { productId, delta: q, type: 'SALE_CANCEL', invoiceId: id, userId: actor.id, note: `Bill ${inv.invoiceNo} cancelled` }, true)
    const paid = round2(n((await tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } }))._sum.amount))
    if (paid > 0)
      await tx.payment.create({
        data: {
          invoiceId: id,
          kind: 'REFUND',
          amount: -paid,
          method: body.refundMethod ?? payMethodFor(inv.paymentMethod),
          date: new Date(),
          dateKey: toDateKey(new Date()),
          userId: actor.id,
          note: 'Refund on cancellation',
        },
      })
    await tx.invoice.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: body.reason } })
    await syncInvoice(tx, id)
    await audit(tx, actor, 'invoice.cancel', 'invoice', id, { invoiceNo: inv.invoiceNo, reason: body.reason, refunded: paid })
    return loadBill(tx, id)
  })
}

/** Permanently removes a bill (administrators only). Unreturned goods go back into stock first. */
export async function deleteBill(id: string, actor: Actor): Promise<{ invoiceNo: string }> {
  return transaction(async (tx) => {
    await lockInvoice(tx, id)
    const { inv, qty } = await unreturnedStock(tx, id)
    if (!inv.cancelledAt)
      for (const [productId, q] of qty)
        await changeStock(tx, { productId, delta: q, type: 'SALE_CANCEL', invoiceId: id, userId: actor.id, note: `Bill ${inv.invoiceNo} deleted` }, true)
    const snapshot = await loadBill(tx, id)
    await tx.invoice.delete({ where: { id } })
    await audit(tx, actor, 'invoice.delete', 'invoice', id, {
      invoiceNo: inv.invoiceNo,
      customer: inv.customerName,
      grandTotal: n(inv.grandTotal),
      paid: n(inv.amountPaid),
      items: snapshot.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    })
    return { invoiceNo: inv.invoiceNo }
  })
}

/**
 * Sales return (credit note): goods come back into stock and the bill's value drops by what they were sold for
 * (same discount and GST). If the customer had already paid more than the new value, the excess is refunded.
 */
export async function createReturn(id: string, input: ReturnInput, actor: Actor): Promise<Bill> {
  const settings = await getSettings()
  return transaction(async (tx) => {
    await lockInvoice(tx, id)
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: { include: { returnItems: true } } } })
    if (inv.cancelledAt) throw conflict('This bill is cancelled')

    const lines = input.items.map((x) => {
      const item = inv.items.find((i) => i.id === x.invoiceItemId)
      if (!item) throw badRequest('Returned item is not on this bill')
      const left = round3(n(item.quantity) - item.returnItems.reduce((s, r) => s + n(r.quantity), 0))
      if (x.quantity > left + 1e-9) throw badRequest(`${item.name}: only ${left} ${item.unit} can still be returned`)
      return { item, quantity: round3(x.quantity) }
    })
    const value = returnValue(
      lines.map((l) => ({ price: n(l.item.price), quantity: l.quantity, gstRate: n(l.item.gstRate) })),
      { subtotal: n(inv.subtotal), discount: n(inv.discount), gstInclusive: inv.gstInclusive },
    )
    const returnNo = await allocateNumber(tx, 'return', settings.returnPrefix, async (no) => !!(await tx.salesReturn.findUnique({ where: { returnNo: no }, select: { id: true } })))
    const date = new Date(input.date ?? Date.now())
    const ret = await tx.salesReturn.create({
      data: {
        returnNo,
        invoiceId: id,
        date,
        dateKey: toDateKey(date),
        reason: input.reason ?? null,
        total: value.total,
        taxable: value.taxable,
        gst: value.gst,
        userId: actor.id,
        items: { create: lines.map((l, i) => ({ invoiceItemId: l.item.id, productId: l.item.productId, name: l.item.name, quantity: l.quantity, amount: value.lines[i] })) },
      },
    })
    const products = await loadProducts(tx, lines.map((l) => l.item.productId ?? ''))
    for (const [productId, q] of stockQtyByProduct(lines.map((l) => ({ productId: l.item.productId, unit: l.item.unit, quantity: l.quantity })), products))
      await changeStock(tx, { productId, delta: q, type: 'SALE_RETURN', invoiceId: id, returnId: ret.id, userId: actor.id, note: `Return ${returnNo}` }, true)

    // refund what was paid beyond the bill's new value
    const returned = round2(n(inv.returnTotal) + value.total)
    const paid = round2(n((await tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } }))._sum.amount))
    const refund = round2(Math.max(paid - (n(inv.grandTotal) - returned), 0))
    if (refund > 0) {
      const method = input.refundMethod ?? payMethodFor(inv.paymentMethod)
      await tx.payment.create({ data: { invoiceId: id, kind: 'REFUND', amount: -refund, method, date, dateKey: toDateKey(date), userId: actor.id, note: `Refund for ${returnNo}` } })
      await tx.salesReturn.update({ where: { id: ret.id }, data: { refund, refundMethod: method } })
    }
    await syncInvoice(tx, id)
    await audit(tx, actor, 'invoice.return', 'invoice', id, { invoiceNo: inv.invoiceNo, returnNo, total: value.total, refund })
    return loadBill(tx, id)
  })
}
