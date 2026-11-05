import { badRequest, HttpError } from './errors.ts'

/* Small, dependency-free validators shared by every module. Each throws a 400 with per-field messages. */

export type Body = Record<string, unknown>

export function asObject(v: unknown, what = 'Request body'): Body {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what} must be a JSON object`)
  return v as Body
}

export function text(v: unknown, max = 500): string {
  if (v === undefined || v === null) return ''
  return (typeof v === 'string' ? v : String(v)).trim().slice(0, max)
}

export function number(v: unknown): number {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof x === 'number' && Number.isFinite(x) ? x : NaN
}

export const optNumber = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : number(v))

/** Throws when any field has a message. */
export function fail(fields: Record<string, string>) {
  const entries = Object.entries(fields).filter(([, msg]) => msg)
  if (entries.length) throw badRequest(entries[0][1], Object.fromEntries(entries))
}

export const phoneDigits = (phone: string) => phone.replace(/\D/g, '')
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/
export const EMAIL_RE = /^\S+@\S+\.\S+$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** ISO date-time, or a bare yyyy-mm-dd meaning that day (shop time zone) at the current time of day. */
export function isoDate(v: unknown, fallback = new Date()): Date {
  if (typeof v === 'string' && DATE_RE.test(v)) {
    const [y, m, d] = v.split('-').map(Number)
    const now = new Date()
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds())
  }
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v)
  return fallback
}

export function notFuture(date: Date, field = 'date') {
  if (date.getTime() > Date.now() + 36 * 3600_000) throw badRequest('Date cannot be in the future', { [field]: 'Date cannot be in the future' })
}

export function phoneError(phone: string, required: boolean): string {
  const d = phoneDigits(phone)
  if (!phone) return required ? 'Phone number is required' : ''
  return d.length < 7 || d.length > 13 ? 'Enter a valid phone number' : ''
}

export const gstinError = (g: string) => (g && !GSTIN_RE.test(g) ? 'GSTIN should be 15 characters, e.g. 33ABCDE1234F1Z5' : '')
export const emailError = (e: string) => (e && !EMAIL_RE.test(e) ? 'Enter a valid email' : '')

/** Idempotency key from the client: letters, digits and dashes only. */
export function requestKey(v: unknown): string | undefined {
  const k = text(v, 64)
  return /^[A-Za-z0-9-]{8,64}$/.test(k) ? k : undefined
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], label: string): T {
  if (!list.includes(v as T)) throw badRequest(`${label} must be one of ${list.join(', ')}`, { [label]: 'Invalid value' })
  return v as T
}
