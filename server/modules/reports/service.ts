import { computeTotals } from '../../../shared/billing.ts'
import type { CustomerReportRow, DashboardStats, InvoiceReportRow, OutstandingRow, PaymentMethod, PaymentReportRow, PaymentStatus, ReportRows, ReportSummary } from '../../../shared/types.ts'
import { prisma } from '../../db.ts'
import { n, opt, round2, round3, toDateKey } from '../../lib/num.ts'
import { phoneDigits } from '../../lib/validate.ts'
import { billInclude, toBill } from '../invoices/service.ts'

const dayKey = (offsetDays: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return toDateKey(d)
}

async function lowStockCount() {
  const r = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*) AS c FROM "Product" WHERE active AND stock <= "reorderLevel"`
  return Number(r[0]?.c ?? 0)
}

/** Figures for the dashboard. Cancelled bills are left out; returned goods are subtracted. */
export async function dashboard(): Promise<DashboardStats> {
  const today = dayKey(0)
  const monthStart = `${today.slice(0, 7)}-01`
  const live = { cancelledAt: null }

  const [todayBills, week, recent, receivables, payables, month, monthExp, lowStock] = await Promise.all([
    prisma.invoice.findMany({ where: { ...live, dateKey: today }, select: { grandTotal: true, returnTotal: true, amountPaid: true, gst: true, paymentMethod: true } }),
    prisma.invoice.groupBy({ by: ['dateKey'], where: { ...live, dateKey: { gte: dayKey(-6) } }, _sum: { grandTotal: true, returnTotal: true } }),
    prisma.invoice.findMany({ include: billInclude, orderBy: [{ date: 'desc' }, { invoiceNo: 'desc' }], take: 7 }),
    prisma.invoice.aggregate({ where: live, _sum: { balance: true } }),
    prisma.purchase.aggregate({ where: live, _sum: { balance: true } }),
    prisma.invoice.aggregate({ where: { ...live, dateKey: { gte: monthStart } }, _sum: { grandTotal: true, returnTotal: true } }),
    prisma.expense.aggregate({ where: { dateKey: { gte: monthStart } }, _sum: { amount: true } }),
    lowStockCount(),
  ])

  const byMethod = new Map<PaymentMethod, number>()
  let sales = 0
  let collected = 0
  let gst = 0
  for (const b of todayBills) {
    const net = n(b.grandTotal) - n(b.returnTotal)
    sales += net
    collected += Math.min(n(b.amountPaid), net)
    gst += n(b.gst)
    const m = b.paymentMethod as PaymentMethod
    byMethod.set(m, (byMethod.get(m) ?? 0) + net)
  }
  const weekMap = new Map(week.map((w) => [w.dateKey, n(w._sum.grandTotal) - n(w._sum.returnTotal)]))

  return {
    today: { sales: round2(sales), count: todayBills.length, collected: round2(collected), gst: round2(gst), byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, round2(v)]) },
    week: Array.from({ length: 7 }, (_, i) => dayKey(i - 6)).map((key) => ({ key, total: round2(weekMap.get(key) ?? 0) })),
    recentBills: recent.map(toBill),
    receivables: round2(n(receivables._sum.balance)),
    payables: round2(n(payables._sum.balance)),
    monthSales: round2(n(month._sum.grandTotal) - n(month._sum.returnTotal)),
    monthExpenses: round2(n(monthExp._sum.amount)),
    lowStock,
  }
}

/**
 * Sales, GST, collections, purchases and expenses for a date range (inclusive, shop time zone).
 *
 * How each figure is counted (so nothing is counted twice):
 *  - Sales: bills dated in the range, cancelled bills left out. Goods returned are subtracted on the date of
 *    the return (credit note), so a return in this period on an older bill reduces this period's sales.
 *  - Collections: the Payment rows for bills, dated in the range: money received (+) and refunds (−). A bill's
 *    own "amount paid" is a running total of those same rows and is never added on top.
 *  - Expenses: the Expense rows dated in the range.
 *  - Profit: net sales without GST (GST collected is owed to the government) minus expenses. Purchases /
 *    cost of goods are not deducted, so this is not a full profit-and-loss statement.
 */
export async function summary(from: string, to: string): Promise<ReportSummary> {
  const range = { gte: from, lte: to }
  const [invoices, cancelled, returns, collections, purchases, supplierPay, expenses, outstanding] = await Promise.all([
    prisma.invoice.findMany({ where: { cancelledAt: null, dateKey: range }, include: { items: true } }),
    prisma.invoice.count({ where: { NOT: { cancelledAt: null }, dateKey: range } }),
    prisma.salesReturn.findMany({ where: { dateKey: range, invoice: { cancelledAt: null } }, select: { total: true, taxable: true, gst: true, dateKey: true } }),
    prisma.payment.findMany({ where: { invoiceId: { not: null }, dateKey: range }, select: { amount: true, method: true, dateKey: true } }),
    prisma.purchase.aggregate({ where: { cancelledAt: null, dateKey: range }, _sum: { taxable: true, gst: true, grandTotal: true }, _count: true }),
    prisma.payment.aggregate({ where: { purchaseId: { not: null }, dateKey: range }, _sum: { amount: true } }),
    prisma.expense.findMany({ where: { dateKey: range }, select: { amount: true, category: true, dateKey: true } }),
    prisma.invoice.aggregate({ where: { cancelledAt: null, balance: { gt: 0 } }, _sum: { balance: true }, _count: true }),
  ])

  const sales = { count: invoices.length, cancelled, subtotal: 0, discount: 0, taxable: 0, gst: 0, grandTotal: 0, returns: 0, net: 0, returnsTaxable: 0, returnsGst: 0, netTaxable: 0, netGst: 0 }
  const byRate = new Map<number, { taxable: number; gst: number }>()
  const products = new Map<string, { name: string; quantity: number; unit: string; amount: number }>()
  type Day = { bills: number; gross: number; discount: number; returns: number; gst: number; sales: number; collected: number; expenses: number }
  const daily = new Map<string, Day>()
  const day = (k: string) => daily.get(k) ?? (daily.set(k, { bills: 0, gross: 0, discount: 0, returns: 0, gst: 0, sales: 0, collected: 0, expenses: 0 }), daily.get(k)!)

  for (const inv of invoices) {
    const items = inv.items.map((i) => ({ price: n(i.price), quantity: n(i.quantity), gstRate: n(i.gstRate) }))
    const t = computeTotals({ items, discountType: inv.discountType as 'amount' | 'percent', discountValue: n(inv.discountValue), gstInclusive: inv.gstInclusive, amountPaid: 0 })
    sales.subtotal += t.subtotal
    sales.discount += t.discount
    sales.taxable += t.taxable
    sales.gst += t.gst
    sales.grandTotal += t.grandTotal
    const d = day(inv.dateKey)
    d.bills++
    d.gross += t.grandTotal
    d.discount += t.discount
    d.gst += t.gst
    d.sales += t.grandTotal
    for (const g of t.gstBreakdown) {
      const e = byRate.get(g.rate) ?? { taxable: 0, gst: 0 }
      e.taxable += g.taxable
      e.gst += g.gst
      byRate.set(g.rate, e)
    }
    for (const it of inv.items) {
      const key = `${it.name.toLowerCase()}|${it.unit}`
      const p = products.get(key) ?? { name: it.name, quantity: 0, unit: it.unit, amount: 0 }
      p.quantity += n(it.quantity)
      p.amount += n(it.price) * n(it.quantity)
      products.set(key, p)
    }
  }
  for (const r of returns) {
    sales.returns += n(r.total)
    sales.returnsTaxable += n(r.taxable)
    sales.returnsGst += n(r.gst)
    const d = day(r.dateKey)
    d.returns += n(r.total)
    d.gst -= n(r.gst)
    d.sales -= n(r.total)
  }
  sales.net = sales.grandTotal - sales.returns
  sales.netTaxable = sales.taxable - sales.returnsTaxable
  sales.netGst = sales.gst - sales.returnsGst

  const methods = new Map<string, number>()
  const collected = { received: 0, refunded: 0, net: 0 }
  for (const p of collections) {
    const amt = n(p.amount)
    methods.set(p.method, (methods.get(p.method) ?? 0) + amt)
    day(p.dateKey).collected += amt
    if (amt >= 0) collected.received += amt
    else collected.refunded -= amt
    collected.net += amt
  }
  const expCats = new Map<string, number>()
  for (const e of expenses) {
    expCats.set(e.category, (expCats.get(e.category) ?? 0) + n(e.amount))
    day(e.dateKey).expenses += n(e.amount)
  }
  const expenseTotal = round2(expenses.reduce((s, e) => s + n(e.amount), 0))

  const receivables = await prisma.invoice.findMany({
    where: { cancelledAt: null, balance: { gt: 0 } },
    orderBy: { date: 'asc' },
    take: 200,
    select: { id: true, invoiceNo: true, date: true, customerName: true, customerPhone: true, grandTotal: true, balance: true },
  })

  const r2 = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)])) as T
  const netSales = round2(sales.net)
  const gstOnNetSales = round2(sales.netGst)
  const netSalesExGst = round2(netSales - gstOnNetSales)
  return {
    from,
    to,
    sales: { ...r2(sales), count: sales.count, cancelled },
    gstByRate: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, taxable: round2(v.taxable), gst: round2(v.gst) })),
    collections: [...methods.entries()].map(([method, amount]) => ({ method, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    collectionTotals: { ...r2(collected), count: collections.length },
    purchases: { count: purchases._count, taxable: round2(n(purchases._sum.taxable)), gst: round2(n(purchases._sum.gst)), grandTotal: round2(n(purchases._sum.grandTotal)) },
    supplierPayments: round2(n(supplierPay._sum.amount)),
    expenses: [...expCats.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    expenseTotal,
    expenseCount: expenses.length,
    profit: { netSales, gstOnNetSales, netSalesExGst, expenses: expenseTotal, net: round2(netSalesExGst - expenseTotal) },
    outstanding: { total: round2(n(outstanding._sum.balance)), count: outstanding._count },
    daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...r2(v), bills: v.bills })),
    topProducts: [...products.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
      .map((p) => ({ ...p, quantity: round3(p.quantity), amount: round2(p.amount) })),
    receivables: receivables.map((r) => ({ id: r.id, invoiceNo: r.invoiceNo, date: r.date.toISOString(), customer: r.customerName, phone: r.customerPhone, grandTotal: n(r.grandTotal), balance: n(r.balance) })),
  }
}

/* ---------- detailed reports (rows for the tables and exports) ---------- */

/** Most rows one report returns; a longer period is flagged `truncated` so the screen can say so. */
export const ROW_LIMIT = 10_000

const rowsOf = <T>(from: string, to: string, rows: T[]): ReportRows<T> => ({ from, to, rows: rows.slice(0, ROW_LIMIT), truncated: rows.length > ROW_LIMIT })

/** Every bill dated in the period, cancelled ones included (marked), with what was paid and is still due. */
export async function invoiceReport(from: string, to: string): Promise<ReportRows<InvoiceReportRow>> {
  const rows = await prisma.invoice.findMany({
    where: { dateKey: { gte: from, lte: to } },
    orderBy: [{ date: 'desc' }, { invoiceNo: 'desc' }],
    take: ROW_LIMIT + 1,
    select: {
      id: true,
      invoiceNo: true,
      date: true,
      dateKey: true,
      customerName: true,
      customerPhone: true,
      subtotal: true,
      discount: true,
      taxable: true,
      gst: true,
      grandTotal: true,
      returnTotal: true,
      amountPaid: true,
      balance: true,
      status: true,
      paymentMethod: true,
      cancelledAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { items: true } },
    },
  })
  return rowsOf(
    from,
    to,
    rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      date: r.date.toISOString(),
      dateKey: r.dateKey,
      customer: r.customerName,
      phone: r.customerPhone,
      items: r._count.items,
      subtotal: n(r.subtotal),
      discount: n(r.discount),
      taxable: n(r.taxable),
      gst: n(r.gst),
      grandTotal: n(r.grandTotal),
      returns: n(r.returnTotal),
      paid: n(r.amountPaid),
      balance: n(r.balance),
      status: r.status as PaymentStatus,
      method: r.paymentMethod,
      cancelled: !!r.cancelledAt,
      createdBy: r.createdBy?.name,
    })),
  )
}

/**
 * Sales per customer for bills dated in the period (cancelled bills left out). Returns, payments and balance
 * are those recorded against these bills so far. Customers without a saved record are grouped by name + phone.
 */
export async function customerReport(from: string, to: string): Promise<ReportRows<CustomerReportRow>> {
  const bills = await prisma.invoice.findMany({
    where: { cancelledAt: null, dateKey: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { invoiceNo: 'asc' }],
    select: { customerId: true, customerName: true, customerPhone: true, grandTotal: true, returnTotal: true, amountPaid: true, balance: true, date: true },
  })
  const map = new Map<string, CustomerReportRow>()
  for (const b of bills) {
    const key = b.customerId ?? `${b.customerName.trim().toLowerCase()}|${phoneDigits(b.customerPhone)}`
    const row = map.get(key) ?? { key, customerId: b.customerId ?? undefined, name: b.customerName, phone: b.customerPhone, bills: 0, gross: 0, returns: 0, net: 0, paid: 0, balance: 0, lastBill: '' }
    row.bills++
    row.gross += n(b.grandTotal)
    row.returns += n(b.returnTotal)
    row.paid += n(b.amountPaid)
    row.balance += n(b.balance)
    // bills are in date order, so this ends with the latest name / phone used
    row.name = b.customerName
    row.phone = b.customerPhone || row.phone
    row.lastBill = b.date.toISOString()
    map.set(key, row)
  }
  const rows = [...map.values()]
    .map((r) => ({ ...r, gross: round2(r.gross), returns: round2(r.returns), net: round2(r.gross - r.returns), paid: round2(r.paid), balance: round2(r.balance) }))
    .sort((a, b) => b.net - a.net)
  return rowsOf(from, to, rows)
}

/** Every payment received and refund given for bills, dated in the period. */
export async function paymentReport(from: string, to: string): Promise<ReportRows<PaymentReportRow>> {
  const rows = await prisma.payment.findMany({
    where: { invoiceId: { not: null }, dateKey: { gte: from, lte: to } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: ROW_LIMIT + 1,
    include: { invoice: { select: { invoiceNo: true, customerName: true } }, user: { select: { name: true } } },
  })
  return rowsOf(
    from,
    to,
    rows.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      dateKey: p.dateKey,
      invoiceId: p.invoiceId!,
      invoiceNo: p.invoice?.invoiceNo ?? '',
      customer: p.invoice?.customerName ?? '',
      kind: p.kind,
      method: p.method,
      amount: n(p.amount),
      reference: opt(p.reference),
      note: opt(p.note),
      userName: p.user?.name,
    })),
  )
}

/** Bills with money still due, as of now (all dates), oldest first, with how many days they have been open. */
export async function outstandingReport(): Promise<ReportRows<OutstandingRow>> {
  const today = toDateKey(new Date())
  const rows = await prisma.invoice.findMany({
    where: { cancelledAt: null, balance: { gt: 0 } },
    orderBy: [{ date: 'asc' }, { invoiceNo: 'asc' }],
    take: ROW_LIMIT + 1,
    select: { id: true, invoiceNo: true, date: true, dateKey: true, customerName: true, customerPhone: true, grandTotal: true, returnTotal: true, amountPaid: true, balance: true },
  })
  return rowsOf(
    rows[0]?.dateKey ?? today,
    today,
    rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      date: r.date.toISOString(),
      dateKey: r.dateKey,
      customer: r.customerName,
      phone: r.customerPhone,
      grandTotal: n(r.grandTotal),
      returns: n(r.returnTotal),
      paid: n(r.amountPaid),
      balance: n(r.balance),
      days: Math.max(0, Math.round((Date.parse(today) - Date.parse(r.dateKey)) / 86_400_000)),
    })),
  )
}
