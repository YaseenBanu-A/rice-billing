import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const purchaseRoutes = Router()
  .get('/purchases', requirePermission('purchases.view'), c.list)
  .get('/purchases/next', requirePermission('purchases.view'), c.next)
  .get('/purchases/:id', requirePermission('purchases.view'), c.get)
  .post('/purchases', requirePermission('purchases.manage'), c.create)
  .post('/purchases/:id/payments', requirePermission('purchases.manage'), c.pay)
  .post('/purchases/:id/cancel', requirePermission('purchases.manage'), c.cancel)
