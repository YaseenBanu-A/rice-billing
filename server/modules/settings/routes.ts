import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const settingsRoutes = Router()
  .get('/settings', c.get)
  .put('/settings', requirePermission('settings.manage'), c.save)
  .get('/tax-rates', c.listRates)
  .post('/tax-rates', requirePermission('settings.manage'), c.createRate)
  .put('/tax-rates/:id', requirePermission('settings.manage'), c.updateRate)
  .delete('/tax-rates/:id', requirePermission('settings.manage'), c.deleteRate)
