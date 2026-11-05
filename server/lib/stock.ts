import type { Tx } from '../db.ts'
import type { MovementType } from '../generated/prisma/enums.ts'
import { conflict, notFound } from './errors.ts'
import { n, round3 } from './num.ts'

export interface StockChange {
  productId: string
  /** positive adds stock, negative removes it (in the product's own unit) */
  delta: number
  type: MovementType
  invoiceId?: string
  purchaseId?: string
  returnId?: string
  note?: string
  userId?: string
}

/**
 * Changes a product's stock and records the movement. The availability check and the update are a single
 * SQL statement, so two people selling the last bag at the same moment can't both succeed.
 */
export async function changeStock(tx: Tx, c: StockChange, allowNegative: boolean) {
  const delta = round3(c.delta)
  if (delta === 0) return
  const where = delta < 0 && !allowNegative ? { id: c.productId, stock: { gte: -delta } } : { id: c.productId }
  const { count } = await tx.product.updateMany({ where, data: { stock: { increment: delta } } })
  if (count === 0) {
    const p = await tx.product.findUnique({ where: { id: c.productId }, select: { name: true, stock: true, unit: true } })
    if (!p) throw notFound('Product')
    throw conflict(`Not enough stock for ${p.name}: ${n(p.stock)} ${p.unit} available, ${-delta} ${p.unit} needed`, 'insufficient_stock')
  }
  const after = await tx.product.findUniqueOrThrow({ where: { id: c.productId }, select: { stock: true } })
  await tx.stockMovement.create({
    data: {
      productId: c.productId,
      type: c.type,
      quantity: delta,
      balanceAfter: after.stock,
      invoiceId: c.invoiceId ?? null,
      purchaseId: c.purchaseId ?? null,
      returnId: c.returnId ?? null,
      note: c.note ?? null,
      userId: c.userId ?? null,
    },
  })
}
