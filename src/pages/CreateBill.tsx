import {
  Banknote,
  CalendarDays,
  Check,
  CreditCard,
  FileDown,
  HandCoins,
  Landmark,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  ShoppingCart,
  Smartphone,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BusinessMark } from '../components/BusinessMark'
import { FormatSwitch } from '../components/invoice/FormatSwitch'
import { Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Segmented, StatusBadge, Textarea, cn } from '../components/ui'
import { UNITS, computeTotals, paymentStatus } from '../lib/billing'
import { currencySymbol, initials, toDateKey, uid } from '../lib/format'
import { useLocalStorage } from '../lib/useLocalStorage'
import { useApp } from '../store/AppContext'
import type { Bill, BillCustomer, BillInput, BillItem, DiscountType, InvoiceFormat, PaymentMethod } from '../types'

interface Draft {
  id: string
  invoiceNo: string
  date: string // yyyy-mm-dd
  customer: BillCustomer
  saveCustomer: boolean
  items: BillItem[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  paymentMethod: PaymentMethod
  amountPaid: string
  notes: string
  dirty: boolean
  /** version of the saved bill (the server refuses an edit made from an out-of-date copy) */
  version?: number
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: 'Cash', label: 'Cash', icon: Banknote },
  { value: 'UPI', label: 'UPI', icon: Smartphone },
  { value: 'Card', label: 'Card', icon: CreditCard },
  { value: 'Bank Transfer', label: 'Bank', icon: Landmark },
  { value: 'Credit', label: 'Pay Later', icon: HandCoins },
]

const GST_RATES = [0, 5, 12, 18, 28]

const num = (n: number) => (Number.isFinite(n) ? n : 0)

// Survives remounts, so a request made from another page is handled once when this page opens
let handledNewBillRequest = 0

export function CreateBill() {
  const app = useApp()
  const { settings, customers, bills, money, toast } = app
  const sym = currencySymbol(settings.currency)

  const blankDraft = (): Draft => ({
    id: uid('draft-'),
    invoiceNo: '',
    date: toDateKey(new Date()),
    customer: { name: '', phone: '', address: '' },
    saveCustomer: true,
    items: [],
    discountType: 'percent',
    discountValue: 0,
    gstInclusive: settings.gstInclusive,
    paymentMethod: 'Cash',
    amountPaid: '',
    notes: '',
    dirty: false,
  })

  const [draft, setDraft] = useLocalStorage<Draft>('bd.draft', blankDraft)
  const [confirmNew, setConfirmNew] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [format, setFormat] = useState<InvoiceFormat>(settings.invoiceFormat)

  const isSaved = bills.some((b) => b.id === draft.id)
  // Unsaved bills show the server's next number; the real one is assigned when saving
  const invoiceNo = isSaved ? draft.invoiceNo : app.nextInvoiceNo

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p, dirty: true }))
  const patchItem = (id: string, p: Partial<BillItem>) =>
    setDraft((d) => ({ ...d, dirty: true, items: d.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }))

  const totals = useMemo(
    () =>
      computeTotals({
        items: draft.items.map((i) => ({ ...i, price: Math.max(num(i.price), 0), quantity: Math.max(num(i.quantity), 0) })),
        discountType: draft.discountType,
        discountValue: num(draft.discountValue),
        gstInclusive: draft.gstInclusive,
        amountPaid: num(parseFloat(draft.amountPaid)),
      }),
    [draft.items, draft.discountType, draft.discountValue, draft.gstInclusive, draft.amountPaid],
  )
  const status = paymentStatus(totals)

  /* ---------- validation ---------- */
  const itemErrors = (i: BillItem) => ({
    name: !i.name.trim() ? 'Enter the item name' : '',
    price: !Number.isFinite(i.price) || i.price < 0 ? 'Enter a valid price' : '',
    quantity: !Number.isFinite(i.quantity) || i.quantity <= 0 ? 'Min 1' : '',
  })
  const discountError =
    draft.discountValue < 0
      ? 'Discount cannot be negative'
      : draft.discountType === 'percent' && draft.discountValue > 100
        ? 'Cannot exceed 100%'
        : draft.discountType === 'amount' && draft.discountValue > totals.subtotal && totals.subtotal > 0
          ? 'Cannot exceed subtotal'
          : ''
  const paidNum = parseFloat(draft.amountPaid)
  const paidError = draft.amountPaid !== '' && (!Number.isFinite(paidNum) || paidNum < 0) ? 'Enter a valid amount' : ''

  function validate(): string | null {
    if (draft.items.length === 0) return 'Add at least one item to the bill.'
    if (draft.items.some((i) => itemErrors(i).name)) return 'Every item needs a name.'
    if (draft.items.some((i) => itemErrors(i).quantity)) return 'Quantities must be greater than zero.'
    if (draft.items.some((i) => itemErrors(i).price)) return 'Prices cannot be empty or negative.'
    if (discountError) return discountError
    if (paidError) return paidError
    if (draft.customer.phone && !/^[+\d][\d\s-]{6,}$/.test(draft.customer.phone.trim())) return 'Customer phone number looks invalid.'
    return null
  }

  /* ---------- actions ---------- */
  /** Validates, then creates or updates the bill on the server. Returns the saved bill, or null. */
  async function persist(): Promise<Bill | null> {
    if (saving) return null
    const err = validate()
    if (err) {
      setShowErrors(true)
      toast(err, 'error')
      return null
    }
    const now = new Date()
    const [y, m, d] = draft.date.split('-').map(Number)
    const date = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds())

    const customer: BillCustomer = {
      ...draft.customer,
      name: draft.customer.name.trim() || 'Walk-in Customer',
      phone: draft.customer.phone.trim(),
      address: draft.customer.address?.trim(),
    }
    const input: BillInput = {
      // the draft id is unique per bill: resending it can never create a second bill
      clientRequestId: isSaved ? undefined : draft.id,
      version: isSaved ? draft.version : undefined,
      date: date.toISOString(),
      customer,
      saveCustomer: draft.saveCustomer,
      items: draft.items.map(({ id: _id, ...item }) => item),
      discountType: draft.discountType,
      discountValue: num(draft.discountValue),
      gstInclusive: draft.gstInclusive,
      paymentMethod: draft.paymentMethod,
      amountPaid: totals.paid,
      notes: draft.notes,
    }

    setSaving(true)
    try {
      const saved = await app.saveBill(isSaved ? draft.id : null, input)
      setDraft((d) => ({
        ...d,
        id: saved.id,
        invoiceNo: saved.invoiceNo,
        version: saved.version,
        customer: { ...saved.customer, address: saved.customer.address ?? '' },
        items: saved.items,
        dirty: false,
      }))
      setShowErrors(false)
      return saved
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the bill', 'error')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (isSaved && !draft.dirty) return toast(`Bill ${draft.invoiceNo} is already saved`, 'info')
    const wasSaved = isSaved
    const b = await persist()
    if (b) toast(wasSaved ? `Bill ${b.invoiceNo} updated` : `Bill ${b.invoiceNo} saved successfully`)
  }

  const savedOrPersist = async () => (isSaved && !draft.dirty ? (bills.find((x) => x.id === draft.id) ?? null) : persist())

  async function print() {
    const b = await savedOrPersist()
    if (b) app.printBill(b, format)
  }

  async function pdf() {
    const b = await savedOrPersist()
    if (b) app.downloadPdf(b, format)
  }

  function newBill() {
    setDraft(blankDraft())
    setShowErrors(false)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  // Opening Create Bill always starts a new bill with the next invoice number, unless there is unsaved
  // work. (A bill already saved is not reopened here, so typing a new bill can't overwrite it.)
  useEffect(() => {
    if (isSaved && !draft.dirty) newBill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.createOpened])

  // "New Bill" from the sidebar or dashboard: start fresh, but ask before discarding unsaved work
  useEffect(() => {
    if (app.newBillRequest === handledNewBillRequest) return
    handledNewBillRequest = app.newBillRequest
    if (draft.items.length && draft.dirty) setConfirmNew(true)
    else newBill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.newBillRequest])

  function addItem(name: string, unit: string, price: number, quantity: number, bags?: number) {
    setDraft((d) => ({
      ...d,
      dirty: true,
      items: [...d.items, { id: uid('li-'), productId: '', name, sku: '', price, quantity, unit, bags, gstRate: settings.defaultGst }],
    }))
  }

  // Item names billed before, with their latest rate and unit (bills are newest first)
  const pastItems = useMemo(() => {
    const map = new Map<string, PastItem>()
    for (const b of bills)
      for (const it of b.items) if (!map.has(it.name.toLowerCase())) map.set(it.name.toLowerCase(), { name: it.name, price: it.price, unit: it.unit ?? '' })
    return map
  }, [bills])

  // Shortcuts: "/" focus item name, Ctrl/Cmd+S save
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const itemCount = draft.items.reduce((s, i) => s + num(i.quantity), 0)

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create Bill</h1>
            {isSaved ? (
              draft.dirty ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20">Unsaved changes</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/15">
                  <Check className="size-3" /> Saved
                </span>
              )
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-ink-500">Draft</span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Type the item, bags, weight and rate, pressing Enter after each (leave Bags empty if not needed)
          </p>
        </div>
        <Button icon={RotateCcw} onClick={() => (draft.items.length && draft.dirty ? setConfirmNew(true) : newBill())}>
          New Bill
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------- Left column ---------------- */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Bill header */}
          <Card>
            <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <BusinessMark size={44} />
                <div>
                  <p className="font-semibold text-ink-900">{settings.businessName}</p>
                  <p className="text-xs text-ink-500">{settings.gstin ? `GSTIN ${settings.gstin}` : settings.phone}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2">
                  <p className="text-[11px] font-medium tracking-wide text-ink-400 uppercase">Invoice No.</p>
                  <p className="tabular text-sm font-semibold text-ink-900">{invoiceNo}</p>
                </div>
                <label className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 transition-colors hover:border-ink-300">
                  <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
                    <CalendarDays className="size-3" /> Date
                  </p>
                  <input
                    type="date"
                    value={draft.date}
                    max={toDateKey(new Date())}
                    onChange={(e) => e.target.value && patch({ date: e.target.value })}
                    className="tabular cursor-pointer bg-transparent text-sm font-semibold text-ink-900 outline-none"
                  />
                </label>
              </div>
            </div>
            <CustomerSection draft={draft} patch={patch} customers={customers} />
          </Card>

          {/* Items */}
          <Card>
            <div className="border-b border-slate-100 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-ink-900">Bill Items</h3>
                  {draft.items.length > 0 && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {draft.items.length} {draft.items.length === 1 ? 'item' : 'items'} · {itemCount} qty
                    </span>
                  )}
                </div>
                {draft.items.length > 0 && (
                  <button onClick={() => patch({ items: [] })} className="text-xs font-medium text-ink-400 transition-colors hover:text-red-600">
                    Clear all
                  </button>
                )}
              </div>
              <ItemEntry onAdd={addItem} inputRef={searchRef} pastItems={pastItems} sym={sym} />
            </div>

            {draft.items.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="No items added yet" description="Type an item name and its rate above to start the bill." />
            ) : (
              // Row layout follows the space this card actually has (container query), not the window width
              <div className="@container">
                {/* column headings (desktop) */}
                <div className="hidden grid-cols-[minmax(0,1fr)_120px_136px_120px_40px] gap-4 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5 text-[11px] font-semibold tracking-wider text-ink-500 uppercase @2xl:grid">
                  <span>Item</span>
                  <span className="text-right">Rate</span>
                  <span className="text-center">Quantity</span>
                  <span className="text-right">Amount</span>
                  <span className="sr-only">Action</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {draft.items.map((item) => {
                    const errs = showErrors || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.price < 0 ? itemErrors(item) : { name: '', price: '', quantity: '' }
                    return (
                      <li key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 px-5 py-3.5 transition-colors hover:bg-slate-50/50 @2xl:grid-cols-[minmax(0,1fr)_120px_136px_120px_40px]">
                        <div className="min-w-0">
                          <input
                            aria-label="Item name"
                            value={item.name}
                            placeholder="Item name"
                            onChange={(e) => patchItem(item.id, { name: e.target.value })}
                            className={cn(
                              '-ml-1.5 w-full rounded border bg-transparent px-1.5 py-0.5 text-sm font-medium text-ink-900 outline-none',
                              errs.name ? 'border-red-400' : 'border-transparent hover:border-slate-200 focus:border-brand-500',
                            )}
                          />
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                            {item.sku && (
                              <>
                                <span>{item.sku}</span>
                                <span>·</span>
                              </>
                            )}
                            <select
                              aria-label={`Unit of ${item.name}`}
                              value={item.unit ?? ''}
                              onChange={(e) => patchItem(item.id, { unit: e.target.value || undefined })}
                              className="cursor-pointer rounded border border-transparent bg-transparent py-0 font-medium text-ink-500 hover:border-slate-200 focus:border-brand-500 focus:outline-none"
                            >
                              {!item.unit && <option value="">No unit</option>}
                              {UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                            <span>·</span>
                            <label className="flex items-center gap-1">
                              Bags
                              <input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                placeholder="–"
                                value={item.bags ?? ''}
                                onChange={(e) => patchItem(item.id, { bags: e.target.value === '' ? undefined : Math.max(parseFloat(e.target.value) || 0, 0) })}
                                className="tabular w-12 rounded border border-transparent bg-transparent px-1 py-0 font-medium text-ink-500 hover:border-slate-200 focus:border-brand-500 focus:outline-none"
                              />
                            </label>
                            <span>·</span>
                            <label className="flex items-center gap-1">
                              GST
                              <select
                                value={item.gstRate}
                                onChange={(e) => patchItem(item.id, { gstRate: Number(e.target.value) })}
                                className="cursor-pointer rounded border border-transparent bg-transparent py-0 font-medium text-ink-500 hover:border-slate-200 focus:border-brand-500 focus:outline-none"
                              >
                                {GST_RATES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}%
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="col-start-2 row-start-1 @2xl:hidden">
                          <IconButton icon={Trash2} label={`Remove ${item.name}`} tone="danger" onClick={() => patch({ items: draft.items.filter((i) => i.id !== item.id) })} />
                        </div>

                        <div className="col-span-2 grid grid-cols-3 items-start gap-3 @2xl:contents">
                          <div>
                            <span className="mb-1 block text-[11px] text-ink-400 @2xl:hidden">Price</span>
                            <div className="relative">
                              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-400">{sym}</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                aria-label={`Rate of ${item.name}`}
                                value={Number.isFinite(item.price) ? item.price : ''}
                                onChange={(e) => patchItem(item.id, { price: e.target.value === '' ? NaN : parseFloat(e.target.value) })}
                                className={cn(
                                  'tabular h-9 w-full rounded-lg border bg-surface pr-2.5 pl-6 text-right text-sm text-ink-900 outline-none transition-colors focus:ring-4',
                                  errs.price ? 'border-red-400 focus:ring-red-500/15' : 'border-slate-200 hover:border-ink-300 focus:border-brand-500 focus:ring-brand-500/15',
                                )}
                              />
                            </div>
                            {errs.price && <p className="mt-1 text-right text-[11px] text-red-600">{errs.price}</p>}
                          </div>

                          <div>
                            <span className="mb-1 block text-[11px] text-ink-400 @2xl:hidden">Quantity</span>
                            <div className={cn('flex h-9 items-center overflow-hidden rounded-lg border bg-surface', errs.quantity ? 'border-red-400' : 'border-slate-200')}>
                              <button
                                aria-label="Decrease quantity"
                                onClick={() => patchItem(item.id, { quantity: Math.max(1, num(item.quantity) - 1) })}
                                className="flex h-full w-8 items-center justify-center text-ink-500 transition-colors hover:bg-slate-100 hover:text-ink-900"
                              >
                                <Minus className="size-3.5" />
                              </button>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                aria-label={`Quantity of ${item.name}`}
                                value={Number.isFinite(item.quantity) ? item.quantity : ''}
                                onChange={(e) => patchItem(item.id, { quantity: e.target.value === '' ? NaN : parseFloat(e.target.value) })}
                                className="tabular h-full w-full min-w-0 border-x border-slate-200 text-center text-sm font-medium text-ink-900 outline-none focus:bg-brand-50/40"
                              />
                              <button
                                aria-label="Increase quantity"
                                onClick={() => patchItem(item.id, { quantity: num(item.quantity) + 1 })}
                                className="flex h-full w-8 items-center justify-center text-ink-500 transition-colors hover:bg-slate-100 hover:text-ink-900"
                              >
                                <Plus className="size-3.5" />
                              </button>
                            </div>
                            {errs.quantity && <p className="mt-1 text-center text-[11px] text-red-600">{errs.quantity}</p>}
                          </div>

                          <div className="text-right">
                            <span className="mb-1 block text-[11px] text-ink-400 @2xl:hidden">Amount</span>
                            <p className="tabular text-sm leading-9 font-semibold text-ink-900">{money(num(item.price) * num(item.quantity))}</p>
                          </div>
                        </div>

                        <div className="hidden @2xl:block">
                          <IconButton icon={Trash2} label={`Remove ${item.name}`} tone="danger" onClick={() => patch({ items: draft.items.filter((i) => i.id !== item.id) })} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <Field label="Notes" optional hint="Shown only in the app, not on the printed invoice.">
              <Textarea value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="e.g. Deliver by Friday, customer will pay balance on pickup" className="min-h-[64px]" />
            </Field>
          </Card>
        </div>

        {/* ---------------- Right column ---------------- */}
        <div className="flex flex-col gap-6 xl:sticky xl:top-22 xl:self-start">
          {/* Summary */}
          <Card className="overflow-hidden">
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-ink-900">Bill Summary</h3>
                <Segmented
                  value={draft.gstInclusive ? 'inc' : 'exc'}
                  onChange={(v) => patch({ gstInclusive: v === 'inc' })}
                  options={[
                    { value: 'exc', label: '+ GST' },
                    { value: 'inc', label: 'Incl. GST' },
                  ]}
                />
              </div>

              <SummaryRow label="Subtotal" value={money(totals.subtotal)} />

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-500">Discount</span>
                  <div className="flex items-center gap-2">
                    <Segmented
                      value={draft.discountType}
                      onChange={(v) => patch({ discountType: v })}
                      options={[
                        { value: 'percent', label: '%' },
                        { value: 'amount', label: sym },
                      ]}
                    />
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      aria-label="Discount"
                      value={draft.discountValue || ''}
                      placeholder="0"
                      onChange={(e) => patch({ discountValue: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                      className={cn(
                        'tabular h-8 w-20 rounded-lg border bg-surface px-2 text-right text-sm outline-none focus:ring-4',
                        discountError ? 'border-red-400 focus:ring-red-500/15' : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500/15',
                      )}
                    />
                  </div>
                </div>
                {discountError ? (
                  <p className="mt-1 text-right text-xs text-red-600">{discountError}</p>
                ) : (
                  totals.discount > 0 && <p className="tabular mt-1 text-right text-sm font-medium text-emerald-600">− {money(totals.discount)}</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">Set GST for all items</span>
                <select
                  aria-label="GST rate for all items"
                  value=""
                  onChange={(e) => e.target.value !== '' && patch({ items: draft.items.map((i) => ({ ...i, gstRate: Number(e.target.value) })) })}
                  className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-surface px-2 text-sm text-ink-700 outline-none focus:border-brand-500"
                >
                  <option value="">Choose…</option>
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
                <SummaryRow label="Taxable value" value={money(totals.taxable)} small />
                {totals.gstBreakdown.length === 0 && <SummaryRow label="GST" value={money(0)} small />}
                {totals.gstBreakdown.map((g) => (
                  <SummaryRow key={g.rate} label={`GST @ ${g.rate}%${draft.gstInclusive ? ' (incl.)' : ''}`} value={money(g.gst)} small />
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden bg-ink-950 px-5 py-5 text-white">
              <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand-500/35 blur-3xl" />
              <div className="relative flex items-end justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400">Grand Total</p>
                  <p className="text-[11px] text-slate-500">GST {money(totals.gst)} {draft.gstInclusive ? 'included' : 'added'}</p>
                </div>
                <p className="tabular text-[28px] leading-none font-semibold tracking-tight">{money(totals.grandTotal)}</p>
              </div>
            </div>
          </Card>

          {/* Payment */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-900">Payment</h3>
              {draft.items.length > 0 && <StatusBadge status={status} />}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => {
                const active = draft.paymentMethod === value
                return (
                  <button
                    key={value}
                    onClick={() => patch({ paymentMethod: value, ...(value === 'Credit' ? { amountPaid: '' } : {}) })}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-medium transition-all',
                      active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15' : 'border-slate-200 text-ink-500 hover:border-ink-300 hover:bg-slate-50 hover:text-ink-900',
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {label}
                  </button>
                )
              })}
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="amount-paid" className="text-[13px] font-medium text-ink-700">
                  Amount received
                </label>
                <button
                  onClick={() => patch({ amountPaid: String(totals.grandTotal) })}
                  disabled={totals.grandTotal === 0}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40"
                >
                  Full amount
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-400">{sym}</span>
                <Input
                  id="amount-paid"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft.amountPaid}
                  invalid={!!paidError}
                  onChange={(e) => patch({ amountPaid: e.target.value })}
                  className="tabular h-11 pl-8 text-base font-medium"
                />
              </div>
              {paidError && <p className="mt-1 text-xs text-red-600">{paidError}</p>}
              {draft.paymentMethod === 'Credit' && !paidError && (
                <p className="mt-1 text-xs text-ink-500">Pay later: enter any advance received, the rest stays as balance due.</p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-ink-500">Paid</p>
                <p className="tabular mt-0.5 font-semibold text-ink-900">{money(totals.paid)}</p>
              </div>
              {totals.change > 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs text-emerald-700">Change to return</p>
                  <p className="tabular mt-0.5 font-semibold text-emerald-700">{money(totals.change)}</p>
                </div>
              ) : (
                <div className={cn('rounded-xl border p-3', totals.balance > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200')}>
                  <p className={cn('text-xs', totals.balance > 0 ? 'text-amber-700' : 'text-ink-500')}>Balance due</p>
                  <p className={cn('tabular mt-0.5 font-semibold', totals.balance > 0 ? 'text-amber-700' : 'text-ink-900')}>{money(totals.balance)}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Actions */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-ink-700">Bill size</span>
              <FormatSwitch value={format} onChange={setFormat} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" size="lg" icon={Printer} onClick={print} disabled={saving}>
                {saving ? 'Saving…' : 'Print'}
              </Button>
              <Button size="lg" icon={FileDown} onClick={pdf} disabled={saving}>
                PDF
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-ink-400">The bill is saved automatically when you print or download it.</p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmNew}
        onClose={() => setConfirmNew(false)}
        title="Discard current bill?"
        message="This bill has unsaved changes. Starting a new bill will clear them."
        confirmLabel="Discard & start new"
        onConfirm={newBill}
      />
    </div>
  )
}

function SummaryRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={small ? 'text-xs text-ink-500' : 'text-sm text-ink-500'}>{label}</span>
      <span className={cn('tabular font-medium text-ink-900', small ? 'text-xs' : 'text-sm')}>{value}</span>
    </div>
  )
}

/* ---------------- Customer section ---------------- */

function CustomerSection({ draft, patch, customers }: { draft: Draft; patch: (p: Partial<Draft>) => void; customers: ReturnType<typeof useApp>['customers'] }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const q = draft.customer.name.trim().toLowerCase()
  const matches = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))).slice(0, 6)

  const pick = (c: (typeof customers)[number]) => {
    patch({ customer: { id: c.id, name: c.name, phone: c.phone, address: c.address ?? '' } })
    setOpen(false)
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
      <div className="relative">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="cust-name" className="text-[13px] font-medium text-ink-700">
            Customer
          </label>
          <button onClick={() => patch({ customer: { name: 'Walk-in Customer', phone: '', address: '' } })} className="text-xs font-medium text-brand-600 hover:text-brand-700">
            Walk-in
          </button>
        </div>
        <div className="relative">
          <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <Input
            id="cust-name"
            autoComplete="off"
            placeholder="Search or type customer name"
            value={draft.customer.name}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onChange={(e) => {
              patch({ customer: { ...draft.customer, id: undefined, name: e.target.value } })
              setOpen(true)
              setHi(0)
            }}
            onKeyDown={(e) => {
              if (!open || !matches.length) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, matches.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)))
              if (e.key === 'Enter') (e.preventDefault(), pick(matches[hi]))
              if (e.key === 'Escape') setOpen(false)
            }}
            className="pl-9"
          />
        </div>
        {open && matches.length > 0 && (
          <div className="animate-fade-in absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-surface py-1 shadow-pop">
            {matches.map((c, i) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                onMouseEnter={() => setHi(i)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === hi && 'bg-slate-50')}
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-ink-700">{initials(c.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                  <span className="block text-xs text-ink-500">{c.phone}</span>
                </span>
                {draft.customer.id === c.id && <Check className="size-4 text-brand-600" />}
              </button>
            ))}
          </div>
        )}
        {!draft.customer.id && draft.customer.name.trim() && draft.customer.name !== 'Walk-in Customer' && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-500">
            <input type="checkbox" checked={draft.saveCustomer} onChange={(e) => patch({ saveCustomer: e.target.checked })} className="size-3.5 accent-brand-600" />
            Save as new customer (needs phone number)
          </label>
        )}
      </div>

      <Field label="Phone number" htmlFor="cust-phone">
        <Input id="cust-phone" type="tel" inputMode="tel" placeholder="98765 43210" value={draft.customer.phone} onChange={(e) => patch({ customer: { ...draft.customer, phone: e.target.value } })} />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Address" optional htmlFor="cust-addr">
          <Input id="cust-addr" placeholder="Street, area, city" value={draft.customer.address ?? ''} onChange={(e) => patch({ customer: { ...draft.customer, address: e.target.value } })} />
        </Field>
      </div>
    </div>
  )
}

/* ---------------- Item entry ---------------- */

/** Type an item name and rate, press Enter: no product list needed. Names billed before are suggested with their last rate. */
interface PastItem {
  name: string
  price: number
  unit: string
}

function ItemEntry({
  onAdd,
  inputRef,
  pastItems,
  sym,
}: {
  onAdd: (name: string, unit: string, price: number, quantity: number, bags?: number) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  pastItems: Map<string, PastItem>
  sym: string
}) {
  const [name, setName] = useState('')
  // kept between items: a shop usually sells several things in the same unit
  const [unit, setUnit] = useState(UNITS[0])
  const [rate, setRate] = useState('')
  const [bags, setBags] = useState('')
  const [qty, setQty] = useState('1')
  const [error, setError] = useState('')
  const bagsRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const rateRef = useRef<HTMLInputElement>(null)

  function add() {
    const price = parseFloat(rate)
    const quantity = parseFloat(qty)
    const bagCount = bags.trim() === '' ? undefined : parseFloat(bags)
    if (!name.trim()) return (setError('Type the item name'), inputRef.current?.focus())
    if (bagCount !== undefined && (!Number.isFinite(bagCount) || bagCount < 0)) return (setError('Bags must be zero or more'), bagsRef.current?.select())
    if (!Number.isFinite(quantity) || quantity <= 0) return (setError('Quantity must be more than 0'), qtyRef.current?.select())
    if (!Number.isFinite(price) || price < 0) return (setError('Enter the rate'), rateRef.current?.focus())
    onAdd(name.trim(), unit, price, quantity, bagCount || undefined)
    setName('')
    setBags('')
    setRate('')
    setQty('1')
    setError('')
    inputRef.current?.focus()
  }

  const onEnter = (e: React.KeyboardEvent, fn: () => void) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    fn()
  }
  const label = 'mb-1 block text-[11px] font-medium text-ink-500'
  const field =
    'tabular h-11 w-full rounded-xl border border-slate-200 bg-surface text-sm text-ink-900 shadow-xs outline-none transition-colors placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15'

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_76px_90px_90px_120px_auto] items-end gap-2 max-sm:grid-cols-4">
        <label className="max-sm:col-span-4">
          <span className={label}>Item</span>
          <input
            ref={inputRef}
            value={name}
            list="past-items"
            autoComplete="off"
            placeholder="Item name"
            onChange={(e) => {
              setName(e.target.value)
              setError('')
              const past = pastItems.get(e.target.value.trim().toLowerCase())
              if (past && rate === '') setRate(String(past.price))
              if (past?.unit) setUnit(past.unit)
            }}
            onKeyDown={(e) => onEnter(e, () => (name.trim() ? bagsRef.current?.focus() : add()))}
            className={cn(field, 'px-3.5')}
          />
        </label>
        <datalist id="past-items">
          {[...pastItems.values()].slice(0, 200).map((p) => (
            <option key={p.name} value={p.name} />
          ))}
        </datalist>
        <label>
          <span className={label}>Bags</span>
          <input
            ref={bagsRef}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="–"
            value={bags}
            onChange={(e) => (setBags(e.target.value), setError(''))}
            onKeyDown={(e) => onEnter(e, () => qtyRef.current?.select())}
            className={cn(field, 'px-3 text-center')}
          />
        </label>
        <label>
          <span className={label}>{unit === 'Kg' ? 'Weight (Kg)' : 'Quantity'}</span>
          <input
            ref={qtyRef}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="Qty"
            value={qty}
            onChange={(e) => (setQty(e.target.value), setError(''))}
            onKeyDown={(e) => onEnter(e, () => (rate === '' ? rateRef.current?.focus() : add()))}
            className={cn(field, 'px-3 text-center')}
          />
        </label>
        <label>
          <span className={label}>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={cn(field, 'cursor-pointer px-3')}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>{unit === 'Loose' ? 'Rate' : `Rate per ${unit}`}</span>
          <span className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-400">{sym}</span>
            <input
              ref={rateRef}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={rate}
              onChange={(e) => (setRate(e.target.value), setError(''))}
              onKeyDown={(e) => onEnter(e, add)}
              className={cn(field, 'pr-3 pl-7 text-right')}
            />
          </span>
        </label>
        <Button variant="primary" icon={Plus} onClick={add} className="h-11 max-sm:col-span-4">
          Add
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
