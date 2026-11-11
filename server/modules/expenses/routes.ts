import express, { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from './service.ts'

// receipts arrive as the raw file (not JSON); a little headroom so the service can give a clear "too large" message
const rawFile = express.raw({ type: [...ATTACHMENT_TYPES], limit: MAX_ATTACHMENT_BYTES + 64 * 1024 })

export const expenseRoutes = Router()
  // fixed paths first, so they are not taken for an expense id
  .get('/expenses', requirePermission('expenses.view'), c.list)
  .get('/expenses/summary', requirePermission('expenses.view'), c.summary)
  .get('/expenses/categories', requirePermission('expenses.view'), c.categoryNames)
  .get('/expenses/:id', requirePermission('expenses.view'), c.get)
  .post('/expenses', requirePermission('expenses.manage'), c.create)
  .put('/expenses/:id', requirePermission('expenses.manage'), c.update)
  .delete('/expenses/:id', requirePermission('expenses.manage'), c.remove)
  .get('/expenses/:id/attachment', requirePermission('expenses.view'), c.download)
  .put('/expenses/:id/attachment', requirePermission('expenses.manage'), rawFile, c.attach)
  .delete('/expenses/:id/attachment', requirePermission('expenses.manage'), c.detach)
  .get('/expense-categories', requirePermission('expenses.view'), c.categories)
  .post('/expense-categories', requirePermission('expenses.manage'), c.createCategory)
  .put('/expense-categories/:id', requirePermission('expenses.manage'), c.updateCategory)
  .delete('/expense-categories/:id', requirePermission('expenses.manage'), c.removeCategory)
