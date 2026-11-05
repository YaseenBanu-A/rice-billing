import { ArrowRight, Plus, ReceiptText, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BillViewModal } from '../components/BillViewModal'
import { Avatar, Button, Card, CardHeader, EmptyState, StatusBadge, cn, td, th } from '../components/ui'
import { formatDate, formatTime, isToday, toDateKey } from '../lib/format'
import { useApp } from '../store/AppContext'
import type { Bill, PaymentMethod } from '../types'

export function Dashboard() {
  const { bills, money, navigate, settings, startNewBill } = useApp()
  const [viewing, setViewing] = useState<Bill | null>(null)

  const stats = useMemo(() => {
    const today = bills.filter((b) => isToday(b.date))
    const sum = (l: Bill[]) => l.reduce((s, b) => s + b.totals.grandTotal, 0)

    const byMethod = new Map<PaymentMethod, number>()
    for (const b of today) byMethod.set(b.paymentMethod, (byMethod.get(b.paymentMethod) ?? 0) + b.totals.grandTotal)

    // last 7 days, oldest first
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const key = toDateKey(d)
      return { key, label: d.toLocaleDateString('en-IN', { weekday: 'short' }), total: sum(bills.filter((b) => toDateKey(b.date) === key)) }
    })

    return {
      todaySales: sum(today),
      todayCount: today.length,
      collected: today.reduce((s, b) => s + Math.min(b.totals.paid, b.totals.grandTotal), 0),
      todayGst: today.reduce((s, b) => s + b.totals.gst, 0),
      byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]),
      week,
    }
  }, [bills])

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()
  const weekMax = Math.max(...stats.week.map((d) => d.total), 1)

  return (
    <div>
      {/* Welcome banner */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-ink-950 px-6 py-7 text-white shadow-lift sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-indigo-500/15 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)', backgroundSize: '32px 32px', maskImage: 'linear-gradient(to left, black, transparent 70%)' }}
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-brand-300 uppercase">{formatDate(new Date().toISOString())}</p>
            <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">
              {greeting}
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">Welcome back to {settings.businessName}. Create a bill in seconds: search a product, set the quantity and print.</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button
              onClick={startNewBill}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.5)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-8px_rgb(0_0_0/0.6)]"
            >
              <Plus className="size-4" /> Create New Bill
            </button>
            <p className="hidden text-xs text-slate-500 sm:block">
              or press <kbd className="rounded border border-white/10 bg-white/5 px-1.5 text-[10px] text-slate-300">N</kbd> anywhere
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader
            title="Recent Bills"
            subtitle="Latest invoices across all days"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('history')}>
                View all <ArrowRight className="size-3.5" />
              </Button>
            }
          />
          {bills.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No bills yet" description="Bills you create will show up here." action={<Button variant="primary" icon={Plus} onClick={() => navigate('create')}>Create Bill</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <th className={th}>Invoice</th>
                    <th className={th}>Customer</th>
                    <th className={cn(th, 'hidden md:table-cell')}>Date</th>
                    <th className={cn(th, 'text-right')}>Amount</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...bills]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 7)
                    .map((b) => (
                      <tr key={b.id} onClick={() => setViewing(b)} className="cursor-pointer transition-colors hover:bg-slate-50/70">
                        <td className={cn(td, 'font-medium text-ink-900')}>{b.invoiceNo}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={b.customer.name} size={28} />
                            <span className="text-ink-900">{b.customer.name}</span>
                          </div>
                        </td>
                        <td className={cn(td, 'hidden text-ink-500 md:table-cell')}>
                          {isToday(b.date) ? `Today, ${formatTime(b.date)}` : formatDate(b.date)}
                        </td>
                        <td className={cn(td, 'tabular text-right font-semibold text-ink-900')}>{money(b.totals.grandTotal)}</td>
                        <td className={td}>
                          <StatusBadge status={b.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Today's Summary" icon={TrendingUp} />
            <div className="space-y-3 p-5">
              <SummaryLine label="Gross sales" value={money(stats.todaySales)} strong />
              <SummaryLine label="Collected" value={money(stats.collected)} />
              <SummaryLine label="Outstanding (today)" value={money(stats.todaySales - stats.collected)} />
              <SummaryLine label="GST collected" value={money(stats.todayGst)} />
              <SummaryLine label="Average bill" value={money(stats.todayCount ? stats.todaySales / stats.todayCount : 0)} />

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-3 text-xs font-medium text-ink-500">By payment method</p>
                {stats.byMethod.length === 0 ? (
                  <p className="text-sm text-ink-400">No payments today yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {stats.byMethod.map(([method, amt]) => (
                      <div key={method}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-ink-700">{method === 'Credit' ? 'Pay Later' : method}</span>
                          <span className="tabular font-medium text-ink-900">{money(amt)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(amt / stats.todaySales) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-semibold text-ink-900">Last 7 days</p>
            <p className="text-xs text-ink-500">Daily sales</p>
            <div className="mt-4 flex items-end gap-2">
              {stats.week.map((d, i) => (
                <div key={d.key} className="group flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-24 w-full items-end">
                    <div
                      title={`${d.label}: ${money(d.total)}`}
                      className={cn('w-full rounded-md transition-colors', i === 6 ? 'bg-brand-600' : 'bg-brand-100 group-hover:bg-brand-200')}
                      style={{ height: `${Math.max((d.total / weekMax) * 100, d.total ? 4 : 2)}%` }}
                    />
                  </div>
                  <span className={cn('text-[10px]', i === 6 ? 'font-semibold text-ink-900' : 'text-ink-400')}>{d.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <BillViewModal bill={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-500">{label}</span>
      <span className={cn('tabular text-sm', strong ? 'font-semibold text-ink-900' : 'font-medium text-ink-700')}>{value}</span>
    </div>
  )
}
