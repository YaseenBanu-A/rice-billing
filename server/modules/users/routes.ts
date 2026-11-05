import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const userRoutes = Router()
  .get('/users', requirePermission('users.manage'), c.list)
  .post('/users', requirePermission('users.manage'), c.create)
  .put('/users/:id', requirePermission('users.manage'), c.update)
  .get('/audit-log', requirePermission('audit.view'), c.auditLog)
