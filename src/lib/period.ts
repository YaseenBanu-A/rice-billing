import { toDateKey } from './format'

/* Date periods for the Reports and Expenses screens. Dates are yyyy-mm-dd in the shop's local time. */

export type PeriodPreset = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'fy' | 'custom'

export interface Period {
  preset: PeriodPreset
  from: string
  to: string
}

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  lastWeek: 'Last week',
  month: 'This month',
  lastMonth: 'Last month',
  fy: 'This FY',
  custom: 'Custom',
}

const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday of the week containing `d` */
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

/** The dates a preset covers, as of `now`. Weeks start on Monday; the financial year starts on 1 April. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): { from: string; to: string } {
  const today = toDateKey(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = toDateKey(addDays(now, -1))
      return { from: y, to: y }
    }
    case 'week':
      return { from: toDateKey(weekStart(now)), to: today }
    case 'lastWeek': {
      const start = addDays(weekStart(now), -7)
      return { from: toDateKey(start), to: toDateKey(addDays(start, 6)) }
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toDateKey(first), to: toDateKey(last) }
    }
    case 'fy': {
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
      return { from: `${y}-04-01`, to: today }
    }
  }
}

export const periodOf = (preset: Exclude<PeriodPreset, 'custom'>): Period => ({ preset, ...presetRange(preset) })

/** Problem with a custom period, or '' when it can be used (the server allows at most 3 years). */
export function periodError(p: { from: string; to: string }): string {
  if (!p.from || !p.to) return 'Choose both dates'
  if (p.from > p.to) return 'The start date is after the end date'
  if ((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 > 366 * 3) return 'Choose a period of at most 3 years'
  return ''
}

const fmt = (key: string, withYear = true) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })

/** "11 Nov 2026" or "1 Nov – 11 Nov 2026" */
export function periodLabel(p: { from: string; to: string }): string {
  if (p.from === p.to) return fmt(p.from)
  return `${fmt(p.from, p.from.slice(0, 4) !== p.to.slice(0, 4))} – ${fmt(p.to)}`
}

/** Short date for tables: "11 Nov 2026" */
export const dayLabel = (key: string) => fmt(key)

/* ---------- grouping daily rows into weeks / months ---------- */

export type Grouping = 'day' | 'week' | 'month'

export function groupKey(dateKey: string, g: Grouping): string {
  if (g === 'day') return dateKey
  if (g === 'month') return dateKey.slice(0, 7)
  return toDateKey(weekStart(new Date(`${dateKey}T00:00:00`)))
}

export function groupLabel(key: string, g: Grouping): string {
  if (g === 'day') return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  if (g === 'month') return new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const end = toDateKey(addDays(new Date(`${key}T00:00:00`), 6))
  return `Week of ${periodLabel({ from: key, to: end })}`
}
