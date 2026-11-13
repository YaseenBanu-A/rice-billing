import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { attributedActor } from '../auth/attribution.ts'
import { param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  res.json(
    await s.listProducts({
      q: qs(req, 'q'),
      categoryId: qs(req, 'categoryId'),
      includeInactive: qs(req, 'all') === '1',
      lowStock: qs(req, 'lowStock') === '1',
    }),
  )
}

export async function get(req: Request, res: Response) {
  res.json(await s.getProduct(param(req, 'id')))
}

export async function create(req: Request, res: Response) {
  const actor = await attributedActor(req, req.body?.offlineAttribution, 'products.manage')
  const { product: p, created } = await s.createProduct(req.body, actor)
  if (created) broadcast({ entity: 'product', action: 'create', id: p.id, label: p.name }, actor)
  res.status(created ? 201 : 200).json(p)
}

export async function update(req: Request, res: Response) {
  const actor = await attributedActor(req, req.body?.offlineAttribution, 'products.manage')
  const p = await s.updateProduct(param(req, 'id'), req.body, actor)
  broadcast({ entity: 'product', action: 'update', id: p.id, label: p.name }, actor)
  res.json(p)
}

export async function remove(req: Request, res: Response) {
  const r = await s.deleteProduct(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'product', action: r.archived ? 'archive' : 'delete', id: param(req, 'id') }, actorOf(req))
  res.json(r)
}

export async function listCategories(_req: Request, res: Response) {
  res.json(await s.listCategories())
}

export async function createCategory(req: Request, res: Response) {
  const c = await s.createCategory(req.body, actorOf(req))
  broadcast({ entity: 'category', action: 'create', id: c.id }, actorOf(req))
  res.status(201).json(c)
}

export async function updateCategory(req: Request, res: Response) {
  const c = await s.updateCategory(param(req, 'id'), req.body, actorOf(req))
  broadcast({ entity: 'category', action: 'update', id: c.id }, actorOf(req))
  res.json(c)
}

export async function deleteCategory(req: Request, res: Response) {
  await s.deleteCategory(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'category', action: 'delete', id: param(req, 'id') }, actorOf(req))
  res.status(204).end()
}
