import { transaction } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import { n } from '../../lib/num.ts'
import { syncPurchase } from '../purchases/service.ts'
import { syncInvoice } from './service.ts'

/**
 * Removes a payment entered by mistake (administrators only). The bill or purchase balance is recomputed
 * and the removed entry is kept in the audit log.
 */
export async function voidPayment(paymentId: string, actor: Actor): Promise<{ invoiceId?: string; purchaseId?: string }> {
  return transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!p) throw notFound('Payment')
    if (p.invoiceId) {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${p.invoiceId}::uuid FOR UPDATE`
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } })
      if (inv.cancelledAt) throw conflict('Payments on a cancelled bill cannot be changed')
      await tx.payment.delete({ where: { id: paymentId } })
      await syncInvoice(tx, p.invoiceId)
      await audit(tx, actor, 'payment.void', 'invoice', p.invoiceId, { invoiceNo: inv.invoiceNo, amount: n(p.amount), method: p.method, date: p.date })
      return { invoiceId: p.invoiceId }
    }
    if (p.purchaseId) {
      await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${p.purchaseId}::uuid FOR UPDATE`
      const pur = await tx.purchase.findUniqueOrThrow({ where: { id: p.purchaseId } })
      if (pur.cancelledAt) throw conflict('Payments on a cancelled purchase cannot be changed')
      await tx.payment.delete({ where: { id: paymentId } })
      await syncPurchase(tx, p.purchaseId)
      await audit(tx, actor, 'payment.void', 'purchase', p.purchaseId, { purchaseNo: pur.purchaseNo, amount: n(p.amount), method: p.method })
      return { purchaseId: p.purchaseId }
    }
    throw notFound('Payment')
  })
}
