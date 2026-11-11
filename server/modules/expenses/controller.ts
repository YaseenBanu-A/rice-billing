import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { idParam, paging, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import { periodOf } from '../reports/period.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  const { from, to } = periodOf(req, { optional: true })
  res.json(
    await s.listExpenses({
      q: qs(req, 'q'),
      category: qs(req, 'category'),
      categoryId: qs(req, 'categoryId'),
      method: qs(req, 'method'),
      from,
      to,
      ...paging(req, 50, 5000),
    }),
  )
}

export async function get(req: Request, res: Response) {
  res.json(await s.getExpense(idParam(req, 'id', 'Expense')))
}

/** Defaults to the current month */
export async function summary(req: Request, res: Response) {
  const { from, to } = periodOf(req)
  res.json(await s.expenseSummary(from!, to!))
}

export async function categoryNames(_req: Request, res: Response) {
  res.json(await s.expenseCategoryNames())
}

export async function create(req: Request, res: Response) {
  const { expense, created } = await s.createExpense(s.validateExpense(req.body), actorOf(req))
  if (created) broadcast({ entity: 'expense', action: 'create', id: expense.id, label: expense.title || expense.category }, actorOf(req))
  res.status(created ? 201 : 200).json(expense)
}

export async function update(req: Request, res: Response) {
  const e = await s.updateExpense(idParam(req, 'id', 'Expense'), s.validateExpense(req.body), actorOf(req))
  broadcast({ entity: 'expense', action: 'update', id: e.id, label: e.title || e.category }, actorOf(req))
  res.json(e)
}

export async function remove(req: Request, res: Response) {
  await s.deleteExpense(idParam(req, 'id', 'Expense'), actorOf(req))
  broadcast({ entity: 'expense', action: 'delete', id: idParam(req, 'id', 'Expense') }, actorOf(req))
  res.status(204).end()
}

/* ---------- categories ---------- */

export async function categories(_req: Request, res: Response) {
  res.json(await s.listExpenseCategories())
}

export async function createCategory(req: Request, res: Response) {
  const c = await s.createExpenseCategory(s.validateCategory(req.body), actorOf(req))
  broadcast({ entity: 'expense', action: 'category.create', id: c.id, label: c.name }, actorOf(req))
  res.status(201).json(c)
}

export async function updateCategory(req: Request, res: Response) {
  const c = await s.updateExpenseCategory(idParam(req, 'id', 'Category'), s.validateCategory(req.body), actorOf(req))
  broadcast({ entity: 'expense', action: 'category.update', id: c.id, label: c.name }, actorOf(req))
  res.json(c)
}

export async function removeCategory(req: Request, res: Response) {
  const r = await s.deleteExpenseCategory(idParam(req, 'id', 'Category'), actorOf(req))
  broadcast({ entity: 'expense', action: 'category.delete', id: idParam(req, 'id', 'Category') }, actorOf(req))
  res.json(r)
}

/* ---------- receipt ---------- */

/** Body is the raw file; its type in Content-Type and its name (URL-encoded) in X-File-Name. */
export async function attach(req: Request, res: Response) {
  let fileName = req.get('x-file-name') ?? 'receipt'
  try {
    fileName = decodeURIComponent(fileName)
  } catch {
    // not URL-encoded: use as given (the service cleans it)
  }
  const info = await s.saveAttachment(idParam(req, 'id', 'Expense'), { data: req.body, mimeType: req.get('content-type') ?? '', fileName }, actorOf(req))
  broadcast({ entity: 'expense', action: 'attach', id: idParam(req, 'id', 'Expense') }, actorOf(req))
  res.status(201).json(info)
}

export async function download(req: Request, res: Response) {
  const a = await s.getAttachment(idParam(req, 'id', 'Expense'))
  res.setHeader('Content-Type', a.mimeType)
  res.setHeader('Content-Length', String(a.size))
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`)
  res.setHeader('Cache-Control', 'private, no-store')
  // the file is shown on its own, never as part of the app
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
  res.end(Buffer.from(a.data))
}

export async function detach(req: Request, res: Response) {
  await s.deleteAttachment(idParam(req, 'id', 'Expense'), actorOf(req))
  broadcast({ entity: 'expense', action: 'detach', id: idParam(req, 'id', 'Expense') }, actorOf(req))
  res.status(204).end()
}
