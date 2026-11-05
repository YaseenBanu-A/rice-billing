import { computeTotals, PAY_METHODS, settlementStatus, toStockQty } from '../../../shared/billing.ts'
import type { DiscountType, Paged, PaymentInput, PayMethod, Purchase, PurchaseInput } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import { dateKeyWhere } from '../../lib/http.ts'
import { allocateNumber, peekNumber } from '../../lib/numbering.ts'
import { iso, n, nOpt, nul, opt, round2, round3, toDateKey } from '../../lib/num.ts'
import { changeStock } from '../../lib/stock.ts'
import { asObject, fail, isoDate, notFuture, number, requestKey, text } from '../../lib/validate.ts'
import { activeRates, assertRate, getSettings } from '../settings/service.ts'

const include = {
  items: { orderBy: { position: 'asc' } },
  supplier: { select: { name: true } },
  payments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
  user: { select: { name: true } },
} satisfies Prisma.PurchaseInclude

type Row = Prisma.PurchaseGetPayload<{ include: typeof include }>

function toPurchase(r: Row): Purchase {
  const items = r.items.map((i) => ({ id: i.id, productId: i.productId, name: i.name, quantity: n(i.quantity), unit: i.unit, bags: nOpt(i.bags), price: n(i.price), gstRate: n(i.gstRate) }))
  const totals = computeTotals({ items, discountType: r.discountType as DiscountType, discountValue: n(r.discountValue), gstInclusive: r.gstInclusive, amountPaid: n(r.amountPaid) })
  return {
    id: r.id,
    purchaseNo: r.purchaseNo,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    supplierInvoiceNo: opt(r.supplierInvoiceNo),
    date: r.date.toISOString(),
    items,
    discountType: r.discountType as DiscountType,
    discountValue: n(r.discountValue),
    gstInclusive: r.gstInclusive,
    totals,
    amountPaid: n(r.amountPaid),
    balance: n(r.balance),
    status: r.status as Purchase['status'],
    notes: opt(r.notes),
    cancelled: !!r.cancelledAt,
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
    createdByName: r.user?.name,
    createdAt: iso(r.createdAt)!,
  }
}

async function load(db: Tx, id: string) {
  const r = await db.purchase.findUnique({ where: { id }, include })
  if (!r) throw notFound('Purchase')
  return toPurchase(r)
}

export const getPurchase = (id: string) => load(prisma, id)

export function validatePurchase(raw: unknown): PurchaseInput {
  const b = asObject(raw)
  if (!Array.isArray(b.items) || !b.items.length) throw badRequest('Add at least one product', { items: 'No items' })
  if (b.items.length > 300) throw badRequest('A purchase can have at most 300 items')
  const items = b.items.map((x, i) => {
    const o = asObject(x, `items[${i}]`)
    const it = {
      productId: text(o.productId, 64),
      name: text(o.name, 160),
      quantity: number(o.quantity),
      unit: text(o.unit, 10),
      bags: o.bags === undefined || o.bags === null || o.bags === '' ? undefined : number(o.bags),
      price: number(o.price),
      gstRate: number(o.gstRate),
    }
    fail({
      [`items.${i}.productId`]: !it.productId ? `Line ${i + 1}: choose a product` : '',
      [`items.${i}.quantity`]: Number.isNaN(it.quantity) || it.quantity <= 0 ? `Line ${i + 1}: quantity must be more than 0` : '',
      [`items.${i}.price`]: Number.isNaN(it.price) || it.price < 0 ? `Line ${i + 1}: enter the rate` : '',
      [`items.${i}.bags`]: it.bags !== undefined && (Number.isNaN(it.bags) || it.bags < 0) ? `Line ${i + 1}: bags must be zero or more` : '',
      [`items.${i}.gstRate`]: Number.isNaN(it.gstRate) ? `Line ${i + 1}: invalid GST rate` : '',
    })
    return it
  })
  const date = isoDate(b.date)
  const p: PurchaseInput = {
    supplierId: text(b.supplierId, 64),
    supplierInvoiceNo: text(b.supplierInvoiceNo, 60) || undefined,
    date: date.toISOString(),
    items,
    discountType: b.discountType === 'percent' ? 'percent' : 'amount',
    discountValue: number(b.discountValue ?? 0),
    gstInclusive: b.gstInclusive === true,
    amountPaid: number(b.amountPaid ?? 0),
    paymentMethod: (b.paymentMethod ?? 'Cash') as PayMethod,
    notes: text(b.notes, 1000) || undefined,
    clientRequestId: requestKey(b.clientRequestId),
  }
  fail({
    supplierId: !p.supplierId ? 'Choose a supplier' : '',
    discountValue: Number.isNaN(p.discountValue) || p.discountValue < 0 || (p.discountType === 'percent' && p.discountValue > 100) ? 'Invalid discount' : '',
    amountPaid: Number.isNaN(p.amountPaid) || p.amountPaid < 0 ? 'Amount paid must be zero or more' : '',
    paymentMethod: !PAY_METHODS.includes(p.paymentMethod as never) ? 'Invalid payment method' : '',
  })
  notFuture(date)
  return p
}

async function syncPurchase(tx: Tx, id: string) {
  const r = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } })
  const paid = round2(n((await tx.payment.aggregate({ where: { purchaseId: id }, _sum: { amount: true } }))._sum.amount))
  const t = computeTotals({
    items: r.items.map((i) => ({ price: n(i.price), quantity: n(i.quantity), gstRate: n(i.gstRate) })),
    discountType: r.discountType as DiscountType,
    discountValue: n(r.discountValue),
    gstInclusive: r.gstInclusive,
    amountPaid: 0,
  })
  const cancelled = !!r.cancelledAt
  await tx.purchase.update({
    where: { id },
    data: {
      subtotal: t.subtotal,
      discount: t.discount,
      taxable: t.taxable,
      gst: t.gst,
      grandTotal: t.grandTotal,
      amountPaid: paid,
      balance: cancelled ? 0 : round2(Math.max(t.grandTotal - paid, 0)),
      status: cancelled ? 'Cancelled' : settlementStatus(t.grandTotal, paid),
    },
  })
}
export { syncPurchase }

const purchaseTaken = (db: Tx) => async (no: string) => !!(await db.purchase.findUnique({ where: { purchaseNo: no }, select: { id: true } }))

export async function nextPurchaseNo() {
  return peekNumber(prisma, 'purchase', (await getSettings()).purchasePrefix, purchaseTaken(prisma))
}

export async function listPurchases(f: { q?: string; supplierId?: string; from?: string; to?: string; status?: string; limit: number; offset: number }): Promise<Paged<Purchase> & { summary: { grandTotal: number; balance: number } }> {
  const term = f.q?.trim()
  const where: Prisma.PurchaseWhereInput = {
    ...(term
      ? { OR: [{ purchaseNo: { contains: term, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: term, mode: 'insensitive' } }, { supplier: { name: { contains: term, mode: 'insensitive' } } }] }
      : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(dateKeyWhere(f.from, f.to) ? { dateKey: dateKeyWhere(f.from, f.to) } : {}),
  }
  const [rows, total, sums] = await Promise.all([
    prisma.purchase.findMany({ where, include, orderBy: [{ date: 'desc' }, { purchaseNo: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.purchase.count({ where }),
    prisma.purchase.aggregate({ where: { AND: [where, { cancelledAt: null }] }, _sum: { grandTotal: true, balance: true } }),
  ])
  return { items: rows.map(toPurchase), total, summary: { grandTotal: round2(n(sums._sum.grandTotal)), balance: round2(n(sums._sum.balance)) } }
}

/** Records a purchase: stock goes up for every line, the product's purchase rate is updated, and any payment is recorded. */
export async function createPurchase(input: PurchaseInput, actor: Actor): Promise<{ purchase: Purchase; created: boolean }> {
  const settings = await getSettings()
  return transaction(async (tx) => {
    if (input.clientRequestId) {
      const dup = await tx.purchase.findUnique({ where: { clientRequestId: input.clientRequestId }, include })
      if (dup) return { purchase: toPurchase(dup), created: false }
    }
    if (!(await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } }))) throw notFound('Supplier')
    const rates = await activeRates(tx)
    for (const it of input.items) await assertRate(tx, it.gstRate, 'gstRate', rates)
    const products = new Map(
      (await tx.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } })).map((p) => [p.id, { ...p, bagWeight: p.bagWeight === null ? null : n(p.bagWeight) }]),
    )
    for (const it of input.items) if (!products.get(it.productId)?.active) throw badRequest(`${it.name || 'A product'} no longer exists or is archived`)

    const totals = computeTotals({ ...input, amountPaid: input.amountPaid })
    if (input.discountType === 'amount' && input.discountValue > totals.subtotal) throw badRequest('Discount cannot exceed the subtotal')
    const purchaseNo = await allocateNumber(tx, 'purchase', settings.purchasePrefix, purchaseTaken(tx))
    const date = new Date(input.date)
    const pur = await tx.purchase.create({
      data: {
        purchaseNo,
        supplierId: input.supplierId,
        supplierInvoiceNo: input.supplierInvoiceNo ?? null,
        date,
        dateKey: toDateKey(date),
        discountType: input.discountType,
        discountValue: input.discountValue,
        gstInclusive: input.gstInclusive,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxable: totals.taxable,
        gst: totals.gst,
        grandTotal: totals.grandTotal,
        balance: totals.grandTotal,
        status: 'Unpaid',
        notes: nul(input.notes),
        clientRequestId: input.clientRequestId ?? null,
        userId: actor.id,
        items: {
          create: input.items.map((it, position) => ({
            position,
            productId: it.productId,
            name: products.get(it.productId)!.name,
            quantity: round3(it.quantity),
            unit: it.unit || products.get(it.productId)!.unit,
            bags: it.bags ?? null,
            price: round2(it.price),
            gstRate: it.gstRate,
          })),
        },
      },
    })
    for (const it of input.items) {
      const p = products.get(it.productId)!
      await changeStock(tx, { productId: p.id, delta: toStockQty(it.quantity, it.unit, p), type: 'PURCHASE', purchaseId: pur.id, userId: actor.id }, true)
      // latest cost, when bought in the unit stock is kept in
      if (!it.unit || it.unit === p.unit) await tx.product.update({ where: { id: p.id }, data: { purchasePrice: round2(it.price) } })
    }
    const paid = Math.min(round2(input.amountPaid), totals.grandTotal)
    if (paid > 0)
      await tx.payment.create({ data: { purchaseId: pur.id, amount: paid, method: input.paymentMethod, date, dateKey: toDateKey(date), userId: actor.id, note: 'Paid at purchase' } })
    await syncPurchase(tx, pur.id)
    await audit(tx, actor, 'purchase.create', 'purchase', pur.id, { purchaseNo, supplierId: input.supplierId, grandTotal: totals.grandTotal, paid })
    return { purchase: await load(tx, pur.id), created: true }
  })
}

async function lockPurchase(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Purchase" WHERE id = ${id}::uuid FOR UPDATE`
  if (!rows.length) throw notFound('Purchase')
}

export async function addPurchasePayment(id: string, p: PaymentInput, actor: Actor) {
  return transaction(async (tx) => {
    if (p.clientRequestId && (await tx.payment.findUnique({ where: { clientRequestId: p.clientRequestId } }))) return load(tx, id)
    await lockPurchase(tx, id)
    const pur = await tx.purchase.findUniqueOrThrow({ where: { id } })
    if (pur.cancelledAt) throw conflict('This purchase is cancelled')
    if (p.amount > n(pur.balance) + 0.005) throw badRequest(`Amount is more than the balance due (${n(pur.balance).toFixed(2)})`, { amount: 'More than balance due' })
    const date = new Date(p.date ?? Date.now())
    await tx.payment.create({
      data: { purchaseId: id, amount: p.amount, method: p.method, date, dateKey: toDateKey(date), reference: p.reference ?? null, note: p.note ?? null, clientRequestId: p.clientRequestId ?? null, userId: actor.id },
    })
    await syncPurchase(tx, id)
    await audit(tx, actor, 'payment.create', 'purchase', id, { purchaseNo: pur.purchaseNo, amount: p.amount, method: p.method })
    return load(tx, id)
  })
}

/** Cancels a purchase: its stock is removed again (refused if already sold, unless negative stock is allowed). */
export async function cancelPurchase(id: string, reason: string, actor: Actor) {
  const settings = await getSettings()
  return transaction(async (tx) => {
    await lockPurchase(tx, id)
    const pur = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: { include: { product: true } } } })
    if (pur.cancelledAt) throw conflict('This purchase is already cancelled')
    for (const it of pur.items) {
      const p = { unit: it.product.unit, bagWeight: it.product.bagWeight === null ? null : n(it.product.bagWeight) }
      await changeStock(tx, { productId: it.productId, delta: -toStockQty(n(it.quantity), it.unit, p), type: 'PURCHASE_CANCEL', purchaseId: id, userId: actor.id, note: `Purchase ${pur.purchaseNo} cancelled` }, settings.allowNegativeStock)
    }
    const paid = n(pur.amountPaid)
    if (paid > 0)
      await tx.payment.create({ data: { purchaseId: id, kind: 'REFUND', amount: -paid, method: 'Cash', date: new Date(), dateKey: toDateKey(new Date()), userId: actor.id, note: 'Returned by supplier on cancellation' } })
    await tx.purchase.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason } })
    await syncPurchase(tx, id)
    await audit(tx, actor, 'purchase.cancel', 'purchase', id, { purchaseNo: pur.purchaseNo, reason })
    return load(tx, id)
  })
}
