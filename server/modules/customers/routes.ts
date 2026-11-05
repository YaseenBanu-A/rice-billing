import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const customerRoutes = Router()
  .get('/customers', requirePermission('customers.view'), c.list)
  .get('/customers/:id', requirePermission('customers.view'), c.get)
  .post('/customers', requirePermission('customers.manage'), c.create)
  .put('/customers/:id', requirePermission('customers.manage'), c.update)
  .delete('/customers/:id', requirePermission('customers.delete'), c.remove)
