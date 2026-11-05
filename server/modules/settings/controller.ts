import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { param } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function get(_req: Request, res: Response) {
  res.json(await s.getSettings())
}

export async function save(req: Request, res: Response) {
  const settings = await s.saveSettings(s.validateSettings(req.body), actorOf(req))
  broadcast({ entity: 'settings', action: 'update' }, actorOf(req))
  res.json(settings)
}

export async function listRates(_req: Request, res: Response) {
  res.json(await s.listTaxRates())
}

export async function createRate(req: Request, res: Response) {
  const r = await s.createTaxRate(req.body, actorOf(req))
  broadcast({ entity: 'settings', action: 'taxrate' }, actorOf(req))
  res.status(201).json(r)
}

export async function updateRate(req: Request, res: Response) {
  const r = await s.updateTaxRate(param(req, 'id'), req.body, actorOf(req))
  broadcast({ entity: 'settings', action: 'taxrate' }, actorOf(req))
  res.json(r)
}

export async function deleteRate(req: Request, res: Response) {
  await s.deleteTaxRate(param(req, 'id'), actorOf(req))
  broadcast({ entity: 'settings', action: 'taxrate' }, actorOf(req))
  res.status(204).end()
}
