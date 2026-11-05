import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { dateRange, paging, param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  res.json(await s.listExpenses({ q: qs(req, 'q'), category: qs(req, 'category'), ...dateRange(req), ...paging(req) }))
}

export async function categories(_req: Request, res: Response) {
  res.json(await s.expenseCategories())
}

export async function create(req: Request, res: Response) {
  const { expense, created } = await s.createExpense(s.validateExpense(req.body), actorOf(req))
  if (created) broadcast({ entity: 'expense', action: 'create', id: expense.id }, actorOf(req))
  res.status(created ? 201 : 200).json(expense)
}

export async function update(req: Request, res: Response) {
  const e = await s.updateExpense(param(req, 'id'), s.validateExpense(req.body), actorOf(req))
  broadcast({ entity: 'expense', action: 'update', id: e.id }, actorOf(req))
  res.json(e)
}

export async function remove(req: Request, res: Response) {
  await s.deleteExpense(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'expense', action: 'delete', id: param(req, 'id') }, actorOf(req))
  res.status(204).end()
}
