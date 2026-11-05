import type { Request, Response } from 'express'
import type { PaymentStatus } from '../../../shared/types.ts'
import { actorOf } from '../../lib/audit.ts'
import { badRequest } from '../../lib/errors.ts'
import { dateRange, paging, param, qs } from '../../lib/http.ts'
import { broadcast } from '../../realtime.ts'
import { voidPayment } from './payments.ts'
import * as s from './service.ts'
import { validateBillInput, validateCancel, validatePayment, validateReturn } from './validators.ts'

const STATUSES: PaymentStatus[] = ['Paid', 'Partial', 'Unpaid', 'Cancelled']

export async function list(req: Request, res: Response) {
  const status = qs(req, 'status') as PaymentStatus | undefined
  if (status && !STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`)
  res.json(await s.listBills({ q: qs(req, 'q'), status, customerId: qs(req, 'customerId'), ...dateRange(req), ...paging(req) }))
}

export async function get(req: Request, res: Response) {
  res.json(await s.getBill(param(req, 'id')))
}

export async function itemNames(_req: Request, res: Response) {
  res.json(await s.recentItemNames())
}

export async function next(_req: Request, res: Response) {
  res.json({ invoiceNo: await s.nextInvoiceNo() })
}

const touchesStock = (b: { items: { productId: string }[] }) => b.items.some((i) => i.productId)

export async function create(req: Request, res: Response) {
  const actor = actorOf(req)
  const { bill, created } = await s.createBill(validateBillInput(req.body), actor)
  if (created) {
    broadcast({ entity: 'invoice', action: 'create', id: bill.id, label: bill.invoiceNo }, actor)
    if (touchesStock(bill)) broadcast({ entity: 'stock', action: 'sale', id: bill.id }, actor)
  }
  res.status(created ? 201 : 200).json(bill)
}

export async function update(req: Request, res: Response) {
  const actor = actorOf(req)
  const bill = await s.updateBill(param(req, 'id'), validateBillInput(req.body), actor)
  broadcast({ entity: 'invoice', action: 'update', id: bill.id, label: bill.invoiceNo }, actor)
  if (touchesStock(bill)) broadcast({ entity: 'stock', action: 'sale-edit', id: bill.id }, actor)
  res.json(bill)
}

export async function pay(req: Request, res: Response) {
  const actor = actorOf(req)
  const { bill, created } = await s.addPayment(param(req, 'id'), validatePayment(req.body), actor)
  if (created) broadcast({ entity: 'payment', action: 'create', id: bill.id, label: bill.invoiceNo }, actor)
  res.status(created ? 201 : 200).json(bill)
}

export async function cancel(req: Request, res: Response) {
  const actor = actorOf(req)
  const bill = await s.cancelBill(param(req, 'id'), validateCancel(req.body), actor)
  broadcast({ entity: 'invoice', action: 'cancel', id: bill.id, label: bill.invoiceNo }, actor)
  broadcast({ entity: 'stock', action: 'sale-cancel', id: bill.id }, actor)
  res.json(bill)
}

export async function createReturn(req: Request, res: Response) {
  const actor = actorOf(req)
  const bill = await s.createReturn(param(req, 'id'), validateReturn(req.body), actor)
  broadcast({ entity: 'invoice', action: 'return', id: bill.id, label: bill.invoiceNo }, actor)
  broadcast({ entity: 'stock', action: 'return', id: bill.id }, actor)
  res.status(201).json(bill)
}

export async function remove(req: Request, res: Response) {
  const actor = actorOf(req)
  const { invoiceNo } = await s.deleteBill(param(req, 'id'), actor)
  broadcast({ entity: 'invoice', action: 'delete', id: param(req, 'id'), label: invoiceNo }, actor)
  broadcast({ entity: 'stock', action: 'sale-delete' }, actor)
  res.status(204).end()
}

export async function removePayment(req: Request, res: Response) {
  const actor = actorOf(req)
  const r = await voidPayment(param(req, 'id'), actor)
  if (r.invoiceId) broadcast({ entity: 'payment', action: 'void', id: r.invoiceId }, actor)
  if (r.purchaseId) broadcast({ entity: 'purchase', action: 'payment-void', id: r.purchaseId }, actor)
  res.json(r.invoiceId ? await s.getBill(r.invoiceId) : { ok: true })
}
