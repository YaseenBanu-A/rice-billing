import { Archive, ArchiveRestore, CalendarDays, CalendarRange, Check, FileDown, FileSpreadsheet, FileText, Lock, Paperclip, Pencil, Plus, ReceiptText, SearchX, Tags, Trash2, TrendingUp, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { DataTable, PeriodPicker, StatCard, periodText, toExportTable, useTableView, type Column } from '../components/DataTable'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, Pill, SearchInput, Select, Textarea, cn } from '../components/ui'
import { api, ApiError, requestId } from '../lib/api'
import { PAY_METHODS } from '../lib/billing'
import { exportExcel, exportPdf, type ExportDoc } from '../lib/export'
import { currencySymbol, formatTime, toDateKey } from '../lib/format'
import { useResource } from '../lib/live'
import { periodOf, type Period } from '../lib/period'
import { formatBytes, prepareReceipt, RECEIPT_ACCEPT } from '../lib/receipt'
import { useApp } from '../store/AppContext'
import type { Expense, ExpenseCategory, ExpenseInput, PayMethod } from '../types'

/*
 * Expenses: money spent running the shop (rent, salaries, electricity …). Every row is an Expense record in
 * the database; the Reports screen subtracts these from sales for the profit summary.
 */

export function Expenses() {
  const { can, money, toast, settings, user } = useApp()
  const manage = can('expenses.manage')

  const [period, setPeriod] = useState<Period>(() => periodOf('month'))
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [method, setMethod] = useState('')
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [viewingReceipt, setViewingReceipt] = useState<Expense | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)

  const list = useResource(() => api.expenses({ from: period.from, to: period.to, limit: 5000 }), [period.from, period.to], ['expense'])
  const summary = useResource(() => api.expenseSummary(period.from, period.to), [period.from, period.to], ['expense'])
  const cats = useResource(() => api.expenseCategories(), [], ['expense'])

  const filtered = useMemo(
    () => (list.data?.items ?? []).filter((e) => (!categoryId || e.categoryId === categoryId) && (!method || e.paymentMethod === method)),
    [list.data, categoryId, method],
  )

  const columns = useMemo<Column<Expense>[]>(
    () => [
      { key: 'date', label: 'Date', kind: 'date', value: (e) => e.dateKey, hide: 'sm' },
      {
        key: 'title',
        label: 'Expense',
        kind: 'text',
        value: (e) => e.title || e.category,
        render: (e) => (
          <div className="max-w-[260px] min-w-[140px]">
            <p className="truncate font-medium text-ink-900">{e.title || e.category}</p>
            {/* on phones the date and category columns are folded in here */}
            <p className="truncate text-xs text-ink-400 sm:hidden">
              {new Date(`${e.dateKey}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {e.category}
            </p>
            {e.description && <p className="hidden truncate text-xs text-ink-400 sm:block">{e.description}</p>}
          </div>
        ),
      },
      { key: 'category', label: 'Category', kind: 'text', value: (e) => e.category, hide: 'sm', render: (e) => <Pill>{e.category}</Pill> },
      { key: 'method', label: 'Paid by', kind: 'text', value: (e) => e.paymentMethod, hide: 'md' },
      { key: 'reference', label: 'Reference', kind: 'text', value: (e) => e.reference, hide: '2xl' },
      { key: 'notes', label: 'Notes', kind: 'text', value: (e) => e.description, hide: '2xl', render: (e) => <span className="block max-w-[200px] truncate">{e.description || '—'}</span> },
      { key: 'by', label: 'Added by', kind: 'text', value: (e) => e.userName, hide: '2xl' },
      { key: 'amount', label: 'Amount', kind: 'money', value: (e) => e.amount, total: true, render: (e) => <span className="font-semibold text-ink-900">{money(e.amount)}</span> },
      {
        key: 'actions',
        label: '',
        sortable: false,
        noExport: true,
        value: () => '',
        render: (e) => (
          <div className="flex justify-end gap-0.5" onClick={(ev) => ev.stopPropagation()}>
            {e.attachment && <IconButton icon={Paperclip} label={`Receipt: ${e.attachment.fileName}`} onClick={() => setViewingReceipt(e)} className="text-brand-600" />}
            {manage && <IconButton icon={Pencil} label="Edit expense" onClick={() => setEditing(e)} />}
            {manage && <IconButton icon={Trash2} label="Delete expense" tone="danger" onClick={() => setDeleting(e)} />}
          </div>
        ),
      },
    ],
    [money, manage],
  )
  const { view, sort, onSort } = useTableView(filtered, columns, {
    search: q,
    searchText: (e) => `${e.title} ${e.category} ${e.description} ${e.reference ?? ''} ${e.paymentMethod} ${e.userName ?? ''}`,
    initial: { key: 'date', dir: 'desc' },
  })

  const viewTotal = view.reduce((s, e) => s + e.amount, 0)
  const byCategory = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>()
    for (const e of view) {
      const x = m.get(e.category) ?? { total: 0, count: 0 }
      x.total += e.amount
      x.count++
      m.set(e.category, x)
    }
    return [...m.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total)
  }, [view])

  if (!can('expenses.view'))
    return (
      <Card>
        <EmptyState icon={Lock} title="Expenses are for managers" description="Ask an administrator if you need to record or view shop expenses." />
      </Card>
    )

  const hasFilters = !!(q || categoryId || method)
  const exportDoc = (): ExportDoc => ({
    fileName: `Expenses-${period.from}-to-${period.to}`,
    business: settings.businessName,
    title: 'Expense report',
    period: periodText(period),
    generatedBy: user.name,
    sections: [
      toExportTable('Expenses', columns, view),
      {
        title: 'By category',
        columns: [{ label: 'Category' }, { label: 'Entries', kind: 'int' }, { label: 'Amount', kind: 'money' }],
        rows: byCategory.map((c) => [c.category, c.count, c.total]),
        totals: ['Total', view.length, Math.round(viewTotal * 100) / 100],
      },
    ],
    notes: [
      hasFilters ? `Filtered: ${[q && `search "${q}"`, categoryId && `category ${cats.data?.find((c) => c.id === categoryId)?.name}`, method && `paid by ${method}`].filter(Boolean).join(', ')}.` : 'All expenses recorded in the period.',
    ],
  })
  const runExport = async (kind: 'xlsx' | 'pdf') => {
    try {
      if (kind === 'xlsx') exportExcel(exportDoc())
      else await exportPdf(exportDoc())
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the file', 'error')
    }
  }

  const remove = async (e: Expense) => {
    try {
      await api.deleteExpense(e.id)
      toast(`Expense deleted: ${e.title || e.category} · ${money(e.amount)}`)
      list.reload()
      summary.reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the expense', 'error')
    }
  }

  const s = summary.data
  const top = s?.byCategory[0]
  const truncated = list.data && list.data.total > list.data.items.length

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink-900">Expenses</h1>
          <p className="mt-1.5 text-sm text-ink-500">Rent, salaries, bills and other money spent running the shop</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manage && (
            <Button icon={Tags} onClick={() => setManagingCategories(true)}>
              Categories
            </Button>
          )}
          <Button icon={FileSpreadsheet} onClick={() => runExport('xlsx')} disabled={!view.length}>
            Excel
          </Button>
          <Button icon={FileDown} onClick={() => runExport('pdf')} disabled={!view.length}>
            PDF
          </Button>
          {manage && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Add Expense
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Today" icon={CalendarDays} value={s ? money(s.today.total) : '…'} hint={s ? `${s.today.count} ${s.today.count === 1 ? 'entry' : 'entries'}` : undefined} />
        <StatCard label="This month" icon={CalendarRange} tone="emerald" value={s ? money(s.month.total) : '…'} hint={s ? `${s.month.count} ${s.month.count === 1 ? 'entry' : 'entries'}` : undefined} />
        <StatCard label="Selected period" icon={Wallet} tone="amber" value={s ? money(s.period.total) : '…'} hint={s ? `${s.period.count} entries · ${money(s.period.average)} a day` : undefined} />
        <StatCard label="Biggest category" icon={TrendingUp} tone="red" value={<span className="block truncate">{top ? top.category : '—'}</span>} hint={top && s ? `${money(top.total)} · ${Math.round((top.total / (s.period.total || 1)) * 100)}% of the period` : 'No expenses in the period'} />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput value={q} onChange={setQ} placeholder="Search title, notes, reference…" className="sm:w-72" />
              <div className="flex gap-2 sm:ml-auto">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label="Category">
                  <option value="">All categories</option>
                  {(cats.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? '' : ' (archived)'}
                    </option>
                  ))}
                </Select>
                <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Payment method">
                  <option value="">All methods</option>
                  {PAY_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {view.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-xs text-ink-500">
              <span>{periodText(period)}</span>
              <span>
                <span className="font-semibold text-ink-900">{view.length}</span> expenses
              </span>
              <span>
                Total <span className="tabular font-semibold text-ink-900">{money(viewTotal)}</span>
              </span>
            </div>
          )}
          {truncated && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">This period has more than 5,000 expenses: only the latest 5,000 are listed. Choose a shorter period.</p>}
          {list.error && <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{list.error}</p>}

          {list.loading && !list.data ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={view}
              sort={sort}
              onSort={onSort}
              rowKey={(e) => e.id}
              onRowClick={manage ? (e) => setEditing(e) : undefined}
              empty={
                (list.data?.items.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={ReceiptText}
                    title="No expenses in this period"
                    description="Record rent, salaries, electricity and other costs to see them here and in the profit report."
                    action={manage && <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add Expense</Button>}
                  />
                ) : (
                  <EmptyState
                    icon={SearchX}
                    title="No expenses match your filters"
                    action={
                      hasFilters && (
                        <Button
                          onClick={() => {
                            setQ('')
                            setCategoryId('')
                            setMethod('')
                          }}
                        >
                          Clear filters
                        </Button>
                      )
                    }
                  />
                )
              }
            />
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader title="By category" subtitle={hasFilters ? 'Expenses matching the filters' : 'Selected period'} icon={Tags} />
          <div className="space-y-3 p-5">
            {byCategory.length === 0 ? (
              <p className="text-sm text-ink-400">Nothing recorded.</p>
            ) : (
              byCategory.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span className="truncate text-ink-700">
                      {c.category} <span className="text-ink-400">· {c.count}</span>
                    </span>
                    <span className="tabular font-medium text-ink-900">{money(c.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(c.total / (byCategory[0].total || 1)) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            {s && s.byMethod.length > 0 && !hasFilters && (
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium text-ink-500">By payment method</p>
                {s.byMethod.map((m) => (
                  <div key={m.method} className="flex justify-between py-0.5 text-xs">
                    <span className="text-ink-700">{m.method}</span>
                    <span className="tabular font-medium text-ink-900">{money(m.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {editing && (
        <ExpenseModal
          expense={editing === 'new' ? null : editing}
          categories={cats.data ?? []}
          onCategoriesChanged={cats.reload}
          onClose={() => setEditing(null)}
          onSaved={() => {
            list.reload()
            summary.reload()
            cats.reload()
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this expense?"
        message={deleting ? `${deleting.title || deleting.category} · ${money(deleting.amount)} on ${new Date(deleting.date).toLocaleDateString('en-IN')}${deleting.attachment ? ' and its receipt' : ''} will be removed permanently. Reports will no longer include it.` : ''}
        confirmLabel="Delete expense"
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
      {viewingReceipt && <ReceiptModal expense={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
      {managingCategories && <CategoriesModal categories={cats.data ?? []} reload={cats.reload} onClose={() => setManagingCategories(false)} />}
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-ink-500">
      <span className="size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      Loading…
    </div>
  )
}

/* ---------- add / edit ---------- */

type Receipt = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; file: Blob; name: string }

function ExpenseModal({ expense, categories, onCategoriesChanged, onClose, onSaved }: { expense: Expense | null; categories: ExpenseCategory[]; onCategoriesChanged: () => void; onClose: () => void; onSaved: () => void }) {
  const { toast, money, settings } = useApp()
  const [f, setF] = useState({
    title: expense?.title ?? '',
    categoryId: expense?.categoryId ?? '',
    amount: expense ? String(expense.amount) : '',
    date: expense?.dateKey ?? toDateKey(new Date()),
    paymentMethod: (expense?.paymentMethod ?? 'Cash') as PayMethod,
    reference: expense?.reference ?? '',
    description: expense?.description ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [receipt, setReceipt] = useState<Receipt>({ kind: 'keep' })
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState<string | null>(null)
  // one key per form: a double click or a retry after a network drop saves once
  const key = useRef(requestId())
  const fileInput = useRef<HTMLInputElement>(null)

  // archived categories are offered only to the expense already filed under one
  const options = categories.filter((c) => c.active || c.id === expense?.categoryId)
  useEffect(() => {
    if (!f.categoryId && options.length && !expense) setF((x) => ({ ...x, categoryId: options.find((c) => c.name === 'Other')?.id ?? '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length])

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setPreparing(true)
    try {
      const r = await prepareReceipt(file)
      setReceipt({ kind: 'new', ...r })
      setErrors((e) => ({ ...e, receipt: '' }))
    } catch (err) {
      setErrors((e) => ({ ...e, receipt: err instanceof Error ? err.message : 'Could not read the file' }))
    } finally {
      setPreparing(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const addCategory = async () => {
    const name = (newCat ?? '').trim()
    if (!name) return setNewCat(null)
    try {
      const c = await api.createExpenseCategory(name)
      onCategoriesChanged()
      set('categoryId', c.id)
      setNewCat(null)
    } catch (err) {
      setErrors((e) => ({ ...e, categoryId: err instanceof Error ? err.message : 'Could not add the category' }))
    }
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const amount = Number(f.amount)
    const errs: Record<string, string> = {
      title: f.title.trim() ? '' : 'Enter what the expense was for',
      categoryId: f.categoryId ? '' : 'Choose a category',
      amount: f.amount && Number.isFinite(amount) && amount > 0 ? '' : 'Enter an amount greater than zero',
      date: f.date ? (f.date > toDateKey(new Date()) ? 'Date cannot be in the future' : '') : 'Choose the date',
    }
    if (Object.values(errs).some(Boolean)) return setErrors(errs)

    const input: ExpenseInput = {
      // keep the original time of day when the date is unchanged
      date: expense && f.date === expense.dateKey ? expense.date : f.date,
      title: f.title.trim(),
      categoryId: f.categoryId,
      category: categories.find((c) => c.id === f.categoryId)?.name ?? '',
      amount: Math.round(amount * 100) / 100,
      paymentMethod: f.paymentMethod,
      reference: f.reference.trim() || undefined,
      description: f.description.trim(),
      clientRequestId: expense ? undefined : key.current,
    }
    setSaving(true)
    try {
      const saved = expense ? await api.updateExpense(expense.id, input) : await api.createExpense(input)
      let receiptError = ''
      try {
        if (receipt.kind === 'new') await api.uploadReceipt(saved.id, receipt.file, receipt.name)
        if (receipt.kind === 'remove' && expense?.attachment) await api.deleteReceipt(saved.id)
      } catch (err) {
        receiptError = err instanceof Error ? err.message : 'unknown error'
      }
      onSaved()
      if (receiptError) toast(`Expense saved, but the receipt was not: ${receiptError}`, 'error')
      else toast(`${expense ? 'Expense updated' : 'Expense added'}: ${saved.title || saved.category} · ${money(saved.amount)}`)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields)
      toast(err instanceof Error ? err.message : 'Could not save the expense', 'error')
    } finally {
      setSaving(false)
    }
  }

  const current = receipt.kind === 'new' ? { name: receipt.name, size: receipt.file.size } : receipt.kind === 'keep' && expense?.attachment ? { name: expense.attachment.fileName, size: expense.attachment.size } : null

  return (
    <Modal
      open
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      subtitle={expense ? `Added ${new Date(expense.createdAt).toLocaleDateString('en-IN')} ${formatTime(expense.createdAt)}${expense.userName ? ` by ${expense.userName}` : ''}` : 'Saved to the database and included in reports'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="expense-form" disabled={saving || preparing}>
            {saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Expense title" error={errors.title} htmlFor="x-title">
            <Input id="x-title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Shop rent for November" maxLength={120} invalid={!!errors.title} autoFocus />
          </Field>
        </div>

        <Field label="Category" error={errors.categoryId || errors.category} htmlFor="x-cat">
          {newCat === null ? (
            <div className="flex gap-2">
              <Select id="x-cat" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} className="min-w-0 flex-1">
                <option value="">Choose…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? '' : ' (archived)'}
                  </option>
                ))}
              </Select>
              <Button icon={Plus} onClick={() => setNewCat('')} aria-label="New category" title="New category" className="px-3" />
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="New category name"
                maxLength={60}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewCat(null)
                  }
                }}
              />
              <IconButton icon={Check} label="Add category" onClick={addCategory} className="size-10" />
              <IconButton icon={X} label="Cancel" onClick={() => setNewCat(null)} className="size-10" />
            </div>
          )}
        </Field>

        <Field label={`Amount (${currencySymbol(settings.currency)})`} error={errors.amount} htmlFor="x-amount">
          <Input id="x-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" invalid={!!errors.amount} className="tabular" />
        </Field>

        <Field label="Date" error={errors.date} htmlFor="x-date">
          <Input id="x-date" type="date" value={f.date} max={toDateKey(new Date())} onChange={(e) => set('date', e.target.value)} invalid={!!errors.date} />
        </Field>

        <Field label="Payment method" error={errors.paymentMethod} htmlFor="x-method">
          <Select id="x-method" value={f.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Reference" optional hint="Bill / voucher number, UPI or bank transaction ID" htmlFor="x-ref">
            <Input id="x-ref" value={f.reference} onChange={(e) => set('reference', e.target.value)} maxLength={100} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description / notes" optional htmlFor="x-notes">
            <Textarea id="x-notes" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} rows={3} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Receipt or bill" optional error={errors.receipt} hint="Photo (JPG, PNG, WebP) or PDF, up to 2 MB. Large photos are reduced automatically.">
            <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            {current ? (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <FileText className="size-4 shrink-0 text-brand-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-900">{current.name}</p>
                  <p className="text-xs text-ink-400">
                    {formatBytes(current.size)}
                    {receipt.kind === 'new' ? ' · will be uploaded on save' : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                  Replace
                </Button>
                <IconButton icon={Trash2} label="Remove receipt" tone="danger" onClick={() => setReceipt(expense?.attachment ? { kind: 'remove' } : { kind: 'keep' })} />
              </div>
            ) : (
              <Button icon={Paperclip} onClick={() => fileInput.current?.click()} disabled={preparing} className="w-full border-dashed">
                {preparing ? 'Preparing…' : receipt.kind === 'remove' ? 'Receipt will be removed on save · attach another' : 'Attach receipt'}
              </Button>
            )}
          </Field>
        </div>
      </form>
    </Modal>
  )
}

/* ---------- receipt viewer ---------- */

function ReceiptModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const info = expense.attachment!
  const isImage = info.mimeType.startsWith('image/')

  useEffect(() => {
    let objectUrl: string | null = null
    api
      .receipt(expense.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the receipt'))
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [expense.id])

  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = info.fileName
    a.click()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Receipt"
      subtitle={`${expense.title || expense.category} · ${info.fileName} · ${formatBytes(info.size)}`}
      size="lg"
      footer={
        <>
          {!isImage && (
            <Button icon={FileText} onClick={() => url && window.open(url, '_blank', 'noopener')} disabled={!url}>
              Open PDF
            </Button>
          )}
          <Button variant="primary" icon={FileDown} onClick={download} disabled={!url}>
            Download
          </Button>
        </>
      }
    >
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !url ? (
        <Loading />
      ) : isImage ? (
        <img src={url} alt={`Receipt for ${expense.title || expense.category}`} className="mx-auto max-h-[65vh] rounded-lg border border-slate-200 object-contain" />
      ) : (
        <EmptyState icon={FileText} title={info.fileName} description="PDF receipt. Open it in a new tab or download it." />
      )}
    </Modal>
  )
}

/* ---------- category management ---------- */

function CategoriesModal({ categories, reload, onClose }: { categories: ExpenseCategory[]; reload: () => void; onClose: () => void }) {
  const { toast, money } = useApp()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      reload()
      toast(ok)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Enter a category name')
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return setError(`"${n}" already exists`)
    if (await run(() => api.createExpenseCategory(n), `Category "${n}" added`)) setName('')
  }

  const saveRename = async () => {
    if (!renaming) return
    const c = categories.find((x) => x.id === renaming.id)!
    const n = renaming.name.trim()
    if (!n || n === c.name) return setRenaming(null)
    if (await run(() => api.updateExpenseCategory(c.id, { name: n, active: c.active }), `Renamed to "${n}"${c.expenseCount ? ` on ${c.expenseCount} expenses` : ''}`)) setRenaming(null)
  }

  const sorted = [...categories].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <Modal open onClose={onClose} title="Expense categories" subtitle="Renaming updates the expenses filed under it. A category in use is archived instead of deleted." size="lg">
      <form onSubmit={add} className="mb-4 flex gap-2">
        <div className="flex-1">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            placeholder="New category, e.g. Internet & phone"
            maxLength={60}
            invalid={!!error}
            aria-label="New category name"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <Button type="submit" variant="primary" icon={Plus} disabled={busy}>
          Add
        </Button>
      </form>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {sorted.map((c) => (
          <div key={c.id} className={cn('flex items-center gap-3 px-4 py-2.5', !c.active && 'bg-slate-50/60')}>
            <div className="min-w-0 flex-1">
              {renaming?.id === c.id ? (
                <Input
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  maxLength={60}
                  autoFocus
                  className="h-8"
                  aria-label="Category name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <>
                  <p className={cn('truncate text-sm font-medium', c.active ? 'text-ink-900' : 'text-ink-400')}>
                    {c.name}
                    {!c.active && <span className="ml-2 rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-500 uppercase">Archived</span>}
                  </p>
                  <p className="text-xs text-ink-400">{c.expenseCount ? `${c.expenseCount} expenses · ${money(c.total)}` : 'Not used yet'}</p>
                </>
              )}
            </div>
            {renaming?.id === c.id ? (
              <>
                <IconButton icon={Check} label="Save name" onClick={saveRename} />
                <IconButton icon={X} label="Cancel" onClick={() => setRenaming(null)} />
              </>
            ) : (
              <div className="flex gap-0.5">
                <IconButton icon={Pencil} label="Rename" onClick={() => setRenaming({ id: c.id, name: c.name })} />
                {c.active ? (
                  c.expenseCount > 0 ? (
                    <IconButton icon={Archive} label="Archive (hide from new expenses)" onClick={() => run(() => api.updateExpenseCategory(c.id, { name: c.name, active: false }), `"${c.name}" archived`)} />
                  ) : (
                    <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => setDeleting(c)} />
                  )
                ) : (
                  <IconButton icon={ArchiveRestore} label="Restore" onClick={() => run(() => api.updateExpenseCategory(c.id, { name: c.name, active: true }), `"${c.name}" restored`)} />
                )}
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">No categories yet. Add one above.</p>}
      </div>
      <ConfirmDialog
        open={!!deleting}
        title="Delete category?"
        message={deleting ? `"${deleting.name}" is not used by any expense and will be deleted.` : ''}
        onConfirm={() => deleting && run(() => api.deleteExpenseCategory(deleting.id), `"${deleting.name}" deleted`)}
        onClose={() => setDeleting(null)}
      />
    </Modal>
  )
}
