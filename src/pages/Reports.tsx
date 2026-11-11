import { ChartColumn, Clock, CreditCard, FileDown, FileSpreadsheet, Hourglass, Info, LayoutDashboard, Lock, ReceiptText, Scale, SearchX, ShoppingBag, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BillViewModal } from '../components/BillViewModal'
import { DataTable, PeriodPicker, StatCard, Tabs, periodText, toExportTable, useTableView, type Column } from '../components/DataTable'
import { Card, CardHeader, EmptyState, Pill, SearchInput, Segmented, Select, StatusBadge, Button, cn } from '../components/ui'
import { api } from '../lib/api'
import { PAY_METHODS } from '../lib/billing'
import { exportExcel, exportPdf, type ExportDoc, type ExportTable } from '../lib/export'
import { formatTime } from '../lib/format'
import { useResource } from '../lib/live'
import { groupKey, groupLabel, periodOf, type Grouping, type Period } from '../lib/period'
import { useApp } from '../store/AppContext'
import type { CustomerReportRow, Expense, InvoiceReportRow, OutstandingRow, PaymentReportRow, PaymentStatus, ReportSummary } from '../types'

/*
 * Reports: every figure is read from the database for the chosen period (shop time zone, both dates included).
 * Each tab's Excel / PDF export contains exactly the rows on screen, after search, filters and sorting.
 */

type Tab = 'overview' | 'sales' | 'invoices' | 'customers' | 'payments' | 'outstanding' | 'expenses'

const TABS: { value: Tab; label: string; icon: typeof ChartColumn }[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'sales', label: 'Sales', icon: ChartColumn },
  { value: 'invoices', label: 'Invoices', icon: ReceiptText },
  { value: 'customers', label: 'Customers', icon: Users },
  { value: 'payments', label: 'Payments', icon: CreditCard },
  { value: 'outstanding', label: 'Outstanding', icon: Hourglass },
  { value: 'expenses', label: 'Expenses', icon: Wallet },
]

const LIVE = ['invoice', 'payment', 'expense'] as const

/** How the figures are worked out: shown on screen and printed in exports */
const METHOD_NOTES = [
  'Sales: bills dated in the period. Cancelled bills are left out; deleted bills no longer exist. Goods returned are subtracted on the date of the return.',
  'Collections: payments received for bills in the period minus refunds given in the period. Each payment entry is counted once.',
  'Expenses: expenses dated in the period, as recorded on the Expenses screen.',
  'Net profit = net sales excluding GST − expenses. GST collected is left out because it is owed to the government. The cost of goods bought for resale (purchases) is not deducted, so this is not a full profit & loss statement.',
]

type DocBuilder = () => Omit<ExportDoc, 'business' | 'period' | 'generatedBy'> | null
/** A tab hands the page its export builder (or null when it closes) */
type Exporter = (build: DocBuilder | null) => void

export function Reports() {
  const { can, settings, user, toast, money } = useApp()
  const [tab, setTab] = useState<Tab>('overview')
  const [period, setPeriod] = useState<Period>(() => periodOf('month'))
  const summary = useResource(() => api.reportSummary(period.from, period.to), [period.from, period.to], [...LIVE])
  const builder = useRef<DocBuilder | null>(null)
  const exporter = useCallback<Exporter>((build) => {
    builder.current = build
  }, [])

  if (!can('reports.view'))
    return (
      <Card>
        <EmptyState icon={Lock} title="Reports are for managers" description="Ask an administrator if you need to see sales, collections and profit reports." />
      </Card>
    )

  const run = async (kind: 'xlsx' | 'pdf') => {
    const d = builder.current?.()
    if (!d) return toast('Nothing to export yet', 'info')
    const doc: ExportDoc = { ...d, business: settings.businessName, period: tab === 'outstanding' ? `As of ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : periodText(period), generatedBy: user.name }
    try {
      if (kind === 'xlsx') exportExcel(doc)
      else await exportPdf(doc)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the file', 'error')
    }
  }

  const s = summary.data
  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink-900">Reports</h1>
          <p className="mt-1.5 text-sm text-ink-500">Sales, collections, dues and profit from your billing records</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={FileSpreadsheet} onClick={() => run('xlsx')}>
            Export Excel
          </Button>
          <Button icon={FileDown} onClick={() => run('pdf')}>
            Export PDF
          </Button>
        </div>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <PeriodPicker value={period} onChange={setPeriod} />
          <p className="text-sm font-medium text-ink-700 lg:pt-1.5">{periodText(period)}</p>
        </div>
      </Card>

      {summary.error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{summary.error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Net sales" icon={ShoppingBag} value={s ? money(s.sales.net) : '…'} hint={s ? `${s.sales.count} bills${s.sales.returns ? ` · ${money(s.sales.returns)} returned` : ''}` : undefined} />
        <StatCard label="Collected" icon={CreditCard} tone="emerald" value={s ? money(s.collectionTotals.net) : '…'} hint={s ? (s.collectionTotals.refunded ? `after ${money(s.collectionTotals.refunded)} refunds` : `${s.collectionTotals.count} payments`) : undefined} />
        <StatCard label="Expenses" icon={Wallet} tone="amber" value={s ? money(s.expenseTotal) : '…'} hint={s ? `${s.expenseCount} ${s.expenseCount === 1 ? 'entry' : 'entries'}` : undefined} />
        <StatCard
          label="Net profit"
          icon={s && s.profit.net < 0 ? TrendingDown : TrendingUp}
          tone={s && s.profit.net < 0 ? 'red' : 'emerald'}
          value={s ? money(s.profit.net) : '…'}
          valueClass={s && s.profit.net < 0 ? 'text-red-600' : undefined}
          hint="Sales excl. GST − expenses"
        />
        <StatCard label="Outstanding" icon={Hourglass} tone="red" value={s ? money(s.outstanding.total) : '…'} hint={s ? `${s.outstanding.count} bills · all dates` : undefined} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      <div className="mt-6">
        {tab === 'overview' && <Overview summary={s} exporter={exporter} />}
        {tab === 'sales' && <Sales summary={s} exporter={exporter} />}
        {tab === 'invoices' && <Invoices period={period} exporter={exporter} />}
        {tab === 'customers' && <Customers period={period} exporter={exporter} />}
        {tab === 'payments' && <Payments period={period} summary={s} exporter={exporter} />}
        {tab === 'outstanding' && <Outstanding exporter={exporter} />}
        {tab === 'expenses' && <Expenses period={period} exporter={exporter} />}
      </div>
    </div>
  )
}

/* ---------- shared bits ---------- */

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-ink-500">
      <span className="size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      Loading…
    </div>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
}

function Strip({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-xs text-ink-500">
      {items.map(([label, value]) => (
        <span key={label}>
          {label} <span className="tabular font-semibold text-ink-900">{value}</span>
        </span>
      ))}
    </div>
  )
}

function Truncated({ show }: { show?: boolean }) {
  if (!show) return null
  return <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">This period has more than 10,000 rows: only the first 10,000 are shown. Choose a shorter period.</p>
}

const NoMatch = ({ any }: { any: boolean }) =>
  any ? <EmptyState icon={SearchX} title="Nothing matches your search or filters" /> : <EmptyState icon={ChartColumn} title="No records for this period" description="Choose another period above." />

/** Registers the current tab's export with the page's Excel / PDF buttons */
function useExport(exporter: Exporter, build: DocBuilder) {
  const ref = useRef(build)
  // always the latest rows / filters
  useEffect(() => {
    ref.current = build
  })
  useEffect(() => {
    exporter(() => ref.current())
    return () => exporter(null)
  }, [exporter])
}

const fileStamp = (p?: { from: string; to: string }) => (p ? `${p.from}-to-${p.to}` : new Date().toISOString().slice(0, 10))

/* ---------- overview: profit statement ---------- */

function Overview({ summary: s, exporter }: { summary: ReportSummary | null; exporter: Exporter }) {
  const { money } = useApp()

  const lines = (r: ReportSummary): { label: string; value: number; kind: 'plus' | 'minus' | 'sub' | 'result' }[] => [
    { label: `Gross sales (${r.sales.count} bills, including GST)`, value: r.sales.grandTotal, kind: 'plus' },
    { label: 'Less: goods returned', value: -r.sales.returns, kind: 'minus' },
    { label: 'Net sales (including GST)', value: r.profit.netSales, kind: 'sub' },
    { label: 'Less: GST in net sales', value: -r.profit.gstOnNetSales, kind: 'minus' },
    { label: 'Net sales excluding GST', value: r.profit.netSalesExGst, kind: 'sub' },
    { label: `Less: expenses (${r.expenseCount} entries)`, value: -r.profit.expenses, kind: 'minus' },
    { label: 'Net profit (before cost of goods)', value: r.profit.net, kind: 'result' },
  ]

  useExport(exporter, () => {
    if (!s) return null
    const sections: ExportTable[] = [
      { title: 'Profit summary', columns: [{ label: 'Item', width: 4 }, { label: 'Amount', kind: 'money' }], rows: lines(s).map((l) => [l.label, l.value]) },
      {
        title: 'Collections',
        columns: [{ label: 'Method' }, { label: 'Amount', kind: 'money' }],
        rows: [...s.collections.map((c) => [c.method, c.amount]), ['Received', s.collectionTotals.received], ['Refunded', -s.collectionTotals.refunded]],
        totals: ['Net collected', s.collectionTotals.net],
      },
      { title: 'Expenses by category', columns: [{ label: 'Category' }, { label: 'Amount', kind: 'money' }], rows: s.expenses.map((e) => [e.category, e.amount]), totals: ['Total', s.expenseTotal] },
      { title: 'GST by rate', columns: [{ label: 'GST rate' }, { label: 'Taxable value', kind: 'money' }, { label: 'GST', kind: 'money' }], rows: s.gstByRate.map((g) => [`${g.rate}%`, g.taxable, g.gst]), totals: ['Total (before returns)', s.sales.taxable, s.sales.gst] },
    ]
    return { fileName: `Profit-summary-${fileStamp(s)}`, title: 'Profit summary', sections, notes: METHOD_NOTES }
  })

  if (!s) return <Loading />
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <CardHeader title="Profit summary" subtitle="Sales minus recorded expenses" icon={Scale} />
        <div className="p-5">
          <dl className="divide-y divide-slate-100">
            {lines(s).map((l) => (
              <div key={l.label} className={cn('flex items-center justify-between gap-4 py-2.5', l.kind === 'result' && 'mt-1 rounded-xl border-0 bg-slate-50 px-4 py-3.5')}>
                <dt className={cn('text-sm', l.kind === 'minus' ? 'pl-4 text-ink-500' : l.kind === 'plus' ? 'text-ink-700' : 'font-semibold text-ink-900')}>{l.label}</dt>
                <dd
                  className={cn(
                    'tabular text-sm whitespace-nowrap',
                    l.kind === 'minus' && 'text-ink-500',
                    l.kind === 'sub' && 'font-semibold text-ink-900',
                    l.kind === 'result' && cn('text-lg font-semibold', l.value < 0 ? 'text-red-600' : 'text-emerald-700'),
                  )}
                >
                  {l.kind === 'minus' ? `− ${money(Math.abs(l.value))}` : money(l.value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex gap-3 rounded-xl border border-brand-200/60 bg-brand-50/60 p-4 text-xs leading-relaxed text-ink-700">
            <Info className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <ul className="space-y-1.5">
              {METHOD_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {s.purchases.count > 0 && (
                <li>
                  Purchases recorded in the period (not deducted above): {s.purchases.count} for {money(s.purchases.grandTotal)}.
                </li>
              )}
            </ul>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Collections" subtitle="Money received for bills" icon={CreditCard} />
          <div className="space-y-2.5 p-5 text-sm">
            <Line label="Received" value={money(s.collectionTotals.received)} />
            <Line label="Refunded" value={s.collectionTotals.refunded ? `− ${money(s.collectionTotals.refunded)}` : money(0)} />
            <Line label="Net collected" value={money(s.collectionTotals.net)} strong />
            {s.collections.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-medium text-ink-500">By method (net)</p>
                <Bars items={s.collections.map((c) => [c.method, c.amount])} />
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Expenses by category" icon={Wallet} />
          <div className="p-5">{s.expenses.length ? <Bars items={s.expenses.map((e) => [e.category, e.amount])} /> : <p className="text-sm text-ink-400">No expenses in this period.</p>}</div>
        </Card>
      </div>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-semibold text-ink-900' : 'text-ink-500'}>{label}</span>
      <span className={cn('tabular', strong ? 'font-semibold text-ink-900' : 'font-medium text-ink-700')}>{value}</span>
    </div>
  )
}

function Bars({ items }: { items: [string, number][] }) {
  const { money } = useApp()
  const max = Math.max(...items.map(([, v]) => Math.abs(v)), 1)
  return (
    <div className="space-y-2.5">
      {items.map(([label, v]) => (
        <div key={label}>
          <div className="mb-1 flex justify-between gap-3 text-xs">
            <span className="truncate text-ink-700">{label}</span>
            <span className="tabular font-medium text-ink-900">{money(v)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Math.abs(v) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- sales by day / week / month ---------- */

type SalesRow = { key: string; bills: number; gross: number; discount: number; returns: number; gst: number; sales: number; collected: number; expenses: number }

function Sales({ summary: s, exporter }: { summary: ReportSummary | null; exporter: Exporter }) {
  const [grouping, setGrouping] = useState<Grouping>('day')
  const rows = useMemo(() => {
    const m = new Map<string, SalesRow>()
    for (const d of s?.daily ?? []) {
      const k = groupKey(d.date, grouping)
      const r = m.get(k) ?? { key: k, bills: 0, gross: 0, discount: 0, returns: 0, gst: 0, sales: 0, collected: 0, expenses: 0 }
      for (const f of ['bills', 'gross', 'discount', 'returns', 'gst', 'sales', 'collected', 'expenses'] as const) r[f] += d[f]
      m.set(k, r)
    }
    return [...m.values()].map((r) => ({ ...r, gross: rd(r.gross), discount: rd(r.discount), returns: rd(r.returns), gst: rd(r.gst), sales: rd(r.sales), collected: rd(r.collected), expenses: rd(r.expenses) }))
  }, [s, grouping])

  const columns = useMemo<Column<SalesRow>[]>(
    () => [
      { key: 'key', label: grouping === 'day' ? 'Date' : grouping === 'week' ? 'Week' : 'Month', kind: 'text', value: (r) => groupLabel(r.key, grouping) },
      { key: 'bills', label: 'Bills', kind: 'int', value: (r) => r.bills, total: true },
      { key: 'gross', label: 'Gross sales', kind: 'money', value: (r) => r.gross, total: true, hide: 'md' },
      { key: 'discount', label: 'Discount', kind: 'money', value: (r) => r.discount, total: true, hide: 'lg' },
      { key: 'returns', label: 'Returns', kind: 'money', value: (r) => r.returns, total: true, hide: 'md' },
      { key: 'gst', label: 'GST', kind: 'money', value: (r) => r.gst, total: true, hide: '2xl' },
      { key: 'sales', label: 'Net sales', kind: 'money', value: (r) => r.sales, total: true },
      { key: 'collected', label: 'Collected', kind: 'money', value: (r) => r.collected, total: true, hide: 'sm' },
      { key: 'expenses', label: 'Expenses', kind: 'money', value: (r) => r.expenses, total: true, hide: 'sm' },
    ],
    [grouping],
  )
  // sorting by the label column sorts by the date key underneath
  const sortable = useMemo(() => columns.map((c) => (c.key === 'key' ? { ...c, value: (r: SalesRow) => r.key } : c)), [columns])
  const { view, sort, onSort } = useTableView(rows, sortable, { initial: { key: 'key', dir: 'asc' } })

  const productCols = useMemo<Column<ReportSummary['topProducts'][number]>[]>(
    () => [
      { key: 'name', label: 'Item', kind: 'text', value: (p) => p.name },
      { key: 'qty', label: 'Quantity', kind: 'text', value: (p) => `${p.quantity} ${p.unit}`.trim(), sortable: false },
      { key: 'amount', label: 'Value (before discount & GST)', kind: 'money', value: (p) => p.amount },
    ],
    [],
  )
  const gstCols = useMemo<Column<ReportSummary['gstByRate'][number]>[]>(
    () => [
      { key: 'rate', label: 'GST rate', kind: 'text', value: (g) => `${g.rate}%` },
      { key: 'taxable', label: 'Taxable value', kind: 'money', value: (g) => g.taxable, total: true },
      { key: 'gst', label: 'GST', kind: 'money', value: (g) => g.gst, total: true },
    ],
    [],
  )
  const products = useTableView(s?.topProducts, productCols, { initial: { key: 'amount', dir: 'desc' } })
  const gst = useTableView(s?.gstByRate, gstCols, { initial: { key: 'rate', dir: 'asc' } })

  useExport(exporter, () =>
    s
      ? {
          fileName: `Sales-report-${grouping}-${fileStamp(s)}`,
          title: 'Sales report',
          sections: [
            toExportTable(`Sales by ${grouping}`, sortable.map((c) => (c.key === 'key' ? { ...c, value: (r: SalesRow) => groupLabel(r.key, grouping) } : c)), view),
            toExportTable('GST by rate', gstCols, gst.view),
            toExportTable('Top items', productCols, products.view),
          ],
          notes: [...METHOD_NOTES.slice(0, 3), 'GST by rate is for bills in the period, before returns.'],
        }
      : null,
  )

  if (!s) return <Loading />
  return (
    <div className="flex flex-col gap-6">
      <Card className="min-w-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[15px] font-semibold text-ink-900">Sales report</p>
            <p className="text-xs text-ink-500">Net sales = gross sales − returns · days without activity are not listed</p>
          </div>
          <Segmented<Grouping>
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
            ]}
          />
        </div>
        <DataTable columns={sortable} rows={view} sort={sort} onSort={onSort} rowKey={(r) => r.key} empty={<NoMatch any={false} />} />
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="GST by rate" subtitle="Bills in the period, before returns" />
          <DataTable columns={gstCols} rows={gst.view} sort={gst.sort} onSort={gst.onSort} rowKey={(g) => String(g.rate)} empty={<NoMatch any={false} />} />
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Top items" subtitle="By value sold (up to 15)" />
          <DataTable columns={productCols} rows={products.view} sort={products.sort} onSort={products.onSort} rowKey={(p) => `${p.name}|${p.unit}`} empty={<NoMatch any={false} />} />
        </Card>
      </div>
    </div>
  )
}

const rd = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/* ---------- invoices ---------- */

type StatusFilter = 'active' | 'all' | PaymentStatus

function Invoices({ period, exporter }: { period: Period; exporter: Exporter }) {
  const { money, bills } = useApp()
  const data = useResource(() => api.invoiceReport(period.from, period.to), [period.from, period.to], [...LIVE])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [method, setMethod] = useState('')
  const [viewing, setViewing] = useState<string | null>(null)

  const rows = useMemo(
    () => (data.data?.rows ?? []).filter((r) => (status === 'active' ? !r.cancelled : status === 'all' || r.status === status) && (!method || r.method === method)),
    [data.data, status, method],
  )
  const columns = useMemo<Column<InvoiceReportRow>[]>(
    () => [
      { key: 'no', label: 'Invoice', kind: 'text', value: (r) => r.invoiceNo, render: (r) => <span className="font-medium text-ink-900">{r.invoiceNo}</span> },
      { key: 'date', label: 'Date', kind: 'date', value: (r) => r.dateKey, hide: 'sm' },
      {
        key: 'customer',
        label: 'Customer',
        kind: 'text',
        value: (r) => r.customer,
        render: (r) => (
          <div>
            <p className="text-ink-900">{r.customer}</p>
            {r.phone && <p className="text-xs text-ink-400">{r.phone}</p>}
          </div>
        ),
      },
      { key: 'phone', label: 'Phone', kind: 'text', value: (r) => r.phone, hide: 'lg', render: () => null },
      { key: 'items', label: 'Items', kind: 'int', value: (r) => r.items, hide: '2xl' },
      { key: 'taxable', label: 'Taxable', kind: 'money', value: (r) => r.taxable, total: true, hide: '2xl' },
      { key: 'gst', label: 'GST', kind: 'money', value: (r) => r.gst, total: true, hide: '2xl' },
      { key: 'total', label: 'Bill total', kind: 'money', value: (r) => r.grandTotal, total: true, render: (r) => <span className={cn('font-semibold', r.cancelled ? 'text-ink-400 line-through' : 'text-ink-900')}>{money(r.grandTotal)}</span> },
      { key: 'returns', label: 'Returns', kind: 'money', value: (r) => r.returns, total: true, hide: '2xl' },
      { key: 'paid', label: 'Paid', kind: 'money', value: (r) => r.paid, total: true, hide: 'md' },
      { key: 'balance', label: 'Balance', kind: 'money', value: (r) => r.balance, total: true, render: (r) => <span className={r.balance > 0 ? 'font-medium text-amber-700' : 'text-ink-400'}>{money(r.balance)}</span> },
      { key: 'status', label: 'Status', kind: 'text', value: (r) => r.status, hide: 'sm', render: (r) => <StatusBadge status={r.status} /> },
      { key: 'method', label: 'Method', kind: 'text', value: (r) => (r.method === 'Credit' ? 'Pay Later' : r.method), hide: '2xl' },
      { key: 'by', label: 'Billed by', kind: 'text', value: (r) => r.createdBy, hide: '2xl' },
    ],
    [money],
  )
  // the phone shows under the customer's name; its own column is for export only
  const shown = useMemo(() => columns.filter((c) => c.key !== 'phone'), [columns])
  const { view, sort, onSort } = useTableView(rows, columns, { search: q, initial: { key: 'date', dir: 'desc' } })
  const sum = (f: (r: InvoiceReportRow) => number) => view.reduce((t, r) => t + f(r), 0)

  useExport(exporter, () => ({
    fileName: `Invoice-report-${fileStamp(period)}`,
    title: 'Invoice report',
    sections: [toExportTable('Invoices', columns, view)],
    notes: [status === 'active' ? 'Cancelled bills are not included.' : status === 'all' ? 'Includes cancelled bills (their totals are included in the totals row).' : `Only ${status} bills.`, 'Paid is net of refunds. Balance is as of now.'],
  }))

  return (
    <Card className="min-w-0">
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search invoice no., customer or phone" className="sm:w-72" />
        <div className="flex gap-2 sm:ml-auto">
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 min-w-0 flex-1 sm:w-48 sm:flex-none" aria-label="Status">
            <option value="active">All except cancelled</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partly paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Cancelled">Cancelled</option>
            <option value="all">All, including cancelled</option>
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Bill payment method">
            <option value="">All methods</option>
            {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'].map((m) => (
              <option key={m} value={m}>
                {m === 'Credit' ? 'Pay Later' : m}
              </option>
            ))}
          </Select>
        </div>
      </Toolbar>
      {view.length > 0 && (
        <Strip
          items={[
            ['Bills', view.length],
            ['Total', money(sum((r) => r.grandTotal))],
            ['Paid', money(sum((r) => r.paid))],
            ['Balance', money(sum((r) => r.balance))],
          ]}
        />
      )}
      <Truncated show={data.data?.truncated} />
      {data.error && <p className="px-4 py-3 text-sm text-red-600">{data.error}</p>}
      {data.loading && !data.data ? (
        <Loading />
      ) : (
        <DataTable
          columns={shown}
          rows={view}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => r.id}
          onRowClick={(r) => setViewing(r.id)}
          rowClassName={(r) => (r.cancelled ? 'opacity-70' : undefined)}
          empty={<NoMatch any={!!data.data?.rows.length} />}
        />
      )}
      <BillViewModal bill={bills.find((b) => b.id === viewing) ?? null} onClose={() => setViewing(null)} />
    </Card>
  )
}

/* ---------- customer-wise ---------- */

function Customers({ period, exporter }: { period: Period; exporter: Exporter }) {
  const { money } = useApp()
  const data = useResource(() => api.customerReport(period.from, period.to), [period.from, period.to], [...LIVE])
  const [q, setQ] = useState('')
  const [dueOnly, setDueOnly] = useState<'all' | 'due'>('all')
  const rows = useMemo(() => (data.data?.rows ?? []).filter((r) => dueOnly === 'all' || r.balance > 0), [data.data, dueOnly])
  const columns = useMemo<Column<CustomerReportRow>[]>(
    () => [
      { key: 'name', label: 'Customer', kind: 'text', value: (r) => r.name, render: (r) => <span className="font-medium text-ink-900">{r.name}</span> },
      { key: 'phone', label: 'Phone', kind: 'text', value: (r) => r.phone, hide: 'sm' },
      { key: 'bills', label: 'Bills', kind: 'int', value: (r) => r.bills, total: true },
      { key: 'gross', label: 'Gross sales', kind: 'money', value: (r) => r.gross, total: true, hide: 'lg' },
      { key: 'returns', label: 'Returns', kind: 'money', value: (r) => r.returns, total: true, hide: 'lg' },
      { key: 'net', label: 'Net sales', kind: 'money', value: (r) => r.net, total: true, render: (r) => <span className="font-semibold text-ink-900">{money(r.net)}</span> },
      { key: 'paid', label: 'Paid', kind: 'money', value: (r) => r.paid, total: true, hide: 'md' },
      { key: 'balance', label: 'Balance', kind: 'money', value: (r) => r.balance, total: true, render: (r) => <span className={r.balance > 0 ? 'font-medium text-amber-700' : 'text-ink-400'}>{money(r.balance)}</span> },
      { key: 'last', label: 'Last bill', kind: 'date', value: (r) => r.lastBill, hide: 'md' },
    ],
    [money],
  )
  const { view, sort, onSort } = useTableView(rows, columns, { search: q, initial: { key: 'net', dir: 'desc' } })

  useExport(exporter, () => ({
    fileName: `Customer-sales-${fileStamp(period)}`,
    title: 'Customer-wise sales',
    sections: [toExportTable('Customers', columns, view)],
    notes: ['Bills dated in the period, cancelled bills left out. Returns, payments and balance are those recorded against these bills so far.', 'Customers without a saved record are grouped by name and phone.'],
  }))

  return (
    <Card className="min-w-0">
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search customer or phone" className="sm:w-72" />
        <Segmented<'all' | 'due'>
          className="sm:ml-auto"
          value={dueOnly}
          onChange={setDueOnly}
          options={[
            { value: 'all', label: 'All customers' },
            { value: 'due', label: 'With balance due' },
          ]}
        />
      </Toolbar>
      <Truncated show={data.data?.truncated} />
      {data.error && <p className="px-4 py-3 text-sm text-red-600">{data.error}</p>}
      {data.loading && !data.data ? <Loading /> : <DataTable columns={columns} rows={view} sort={sort} onSort={onSort} rowKey={(r) => r.key} empty={<NoMatch any={!!data.data?.rows.length} />} />}
    </Card>
  )
}

/* ---------- payments & collections ---------- */

function Payments({ period, summary: s, exporter }: { period: Period; summary: ReportSummary | null; exporter: Exporter }) {
  const { money } = useApp()
  const data = useResource(() => api.paymentReport(period.from, period.to), [period.from, period.to], [...LIVE])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'PAYMENT' | 'REFUND'>('all')
  const [method, setMethod] = useState('')
  const rows = useMemo(() => (data.data?.rows ?? []).filter((r) => (kind === 'all' || r.kind === kind) && (!method || r.method === method)), [data.data, kind, method])
  const columns = useMemo<Column<PaymentReportRow>[]>(
    () => [
      { key: 'date', label: 'Date', kind: 'date', value: (r) => r.dateKey, render: (r) => <div><p className="text-ink-900">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p><p className="text-xs text-ink-400">{formatTime(r.date)}</p></div> },
      { key: 'invoice', label: 'Invoice', kind: 'text', value: (r) => r.invoiceNo, render: (r) => <span className="font-medium text-ink-900">{r.invoiceNo}</span> },
      { key: 'customer', label: 'Customer', kind: 'text', value: (r) => r.customer, hide: 'md' },
      { key: 'type', label: 'Type', kind: 'text', value: (r) => (r.kind === 'REFUND' ? 'Refund' : 'Payment'), render: (r) => (r.kind === 'REFUND' ? <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/15 ring-inset">Refund</span> : <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/15 ring-inset">Payment</span>) },
      { key: 'method', label: 'Method', kind: 'text', value: (r) => r.method, hide: 'sm', render: (r) => <Pill>{r.method}</Pill> },
      { key: 'reference', label: 'Reference / note', kind: 'text', value: (r) => [r.reference, r.note].filter(Boolean).join(' · '), hide: '2xl' },
      { key: 'by', label: 'Recorded by', kind: 'text', value: (r) => r.userName, hide: '2xl' },
      { key: 'amount', label: 'Amount', kind: 'money', value: (r) => r.amount, total: true, render: (r) => <span className={cn('font-semibold', r.amount < 0 ? 'text-red-600' : 'text-ink-900')}>{money(r.amount)}</span> },
    ],
    [money],
  )
  const { view, sort, onSort } = useTableView(rows, columns, { search: q, initial: { key: 'date', dir: 'desc' } })
  const byMethod = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of view) m.set(r.method, (m.get(r.method) ?? 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [view])
  const received = view.filter((r) => r.amount > 0).reduce((t, r) => t + r.amount, 0)
  const refunded = view.filter((r) => r.amount < 0).reduce((t, r) => t - r.amount, 0)

  useExport(exporter, () => ({
    fileName: `Payments-collections-${fileStamp(period)}`,
    title: 'Payment & collection report',
    sections: [
      toExportTable('Payments', columns, view),
      { title: 'By method', columns: [{ label: 'Method' }, { label: 'Net amount', kind: 'money' }], rows: byMethod.map(([m, v]) => [m, rd(v)]), totals: ['Net collected', rd(received - refunded)] },
    ],
    notes: ['Payments received (+) and refunds given (−) for bills, dated in the period. Each entry is counted once; refunds on cancelled bills and returns are included as negative amounts.'],
  }))

  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search invoice, customer, reference" className="sm:w-72" />
          <div className="flex gap-2 sm:ml-auto">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-9 min-w-0 flex-1 sm:w-36 sm:flex-none" aria-label="Type">
              <option value="all">All entries</option>
              <option value="PAYMENT">Payments</option>
              <option value="REFUND">Refunds</option>
            </Select>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Payment method">
              <option value="">All methods</option>
              {PAY_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </div>
        </Toolbar>
        {view.length > 0 && (
          <Strip
            items={[
              ['Entries', view.length],
              ['Received', money(received)],
              ['Refunded', money(refunded)],
              ['Net', money(received - refunded)],
            ]}
          />
        )}
        <Truncated show={data.data?.truncated} />
        {data.error && <p className="px-4 py-3 text-sm text-red-600">{data.error}</p>}
        {data.loading && !data.data ? <Loading /> : <DataTable columns={columns} rows={view} sort={sort} onSort={onSort} rowKey={(r) => r.id} empty={<NoMatch any={!!data.data?.rows.length} />} />}
      </Card>
      <Card className="h-fit">
        <CardHeader title="By method" subtitle={q || kind !== 'all' || method ? 'Entries matching the filters' : 'Net of refunds'} icon={CreditCard} />
        <div className="p-5">{byMethod.length ? <Bars items={byMethod.map(([m, v]) => [m, rd(v)])} /> : <p className="text-sm text-ink-400">No payments in this period.</p>}</div>
        {s && s.outstanding.total > 0 && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-ink-500">
            Still to collect on all bills: <span className="tabular font-semibold text-amber-700">{money(s.outstanding.total)}</span>
          </p>
        )}
      </Card>
    </div>
  )
}

/* ---------- outstanding ---------- */

type Age = 'all' | '0-30' | '31-60' | '61-90' | '90+'
const AGES: { value: Age; label: string; test: (d: number) => boolean }[] = [
  { value: '0-30', label: '0–30 days', test: (d) => d <= 30 },
  { value: '31-60', label: '31–60 days', test: (d) => d > 30 && d <= 60 },
  { value: '61-90', label: '61–90 days', test: (d) => d > 60 && d <= 90 },
  { value: '90+', label: 'Over 90 days', test: (d) => d > 90 },
]

function Outstanding({ exporter }: { exporter: Exporter }) {
  const { money, bills } = useApp()
  const data = useResource(() => api.outstandingReport(), [], [...LIVE])
  const [q, setQ] = useState('')
  const [age, setAge] = useState<Age>('all')
  const [viewing, setViewing] = useState<string | null>(null)
  const all = useMemo(() => data.data?.rows ?? [], [data.data])
  const rows = useMemo(() => (age === 'all' ? all : all.filter((r) => AGES.find((a) => a.value === age)!.test(r.days))), [all, age])
  const columns = useMemo<Column<OutstandingRow>[]>(
    () => [
      { key: 'no', label: 'Invoice', kind: 'text', value: (r) => r.invoiceNo, render: (r) => <span className="font-medium text-ink-900">{r.invoiceNo}</span> },
      { key: 'date', label: 'Bill date', kind: 'date', value: (r) => r.dateKey },
      { key: 'customer', label: 'Customer', kind: 'text', value: (r) => r.customer },
      { key: 'phone', label: 'Phone', kind: 'text', value: (r) => r.phone, hide: 'sm' },
      { key: 'total', label: 'Bill total', kind: 'money', value: (r) => r.grandTotal, total: true, hide: 'md' },
      { key: 'returns', label: 'Returns', kind: 'money', value: (r) => r.returns, total: true, hide: 'lg' },
      { key: 'paid', label: 'Paid', kind: 'money', value: (r) => r.paid, total: true, hide: 'md' },
      { key: 'balance', label: 'Balance due', kind: 'money', value: (r) => r.balance, total: true, render: (r) => <span className="font-semibold text-amber-700">{money(r.balance)}</span> },
      { key: 'days', label: 'Days', kind: 'int', value: (r) => r.days, render: (r) => <span className={cn('tabular', r.days > 90 ? 'font-semibold text-red-600' : r.days > 30 ? 'text-amber-700' : 'text-ink-700')}>{r.days}</span> },
    ],
    [money],
  )
  const { view, sort, onSort } = useTableView(rows, columns, { search: q, initial: { key: 'days', dir: 'desc' } })
  const buckets = AGES.map((a) => ({ ...a, rows: all.filter((r) => a.test(r.days)) }))

  useExport(exporter, () => ({
    fileName: `Outstanding-${fileStamp()}`,
    title: 'Pending payments / outstanding balances',
    sections: [
      toExportTable('Outstanding bills', columns, view),
      { title: 'By age', columns: [{ label: 'Age' }, { label: 'Bills', kind: 'int' }, { label: 'Balance due', kind: 'money' }], rows: buckets.map((b) => [b.label, b.rows.length, rd(b.rows.reduce((t, r) => t + r.balance, 0))]), totals: ['Total', all.length, rd(all.reduce((t, r) => t + r.balance, 0))] },
    ],
    notes: ['Every bill that still has money due today, whatever its date. Cancelled bills are left out. Days = days since the bill date.'],
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {buckets.map((b) => (
          <button key={b.value} onClick={() => setAge(age === b.value ? 'all' : b.value)} className="text-left">
            <Card className={cn('p-4 transition-shadow hover:shadow-lift', age === b.value && 'ring-2 ring-brand-500')}>
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <Clock className="size-3.5" /> {b.label}
              </p>
              <p className="tabular mt-1 text-lg font-semibold text-ink-900">{money(b.rows.reduce((t, r) => t + r.balance, 0))}</p>
              <p className="text-xs text-ink-400">
                {b.rows.length} {b.rows.length === 1 ? 'bill' : 'bills'}
              </p>
            </Card>
          </button>
        ))}
      </div>
      <Card className="min-w-0">
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search invoice, customer or phone" className="sm:w-72" />
          <Select value={age} onChange={(e) => setAge(e.target.value as Age)} className="h-9 sm:ml-auto sm:w-44" aria-label="Age">
            <option value="all">Any age</option>
            {AGES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Toolbar>
        <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-ink-500">As of today, all dates (not limited to the selected period). Open a bill to record a payment.</p>
        {data.error && <p className="px-4 py-3 text-sm text-red-600">{data.error}</p>}
        {data.loading && !data.data ? (
          <Loading />
        ) : (
          <DataTable
            columns={columns}
            rows={view}
            sort={sort}
            onSort={onSort}
            rowKey={(r) => r.id}
            onRowClick={(r) => setViewing(r.id)}
            empty={all.length ? <NoMatch any /> : <EmptyState icon={Hourglass} title="Nothing outstanding" description="Every bill is fully paid." />}
          />
        )}
        <BillViewModal bill={bills.find((b) => b.id === viewing) ?? null} onClose={() => setViewing(null)} />
      </Card>
    </div>
  )
}

/* ---------- expenses ---------- */

function Expenses({ period, exporter }: { period: Period; exporter: Exporter }) {
  const { money } = useApp()
  const data = useResource(() => api.expenses({ from: period.from, to: period.to, limit: 5000 }), [period.from, period.to], ['expense'])
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [method, setMethod] = useState('')
  const all = useMemo(() => data.data?.items ?? [], [data.data])
  const categories = useMemo(() => [...new Set(all.map((e) => e.category))].sort(), [all])
  const rows = useMemo(() => all.filter((e) => (!category || e.category === category) && (!method || e.paymentMethod === method)), [all, category, method])
  const columns = useMemo<Column<Expense>[]>(
    () => [
      { key: 'date', label: 'Date', kind: 'date', value: (e) => e.dateKey, hide: 'sm' },
      {
        key: 'title',
        label: 'Expense',
        kind: 'text',
        value: (e) => e.title || e.category,
        render: (e) => (
          <div className="min-w-[140px]">
            <p className="font-medium text-ink-900">{e.title || e.category}</p>
            <p className="text-xs text-ink-400 sm:hidden">
              {new Date(`${e.dateKey}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {e.category}
            </p>
          </div>
        ),
      },
      { key: 'category', label: 'Category', kind: 'text', value: (e) => e.category, hide: 'sm', render: (e) => <Pill>{e.category}</Pill> },
      { key: 'method', label: 'Paid by', kind: 'text', value: (e) => e.paymentMethod, hide: 'md' },
      { key: 'reference', label: 'Reference', kind: 'text', value: (e) => e.reference, hide: '2xl' },
      { key: 'notes', label: 'Notes', kind: 'text', value: (e) => e.description, hide: '2xl', render: (e) => <span className="block max-w-[220px] truncate">{e.description || '—'}</span> },
      { key: 'by', label: 'Added by', kind: 'text', value: (e) => e.userName, hide: '2xl' },
      { key: 'receipt', label: 'Receipt', kind: 'text', value: (e) => (e.attachment ? 'Yes' : ''), hide: '2xl' },
      { key: 'amount', label: 'Amount', kind: 'money', value: (e) => e.amount, total: true, render: (e) => <span className="font-semibold text-ink-900">{money(e.amount)}</span> },
    ],
    [money],
  )
  const { view, sort, onSort } = useTableView(rows, columns, { search: q, searchText: (e) => `${e.title} ${e.category} ${e.description} ${e.reference ?? ''} ${e.userName ?? ''}`, initial: { key: 'date', dir: 'desc' } })
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of view) m.set(e.category, (m.get(e.category) ?? 0) + e.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [view])

  useExport(exporter, () => ({
    fileName: `Expense-report-${fileStamp(period)}`,
    title: 'Expense report',
    sections: [
      toExportTable('Expenses', columns, view),
      { title: 'By category', columns: [{ label: 'Category' }, { label: 'Amount', kind: 'money' }], rows: byCategory.map(([c, v]) => [c, rd(v)]), totals: ['Total', rd(view.reduce((t, e) => t + e.amount, 0))] },
    ],
    notes: ['Expenses dated in the period, as recorded on the Expenses screen.'],
  }))

  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search title, notes, reference" className="sm:w-72" />
          <div className="flex gap-2 sm:ml-auto">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Payment method">
              <option value="">All methods</option>
              {PAY_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </div>
        </Toolbar>
        {view.length > 0 && (
          <Strip
            items={[
              ['Entries', view.length],
              ['Total', money(view.reduce((t, e) => t + e.amount, 0))],
            ]}
          />
        )}
        {data.data && data.data.total > data.data.items.length && <Truncated show />}
        {data.error && <p className="px-4 py-3 text-sm text-red-600">{data.error}</p>}
        {data.loading && !data.data ? <Loading /> : <DataTable columns={columns} rows={view} sort={sort} onSort={onSort} rowKey={(e) => e.id} empty={<NoMatch any={all.length > 0} />} />}
      </Card>
      <Card className="h-fit">
        <CardHeader title="By category" icon={Wallet} />
        <div className="p-5">{byCategory.length ? <Bars items={byCategory.map(([c, v]) => [c, rd(v)])} /> : <p className="text-sm text-ink-400">No expenses in this period.</p>}</div>
      </Card>
    </div>
  )
}
