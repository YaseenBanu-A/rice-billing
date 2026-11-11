import type {
  ApiErrorBody,
  Backup,
  Bill,
  BillInput,
  BillPage,
  Category,
  Customer,
  CustomerReportRow,
  Expense,
  ExpenseAttachmentInfo,
  ExpenseCategory,
  ExpenseInput,
  ExpensePage,
  ExpenseSummary,
  InvoiceReportRow,
  OutstandingRow,
  PaymentInput,
  PaymentReportRow,
  Product,
  ReportRows,
  ReportSummary,
  Settings,
  TaxRate,
  User,
} from '../types'

/*
 * Talks to the billing server. The short-lived access token lives only in memory (never in localStorage);
 * the long-lived refresh token is an HttpOnly cookie the browser sends to /api/auth only. When the access
 * token expires, the first failing request refreshes it once and is retried.
 */

/** Empty = same origin (the server also serves this app). Set VITE_API_URL only when hosting the app separately. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  code?: string
  fields?: Record<string, string>
  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message)
    this.status = status
    this.fields = fields
    this.code = code
  }
}

let accessToken: string | null = null
let onSignedOut: (() => void) | undefined
const tokenListeners = new Set<(t: string | null) => void>()

export const getAccessToken = () => accessToken
export function setAccessToken(t: string | null) {
  accessToken = t
  tokenListeners.forEach((l) => l(t))
}
export const onTokenChange = (l: (t: string | null) => void) => (tokenListeners.add(l), () => void tokenListeners.delete(l))

/** Called when the session can't be renewed (signed out elsewhere, deactivated, expired) */
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn
}

export interface Session {
  accessToken: string
  user: User
}

let refreshing: Promise<Session | null> | null = null

/** Gets a new access token from the refresh cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'ajrice' } })
      if (!res.ok) return null
      const s = (await res.json()) as Session
      setAccessToken(s.accessToken)
      return s
    } catch {
      return null
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

/** A file sent as-is (not JSON), e.g. an expense receipt */
interface RawBody {
  file: Blob
  type: string
  name: string
}

async function send(method: string, path: string, body?: unknown, raw?: RawBody): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'ajrice' }
  if (raw) {
    headers['Content-Type'] = raw.type
    headers['X-File-Name'] = encodeURIComponent(raw.name)
  } else if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(`${API_BASE}/api${path}`, { method, headers, credentials: 'include', body: raw ? raw.file : body === undefined ? undefined : JSON.stringify(body) })
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: RawBody; blob?: boolean } = {}): Promise<T> {
  let res: Response
  try {
    res = await send(method, path, body, opts.raw)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      const s = await refreshSession()
      if (!s) {
        setAccessToken(null)
        onSignedOut?.()
        throw new ApiError(401, 'Please sign in again')
      }
      res = await send(method, path, body, opts.raw)
    }
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'Cannot reach the billing server. Check your internet connection.')
  }
  if (res.status === 204) return undefined as T
  if (opts.blob && res.ok) return (await res.blob()) as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data as ApiErrorBody | null
    if (res.status === 401 && !path.startsWith('/auth/')) onSignedOut?.()
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.fields, err?.code)
  }
  return data as T
}

const enc = encodeURIComponent
const query = (params: Record<string, string | number | boolean | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${enc(String(v))}`)
    .join('&')
  return q ? `?${q}` : ''
}

/** What the inventory form sends. Stock is set with `openingStock` on create, and through adjustments afterwards. */
export interface ProductInput {
  name: string
  sku: string
  categoryId?: string
  variety?: string
  brand?: string
  hsnCode: string
  unit: string
  /** package size in kg (1, 5, 10, 25 …) */
  bagWeight?: number
  price: number
  purchasePrice: number
  gstRate: number
  reorderLevel: number
  openingStock?: number
  active: boolean
}

export interface Bootstrap {
  settings: Settings
  taxRates: TaxRate[]
  products: Product[]
  customers: Customer[]
  categories: Category[]
  nextInvoiceNo: string
  user: User
}

/** The original demo build (data in the browser) is no longer offered: data always lives in PostgreSQL. */
export const DEMO = false

export const api = {
  /* sign-in */
  login: async (username: string, password: string) => {
    const s = await request<Session>('POST', '/auth/login', { username, password })
    setAccessToken(s.accessToken)
    return s
  },
  logout: async () => {
    await request('POST', '/auth/logout').catch(() => {})
    setAccessToken(null)
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const s = await request<Session>('POST', '/auth/password', { currentPassword, newPassword })
    setAccessToken(s.accessToken)
    return s
  },

  bootstrap: () => request<Bootstrap>('GET', '/bootstrap'),
  saveSettings: (s: Settings) => request<Settings>('PUT', '/settings', s),
  nextInvoiceNo: () => request<{ invoiceNo: string }>('GET', '/invoices/next').then((r) => r.invoiceNo),
  customers: () => request<Customer[]>('GET', '/customers'),
  products: () => request<Product[]>('GET', '/products'),

  /* inventory: products are the same records the bill screen searches and sells from */
  createProduct: (p: ProductInput) => request<Product>('POST', '/products', p),
  updateProduct: (id: string, p: ProductInput) => request<Product>('PUT', `/products/${enc(id)}`, p),
  /** products already used on bills or stock history are archived (hidden) instead of deleted */
  deleteProduct: (id: string) => request<{ archived: boolean }>('DELETE', `/products/${enc(id)}`),
  categories: () => request<Category[]>('GET', '/categories'),
  createCategory: (name: string) => request<Category>('POST', '/categories', { name }),
  /** mode "set" = counted stock; "add"/"remove" = a quantity in the product's unit. A reason is required. */
  adjustStock: (a: { productId: string; mode: 'set' | 'add' | 'remove'; quantity: number; note: string }) =>
    request<{ productId: string; stock: number; delta: number }>('POST', '/inventory/adjustments', a),

  /* bills */
  bills: (q: { limit?: number; offset?: number } = {}) => request<BillPage>('GET', `/bills${query({ ...q })}`),
  bill: (id: string) => request<Bill>('GET', `/bills/${enc(id)}`),
  createBill: (input: BillInput) => request<Bill>('POST', '/bills', input),
  updateBill: (id: string, input: BillInput) => request<Bill>('PUT', `/bills/${enc(id)}`, input),
  addPayment: (id: string, p: PaymentInput) => request<Bill>('POST', `/bills/${enc(id)}/payments`, p),
  deleteBill: (id: string) => request<void>('DELETE', `/bills/${enc(id)}`),

  /* expenses */
  expenses: (q: { q?: string; categoryId?: string; method?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
    request<ExpensePage>('GET', `/expenses${query(q)}`),
  expenseSummary: (from: string, to: string) => request<ExpenseSummary>('GET', `/expenses/summary${query({ from, to })}`),
  createExpense: (e: ExpenseInput) => request<Expense>('POST', '/expenses', e),
  updateExpense: (id: string, e: ExpenseInput) => request<Expense>('PUT', `/expenses/${enc(id)}`, e),
  deleteExpense: (id: string) => request<void>('DELETE', `/expenses/${enc(id)}`),
  uploadReceipt: (id: string, file: Blob, name: string) =>
    request<ExpenseAttachmentInfo>('PUT', `/expenses/${enc(id)}/attachment`, undefined, { raw: { file, type: file.type, name } }),
  receipt: (id: string) => request<Blob>('GET', `/expenses/${enc(id)}/attachment`, undefined, { blob: true }),
  deleteReceipt: (id: string) => request<void>('DELETE', `/expenses/${enc(id)}/attachment`),
  expenseCategories: () => request<ExpenseCategory[]>('GET', '/expense-categories'),
  createExpenseCategory: (name: string) => request<ExpenseCategory>('POST', '/expense-categories', { name }),
  updateExpenseCategory: (id: string, c: { name: string; active: boolean }) => request<ExpenseCategory>('PUT', `/expense-categories/${enc(id)}`, c),
  /** a category with expenses is archived (hidden from new entries) instead of deleted */
  deleteExpenseCategory: (id: string) => request<{ archived: boolean }>('DELETE', `/expense-categories/${enc(id)}`),

  /* reports: every figure comes from the database; `from`/`to` are yyyy-mm-dd, inclusive */
  reportSummary: (from: string, to: string) => request<ReportSummary>('GET', `/reports/summary${query({ from, to })}`),
  invoiceReport: (from: string, to: string) => request<ReportRows<InvoiceReportRow>>('GET', `/reports/invoices${query({ from, to })}`),
  customerReport: (from: string, to: string) => request<ReportRows<CustomerReportRow>>('GET', `/reports/customers${query({ from, to })}`),
  paymentReport: (from: string, to: string) => request<ReportRows<PaymentReportRow>>('GET', `/reports/payments${query({ from, to })}`),
  outstandingReport: () => request<ReportRows<OutstandingRow>>('GET', '/reports/outstanding'),

  /* backup & reset */
  backup: () => request<Backup>('GET', '/backup'),
  restore: (backup: unknown) => request<{ bills: number; customers: number }>('POST', '/restore', backup),
  reset: () => request<{ ok: true }>('POST', '/reset', { confirm: 'RESET' }),
}

/** Random idempotency key for one submission (resent unchanged on retry) */
export const requestId = () => crypto.randomUUID()
