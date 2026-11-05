import type { Request, Response } from 'express'
import { actorOf } from '../../lib/audit.ts'
import { dateRange, paging, param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import { validateCancel, validatePayment } from '../invoices/validators.ts'
import * as s from './service.ts'

export async function list(req: Request, res: Response) {
  res.json(await s.listPurchases({ q: qs(req, 'q'), supplierId: qs(req, 'supplierId'), status: qs(req, 'status'), ...dateRange(req), ...paging(req) }))
}

export async function get(req: Request, res: Response) {
  res.json(await s.getPurchase(param(req, 'id')))
}

export async function next(_req: Request, res: Response) {
  res.json({ purchaseNo: await s.nextPurchaseNo() })
}

export async function create(req: Request, res: Response) {
  const { purchase, created } = await s.createPurchase(s.validatePurchase(req.body), actorOf(req))
  if (created) {
    broadcast({ entity: 'purchase', action: 'create', id: purchase.id, label: purchase.purchaseNo }, actorOf(req))
    broadcast({ entity: 'stock', action: 'purchase', id: purchase.id }, actorOf(req))
  }
  res.status(created ? 201 : 200).json(purchase)
}

export async function pay(req: Request, res: Response) {
  const p = await s.addPurchasePayment(param(req, 'id'), validatePayment(req.body), actorOf(req))
  broadcast({ entity: 'purchase', action: 'payment', id: p.id, label: p.purchaseNo }, actorOf(req))
  res.json(p)
}

export async function cancel(req: Request, res: Response) {
  const { reason } = validateCancel(req.body)
  const p = await s.cancelPurchase(param(req, 'id'), reason, actorOf(req))
  broadcast({ entity: 'purchase', action: 'cancel', id: p.id, label: p.purchaseNo }, actorOf(req))
  broadcast({ entity: 'stock', action: 'purchase-cancel', id: p.id }, actorOf(req))
  res.json(p)
}
