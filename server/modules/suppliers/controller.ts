import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  res.json(await s.listSuppliers(qs(req, 'q')))
}

export async function create(req: Request, res: Response) {
  const r = await s.createSupplier(req.body, actorOf(req))
  broadcast({ entity: 'supplier', action: 'create', id: r.id, label: r.name }, actorOf(req))
  res.status(201).json(r)
}

export async function update(req: Request, res: Response) {
  const r = await s.updateSupplier(param(req, 'id'), req.body, actorOf(req))
  broadcast({ entity: 'supplier', action: 'update', id: r.id, label: r.name }, actorOf(req))
  res.json(r)
}

export async function remove(req: Request, res: Response) {
  await s.deleteSupplier(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'supplier', action: 'delete', id: param(req, 'id') }, actorOf(req))
  res.status(204).end()
}
