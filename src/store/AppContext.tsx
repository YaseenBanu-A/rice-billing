import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, refreshSession, setSignedOutHandler, type ProductInput } from '../lib/api'
import { can as canRole, type Permission } from '../../shared/permissions.ts'
import { LoginScreen } from '../components/LoginScreen'
import { formatMoney, round2, toDateKey, uid } from '../lib/format'
import { connectLive, disconnectLive, onLiveChange } from '../lib/live'
import type { Bill, BillInput, Category, Customer, InvoiceFormat, Page, Product, Settings, TaxRate, User } from '../types'

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

interface AppState {
  page: Page
  navigate: (page: Page) => void
  /** Opens Create Bill with a fresh bill; bumps `newBillRequest` so an open Create Bill page resets too. */
  startNewBill: () => void
  newBillRequest: number
  /** Counts every time Create Bill is opened, including clicking it while already there. */
  createOpened: number

  settings: Settings
  saveSettings: (s: Settings) => Promise<Settings>

  products: Product[]
  customers: Customer[]
  categories: Category[]
  taxRates: TaxRate[]
  /** signed-in user, and what their role may do (the server checks again) */
  user: User
  can: (p: Permission) => boolean

  /** Inventory: creates the product, or updates it when `id` is given */
  saveProduct: (id: string | null, input: ProductInput) => Promise<Product>
  /** Returns true when the product was archived (it has sales or stock history) instead of deleted */
  deleteProduct: (id: string) => Promise<boolean>
  /** Sets the counted stock of a product (recorded as a stock adjustment with the reason) */
  setStock: (productId: string, stock: number, reason: string) => Promise<void>
  addCategory: (name: string) => Promise<Category>
  refreshProducts: () => Promise<void>

  bills: Bill[]
  /** Creates the bill, or updates it when `id` belongs to a saved bill. */
  saveBill: (id: string | null, input: BillInput) => Promise<Bill>
  recordPayment: (id: string, amountPaid: number) => Promise<Bill>
  deleteBill: (id: string) => Promise<void>
  nextInvoiceNo: string

  money: (n: number, digits?: number) => string

  toasts: Toast[]
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: string) => void

  printJob: { bill: Bill; mode: 'print' | 'pdf'; format: InvoiceFormat } | null
  /** `format` defaults to the one chosen in Settings */
  printBill: (b: Bill, format?: InvoiceFormat) => void
  downloadPdf: (b: Bill, format?: InvoiceFormat) => void
  finishPrintJob: () => void

  resetData: () => Promise<void>
  /** Downloads every bill, customer and the settings as a file */
  downloadBackup: () => Promise<void>
  /** Replaces all data with a backup file's contents, then reloads */
  restoreBackup: (backup: unknown) => Promise<void>

  /** True when the server is protected by a password (shows Sign out) */
  authRequired: boolean
  logout: () => Promise<void>
}

interface Data {
  settings: Settings
  products: Product[]
  customers: Customer[]
  categories: Category[]
  taxRates: TaxRate[]
  user: User
  bills: Bill[]
  nextInvoiceNo: string
  authRequired: boolean
}

const Ctx = createContext<AppState | null>(null)

const PAGES: Page[] = ['dashboard', 'create', 'history', 'inventory', 'expenses', 'reports', 'settings']
const pageFromHash = (): Page => {
  const h = window.location.hash.replace('#/', '') as Page
  return PAGES.includes(h) ? h : 'dashboard'
}

const byDateDesc = (a: Bill, b: Bill) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo)

/** Every bill from the database (the screens filter and total them, as before). */
async function loadAllBills(): Promise<Bill[]> {
  const all: Bill[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await api.bills({ limit: 500, offset })
    all.push(...page.items)
    if (all.length >= page.total || page.items.length === 0) return all
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [printJob, setPrintJob] = useState<AppState['printJob']>(null)
  const [newBillRequest, setNewBillRequest] = useState(0)
  const [createOpened, setCreateOpened] = useState(0)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [boot, bills] = await Promise.all([api.bootstrap(), loadAllBills()])
      setData({
        settings: boot.settings,
        products: boot.products,
        customers: boot.customers,
        categories: boot.categories,
        taxRates: boot.taxRates,
        user: boot.user,
        bills,
        nextInvoiceNo: boot.nextInvoiceNo,
        authRequired: true,
      })
      setNeedsLogin(false)
      connectLive()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return setNeedsLogin(true)
      setLoadError(err instanceof Error ? err.message : 'Could not load data')
    }
  }, [])

  useEffect(() => {
    // session expired mid-use: drop to the sign-in screen (the unsaved bill draft is kept in this browser)
    setSignedOutHandler(() => {
      disconnectLive()
      setNeedsLogin(true)
      setData(null)
    })
    // continue the session from the sign-in cookie, if there is one
    refreshSession().then((s) => (s ? load() : setNeedsLogin(true)))
  }, [load])

  const navigate = useCallback((p: Page) => {
    window.location.hash = `/${p}`
    setPage(p)
    if (p === 'create') setCreateOpened((n) => n + 1)
    window.scrollTo({ top: 0 })
  }, [])

  // Follow back/forward and manually edited URLs
  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = uid('t-')
      setToasts((t) => [...t.slice(-3), { id, kind, message }])
      setTimeout(() => dismissToast(id), kind === 'error' ? 4500 : 3000)
    },
    [dismissToast],
  )

  const patch = useCallback((p: Partial<Data> | ((d: Data) => Partial<Data>)) => {
    setData((d) => (d ? { ...d, ...(typeof p === 'function' ? p(d) : p) } : d))
  }, [])

  const refreshNextInvoice = useCallback(async () => {
    try {
      const nextInvoiceNo = await api.nextInvoiceNo()
      patch({ nextInvoiceNo })
    } catch {
      // non-critical: the server assigns the real number on save
    }
  }, [patch])

  const refreshProducts = useCallback(async () => {
    try {
      patch({ products: await api.products() })
    } catch {
      // non-critical: live updates reload products too
    }
  }, [patch])

  // Multi-user: when anyone creates, edits or pays a bill (or changes customers/settings), reload that data
  const signedIn = !!data
  const reloading = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => {
    if (!signedIn) return
    const later = (key: string, fn: () => Promise<unknown>) => {
      clearTimeout(reloading.current[key])
      reloading.current[key] = setTimeout(() => fn().catch(() => {}), 200)
    }
    const off = onLiveChange((ev) => {
      const all = ev.entity === 'all'
      if (all || ev.entity === 'invoice' || ev.entity === 'payment') {
        later('bills', async () => patch({ bills: await loadAllBills() }))
        later('next', refreshNextInvoice)
      }
      if (all || ev.entity === 'customer' || ev.entity === 'invoice') later('customers', async () => patch({ customers: await api.customers() }))
      if (all || ev.entity === 'product' || ev.entity === 'stock') later('products', async () => patch({ products: await api.products() }))
      if (all || ev.entity === 'category' || ev.entity === 'product') later('categories', async () => patch({ categories: await api.categories() }))
      if (all || ev.entity === 'settings')
        later('settings', async () => {
          const b = await api.bootstrap()
          patch({ settings: b.settings, taxRates: b.taxRates })
        })
    })
    return () => {
      off()
      Object.values(reloading.current).forEach(clearTimeout)
    }
  }, [signedIn, patch, refreshNextInvoice])

  const value = useMemo<AppState | null>(() => {
    if (!data) return null
    const upsertBill = (bill: Bill) =>
      patch((d) => ({ bills: [bill, ...d.bills.filter((b) => b.id !== bill.id)].sort(byDateDesc) }))

    return {
      page,
      navigate,
      startNewBill: () => {
        setNewBillRequest((n) => n + 1)
        navigate('create')
      },
      newBillRequest,
      createOpened,
      settings: data.settings,
      saveSettings: async (s) => {
        const saved = await api.saveSettings(s)
        patch({ settings: saved })
        refreshNextInvoice()
        return saved
      },
      products: data.products,
      customers: data.customers,
      categories: data.categories,
      taxRates: data.taxRates,
      user: data.user,
      can: (p) => canRole(data.user.role, p),
      saveProduct: async (id, input) => {
        const saved = id ? await api.updateProduct(id, input) : await api.createProduct(input)
        patch((d) => ({ products: [...d.products.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)) }))
        return saved
      },
      deleteProduct: async (id) => {
        const r = await api.deleteProduct(id)
        patch((d) => ({ products: d.products.filter((p) => p.id !== id) }))
        return r.archived
      },
      setStock: async (productId, stock, reason) => {
        await api.adjustStock({ productId, mode: 'set', quantity: stock, note: reason })
        await refreshProducts()
      },
      addCategory: async (name) => {
        const c = await api.createCategory(name)
        patch((d) => ({ categories: [...d.categories, c].sort((a, b) => a.name.localeCompare(b.name)) }))
        return c
      },
      refreshProducts,
      bills: data.bills,
      saveBill: async (id, input) => {
        const exists = id !== null && data.bills.some((b) => b.id === id)
        const bill = exists ? await api.updateBill(id, input) : await api.createBill(input)
        upsertBill(bill)
        if (!exists) refreshNextInvoice()
        // stock changed on the server: show the new figures at once (live updates also do this)
        if (input.items.some((i) => i.productId)) refreshProducts()
        // a new customer may have been created from the bill
        if (input.saveCustomer && !input.customer.id) api.customers().then((customers) => patch({ customers }), () => {})
        return bill
      },
      /** Brings the amount received up to `amountPaid` by recording the difference as a payment. */
      recordPayment: async (id, amountPaid) => {
        const current = data.bills.find((b) => b.id === id) ?? (await api.bill(id))
        const amount = round2(Math.min(amountPaid - current.amountPaid, current.totals.balance))
        if (amount <= 0) return current
        const method = current.paymentMethod === 'Credit' ? 'Cash' : current.paymentMethod
        const bill = await api.addPayment(id, { amount, method, clientRequestId: crypto.randomUUID() })
        upsertBill(bill)
        return bill
      },
      deleteBill: async (id) => {
        await api.deleteBill(id)
        patch((d) => ({ bills: d.bills.filter((b) => b.id !== id) }))
      },
      nextInvoiceNo: data.nextInvoiceNo,
      money: (n, digits = 2) => formatMoney(n, data.settings.currency, digits),
      toasts,
      toast,
      dismissToast,
      printJob,
      printBill: (bill, format = data.settings.invoiceFormat) => setPrintJob({ bill, mode: 'print', format }),
      downloadPdf: (bill, format = data.settings.invoiceFormat) => setPrintJob({ bill, mode: 'pdf', format }),
      finishPrintJob: () => setPrintJob(null),
      authRequired: data.authRequired,
      logout: async () => {
        disconnectLive()
        await api.logout().catch(() => {})
        setData(null)
        setNeedsLogin(true)
      },
      resetData: async () => {
        await api.reset()
        localStorage.removeItem('bd.draft')
        window.location.reload()
      },
      downloadBackup: async () => {
        const backup = await api.backup()
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `billing-backup-${toDateKey(new Date())}.json`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      },
      restoreBackup: async (backup) => {
        await api.restore(backup)
        localStorage.removeItem('bd.draft')
        window.location.reload()
      },
    }
  }, [data, page, navigate, newBillRequest, createOpened, patch, refreshNextInvoice, refreshProducts, toasts, toast, dismissToast, printJob])

  if (needsLogin) return <LoginScreen onSignedIn={load} />
  if (!value) return <StartupScreen error={loadError} onRetry={load} />
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function StartupScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {error ? (
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-red-50 text-xl text-red-600 ring-1 ring-red-200 ring-inset">!</div>
          <h1 className="text-lg font-semibold text-ink-900">Can't connect to the billing server</h1>
          <p className="mt-2 text-sm text-ink-500">{error}</p>
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-left font-mono text-xs text-ink-700">
            cd simple-billing-app
            <br />
            npm run dev
          </p>
          <button onClick={onRetry} className="mt-5 h-10 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700">
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-sm text-ink-500">
          <span className="size-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
          Loading your billing data…
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
