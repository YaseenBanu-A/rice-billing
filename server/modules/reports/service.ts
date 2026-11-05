import { computeTotals } from '../../../shared/billing.ts'
import type { DashboardStats, PaymentMethod, ReportSummary } from '../../../shared/types.ts'
import { prisma } from '../../db.ts'
import { n, round2, round3, toDateKey } from '../../lib/num.ts'
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

/** Sales, GST, collections, purchases and expenses for a date range (inclusive, shop time zone). */
export async function summary(from: string, to: string): Promise<ReportSummary> {
  const range = { gte: from, lte: to }
  const [invoices, cancelled, returns, collections, purchases, supplierPay, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: { cancelledAt: null, dateKey: range }, include: { items: true } }),
    prisma.invoice.count({ where: { NOT: { cancelledAt: null }, dateKey: range } }),
    prisma.salesReturn.findMany({ where: { dateKey: range, invoice: { cancelledAt: null } }, select: { total: true, dateKey: true } }),
    prisma.payment.findMany({ where: { invoiceId: { not: null }, dateKey: range }, select: { amount: true, method: true, dateKey: true } }),
    prisma.purchase.aggregate({ where: { cancelledAt: null, dateKey: range }, _sum: { taxable: true, gst: true, grandTotal: true }, _count: true }),
    prisma.payment.aggregate({ where: { purchaseId: { not: null }, dateKey: range }, _sum: { amount: true } }),
    prisma.expense.findMany({ where: { dateKey: range }, select: { amount: true, category: true, dateKey: true } }),
  ])

  const sales = { count: invoices.length, cancelled, subtotal: 0, discount: 0, taxable: 0, gst: 0, grandTotal: 0, returns: 0, net: 0 }
  const byRate = new Map<number, { taxable: number; gst: number }>()
  const products = new Map<string, { name: string; quantity: number; unit: string; amount: number }>()
  const daily = new Map<string, { sales: number; collected: number; expenses: number }>()
  const day = (k: string) => daily.get(k) ?? (daily.set(k, { sales: 0, collected: 0, expenses: 0 }), daily.get(k)!)

  for (const inv of invoices) {
    const items = inv.items.map((i) => ({ price: n(i.price), quantity: n(i.quantity), gstRate: n(i.gstRate) }))
    const t = computeTotals({ items, discountType: inv.discountType as 'amount' | 'percent', discountValue: n(inv.discountValue), gstInclusive: inv.gstInclusive, amountPaid: 0 })
    sales.subtotal += t.subtotal
    sales.discount += t.discount
    sales.taxable += t.taxable
    sales.gst += t.gst
    sales.grandTotal += t.grandTotal
    day(inv.dateKey).sales += t.grandTotal
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
    day(r.dateKey).sales -= n(r.total)
  }
  sales.net = sales.grandTotal - sales.returns

  const methods = new Map<string, number>()
  for (const p of collections) {
    methods.set(p.method, (methods.get(p.method) ?? 0) + n(p.amount))
    day(p.dateKey).collected += n(p.amount)
  }
  const expCats = new Map<string, number>()
  for (const e of expenses) {
    expCats.set(e.category, (expCats.get(e.category) ?? 0) + n(e.amount))
    day(e.dateKey).expenses += n(e.amount)
  }

  const receivables = await prisma.invoice.findMany({
    where: { cancelledAt: null, balance: { gt: 0 } },
    orderBy: { date: 'asc' },
    take: 200,
    select: { id: true, invoiceNo: true, date: true, customerName: true, customerPhone: true, grandTotal: true, balance: true },
  })

  const r2 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]))
  return {
    from,
    to,
    sales: { ...(r2(sales) as typeof sales), count: sales.count, cancelled },
    gstByRate: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, taxable: round2(v.taxable), gst: round2(v.gst) })),
    collections: [...methods.entries()].map(([method, amount]) => ({ method, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    purchases: { count: purchases._count, taxable: round2(n(purchases._sum.taxable)), gst: round2(n(purchases._sum.gst)), grandTotal: round2(n(purchases._sum.grandTotal)) },
    supplierPayments: round2(n(supplierPay._sum.amount)),
    expenses: [...expCats.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    expenseTotal: round2(expenses.reduce((s, e) => s + n(e.amount), 0)),
    daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, sales: round2(v.sales), collected: round2(v.collected), expenses: round2(v.expenses) })),
    topProducts: [...products.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
      .map((p) => ({ ...p, quantity: round3(p.quantity), amount: round2(p.amount) })),
    receivables: receivables.map((r) => ({ id: r.id, invoiceNo: r.invoiceNo, date: r.date.toISOString(), customer: r.customerName, phone: r.customerPhone, grandTotal: n(r.grandTotal), balance: n(r.balance) })),
  }
}
