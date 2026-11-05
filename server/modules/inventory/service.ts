import type { MovementType, Paged, StockMovement } from '../../../shared/types.ts'
import { prisma, transaction } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { badRequest, notFound } from '../../lib/errors.ts'
import { n, opt, round2, round3 } from '../../lib/num.ts'
import { changeStock } from '../../lib/stock.ts'
import { asObject, fail, number, text } from '../../lib/validate.ts'
import { getSettings } from '../settings/service.ts'

const TYPES: MovementType[] = ['OPENING', 'PURCHASE', 'PURCHASE_CANCEL', 'SALE', 'SALE_EDIT', 'SALE_CANCEL', 'SALE_RETURN', 'ADJUSTMENT']

export interface MovementFilters {
  productId?: string
  type?: string
  from?: string
  to?: string
  limit: number
  offset: number
}

export async function listMovements(f: MovementFilters): Promise<Paged<StockMovement>> {
  if (f.type && !TYPES.includes(f.type as MovementType)) throw badRequest(`type must be one of ${TYPES.join(', ')}`)
  const where = {
    ...(f.productId ? { productId: f.productId } : {}),
    ...(f.type ? { type: f.type as MovementType } : {}),
    ...(f.from || f.to
      ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999`) } : {}) } }
      : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { id: 'desc' },
      take: f.limit,
      skip: f.offset,
      include: { product: { select: { name: true, unit: true } }, user: { select: { name: true } } },
    }),
    prisma.stockMovement.count({ where }),
  ])
  // document numbers for the "Reference" column
  const ids = (k: 'invoiceId' | 'purchaseId' | 'returnId') => [...new Set(rows.map((r) => r[k]).filter((x): x is string => !!x))]
  const [inv, pur, ret] = await Promise.all([
    prisma.invoice.findMany({ where: { id: { in: ids('invoiceId') } }, select: { id: true, invoiceNo: true } }),
    prisma.purchase.findMany({ where: { id: { in: ids('purchaseId') } }, select: { id: true, purchaseNo: true } }),
    prisma.salesReturn.findMany({ where: { id: { in: ids('returnId') } }, select: { id: true, returnNo: true } }),
  ])
  const refs = new Map<string, string>([...inv.map((x) => [x.id, x.invoiceNo] as const), ...pur.map((x) => [x.id, x.purchaseNo] as const), ...ret.map((x) => [x.id, x.returnNo] as const)])
  return {
    total,
    items: rows.map((r) => ({
      id: String(r.id),
      productId: r.productId,
      productName: r.product.name,
      unit: r.product.unit,
      type: r.type,
      quantity: n(r.quantity),
      balanceAfter: n(r.balanceAfter),
      reference: refs.get(r.returnId ?? '') ?? refs.get(r.purchaseId ?? '') ?? refs.get(r.invoiceId ?? ''),
      note: opt(r.note),
      userName: r.user?.name,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

/**
 * Manual correction after a physical count, damage or sample.
 * mode "set" = the counted stock; "add"/"remove" = a quantity in the product's unit.
 */
export async function adjustStock(raw: unknown, actor: Actor) {
  const b = asObject(raw)
  const a = { productId: text(b.productId, 64), mode: text(b.mode, 10), quantity: number(b.quantity), note: text(b.note, 300) }
  fail({
    productId: !a.productId ? 'Choose a product' : '',
    mode: !['set', 'add', 'remove'].includes(a.mode) ? 'Choose set, add or remove' : '',
    quantity: Number.isNaN(a.quantity) || a.quantity < 0 || (a.mode !== 'set' && a.quantity === 0) ? 'Enter a quantity' : '',
    note: !a.note ? 'Give a reason for the adjustment (e.g. physical count, damaged bags)' : '',
  })
  const allowNegative = (await getSettings()).allowNegativeStock
  return transaction(async (tx) => {
    // lock the product row so a sale can't slip in between reading and setting the stock
    const rows = await tx.$queryRaw<{ stock: unknown; name: string }[]>`SELECT stock, name FROM "Product" WHERE id = ${a.productId}::uuid FOR UPDATE`
    if (!rows.length) throw notFound('Product')
    const current = n(rows[0].stock)
    const delta = round3(a.mode === 'set' ? a.quantity - current : a.mode === 'add' ? a.quantity : -a.quantity)
    if (delta === 0) throw badRequest('Stock is already at that quantity')
    await changeStock(tx, { productId: a.productId, delta, type: 'ADJUSTMENT', note: a.note, userId: actor.id }, allowNegative || a.mode === 'set')
    await audit(tx, actor, 'stock.adjust', 'product', a.productId, { name: rows[0].name, from: current, delta, note: a.note })
    return { productId: a.productId, name: rows[0].name, stock: round3(current + delta), delta }
  })
}

export async function stockSummary() {
  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, stock: true, reorderLevel: true, purchasePrice: true } })
  const lowStock = products.filter((p) => n(p.stock) <= n(p.reorderLevel))
  return {
    products: products.length,
    stockValue: round2(products.reduce((s, p) => s + Math.max(n(p.stock), 0) * n(p.purchasePrice), 0)),
    lowStock: lowStock.map((p) => ({ id: p.id, name: p.name, unit: p.unit, stock: n(p.stock), reorderLevel: n(p.reorderLevel) })),
  }
}
