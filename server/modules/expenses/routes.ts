import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const expenseRoutes = Router()
  .get('/expenses', requirePermission('expenses.view'), c.list)
  .get('/expenses/categories', requirePermission('expenses.view'), c.categories)
  .post('/expenses', requirePermission('expenses.manage'), c.create)
  .put('/expenses/:id', requirePermission('expenses.manage'), c.update)
  .delete('/expenses/:id', requirePermission('expenses.manage'), c.remove)
