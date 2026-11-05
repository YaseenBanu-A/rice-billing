import type { BillItem, BillTotals, DiscountType, PaymentStatus } from './types.ts'
import { round2 } from './util.ts'

interface TotalsInput {
  items: Pick<BillItem, 'price' | 'quantity' | 'gstRate'>[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  amountPaid: number
}

/**
 * Bill-level discount is spread across lines in proportion to their amount,
 * then GST is computed per line at that line's rate.
 */
export function computeTotals({
  items,
  discountType,
  discountValue,
  gstInclusive,
  amountPaid,
}: TotalsInput): BillTotals {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.quantity, 0))

  const rawDiscount =
    discountType === 'percent'
      ? (subtotal * Math.min(Math.max(discountValue, 0), 100)) / 100
      : Math.max(discountValue, 0)
  const discount = round2(Math.min(rawDiscount, subtotal))
  const netFactor = subtotal > 0 ? (subtotal - discount) / subtotal : 0

  const byRate = new Map<number, { taxable: number; gst: number }>()
  for (const item of items) {
    const net = item.price * item.quantity * netFactor
    const r = item.gstRate / 100
    const taxable = gstInclusive ? net / (1 + r) : net
    const gst = gstInclusive ? net - taxable : net * r
    const entry = byRate.get(item.gstRate) ?? { taxable: 0, gst: 0 }
    entry.taxable += taxable
    entry.gst += gst
    byRate.set(item.gstRate, entry)
  }

  const gstBreakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, taxable: round2(v.taxable), gst: round2(v.gst) }))

  const taxable = round2(gstBreakdown.reduce((s, g) => s + g.taxable, 0))
  const gst = round2(gstBreakdown.reduce((s, g) => s + g.gst, 0))
  const grandTotal = round2(taxable + gst)
  const paid = round2(Math.max(amountPaid, 0))

  return {
    subtotal,
    discount,
    taxable,
    gst,
    grandTotal,
    paid,
    balance: round2(Math.max(grandTotal - paid, 0)),
    change: round2(Math.max(paid - grandTotal, 0)),
    gstBreakdown,
  }
}

export function paymentStatus(totals: BillTotals): PaymentStatus {
  if (totals.grandTotal > 0 && totals.paid >= totals.grandTotal) return 'Paid'
  if (totals.paid > 0) return 'Partial'
  return 'Unpaid'
}

/** Units offered for bill items */
export const UNITS = ['Kg', 'Bag', 'Loose']

export const PAY_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'] as const
export const BILL_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'] as const
export const EXPENSE_CATEGORIES = ['Transport', 'Loading / Unloading', 'Labour', 'Rent', 'Electricity', 'Salary', 'Packing material', 'Maintenance', 'Office', 'Other']

export const bagsLabel = (bags: number) => `${bags} ${bags === 1 ? 'Bag' : 'Bags'}`

/** Quantity with its unit, and bags when given, e.g. "2.5 Kg" or "5 Bags / 250 Kg" */
export function qtyLabel(item: { quantity: number; unit?: string; bags?: number }): string {
  const qty = item.unit ? `${item.quantity} ${item.unit}` : String(item.quantity)
  return item.bags ? `${bagsLabel(item.bags)} / ${qty}` : qty
}

export function formatInvoiceNo(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(3, '0')}`
}

export function invoiceSeq(invoiceNo: string): number {
  const m = invoiceNo.match(/(\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}


/** Status once returns and payments are known: `net` is the bill total minus returned goods. */
export function settlementStatus(net: number, paid: number): PaymentStatus {
  if (net <= 0.005 || paid >= net - 0.005) return paid > 0 || net <= 0.005 ? 'Paid' : 'Unpaid'
  return paid > 0.005 ? 'Partial' : 'Unpaid'
}

/**
 * Converts a bill/purchase line quantity into the unit the product's stock is counted in.
 * Bags ↔ Kg use the product's bag weight; anything else is taken as-is.
 */
export function toStockQty(qty: number, lineUnit: string | undefined, product: { unit: string; bagWeight?: number | null }): number {
  const unit = lineUnit || product.unit
  const bw = product.bagWeight ?? 0
  if (unit === product.unit || unit === 'Loose' || product.unit === 'Loose') return qty
  if (unit === 'Bag' && product.unit === 'Kg' && bw > 0) return round3(qty * bw)
  if (unit === 'Kg' && product.unit === 'Bag' && bw > 0) return round3(qty / bw)
  return qty
}

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000

/**
 * Value of goods returned from a bill: same bill discount (as a fraction) and GST as the original sale,
 * so a full return credits exactly what was charged.
 */
export function returnValue(
  lines: { price: number; quantity: number; gstRate: number }[],
  bill: { subtotal: number; discount: number; gstInclusive: boolean },
): { taxable: number; gst: number; total: number; lines: number[] } {
  const factor = bill.subtotal > 0 ? (bill.subtotal - bill.discount) / bill.subtotal : 0
  let taxable = 0
  let gst = 0
  const amounts = lines.map((l) => {
    const net = l.price * l.quantity * factor
    const r = l.gstRate / 100
    const t = bill.gstInclusive ? net / (1 + r) : net
    const g = bill.gstInclusive ? net - t : net * r
    taxable += t
    gst += g
    return round2(t + g)
  })
  return { taxable: round2(taxable), gst: round2(gst), total: round2(round2(taxable) + round2(gst)), lines: amounts }
}
