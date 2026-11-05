import { toDateKey } from '../../shared/util.ts'

export { round2, toDateKey } from '../../shared/util.ts'

const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(value: number, currency = 'INR', fractionDigits = 2): string {
  const key = `${currency}-${fractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    formatters.set(key, f)
  }
  return f.format(Number.isFinite(value) ? value : 0)
}

export function currencySymbol(currency = 'INR'): string {
  return (
    new Intl.NumberFormat('en-IN', { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  )
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function isToday(iso: string): boolean {
  return toDateKey(iso) === toDateKey(new Date())
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  )
}
