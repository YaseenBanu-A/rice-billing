import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const supplierRoutes = Router()
  .get('/suppliers', requirePermission('suppliers.view'), c.list)
  .post('/suppliers', requirePermission('suppliers.manage'), c.create)
  .put('/suppliers/:id', requirePermission('suppliers.manage'), c.update)
  .delete('/suppliers/:id', requirePermission('suppliers.manage'), c.remove)
