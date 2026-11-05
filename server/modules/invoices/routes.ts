import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

/** Sales bills (invoices). Paths keep the app's original /bills naming. */
export const invoiceRoutes = Router()
  .get('/invoices/next', requirePermission('bills.view'), c.next)
  .get('/bills', requirePermission('bills.view'), c.list)
  .get('/bills/item-names', requirePermission('bills.view'), c.itemNames)
  .get('/bills/:id', requirePermission('bills.view'), c.get)
  .post('/bills', requirePermission('bills.create'), c.create)
  .put('/bills/:id', requirePermission('bills.edit'), c.update)
  .post('/bills/:id/payments', requirePermission('payments.record'), c.pay)
  .post('/bills/:id/cancel', requirePermission('bills.cancel'), c.cancel)
  .post('/bills/:id/returns', requirePermission('returns.create'), c.createReturn)
  .delete('/bills/:id', requirePermission('bills.delete'), c.remove)
  .delete('/payments/:id', requirePermission('payments.void'), c.removePayment)
