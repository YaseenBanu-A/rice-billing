import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  res.json(await s.listCustomers(qs(req, 'q'), qs(req, 'stats') === '1'))
}

export async function get(req: Request, res: Response) {
  res.json(await s.getCustomer(param(req, 'id')))
}

export async function create(req: Request, res: Response) {
  const c = await s.createCustomer(req.body, actorOf(req))
  broadcast({ entity: 'customer', action: 'create', id: c.id, label: c.name }, actorOf(req))
  res.status(201).json(c)
}

export async function update(req: Request, res: Response) {
  const c = await s.updateCustomer(param(req, 'id'), req.body, actorOf(req))
  broadcast({ entity: 'customer', action: 'update', id: c.id, label: c.name }, actorOf(req))
  res.json(c)
}

export async function remove(req: Request, res: Response) {
  await s.deleteCustomer(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'customer', action: 'delete', id: param(req, 'id') }, actorOf(req))
  res.status(204).end()
}
