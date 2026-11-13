import { computeTotals, settlementStatus, toStockQty } from '../../shared/billing.ts'
import { round2 } from '../../shared/util.ts'
import type { Bill, BillInput, PaymentInput, PaymentRecord, PayMethod, Product } from '../types'

/*
 * How a bill looks after changes made offline, before the server has them. Mirrors the server's rules
 * (server/modules/invoices/service.ts): the same totals, the same payment entries, the same status. The server
 * recomputes everything when the change arrives, so these figures are only ever a preview of the same result.
 */

/** Version of a bill that exists only in this browser (the server's versions start at 1) */
export const LOCAL_VERSION = 0

/** Number shown until the server assigns the real, sequential invoice number */
export const pendingInvoiceNo = (id: string) => `PENDING-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`
export const isPendingInvoiceNo = (no: string) => no.startsWith('PENDING-')

/** "Credit" (pay later) isn't a way of paying; an advance on such a bill is taken as cash (same as the server) */
const payMethodFor = (m: string): PayMethod => (m === 'Credit' ? 'Cash' : (m as PayMethod))

const payment = (amount: number, method: string, note: string, userName: string, date = new Date().toISOString()): PaymentRecord => ({
  id: crypto.randomUUID(),
  kind: amount < 0 ? 'REFUND' : 'PAYMENT',
  amount,
  method,
  date,
  note,
  userName,
  createdAt: new Date().toISOString(),
})

/** Totals, balance and status from the lines and the payments recorded so far */
function settle(bill: Omit<Bill, 'totals' | 'status' | 'amountPaid'>, changeReturned: number): Bill {
  const paid = round2(bill.payments.reduce((s, p) => s + p.amount, 0))
  const totals = computeTotals({ ...bill, amountPaid: paid + changeReturned })
  totals.balance = bill.cancelled ? 0 : round2(Math.max(totals.grandTotal - bill.returnTotal - paid, 0))
  return { ...bill, amountPaid: paid, totals, status: bill.cancelled ? 'Cancelled' : settlementStatus(totals.grandTotal - bill.returnTotal, paid) }
}

const linesOf = (input: BillInput) =>
  input.items.map((it) => ({ ...it, id: it.id ?? crypto.randomUUID(), price: round2(it.price), returnedQty: 0 }))

/** A new bill made offline */
export function newLocalBill(input: BillInput & { id: string }, userName: string): Bill {
  const totals = computeTotals(input)
  const paidNow = round2(Math.min(totals.paid, totals.grandTotal))
  const now = new Date().toISOString()
  return settle(
    {
      id: input.id,
      invoiceNo: pendingInvoiceNo(input.id),
      date: input.date,
      customer: input.customer,
      items: linesOf(input),
      discountType: input.discountType,
      discountValue: input.discountValue,
      gstInclusive: input.gstInclusive,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      returnTotal: 0,
      cancelled: false,
      payments: paidNow > 0 ? [payment(paidNow, payMethodFor(input.paymentMethod), 'Paid at billing', userName, input.date)] : [],
      returns: [],
      version: LOCAL_VERSION,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    },
    round2(Math.max(totals.paid - totals.grandTotal, 0)),
  )
}

/** An edit to a bill: new lines and details; the amount received is brought to the new figure (as the server does) */
export function editedBill(prev: Bill, input: BillInput, userName: string): Bill {
  const totals = computeTotals(input)
  const diff = round2(Math.min(totals.paid, totals.grandTotal) - prev.amountPaid)
  return settle(
    {
      ...prev,
      date: input.date,
      customer: input.customer,
      items: linesOf(input),
      discountType: input.discountType,
      discountValue: input.discountValue,
      gstInclusive: input.gstInclusive,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      payments: Math.abs(diff) >= 0.01 ? [...prev.payments, payment(diff, payMethodFor(input.paymentMethod), 'Bill edited', userName)] : prev.payments,
      updatedAt: new Date().toISOString(),
    },
    round2(Math.max(totals.paid - totals.grandTotal, 0)),
  )
}

/** Money received against a bill */
export function paidBill(prev: Bill, p: PaymentInput, userName: string): Bill {
  return settle({ ...prev, payments: [...prev.payments, payment(p.amount, p.method, p.note ?? '', userName, p.date)], updatedAt: new Date().toISOString() }, prev.totals.change)
}

/** The same checks the server makes before an edit, so an offline edit isn't queued only to be refused later */
export function assertEditable(bill: Bill) {
  if (bill.cancelled) throw new Error('This bill is cancelled and cannot be edited')
  if (bill.returns.length) throw new Error('Goods have been returned against this bill, so it can no longer be edited')
}

/** Stock a bill takes per product (in each product's stock unit), after returns */
export function stockUsed(bill: Bill | undefined, products: Map<string, Product>): Map<string, number> {
  const out = new Map<string, number>()
  if (!bill || bill.cancelled) return out
  for (const it of bill.items) {
    const p = it.productId ? products.get(it.productId) : undefined
    if (p) out.set(p.id, (out.get(p.id) ?? 0) + toStockQty(it.quantity - (it.returnedQty ?? 0), it.unit, p))
  }
  return out
}
