import type { Request } from 'express'
import { badRequest } from '../../lib/errors.ts'
import { dateRange } from '../../lib/http.ts'
import { toDateKey } from '../../lib/num.ts'

/** Longest period a report may cover */
const MAX_DAYS = 366 * 3

/**
 * `from` / `to` (yyyy-mm-dd, inclusive, shop time zone) from the query string. When missing they default to
 * the current month, unless `optional` (then no date filter at all).
 */
export function periodOf(req: Request, opts: { optional?: boolean } = {}): { from?: string; to?: string } {
  const today = toDateKey(new Date())
  const given = dateRange(req)
  for (const d of [given.from, given.to]) {
    const t = d ? Date.parse(`${d}T00:00:00Z`) : 0
    // 2024-02-30 parses as 1 March: only a date that reads back the same is real
    if (d && (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d)) throw badRequest(`${d} is not a valid date`)
  }
  if (opts.optional && !given.from && !given.to) return {}
  const from = given.from ?? (opts.optional ? undefined : `${today.slice(0, 7)}-01`)
  const to = given.to ?? (opts.optional ? undefined : today)
  if (from && to) {
    if (from > to) throw badRequest('"from" must be on or before "to"')
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) throw badRequest('Choose a period of at most 3 years')
  }
  return { from, to }
}
