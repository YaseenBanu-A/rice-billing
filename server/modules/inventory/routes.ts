import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const inventoryRoutes = Router()
  .get('/inventory/movements', requirePermission('inventory.view'), c.movements)
  .get('/inventory/summary', requirePermission('inventory.view'), c.summary)
  .post('/inventory/adjustments', requirePermission('inventory.adjust'), c.adjust)
