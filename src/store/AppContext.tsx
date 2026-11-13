import { liveQuery } from 'dexie'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, isNetworkError, refreshFailedOffline, refreshSession, setSignedOutHandler, type ProductInput } from '../lib/api'
import { round3 } from '../../shared/billing.ts'
import { can as canRole, type Permission } from '../../shared/permissions.ts'
import { LoginScreen } from '../components/LoginScreen'
import { formatMoney, round2, toDateKey, uid } from '../lib/format'
import { connectLive, disconnectLive, onLiveChange } from '../lib/live'
import { isOnline, onReconnect, reportNetworkError, useConnectionState, useOnline, type ConnectionState } from '../offline/connection'
import { clearSnapshot, db, loadAttribution, loadSnapshot, saveAttribution, saveSnapshot, type OutboxOp } from '../offline/db'
import { assertEditable, LOCAL_VERSION, stockUsed } from '../offline/localBill'
import { discardOp, queueBillCreate, queueBillUpdate, queuePayment, queueProductCreate, queueProductUpdate, retryOp } from '../offline/outbox'
import { requestSync, setSyncHandlers, syncNow } from '../offline/sync'
import type { Bill, BillInput, Category, Customer, InvoiceFormat, Page, PaymentInput, Product, Settings, TaxRate, User } from '../types'

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

  /* ---------- offline ---------- */
  /** the billing server can be reached right now */
  online: boolean
  /** online, waking (server starting up / not answering in time) or offline (no connection) */
  connection: ConnectionState
  /**
   * Whether the browser agreed to keep this app's offline data out of automatic clean-ups (storage.persist).
   * null = not known / not supported. Even when true, data can still be removed (e.g. clearing site data).
   */
  storagePersisted: boolean | null
  /** when the data on screen came from this device's saved copy (opened offline): when that copy was saved */
  offlineDataFrom: string | null
  /** changes made offline that the server doesn't have yet, oldest first */
  outbox: OutboxOp[]
  /** 'pending' while a bill or product has changes waiting; 'failed' / 'conflict' when the server refused one */
  syncStateOf: (id: string) => OutboxOp['status'] | undefined
  syncNow: () => void
  /** drops a waiting change (sync panel) */
  discardChange: (seq: number) => Promise<void>
  /**
   * Sends a refused change again. `keepMine`: override a newer change made on another device (conflict);
   * `asMe` (administrators): send a change whose maker can't be verified under the administrator's own name.
   */
  retryChange: (seq: number, mode?: 'retry' | 'keepMine' | 'asMe') => Promise<void>
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
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
const digitsOf = (phone: string) => phone.replace(/\D/g, '')

/** Records with unsynced changes, as they look on this device (see src/offline/db.ts) */
interface Local {
  bills: Bill[]
  products: Product[]
  customers: Customer[]
  ops: OutboxOp[]
}
const NO_LOCAL: Local = { bills: [], products: [], customers: [], ops: [] }

/** Set when signing out offline: the server still has to be told, on the next start with a connection */
const SIGN_OUT_PENDING = 'bd.signOutPending'

/** How long the app waits for a (possibly sleeping) server at start before opening the copy saved on this device */
const STARTUP_WAIT_MS = 12_000

/**
 * Asks the browser to keep this app's data (including bills not yet synced) out of automatic clean-ups when the
 * device runs low on storage. Browsers may refuse, ask the user, or still clear data (e.g. "clear site data"), so
 * this lowers the risk but is never a guarantee. Returns whether storage is persistent, or null if unknown.
 */
async function persistStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

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
  const online = useOnline()
  const connection = useConnectionState()
  /** when set, the data on screen is this device's saved copy (opened offline), saved at this time */
  const [offlineDataFrom, setOfflineDataFrom] = useState<string | null>(null)
  const [local, setLocal] = useState<Local>(NO_LOCAL)
  /** server-signed proof of who is signed in, stored with every change made offline */
  const [attribution, setAttribution] = useState<{ userId: string; token: string } | undefined>(undefined)
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null)
  const hasData = useRef(false)
  useEffect(() => {
    hasData.current = !!data
  }, [data])

  /*
   * Writes of this device's copy of the server data run one at a time, newest wins: a write that was overtaken by
   * newer data is skipped, so an older copy can never be saved over a newer one.
   */
  const snapshots = useRef({ chain: Promise.resolve(), generation: 0 })
  const writeSnapshot = useCallback((d: Data) => {
    const w = snapshots.current
    const mine = ++w.generation
    const { authRequired: _a, ...snapshot } = d
    w.chain = w.chain.then(() => (mine === w.generation ? saveSnapshot(snapshot) : undefined)).catch(() => {})
    return w.chain
  }, [])

  /** Opens with this device's saved copy when the server can't be reached. False if there is none. */
  const startOffline = useCallback(async () => {
    const snap = await loadSnapshot().catch(() => null)
    if (!snap) return false
    const { savedAt, ...rest } = snap
    setData({ ...rest, authRequired: true })
    setOfflineDataFrom(savedAt || new Date().toISOString())
    const saved = await loadAttribution(snap.user.id).catch(() => undefined)
    setAttribution(saved && { userId: saved.userId, token: saved.token })
    setNeedsLogin(false)
    return true
  }, [])

  /** Proof of who is signed in, for changes made offline later; kept on the device with the data copy */
  const refreshAttribution = useCallback(async (userId: string) => {
    try {
      const a = await api.offlineAttribution()
      setAttribution({ userId, token: a.token })
      await saveAttribution({ userId, ...a })
    } catch {
      // keep the proof saved earlier (if any); offline changes without one wait for their maker to sign in
      const saved = await loadAttribution(userId).catch(() => undefined)
      setAttribution(saved && { userId, token: saved.token })
    }
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [boot, bills] = await Promise.all([api.bootstrap(), loadAllBills()])
      const next: Data = {
        settings: boot.settings,
        products: boot.products,
        customers: boot.customers,
        categories: boot.categories,
        taxRates: boot.taxRates,
        user: boot.user,
        bills,
        nextInvoiceNo: boot.nextInvoiceNo,
        authRequired: true,
      }
      setData(next)
      // signed in successfully: an earlier offline sign-out no longer needs finishing (it would end this session)
      localStorage.removeItem(SIGN_OUT_PENDING)
      setOfflineDataFrom(null)
      setNeedsLogin(false)
      // save the copy at once (not only after a pause), so the app can open offline straight away
      void writeSnapshot(next)
      void refreshAttribution(boot.user.id)
      void persistStorage().then(setStoragePersisted)
      connectLive()
      requestSync(0)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return setNeedsLogin(true)
      // no connection: keep what is on screen, or open with the copy saved on this device
      if (isNetworkError(err) && (hasData.current || (await startOffline()))) return
      setLoadError(err instanceof Error ? err.message : 'Could not load data')
    }
  }, [startOffline, writeSnapshot, refreshAttribution])

  useEffect(() => {
    // session expired mid-use: drop to the sign-in screen (the unsaved bill draft is kept in this browser).
    // The saved copy is forgotten so the app can't be opened offline without signing in again; changes waiting
    // to sync are kept and sent after the next sign-in.
    setSignedOutHandler(() => {
      disconnectLive()
      setNeedsLogin(true)
      setData(null)
      void clearSnapshot().catch(() => {})
    })
    ;(async () => {
      // signed out while offline last time: finish signing out on the server before anything else
      if (localStorage.getItem(SIGN_OUT_PENDING)) {
        if (await api.logout()) localStorage.removeItem(SIGN_OUT_PENDING)
        return setNeedsLogin(true)
      }
      // continue the session from the sign-in cookie, if there is one; without a connection, open the saved copy.
      // A sleeping server can take a minute to answer: after a while, open the saved copy meanwhile and let the
      // sign-in finish in the background (it is never cut off, so the sign-in cookie is never lost).
      const refresh = refreshSession()
      const first = await Promise.race([refresh, new Promise<'slow'>((r) => setTimeout(() => r('slow'), STARTUP_WAIT_MS))])
      if (first === 'slow') {
        reportNetworkError('timeout')
        if (await startOffline()) {
          void refresh.then((s) => s && load())
          return
        }
      }
      const s = first === 'slow' ? await refresh : first
      if (s) return load()
      if (refreshFailedOffline() && (await startOffline())) return
      setNeedsLogin(true)
    })()
  }, [load, startOffline])

  // Records with unsynced changes, kept in step with IndexedDB (also across open tabs)
  useEffect(() => {
    const sub = liveQuery(async () => ({
      bills: await db.localBills.toArray(),
      products: await db.localProducts.toArray(),
      customers: await db.localCustomers.toArray(),
      ops: await db.outbox.orderBy('seq').toArray(),
    })).subscribe({ next: setLocal, error: () => {} })
    return () => sub.unsubscribe()
  }, [])

  // Keep this device's copy of the server data up to date, so the app can open offline with recent figures.
  // Changes are written shortly after they arrive (several in a burst are written once), and at once when the
  // page is hidden or closed.
  useEffect(() => {
    if (!data || offlineDataFrom) return
    const t = setTimeout(() => void writeSnapshot(data), 500)
    const flush = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(t)
        void writeSnapshot(data)
      }
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [data, offlineDataFrom, writeSnapshot])

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

  // Sync: send changes made offline whenever there is a connection, then reload the server's figures
  const userIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    userIdRef.current = data?.user.id
  }, [data?.user.id])
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    if (!signedIn) return
    setSyncHandlers({
      userId: () => userIdRef.current,
      onBill: (bill) => patch((d) => ({ bills: [bill, ...d.bills.filter((b) => b.id !== bill.id)].sort(byDateDesc) })),
      onProduct: (p) => patch((d) => ({ products: [...d.products.filter((x) => x.id !== p.id), p].sort(byName) })),
      onFinished: (synced, refused) => {
        // say which change was refused and why, so the cashier can act on it (Sync panel)
        for (const op of refused.slice(0, 2)) toast(`Not synced: ${op.label}. ${op.error ?? ''}`, 'error')
        if (refused.length > 2) toast(`${refused.length - 2} more changes need attention: open Sync`, 'error')
        if (!synced) return
        toast(`${synced} offline change${synced === 1 ? '' : 's'} synced to the server`)
        void loadRef.current()
      },
    })
    requestSync(0)
    // safety net (e.g. a change refused because the server was busy)
    const every = setInterval(() => requestSync(0), 60_000)
    // back online: send waiting changes and catch up on what others did meanwhile
    const off = onReconnect(() => {
      requestSync(0)
      void loadRef.current()
    })
    return () => {
      setSyncHandlers(null)
      clearInterval(every)
      off()
    }
  }, [signedIn, patch, toast])

  const value = useMemo<AppState | null>(() => {
    if (!data) return null
    const upsertBill = (bill: Bill) =>
      patch((d) => ({ bills: [bill, ...d.bills.filter((b) => b.id !== bill.id)].sort(byDateDesc) }))

    /* ----- what the screens show: the server's data with this device's unsynced changes on top ----- */
    const localBillIds = new Set(local.bills.map((b) => b.id))
    const bills = local.bills.length ? [...data.bills.filter((b) => !localBillIds.has(b.id)), ...local.bills].sort(byDateDesc) : data.bills
    const serverBill = new Map(data.bills.map((b) => [b.id, b]))

    const catName = new Map(data.categories.map((c) => [c.id, c.name]))
    const localProductIds = new Set(local.products.map((p) => p.id))
    let products = local.products.length
      ? [...data.products.filter((p) => !localProductIds.has(p.id)), ...local.products.map((p) => ({ ...p, categoryName: p.categoryName ?? (p.categoryId ? catName.get(p.categoryId) : undefined) }))].sort(byName)
      : data.products
    if (local.bills.length) {
      // stock taken by bills not yet synced (the server's figures don't include them yet)
      const byId = new Map(products.map((p) => [p.id, p]))
      const taken = new Map<string, number>()
      for (const b of local.bills) {
        const now = stockUsed(b, byId)
        const before = stockUsed(serverBill.get(b.id), byId)
        for (const id of new Set([...now.keys(), ...before.keys()])) taken.set(id, (taken.get(id) ?? 0) + (now.get(id) ?? 0) - (before.get(id) ?? 0))
      }
      products = products.map((p) => (taken.get(p.id) ? { ...p, stock: round3(p.stock - taken.get(p.id)!) } : p))
    }

    const serverCustomerIds = new Set(data.customers.map((c) => c.id))
    const newCustomers = local.customers.filter((c) => !serverCustomerIds.has(c.id))
    const customers = newCustomers.length ? [...data.customers, ...newCustomers].sort(byName) : data.customers

    const syncState = new Map<string, OutboxOp['status']>()
    // a record shows its most serious state: anything refused or held outranks waiting
    for (const op of local.ops) if ((syncState.get(op.entityId) ?? 'pending') === 'pending') syncState.set(op.entityId, op.status)
    const waiting = (id: string) => syncState.has(id)

    // the proof is used only if it is this user's (another user's may still be in memory just after switching)
    const who = { userId: data.user.id, userName: data.user.name, attribution: attribution?.userId === data.user.id ? attribution.token : undefined }
    const billLabel = (b: Bill) => `Bill ${b.invoiceNo} · ${b.customer.name}`
    const afterQueue = () => {
      requestSync(0)
      if (!isOnline()) toast('Saved on this device. It will sync when the connection is back.', 'info')
    }

    /**
     * A customer typed on a bill made offline: link it to a known customer with the same phone, or keep it on
     * this device (with an id the server will also use) until the bill syncs.
     */
    const offlineCustomer = (input: BillInput): { input: BillInput; newCustomer?: Customer } => {
      const c = input.customer
      if (c.id) {
        const pending = local.customers.find((x) => x.id === c.id)
        // still only on this device: ask the server to create it (or link it by phone) with this bill
        return pending ? { input: { ...input, saveCustomer: true, customer: { ...c, phone: c.phone || pending.phone } } } : { input }
      }
      if (!input.saveCustomer || !c.phone || c.name === 'Walk-in Customer') return { input }
      const same = customers.find((x) => digitsOf(x.phone) === digitsOf(c.phone))
      if (same) return { input: { ...input, customer: { ...c, id: same.id } } }
      const newCustomer: Customer = { id: crypto.randomUUID(), name: c.name, phone: c.phone, address: c.address, gstin: c.gstin }
      return { input: { ...input, customer: { ...c, id: newCustomer.id } }, newCustomer }
    }

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
      products,
      customers,
      categories: data.categories,
      taxRates: data.taxRates,
      user: data.user,
      can: (p) => canRole(data.user.role, p),
      saveProduct: async (id, input) => {
        // a new product gets its id here, so bills made offline can use it before it reaches the server
        const withId = id ? input : { ...input, id: crypto.randomUUID() }
        if (!(id && waiting(id)) && isOnline()) {
          try {
            const saved = id ? await api.updateProduct(id, withId) : await api.createProduct(withId)
            patch((d) => ({ products: [...d.products.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)) }))
            return saved
          } catch (e) {
            if (!isNetworkError(e)) throw e
          }
        }
        const label = `Product ${input.name}`
        const saved = id
          ? await queueProductUpdate(id, input, data.products.find((p) => p.id === id) ?? products.find((p) => p.id === id)!, label, who)
          : await queueProductCreate(withId as ProductInput & { id: string }, label, who)
        afterQueue()
        return saved
      },
      deleteProduct: async (id) => {
        if (waiting(id)) throw new Error('This product has changes waiting to sync. Delete it after they reach the server.')
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
      bills,
      /*
       * Bills go straight to the server when it can be reached, as before. Without a connection (or when the
       * bill already has changes waiting, so they stay in order) the bill is saved on this device and synced later.
       */
      saveBill: async (id, input) => {
        const current = id !== null ? bills.find((b) => b.id === id) : undefined
        if (!current) {
          // the bill's id is chosen here, so a retry or a later sync can never create it twice
          const withId = { ...input, id: crypto.randomUUID() }
          if (isOnline()) {
            try {
              const bill = await api.createBill(withId)
              upsertBill(bill)
              refreshNextInvoice()
              // stock changed on the server: show the new figures at once (live updates also do this)
              if (input.items.some((i) => i.productId)) refreshProducts()
              // a new customer may have been created from the bill
              if (input.saveCustomer && !input.customer.id) api.customers().then((customers) => patch({ customers }), () => {})
              return bill
            } catch (e) {
              if (!isNetworkError(e)) throw e
            }
          }
          const { input: queued, newCustomer } = offlineCustomer(withId)
          const bill = await queueBillCreate(queued as BillInput & { id: string }, '', who, newCustomer)
          await db.outbox.where('entityId').equals(bill.id).modify({ label: billLabel(bill) })
          afterQueue()
          return bill
        }
        if (!waiting(current.id) && isOnline()) {
          try {
            // a bill first saved offline: the copy being edited carries the local version, edit the server's
            const version = input.version === LOCAL_VERSION ? serverBill.get(current.id)?.version : input.version
            const bill = await api.updateBill(current.id, { ...input, version })
            upsertBill(bill)
            if (input.items.some((i) => i.productId)) refreshProducts()
            if (input.saveCustomer && !input.customer.id) api.customers().then((customers) => patch({ customers }), () => {})
            return bill
          } catch (e) {
            if (!isNetworkError(e)) throw e
          }
        }
        assertEditable(current)
        const { input: queued, newCustomer } = offlineCustomer(input)
        const bill = await queueBillUpdate(current.id, queued, serverBill.get(current.id) ?? current, billLabel(current), who, newCustomer)
        afterQueue()
        return bill
      },
      /** Brings the amount received up to `amountPaid` by recording the difference as a payment. */
      recordPayment: async (id, amountPaid) => {
        const current = bills.find((b) => b.id === id) ?? (await api.bill(id))
        const amount = round2(Math.min(amountPaid - current.amountPaid, current.totals.balance))
        if (amount <= 0) return current
        const method = current.paymentMethod === 'Credit' ? 'Cash' : current.paymentMethod
        const payment: PaymentInput & { clientRequestId: string } = { amount, method, clientRequestId: crypto.randomUUID() }
        if (!waiting(id) && isOnline()) {
          try {
            const bill = await api.addPayment(id, payment)
            upsertBill(bill)
            return bill
          } catch (e) {
            // the same idempotency key is reused below, so if this payment did reach the server it is saved once
            if (!isNetworkError(e)) throw e
          }
        }
        const label = `Payment ${formatMoney(amount, data.settings.currency)} · ${billLabel(current)}`
        const bill = await queuePayment(id, { ...payment, date: new Date().toISOString() }, serverBill.get(id) ?? current, label, who)
        afterQueue()
        return bill
      },
      deleteBill: async (id) => {
        const ops = local.ops.filter((o) => o.entityId === id)
        const create = ops.find((o) => o.kind === 'bill.create')
        if (create) {
          // made offline: if it never reached the server, deleting it here is all there is to do
          if (create.maybeSentRev !== undefined) throw new Error('This bill may already have reached the server. Delete it once it has synced.')
          return discardOp(create.seq!)
        }
        if (ops.length) throw new Error('This bill has changes waiting to sync. Delete it after they reach the server.')
        await api.deleteBill(id)
        patch((d) => ({ bills: d.bills.filter((b) => b.id !== id) }))
      },
      // offline, the real number is given by the server when the bill syncs (another counter may take the next one)
      nextInvoiceNo: online ? data.nextInvoiceNo : 'Given on sync',
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
        const n = local.ops.length
        const waitingMsg = `${n} change${n === 1 ? '' : 's'} made offline ${n === 1 ? 'has' : 'have'} not reached the server yet. They stay saved on this device and sync after the next sign-in.\n\nSign out anyway?`
        if (n && !window.confirm(waitingMsg)) return
        const offlineMsg = "You're offline. After signing out you can't sign in again on this device until the connection is back.\n\nSign out anyway?"
        if (!isOnline() && !window.confirm(offlineMsg)) return
        disconnectLive()
        // offline, the server can't be told now: remember to finish signing out on the next start
        if (!(await api.logout())) localStorage.setItem(SIGN_OUT_PENDING, '1')
        await clearSnapshot().catch(() => {})
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
      online,
      offlineDataFrom,
      outbox: local.ops,
      syncStateOf: (id) => syncState.get(id),
      syncNow: () => void syncNow(),
      discardChange: (seq) => discardOp(seq),
      retryChange: async (seq, mode = 'retry') => {
        if (mode === 'asMe' && !canRole(data.user.role, 'users.manage')) throw new Error('Only an administrator can do this')
        await retryOp(seq, mode)
        void syncNow()
      },
      connection,
      storagePersisted,
    }
  }, [data, page, navigate, newBillRequest, createOpened, patch, refreshNextInvoice, refreshProducts, toasts, toast, dismissToast, printJob, local, online, offlineDataFrom, attribution, connection, storagePersisted])

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
