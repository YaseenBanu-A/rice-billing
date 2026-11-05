import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { dateRange, paging, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import * as s from './service.ts'

export async function movements(req: Request, res: Response) {
  res.json(await s.listMovements({ productId: qs(req, 'productId'), type: qs(req, 'type'), ...dateRange(req), ...paging(req, 100) }))
}

export async function adjust(req: Request, res: Response) {
  const r = await s.adjustStock(req.body, actorOf(req))
  broadcast({ entity: 'stock', action: 'adjust', id: r.productId, label: r.name }, actorOf(req))
  res.status(201).json(r)
}

export async function summary(_req: Request, res: Response) {
  res.json(await s.stockSummary())
}
