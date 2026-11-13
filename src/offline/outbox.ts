import type { ProductInput } from '../lib/api'
import type { Bill, BillInput, Customer, PaymentInput, Product } from '../types'
import { db, type OpKind, type OutboxOp } from './db'
import { editedBill, LOCAL_VERSION, newLocalBill, paidBill } from './localBill'

/*
 * Queues changes made while offline (or when the server couldn't be reached), and keeps the local copy of
 * each changed record in step. Every function runs in one IndexedDB transaction: the change and the record
 * the screens show are always saved together.
 */

export interface Who {
  userId: string
  userName: string
  /** server-signed proof that this user is signed in (see db.ts OpBase.attribution) */
  attribution?: string
}

const BILL_TABLES = [db.outbox, db.localBills, db.localCustomers]
const PRODUCT_TABLES = [db.outbox, db.localProducts]

const opsFor = (entityId: string) => db.outbox.where('entityId').equals(entityId).sortBy('seq')

function newOp<K extends OpKind>(kind: K, entityId: string, label: string, payload: Extract<OutboxOp, { kind: K }>['payload'], who: Who) {
  return { kind, entityId, label, payload, status: 'pending', rev: 1, attempts: 0, createdAt: new Date().toISOString(), ...who } as Extract<OutboxOp, { kind: K }>
}

/** Waiting again after the user changed it: a refused change gets another try, a conflict still needs a decision */
const touched = <T extends OutboxOp>(op: T): T => ({
  ...op,
  rev: op.rev + 1,
  status: op.status === 'conflict' ? 'conflict' : 'pending',
  error: op.status === 'conflict' ? op.error : undefined,
  attempts: 0,
  nextAttemptAt: undefined,
})

/* ---------- local copies ---------- */

/** Recomputes how a bill looks from the server's copy plus its queued changes (or drops it when none are left) */
export async function rebuildBill(id: string) {
  const ops = (await opsFor(id)).filter((o) => o.kind.startsWith('bill.'))
  let bill: Bill | undefined
  for (const op of ops) {
    if (op.kind === 'bill.create') {
      bill = newLocalBill(op.payload.input, op.userName)
      continue
    }
    // an edit or payment starts from the previous change, or from the server's copy saved with the first one
    const start = bill ?? (op.kind === 'bill.update' || op.kind === 'bill.payment' ? op.payload.base : undefined)
    if (!start) continue
    if (op.kind === 'bill.update') bill = editedBill(start, op.payload.input, op.userName)
    else if (op.kind === 'bill.payment') bill = paidBill(start, op.payload.input, op.userName)
  }
  if (bill) await db.localBills.put(bill)
  else await db.localBills.delete(id)
}

export function productView(base: Product | undefined, input: ProductInput & { id: string }): Product {
  return {
    id: input.id,
    name: input.name,
    sku: input.sku || base?.sku || '',
    price: input.price,
    gstRate: input.gstRate,
    categoryId: input.categoryId || undefined,
    categoryName: base && base.categoryId === input.categoryId ? base.categoryName : undefined,
    variety: input.variety || undefined,
    brand: input.brand || undefined,
    hsnCode: input.hsnCode,
    unit: input.unit,
    bagWeight: input.bagWeight,
    purchasePrice: input.purchasePrice,
    // stock changes only through sales, purchases and adjustments, never from the product form
    stock: base?.stock ?? input.openingStock ?? 0,
    reorderLevel: input.reorderLevel,
    active: input.active,
  }
}

export async function rebuildProduct(id: string) {
  const ops = (await opsFor(id)).filter((o) => o.kind.startsWith('product.'))
  let product: Product | undefined
  for (const op of ops) {
    if (op.kind === 'product.create') product = productView(undefined, op.payload.input)
    else if (op.kind === 'product.update') product = productView(product ?? op.payload.base, { ...op.payload.input, id })
  }
  if (product) await db.localProducts.put(product)
  else await db.localProducts.delete(id)
}

/** Customers added offline are kept only while a waiting bill still refers to them */
export async function pruneLocalCustomers() {
  const used = new Set<string>()
  for (const op of await db.outbox.toArray())
    if ((op.kind === 'bill.create' || op.kind === 'bill.update') && op.payload.input.customer.id) used.add(op.payload.input.customer.id)
  const stale = (await db.localCustomers.toArray()).filter((c) => !used.has(c.id)).map((c) => c.id)
  if (stale.length) await db.localCustomers.bulkDelete(stale)
}

/* ---------- bills ---------- */

/** A new bill. `newCustomer`: a customer typed on this bill, saved locally until the server has it. */
export async function queueBillCreate(input: BillInput & { id: string }, label: string, who: Who, newCustomer?: Customer) {
  await db.transaction('rw', BILL_TABLES, async () => {
    if (newCustomer) await db.localCustomers.put(newCustomer)
    await db.outbox.add(newOp('bill.create', input.id, label, { input }, who))
    await rebuildBill(input.id)
  })
  return (await db.localBills.get(input.id))!
}

/**
 * An edit. While the bill's latest queued change is still waiting, the edit is folded into it (one bill or one
 * edit reaches the server, not a trail of drafts). `current`: the bill as the screens show it now.
 */
export async function queueBillUpdate(id: string, input: BillInput, current: Bill, label: string, who: Who, newCustomer?: Customer) {
  await db.transaction('rw', BILL_TABLES, async () => {
    if (newCustomer) await db.localCustomers.put(newCustomer)
    const ops = (await opsFor(id)).filter((o) => o.kind.startsWith('bill.'))
    const last = ops.at(-1)
    if (last?.kind === 'bill.create') {
      // still a new bill: keep its id and idempotency key, take the new contents
      await db.outbox.put(touched({ ...last, label, payload: { input: { ...input, id, clientRequestId: last.payload.input.clientRequestId, version: undefined } } }))
    } else if (last?.kind === 'bill.update') {
      await db.outbox.put(touched({ ...last, label, payload: { ...last.payload, input: { ...input, version: undefined } } }))
    } else {
      const first = !ops.length
      // first change to a synced bill: remember the server's copy and the version the edit started from
      const baseVersion = first && current.version !== LOCAL_VERSION ? current.version : null
      await db.outbox.add(newOp('bill.update', id, label, { input: { ...input, version: undefined }, base: first ? current : undefined, baseVersion }, who))
    }
    await rebuildBill(id)
    await pruneLocalCustomers()
  })
  return (await db.localBills.get(id))!
}

/** Money received against a bill */
export async function queuePayment(id: string, input: PaymentInput & { clientRequestId: string }, current: Bill, label: string, who: Who) {
  await db.transaction('rw', BILL_TABLES, async () => {
    const first = !(await opsFor(id)).length
    await db.outbox.add(newOp('bill.payment', id, label, { input, base: first ? current : undefined }, who))
    await rebuildBill(id)
  })
  return (await db.localBills.get(id))!
}

/* ---------- products ---------- */

export async function queueProductCreate(input: ProductInput & { id: string }, label: string, who: Who) {
  await db.transaction('rw', PRODUCT_TABLES, async () => {
    await db.outbox.add(newOp('product.create', input.id, label, { input }, who))
    await rebuildProduct(input.id)
  })
  return (await db.localProducts.get(input.id))!
}

/** `current`: the product as the screens show it now (the server's copy, or the local one) */
export async function queueProductUpdate(id: string, input: ProductInput, current: Product, label: string, who: Who) {
  await db.transaction('rw', PRODUCT_TABLES, async () => {
    const last = (await opsFor(id)).filter((o) => o.kind.startsWith('product.')).at(-1)
    if (last?.kind === 'product.create') await db.outbox.put(touched({ ...last, label, payload: { input: { ...input, id, openingStock: last.payload.input.openingStock } } }))
    else if (last?.kind === 'product.update') await db.outbox.put(touched({ ...last, label, payload: { ...last.payload, input } }))
    else await db.outbox.add(newOp('product.update', id, label, { input, base: current }, who))
    await rebuildProduct(id)
  })
  return (await db.localProducts.get(id))!
}

/* ---------- resolving refused changes (sync panel) ---------- */

const ALL_TABLES = [db.outbox, db.localBills, db.localCustomers, db.localProducts]

async function rebuild(entityId: string, kind: OpKind) {
  if (kind.startsWith('bill.')) await rebuildBill(entityId)
  else await rebuildProduct(entityId)
  await pruneLocalCustomers()
}

/**
 * Drops one waiting change. Dropping a new bill or product drops everything queued for it; dropping an edit or
 * payment hands its starting point (the server's copy) to the next change for the same record.
 */
export async function discardOp(seq: number) {
  await db.transaction('rw', ALL_TABLES, async () => {
    const op = await db.outbox.get(seq)
    if (!op) return
    const ops = await opsFor(op.entityId)
    if (op.kind === 'bill.create' || op.kind === 'product.create') {
      await db.outbox.bulkDelete(ops.map((o) => o.seq!))
    } else {
      const next = ops.find((o) => o.seq! > seq)
      if (next && 'base' in op.payload && op.payload.base && (next.kind === 'bill.update' || next.kind === 'bill.payment') && !next.payload.base) {
        const base = op.payload.base as Bill
        if (next.kind === 'bill.update')
          await db.outbox.put({ ...next, payload: { ...next.payload, base, baseVersion: next.payload.baseVersion ?? (op.kind === 'bill.update' ? op.payload.baseVersion : base.version) } })
        else await db.outbox.put({ ...next, payload: { ...next.payload, base } })
      }
      await db.outbox.delete(seq)
    }
    await rebuild(op.entityId, op.kind)
  })
}

/**
 * Tries a refused change again. `keepMine` (conflicts only): send it even though the record was changed
 * elsewhere meanwhile; the user has seen the conflict and chosen their version.
 */
export async function retryOp(seq: number, mode: 'retry' | 'keepMine' | 'asMe' = 'retry') {
  const op = await db.outbox.get(seq)
  if (!op) return
  const reset = { status: 'pending' as const, attempts: 0, nextAttemptAt: undefined, error: undefined, errorCode: undefined }
  if (mode === 'keepMine' && op.kind === 'bill.update') await db.outbox.put({ ...op, ...reset, payload: { ...op.payload, rebase: true } })
  else if (mode === 'keepMine' && op.kind === 'product.update') await db.outbox.put({ ...op, ...reset, payload: { ...op.payload, force: true } })
  // an administrator's explicit decision: the change is sent (and recorded) under the administrator's own name
  else if (mode === 'asMe') await db.outbox.put({ ...op, ...reset, sendAsSelf: true })
  else await db.outbox.put({ ...op, ...reset })
}
