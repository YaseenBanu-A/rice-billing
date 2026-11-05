import type { Request } from 'express'
import { badRequest } from './errors.ts'
import { DATE_RE } from './validate.ts'

/** A query-string value, if given once as text. */
export const qs = (req: Request, key: string): string | undefined => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined)

export function dateRange(req: Request): { from?: string; to?: string } {
  const from = qs(req, 'from') || undefined
  const to = qs(req, 'to') || undefined
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw badRequest('from/to must be dates in yyyy-mm-dd format')
  return { from, to }
}

export function paging(req: Request, defLimit = 50, maxLimit = 500): { limit: number; offset: number } {
  const limit = Number(qs(req, 'limit') ?? defLimit)
  const offset = Number(qs(req, 'offset') ?? 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit || !Number.isInteger(offset) || offset < 0)
    throw badRequest(`limit must be 1-${maxLimit} and offset zero or more`)
  return { limit, offset }
}

export const param = (req: Request, key: string) => String(req.params[key] ?? '')

/** Date filter on a yyyy-mm-dd `dateKey` column */
export function dateKeyWhere(from?: string, to?: string) {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}
