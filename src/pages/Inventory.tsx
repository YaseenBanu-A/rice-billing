import { AlertTriangle, Boxes, PackageX, Package, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, SearchInput, Segmented, Select, cn, td, th } from '../components/ui'
import type { ProductInput } from '../lib/api'
import { UNITS } from '../lib/billing'
import { currencySymbol } from '../lib/format'
import { packLabel, searchProducts, stockLabel, stockState, type StockState } from '../lib/inventory'
import { useApp } from '../store/AppContext'
import type { Product } from '../types'

/*
 * Inventory: the products the bill screen searches and sells from. Every product here is a row in the
 * Product table; selling it on a bill deducts its stock in the same database transaction as the bill.
 */

type StockFilter = 'all' | 'low' | 'out'

const STATE_STYLE: Record<StockState, { label: string; cls: string }> = {
  ok: { label: 'In stock', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  low: { label: 'Low stock', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  out: { label: 'Out of stock', cls: 'bg-red-50 text-red-700 ring-red-600/15' },
}

export function Inventory() {
  const { products, categories, money, can, toast, deleteProduct } = useApp()
  const manage = can('products.manage')

  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)

  const stats = useMemo(() => {
    const low = products.filter((p) => stockState(p) === 'low')
    const out = products.filter((p) => stockState(p) === 'out')
    return {
      total: products.length,
      low,
      out,
      value: products.reduce((s, p) => s + Math.max(p.stock, 0) * p.price, 0),
    }
  }, [products])

  const rows = useMemo(() => {
    let list = searchProducts(products, q)
    if (categoryId) list = list.filter((p) => (categoryId === 'none' ? !p.categoryId : p.categoryId === categoryId))
    if (filter === 'low') list = list.filter((p) => stockState(p) !== 'ok')
    if (filter === 'out') list = list.filter((p) => stockState(p) === 'out')
    return list
  }, [products, q, categoryId, filter])

  async function confirmDelete(p: Product) {
    try {
      const archived = await deleteProduct(p.id)
      toast(archived ? `${p.name} removed from inventory (kept in old bills and stock history)` : `${p.name} deleted`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the product', 'error')
    }
  }

  const alerts = [...stats.out, ...stats.low]

  return (
    <div>
      {/* Header banner */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-ink-950 px-6 py-7 text-white shadow-lift sm:px-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-brand-300 uppercase">Stock</p>
            <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.02em]">Inventory</h1>
            <p className="mt-1.5 max-w-md text-sm text-slate-400">Products added here appear in Create Bill straight away. Each sale deducts its stock automatically.</p>
          </div>
          {manage && (
            <button
              onClick={() => setEditing('new')}
              className="inline-flex h-12 shrink-0 items-center gap-2 self-start rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.5)] transition-all hover:-translate-y-0.5 sm:self-auto"
            >
              <Plus className="size-4" /> Add Product
            </button>
          )}
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={Boxes} label="Total products" value={String(stats.total)} />
          <Stat icon={AlertTriangle} label="Low stock" value={String(stats.low.length)} tone={stats.low.length ? 'amber' : undefined} onClick={() => setFilter('low')} />
          <Stat icon={PackageX} label="Out of stock" value={String(stats.out.length)} tone={stats.out.length ? 'red' : undefined} onClick={() => setFilter('out')} />
          <Stat icon={Wallet} label="Stock value (selling price)" value={money(stats.value, 0)} />
        </div>
      </div>

      {/* Low-stock alerts */}
      {alerts.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {alerts.length} {alerts.length === 1 ? 'product needs' : 'products need'} restocking
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {alerts.slice(0, 12).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => (manage ? setEditing(p) : setQ(p.sku))}
                    className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-amber-200 ring-inset transition-colors hover:ring-amber-600/40"
                  >
                    {p.name} {packLabel(p) && `(${packLabel(p)})`} ·{' '}
                    <span className={stockState(p) === 'out' ? 'text-red-600' : 'text-amber-700'}>{stockLabel(p.stock, p.unit)}</span>
                  </button>
                ))}
                {alerts.length > 12 && <span className="px-1 py-1 text-xs text-amber-700">+{alerts.length - 12} more</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <Card className="min-w-0">
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search by product name, SKU or ID" className="md:max-w-sm md:flex-1" />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="md:w-52" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">No category</option>
          </Select>
          <Segmented
            value={filter}
            onChange={setFilter}
            className="self-start md:ml-auto md:self-auto"
            options={[
              { value: 'all', label: 'All' },
              { value: 'low', label: 'Low' },
              { value: 'out', label: 'Out' },
            ]}
          />
        </div>

        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Add your rice products with their package size, price and stock. They will appear in Create Bill."
            action={manage && <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add Product</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Package} title="No matching products" description="Try another name, SKU or category." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>SKU</th>
                  <th className={cn(th, 'hidden lg:table-cell')}>Category</th>
                  <th className={th}>Pack size</th>
                  <th className={cn(th, 'text-right')}>Selling price</th>
                  <th className={cn(th, 'text-right')}>Available</th>
                  <th className={cn(th, 'hidden text-right md:table-cell')}>Min. level</th>
                  <th className={th}>Status</th>
                  {manage && <th className={th}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const st = STATE_STYLE[stockState(p)]
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-slate-50/70">
                      <td className={cn(td, 'max-w-[260px]')}>
                        <p className="truncate font-medium text-ink-900">{p.name}</p>
                        {(p.variety || p.brand) && <p className="truncate text-xs text-ink-400">{[p.variety, p.brand].filter(Boolean).join(' · ')}</p>}
                      </td>
                      <td className={cn(td, 'font-mono text-xs')} title={`Product ID ${p.id}`}>
                        {p.sku}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell')}>{p.categoryName ?? <span className="text-ink-400">–</span>}</td>
                      <td className={td}>{packLabel(p) || <span className="text-ink-400">–</span>}</td>
                      <td className={cn(td, 'tabular text-right font-semibold text-ink-900')}>
                        {money(p.price)}
                        <span className="ml-1 text-xs font-normal text-ink-400">/ {p.unit}</span>
                      </td>
                      <td className={cn(td, 'tabular text-right font-semibold', stockState(p) === 'out' ? 'text-red-600' : stockState(p) === 'low' ? 'text-amber-700' : 'text-ink-900')}>
                        {stockLabel(p.stock, p.unit)}
                      </td>
                      <td className={cn(td, 'tabular hidden text-right text-ink-500 md:table-cell')}>{stockLabel(p.reorderLevel, p.unit)}</td>
                      <td className={td}>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', st.cls)}>
                          <span className="size-1.5 rounded-full bg-current opacity-80" />
                          {st.label}
                        </span>
                      </td>
                      {manage && (
                        <td className={cn(td, 'text-right')}>
                          <div className="inline-flex gap-0.5">
                            <IconButton icon={Pencil} label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
                            <IconButton icon={Trash2} label={`Delete ${p.name}`} tone="danger" onClick={() => setDeleting(p)} />
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-ink-500">
            Showing {rows.length} of {products.length} products
          </p>
        )}
      </Card>

      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'product'}?`}
        message="It will no longer appear in Inventory or Create Bill. If it was already sold or has stock history, it is kept in the database so old bills stay complete."
        confirmLabel="Delete product"
        onConfirm={() => deleting && confirmDelete(deleting)}
      />
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone, onClick }: { icon: typeof Boxes; label: string; value: string; tone?: 'amber' | 'red'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-left backdrop-blur-sm',
        onClick && 'transition-colors hover:border-white/20 hover:bg-white/[0.07]',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={cn('size-4', tone === 'amber' ? 'text-amber-300' : tone === 'red' ? 'text-red-400' : 'text-brand-300')} />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('tabular mt-2 truncate text-2xl font-semibold tracking-tight', tone === 'amber' ? 'text-amber-300' : tone === 'red' ? 'text-red-400' : 'text-white')}>{value}</p>
    </Tag>
  )
}

/* ---------------- Add / edit form ---------------- */

const PACK_SIZES = [1, 5, 10, 25, 26, 50]

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { categories, taxRates, settings, saveProduct, setStock, addCategory, toast } = useApp()
  const rates = taxRates.filter((r) => r.active).map((r) => r.rate)
  const sym = currencySymbol(settings.currency)

  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    categoryId: product?.categoryId ?? '',
    variety: product?.variety ?? '',
    brand: product?.brand ?? '',
    hsnCode: product?.hsnCode ?? '1006',
    unit: product?.unit ?? 'Bag',
    bagWeight: product?.bagWeight != null ? String(product.bagWeight) : '',
    price: product ? String(product.price) : '',
    purchasePrice: product?.purchasePrice ? String(product.purchasePrice) : '',
    gstRate: String(product?.gstRate ?? (rates.includes(settings.defaultGst) ? settings.defaultGst : (rates[0] ?? 0))),
    stock: product ? String(product.stock) : '',
    reorderLevel: product ? String(product.reorderLevel) : '',
  })
  const [stockReason, setStockReason] = useState('Physical stock count')
  const [newCat, setNewCat] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => (setF((x) => ({ ...x, ...p })), setErrors({}))

  const stockChanged = !!product && f.stock.trim() !== '' && Number(f.stock) !== product.stock

  function check(): Record<string, string> {
    const e: Record<string, string> = {}
    const numOk = (v: string, allowEmpty = true) => (v.trim() === '' ? allowEmpty : Number.isFinite(Number(v)) && Number(v) >= 0)
    if (!f.name.trim()) e.name = 'Enter the product name'
    if (f.sku && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(f.sku.trim())) e.sku = 'Letters, digits, dot, dash or slash only'
    if (!numOk(f.price, false)) e.price = 'Enter the selling price'
    if (!numOk(f.purchasePrice)) e.purchasePrice = 'Cannot be negative'
    if (f.bagWeight.trim() && !(Number(f.bagWeight) > 0)) e.bagWeight = 'Must be more than 0'
    if (!numOk(f.stock)) e.stock = 'Cannot be negative'
    if (!numOk(f.reorderLevel)) e.reorderLevel = 'Cannot be negative'
    if (!/^\d{4,8}$/.test(f.hsnCode.trim())) e.hsnCode = '4 to 8 digits'
    if (stockChanged && !stockReason.trim()) e.stockReason = 'Give a reason for the stock change'
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const e = check()
    if (Object.keys(e).length) return setErrors(e)
    const input: ProductInput = {
      name: f.name.trim(),
      sku: f.sku.trim().toUpperCase(),
      categoryId: f.categoryId || undefined,
      variety: f.variety.trim() || undefined,
      brand: f.brand.trim() || undefined,
      hsnCode: f.hsnCode.trim(),
      unit: f.unit,
      bagWeight: f.bagWeight.trim() ? Number(f.bagWeight) : undefined,
      price: Number(f.price),
      purchasePrice: f.purchasePrice.trim() ? Number(f.purchasePrice) : 0,
      gstRate: Number(f.gstRate),
      reorderLevel: f.reorderLevel.trim() ? Number(f.reorderLevel) : 0,
      openingStock: product ? undefined : f.stock.trim() ? Number(f.stock) : 0,
      active: true,
    }
    setSaving(true)
    try {
      const saved = await saveProduct(product?.id ?? null, input)
      if (stockChanged) await setStock(saved.id, Number(f.stock), stockReason.trim())
      toast(product ? `${saved.name} updated` : `${saved.name} added (${saved.sku})`)
      onClose()
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields
      if (fields) setErrors(fields)
      toast(err instanceof Error ? err.message : 'Could not save the product', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function createCategory() {
    const name = newCat?.trim()
    if (!name) return
    try {
      const c = await addCategory(name)
      set({ categoryId: c.id })
      setNewCat(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the category', 'error')
    }
  }

  const unitLabel = f.unit === 'Bag' ? 'bags' : f.unit === 'Kg' ? 'kg' : 'units'

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={product ? `Edit ${product.name}` : 'Add Product'}
      subtitle={product ? `SKU ${product.sku}` : 'It will be available in Create Bill as soon as you save.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="product-form" disabled={saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Add Product'}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Product name" error={errors.name} htmlFor="p-name">
            <Input id="p-name" autoFocus value={f.name} invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Ponni Raw Rice 25 kg" />
          </Field>
        </div>

        <Field label="SKU / code" optional error={errors.sku} hint={product ? undefined : 'Leave empty to number it automatically (P-001…)'} htmlFor="p-sku">
          <Input id="p-sku" value={f.sku} invalid={!!errors.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} placeholder="e.g. PON-25" className="font-mono" />
        </Field>

        <Field label="Category" optional htmlFor="p-cat">
          {newCat === null ? (
            <Select id="p-cat" value={f.categoryId} onChange={(e) => (e.target.value === '__new' ? setNewCat('') : set({ categoryId: e.target.value }))}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">+ New category…</option>
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.preventDefault(), createCategory())
                  if (e.key === 'Escape') (e.stopPropagation(), setNewCat(null))
                }}
                placeholder="e.g. Raw Rice"
              />
              <Button onClick={createCategory} disabled={!newCat.trim()}>
                Add
              </Button>
              <Button variant="ghost" onClick={() => setNewCat(null)}>
                Cancel
              </Button>
            </div>
          )}
        </Field>

        <div className="sm:col-span-2">
          <Field label="Package size" optional error={errors.bagWeight} hint="Weight of one pack or bag. Lets bills sold in Kg deduct bags correctly (and the other way round)." htmlFor="p-pack">
            <div className="flex flex-wrap items-center gap-1.5">
              {PACK_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set({ bagWeight: f.bagWeight === String(s) ? '' : String(s) })}
                  className={cn(
                    'h-9 rounded-lg border px-3 text-sm font-medium transition-colors',
                    f.bagWeight === String(s) ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15' : 'border-slate-200 text-ink-700 hover:border-ink-300',
                  )}
                >
                  {s} kg
                </button>
              ))}
              <div className="relative w-28">
                <Input id="p-pack" type="number" min={0} step="any" inputMode="decimal" value={f.bagWeight} invalid={!!errors.bagWeight} onChange={(e) => set({ bagWeight: e.target.value })} placeholder="Other" className="h-9 pr-8" />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-400">kg</span>
              </div>
            </div>
          </Field>
        </div>

        <Field label="Stock counted in" htmlFor="p-unit" hint={f.unit === 'Bag' ? 'Stock and price are per bag / pack' : f.unit === 'Kg' ? 'Stock and price are per kg' : undefined}>
          <Select id="p-unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u === 'Bag' ? 'Bag / Pack' : u}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`Selling price per ${f.unit === 'Bag' ? 'bag / pack' : f.unit}`} error={errors.price} htmlFor="p-price">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-400">{sym}</span>
            <Input id="p-price" type="number" min={0} step="0.01" inputMode="decimal" value={f.price} invalid={!!errors.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" className="tabular pl-7" />
          </div>
        </Field>

        <Field label={product ? 'Available stock' : 'Opening stock'} optional={!product} error={errors.stock} hint={`In ${unitLabel}`} htmlFor="p-stock">
          <Input id="p-stock" type="number" min={0} step="any" inputMode="decimal" value={f.stock} invalid={!!errors.stock} onChange={(e) => set({ stock: e.target.value })} placeholder="0" className="tabular" />
        </Field>

        <Field label="Minimum stock level" optional error={errors.reorderLevel} hint={`Low-stock alert at or below this many ${unitLabel}`} htmlFor="p-min">
          <Input id="p-min" type="number" min={0} step="any" inputMode="decimal" value={f.reorderLevel} invalid={!!errors.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} placeholder="0" className="tabular" />
        </Field>

        {stockChanged && (
          <div className="sm:col-span-2">
            <Field label="Reason for the stock change" error={errors.stockReason} hint={`${product!.stock} → ${f.stock} ${unitLabel}. Recorded in the stock history.`} htmlFor="p-reason">
              <Input id="p-reason" value={stockReason} invalid={!!errors.stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder="e.g. New stock received, damaged bags" />
            </Field>
          </div>
        )}

        <Field label="GST rate" htmlFor="p-gst">
          <Select id="p-gst" value={f.gstRate} onChange={(e) => set({ gstRate: e.target.value })}>
            {[...new Set([...rates, Number(f.gstRate)])]
              .sort((a, b) => a - b)
              .map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
          </Select>
        </Field>

        <Field label="HSN code" error={errors.hsnCode} htmlFor="p-hsn">
          <Input id="p-hsn" inputMode="numeric" value={f.hsnCode} invalid={!!errors.hsnCode} onChange={(e) => set({ hsnCode: e.target.value })} className="tabular" />
        </Field>

        <Field label="Purchase price" optional error={errors.purchasePrice} htmlFor="p-cost">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-400">{sym}</span>
            <Input id="p-cost" type="number" min={0} step="0.01" inputMode="decimal" value={f.purchasePrice} invalid={!!errors.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} placeholder="0.00" className="tabular pl-7" />
          </div>
        </Field>

        <Field label="Variety / brand" optional htmlFor="p-variety">
          <div className="flex gap-2">
            <Input id="p-variety" value={f.variety} onChange={(e) => set({ variety: e.target.value })} placeholder="Variety" />
            <Input aria-label="Brand" value={f.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Brand" />
          </div>
        </Field>
      </form>
    </Modal>
  )
}
