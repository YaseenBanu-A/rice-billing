import { BILL_METHODS, PAY_METHODS } from '../../../shared/billing.ts'
import type { BillInput, BillItemInput, DiscountType, PaymentInput, PaymentMethod, PayMethod, ReturnInput } from '../../../shared/types.ts'
import { badRequest } from '../../lib/errors.ts'
import { asObject, fail, gstinError, isoDate, notFuture, number, phoneError, requestKey, text } from '../../lib/validate.ts'

export function validateBillInput(raw: unknown): BillInput {
  const b = asObject(raw)
  const cust = asObject(b.customer ?? {}, 'customer')

  if (!Array.isArray(b.items) || b.items.length === 0) throw badRequest('Add at least one item to the bill', { items: 'Bill has no items' })
  if (b.items.length > 500) throw badRequest('A bill can have at most 500 items')

  const items: BillItemInput[] = b.items.map((rawItem, i) => {
    const it = asObject(rawItem, `items[${i}]`)
    const item = {
      productId: text(it.productId, 64),
      name: text(it.name, 160),
      sku: text(it.sku, 40),
      hsnCode: text(it.hsnCode, 10) || undefined,
      price: number(it.price),
      quantity: number(it.quantity),
      unit: text(it.unit, 20) || undefined,
      bags: it.bags === undefined || it.bags === null || it.bags === '' ? undefined : number(it.bags),
      gstRate: number(it.gstRate),
    }
    const label = item.name || `Item ${i + 1}`
    fail({
      [`items.${i}.name`]: !item.name ? `Item ${i + 1} needs a name` : '',
      [`items.${i}.price`]: Number.isNaN(item.price) || item.price < 0 ? `${label}: price cannot be empty or negative` : '',
      [`items.${i}.quantity`]: Number.isNaN(item.quantity) || item.quantity <= 0 ? `${label}: quantity must be greater than zero` : '',
      [`items.${i}.bags`]: item.bags !== undefined && (Number.isNaN(item.bags) || item.bags < 0) ? `${label}: bags must be zero or more` : '',
      [`items.${i}.gstRate`]: Number.isNaN(item.gstRate) ? `${label}: invalid GST rate` : '',
    })
    return item
  })

  const date = isoDate(b.date)
  const input: BillInput = {
    date: date.toISOString(),
    customer: {
      id: text(cust.id, 64) || undefined,
      name: text(cust.name, 120) || 'Walk-in Customer',
      phone: text(cust.phone, 40),
      address: text(cust.address, 500) || undefined,
      gstin: text(cust.gstin, 15).toUpperCase() || undefined,
    },
    saveCustomer: b.saveCustomer === true,
    items,
    discountType: (b.discountType === 'amount' ? 'amount' : 'percent') as DiscountType,
    discountValue: number(b.discountValue ?? 0),
    gstInclusive: b.gstInclusive === true,
    paymentMethod: b.paymentMethod as PaymentMethod,
    amountPaid: number(b.amountPaid ?? 0),
    notes: text(b.notes, 1000) || undefined,
    clientRequestId: requestKey(b.clientRequestId),
    version: b.version === undefined ? undefined : number(b.version),
  }

  fail({
    paymentMethod: !BILL_METHODS.includes(input.paymentMethod as never) ? `Payment method must be one of ${BILL_METHODS.join(', ')}` : '',
    discountValue:
      Number.isNaN(input.discountValue) || input.discountValue < 0
        ? 'Discount cannot be negative'
        : input.discountType === 'percent' && input.discountValue > 100
          ? 'Discount cannot exceed 100%'
          : '',
    amountPaid: Number.isNaN(input.amountPaid) || input.amountPaid < 0 ? 'Amount paid must be zero or more' : '',
    'customer.phone': input.customer.phone ? phoneError(input.customer.phone, false) && 'Customer phone number looks invalid' : '',
    'customer.gstin': gstinError(input.customer.gstin ?? ''),
  })
  notFuture(date)
  return input
}

export function validatePayment(raw: unknown): PaymentInput {
  const b = asObject(raw)
  const p: PaymentInput = {
    amount: number(b.amount),
    method: b.method as PayMethod,
    date: isoDate(b.date).toISOString(),
    reference: text(b.reference, 100) || undefined,
    note: text(b.note, 300) || undefined,
    clientRequestId: requestKey(b.clientRequestId),
  }
  fail({
    amount: Number.isNaN(p.amount) || p.amount <= 0 ? 'Enter an amount greater than zero' : '',
    method: !PAY_METHODS.includes(p.method as never) ? `Payment method must be one of ${PAY_METHODS.join(', ')}` : '',
  })
  notFuture(new Date(p.date!))
  return { ...p, amount: Math.round(p.amount * 100) / 100 }
}

export function validateReturn(raw: unknown): ReturnInput {
  const b = asObject(raw)
  if (!Array.isArray(b.items) || !b.items.length) throw badRequest('Choose at least one item to return', { items: 'Nothing to return' })
  const items = b.items
    .map((x, i) => {
      const o = asObject(x, `items[${i}]`)
      return { invoiceItemId: text(o.invoiceItemId, 64), quantity: number(o.quantity) }
    })
    .filter((x) => x.quantity !== 0)
  if (!items.length) throw badRequest('Enter the quantity to return', { items: 'Nothing to return' })
  items.forEach((x, i) => fail({ [`items.${i}.quantity`]: Number.isNaN(x.quantity) || x.quantity < 0 ? 'Return quantity must be more than zero' : '' }))
  const refundMethod = b.refundMethod ? (b.refundMethod as PayMethod) : undefined
  fail({ refundMethod: refundMethod && !PAY_METHODS.includes(refundMethod as never) ? 'Invalid refund method' : '' })
  return { items, reason: text(b.reason, 300) || undefined, refundMethod, date: isoDate(b.date).toISOString() }
}

export function validateCancel(raw: unknown): { reason: string; refundMethod?: PayMethod } {
  const b = asObject(raw ?? {})
  const reason = text(b.reason, 300)
  const refundMethod = b.refundMethod ? (b.refundMethod as PayMethod) : undefined
  fail({
    reason: !reason ? 'Give a reason for cancelling' : '',
    refundMethod: refundMethod && !PAY_METHODS.includes(refundMethod as never) ? 'Invalid refund method' : '',
  })
  return { reason, refundMethod }
}
