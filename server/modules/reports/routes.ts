import { Router, type Request, type Response } from 'express'
import { badRequest } from '../../lib/errors.ts'
import { dateRange } from '../../lib/http.ts'
import { toDateKey } from '../../lib/num.ts'
import { requirePermission } from '../../middleware/auth.ts'
import * as s from './service.ts'

async function dashboard(_req: Request, res: Response) {
  res.json(await s.dashboard())
}

/** Defaults to the current month */
async function summary(req: Request, res: Response) {
  const today = toDateKey(new Date())
  const { from = `${today.slice(0, 7)}-01`, to = today } = dateRange(req)
  if (from > to) throw badRequest('"from" must be on or before "to"')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366 * 3) throw badRequest('Choose a range of at most 3 years')
  res.json(await s.summary(from, to))
}

export const reportRoutes = Router()
  .get('/reports/dashboard', requirePermission('bills.view'), dashboard)
  .get('/reports/summary', requirePermission('reports.view'), summary)
