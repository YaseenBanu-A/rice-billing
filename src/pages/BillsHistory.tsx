import { Eye, FileDown, Plus, Printer, ReceiptText, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BillViewModal } from '../components/BillViewModal'
import { SyncChip } from '../components/SyncStatus'
import { Avatar, Button, Card, EmptyState, IconButton, Input, PageHeader, Pill, SearchInput, Segmented, Select, StatusBadge, cn, td, th } from '../components/ui'
import { formatDate, formatTime, toDateKey } from '../lib/format'
import { useApp } from '../store/AppContext'
import type { Bill, PaymentStatus } from '../types'

type Range = 'all' | 'today' | '7d' | '30d' | 'custom'

export function BillsHistory() {
  const { bills, money, navigate, printBill, downloadPdf } = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<PaymentStatus | 'all'>('all')
  const [range, setRange] = useState<Range>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [viewingId, setViewingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const today = toDateKey(new Date())
    const daysAgo = (n: number) => toDateKey(new Date(Date.now() - n * 86_400_000))
    const [start, end] =
      range === 'today' ? [today, today] : range === '7d' ? [daysAgo(6), today] : range === '30d' ? [daysAgo(29), today] : range === 'custom' ? [from, to] : ['', '']

    return [...bills]
      .filter((b) => {
        const key = toDateKey(b.date)
        if (start && key < start) return false
        if (end && key > end) return false
        if (status !== 'all' && b.status !== status) return false
        if (q && !(b.invoiceNo.toLowerCase().includes(q) || b.customer.name.toLowerCase().includes(q) || b.customer.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [bills, query, status, range, from, to])

  const total = filtered.reduce((s, b) => s + b.totals.grandTotal, 0)
  const due = filtered.reduce((s, b) => s + b.totals.balance, 0)
  const viewing = bills.find((b) => b.id === viewingId) ?? null
  const hasFilters = query || status !== 'all' || range !== 'all'

  return (
    <div>
      <PageHeader
        title="Bills History"
        subtitle={`${bills.length} invoices in your billing database`}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => navigate('create')}>
            New Bill
          </Button>
        }
      />

      <Card>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder="Search invoice no., customer or phone" className="lg:w-80" />
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <Segmented<Range>
              value={range}
              onChange={setRange}
              options={[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus | 'all')} className="h-9 w-auto!" aria-label="Payment status">
              <option value="all">All statuses</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Unpaid">Unpaid</option>
            </Select>
          </div>
        </div>
        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-sm text-ink-500">
            From
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto!" />
            to
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto!" />
          </div>
        )}

        {/* Summary strip */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-xs text-ink-500">
            <span>
              <span className="font-semibold text-ink-900">{filtered.length}</span> bills
            </span>
            <span>
              Total <span className="tabular font-semibold text-ink-900">{money(total)}</span>
            </span>
            <span>
              Balance due <span className="tabular font-semibold text-amber-700">{money(due)}</span>
            </span>
          </div>
        )}

        {bills.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No bills yet" description="Create your first bill and it will appear here." action={<Button variant="primary" icon={Plus} onClick={() => navigate('create')}>Create Bill</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No bills match your filters"
            description="Try a different search term or date range."
            action={
              hasFilters && (
                <Button
                  onClick={() => {
                    setQuery('')
                    setStatus('all')
                    setRange('all')
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Invoice No.</th>
                  <th className={th}>Date</th>
                  <th className={th}>Customer</th>
                  <th className={cn(th, 'text-right')}>Total</th>
                  <th className={th}>Status</th>
                  <th className={th}>Method</th>
                  <th className={cn(th, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b: Bill) => (
                  <tr key={b.id} className="transition-colors hover:bg-slate-50/70">
                    <td className={td}>
                      <button onClick={() => setViewingId(b.id)} className="font-medium text-ink-900 hover:text-brand-700">
                        {b.invoiceNo}
                      </button>
                      <div>
                        <SyncChip id={b.id} />
                      </div>
                    </td>
                    <td className={td}>
                      <p className="text-ink-900">{formatDate(b.date)}</p>
                      <p className="text-xs text-ink-400">{formatTime(b.date)}</p>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <Avatar name={b.customer.name} />
                        <div>
                          <p className="text-ink-900">{b.customer.name}</p>
                          {b.customer.phone && <p className="text-xs text-ink-400">{b.customer.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={cn(td, 'tabular text-right')}>
                      <p className="font-semibold text-ink-900">{money(b.totals.grandTotal)}</p>
                      {b.totals.balance > 0 && <p className="text-xs text-amber-700">Due {money(b.totals.balance)}</p>}
                    </td>
                    <td className={td}>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className={td}>
                      <Pill>{b.paymentMethod === 'Credit' ? 'Pay Later' : b.paymentMethod}</Pill>
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <div className="inline-flex gap-0.5">
                        <IconButton icon={Eye} label="View bill" onClick={() => setViewingId(b.id)} />
                        <IconButton icon={Printer} label="Print bill" onClick={() => printBill(b)} />
                        <IconButton icon={FileDown} label="Download PDF" onClick={() => downloadPdf(b)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BillViewModal bill={viewing} onClose={() => setViewingId(null)} />
    </div>
  )
}
