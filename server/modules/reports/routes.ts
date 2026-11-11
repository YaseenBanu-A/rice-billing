import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import { periodOf } from './period.ts'
import * as s from './service.ts'

async function dashboard(_req: Request, res: Response) {
  res.json(await s.dashboard())
}

/** The reports below cover `from`..`to` (inclusive, shop time zone); without them, the current month. */
const period = (req: Request) => periodOf(req) as { from: string; to: string }

async function summary(req: Request, res: Response) {
  const { from, to } = period(req)
  res.json(await s.summary(from, to))
}

async function invoices(req: Request, res: Response) {
  const { from, to } = period(req)
  res.json(await s.invoiceReport(from, to))
}

async function customers(req: Request, res: Response) {
  const { from, to } = period(req)
  res.json(await s.customerReport(from, to))
}

async function payments(req: Request, res: Response) {
  const { from, to } = period(req)
  res.json(await s.paymentReport(from, to))
}

/** As of now, whatever the period */
async function outstanding(_req: Request, res: Response) {
  res.json(await s.outstandingReport())
}

export const reportRoutes = Router()
  .get('/reports/dashboard', requirePermission('bills.view'), dashboard)
  .get('/reports/summary', requirePermission('reports.view'), summary)
  .get('/reports/invoices', requirePermission('reports.view'), invoices)
  .get('/reports/customers', requirePermission('reports.view'), customers)
  .get('/reports/payments', requirePermission('reports.view'), payments)
  .get('/reports/outstanding', requirePermission('reports.view'), outstanding)
