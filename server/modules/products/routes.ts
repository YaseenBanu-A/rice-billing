import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.ts'
import * as c from './controller.ts'

export const productRoutes = Router()
  .get('/products', requirePermission('products.view'), c.list)
  .get('/products/:id', requirePermission('products.view'), c.get)
  .post('/products', requirePermission('products.manage'), c.create)
  .put('/products/:id', requirePermission('products.manage'), c.update)
  .delete('/products/:id', requirePermission('products.manage'), c.remove)
  .get('/categories', requirePermission('products.view'), c.listCategories)
  .post('/categories', requirePermission('products.manage'), c.createCategory)
  .put('/categories/:id', requirePermission('products.manage'), c.updateCategory)
  .delete('/categories/:id', requirePermission('products.manage'), c.deleteCategory)
