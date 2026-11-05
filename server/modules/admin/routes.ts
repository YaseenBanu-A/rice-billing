import express, { Router, type Request, type Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { badRequest } from '../../lib/errors.ts'
import { toDateKey } from '../../lib/num.ts'
import { requirePermission } from '../../middleware/auth.ts'
import { broadcast } from '../../realtime.ts'
import { listCustomers } from '../customers/service.ts'
import { nextInvoiceNo } from '../invoices/service.ts'
import { listCategories, listProducts } from '../products/service.ts'
import { getSettings, listTaxRates } from '../settings/service.ts'
import * as s from './service.ts'

/** Everything a screen needs on first load, in one call */
async function bootstrap(req: Request, res: Response) {
  const [settings, taxRates, products, customers, categories, invoiceNo] = await Promise.all([
    getSettings(),
    listTaxRates(),
    listProducts(),
    listCustomers(),
    listCategories(),
    nextInvoiceNo(),
  ])
  res.json({ settings, taxRates, products, customers, categories, nextInvoiceNo: invoiceNo, user: req.user })
}

async function backup(_req: Request, res: Response) {
  const data = await s.exportAll()
  res.setHeader('Content-Disposition', `attachment; filename="aj-rice-backup-${toDateKey(new Date())}.json"`)
  res.json(data)
}

async function restore(req: Request, res: Response) {
  const result = await s.restore(req.body, actorOf(req))
  broadcast({ entity: 'all', action: 'restore' }, actorOf(req))
  res.json(result)
}

async function reset(req: Request, res: Response) {
  if (req.body?.confirm !== 'RESET') throw badRequest('Type RESET to confirm')
  await s.resetAll(actorOf(req))
  broadcast({ entity: 'all', action: 'reset' }, actorOf(req))
  res.json({ ok: true })
}

export const adminRoutes = Router()
  .get('/bootstrap', bootstrap)
  .get('/backup', requirePermission('data.admin'), backup)
  // a backup holds every bill, so it may be much larger than a normal request
  .post('/restore', requirePermission('data.admin'), express.json({ limit: '50mb' }), restore)
  .post('/reset', requirePermission('data.admin'), reset)
