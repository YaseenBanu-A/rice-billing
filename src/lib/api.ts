import type { ApiErrorBody, Backup, Bill, BillInput, BillPage, Category, Customer, PaymentInput, Product, Settings, TaxRate, User } from '../types'

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

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'ajrice' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(`${API_BASE}/api${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) })
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await send(method, path, body)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      const s = await refreshSession()
      if (!s) {
        setAccessToken(null)
        onSignedOut?.()
        throw new ApiError(401, 'Please sign in again')
      }
      res = await send(method, path, body)
    }
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'Cannot reach the billing server. Check your internet connection.')
  }
  if (res.status === 204) return undefined as T
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

  /* bills */
  bills: (q: { limit?: number; offset?: number } = {}) => request<BillPage>('GET', `/bills${query({ ...q })}`),
  bill: (id: string) => request<Bill>('GET', `/bills/${enc(id)}`),
  createBill: (input: BillInput) => request<Bill>('POST', '/bills', input),
  updateBill: (id: string, input: BillInput) => request<Bill>('PUT', `/bills/${enc(id)}`, input),
  addPayment: (id: string, p: PaymentInput) => request<Bill>('POST', `/bills/${enc(id)}/payments`, p),
  deleteBill: (id: string) => request<void>('DELETE', `/bills/${enc(id)}`),

  /* backup & reset */
  backup: () => request<Backup>('GET', '/backup'),
  restore: (backup: unknown) => request<{ bills: number; customers: number }>('POST', '/restore', backup),
  reset: () => request<{ ok: true }>('POST', '/reset', { confirm: 'RESET' }),
}

/** Random idempotency key for one submission (resent unchanged on retry) */
export const requestId = () => crypto.randomUUID()
