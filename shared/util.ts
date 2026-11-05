export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** yyyy-mm-dd in local time, for <input type="date"> and day comparisons */
export function toDateKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
