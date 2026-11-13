import { useSyncExternalStore } from 'react'
import { api, ApiError, type ProductInput } from '../lib/api'
import { computeTotals } from '../../shared/billing.ts'
import type { Bill, BillInput, Product } from '../types'
import { isOnline } from './connection'
import { db, type OutboxOp } from './db'
import { isPendingInvoiceNo } from './localBill'
import { pruneLocalCustomers, rebuildBill, rebuildProduct } from './outbox'

/*
 * Sends waiting changes to the server, oldest first.
 *
 *  - Safe to repeat: new bills and products carry their own id plus an idempotency key, payments carry an
 *    idempotency key, edits carry the version they started from. A change sent twice (the answer was lost, two
 *    tabs, a retry) is saved once.
 *  - Nothing is overwritten silently: an edit to a bill someone else changed meanwhile is refused by the server
 *    (version check) and a product edit is merged field by field; either way a real clash is marked "conflict"
 *    and waits for the user to choose.
 *  - Order is kept per record: while one change to a bill is refused, later changes to that bill wait.
 *  - No connection: stop, and try again later with growing gaps (or as soon as the connection is back).
 */

export interface SyncHandlers {
  /** the signed-in user: their own changes are sent as theirs; other people's need proof of who made them */
  userId: () => string | undefined
  /** the server's copy after a change was saved, so the screens can show it at once */
  onBill: (b: Bill) => void
  onProduct: (p: Product) => void
  /** a run finished: `synced` changes were saved, `refused` ones need the user's attention */
  onFinished: (synced: number, refused: OutboxOp[]) => void
}

let handlers: SyncHandlers | null = null
export const setSyncHandlers = (h: SyncHandlers | null) => void (handlers = h)

let running = false
let runAgain = false
const runningListeners = new Set<() => void>()
function setRunning(v: boolean) {
  running = v
  runningListeners.forEach((l) => l())
}
/** True while changes are being sent */
export const useSyncRunning = () =>
  useSyncExternalStore(
    (l) => (runningListeners.add(l), () => void runningListeners.delete(l)),
    () => running,
  )
let timer: ReturnType<typeof setTimeout> | undefined
/** no automatic run before this time (ms) after a network failure */
let retryAt = 0
let failures = 0

/** Starts a sync shortly (several changes in a row are sent in one run). */
export function requestSync(delay = 400) {
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(false), Math.max(delay, retryAt - Date.now()))
}

/** Sends everything waiting now. `manual`: the user asked, so don't wait out the retry gap. */
export async function syncNow(manual = true): Promise<void> {
  if (manual) retryAt = 0
  if (!isOnline() || Date.now() < retryAt) return
  if (running) {
    runAgain = true
    return
  }
  setRunning(true)
  let result: RunResult = { synced: 0, refused: [] }
  try {
    result = (await withLock(drain)) ?? result
  } catch {
    // unexpected (e.g. storage error): try again later
    scheduleRetry()
  } finally {
    setRunning(false)
  }
  handlers?.onFinished(result.synced, result.refused)
  if (runAgain) {
    runAgain = false
    requestSync(0)
  }
}

/** One tab at a time (several open tabs share the same outbox). */
async function withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!navigator.locks) return fn()
  return navigator.locks.request('ajrice-sync', { ifAvailable: true }, (lock) => (lock ? fn() : undefined))
}

function scheduleRetry() {
  failures++
  const gap = Math.min(5000 * 2 ** (failures - 1), 5 * 60_000)
  retryAt = Date.now() + gap
  requestSync(gap)
}

type Outcome = 'saved' | 'requeued' | 'refused' | 'stop'
interface RunResult {
  synced: number
  refused: OutboxOp[]
}

const UNVERIFIED = (op: OutboxOp) =>
  `Made offline by ${op.userName}, who is not signed in now. It will sync when ${op.userName} signs in on this device, or an administrator can send it under their own name.`

async function drain(): Promise<RunResult> {
  const me = handlers?.userId()
  let synced = 0
  const refused: OutboxOp[] = []
  // changes held because their maker couldn't be verified: that person is signed in now, so send them as theirs
  if (me)
    await db.outbox
      .where('status')
      .equals('review')
      .modify((o) => {
        if (o.userId === me) Object.assign(o, { status: 'pending', error: undefined, errorCode: undefined })
      })
  for (;;) {
    // first waiting change whose record has no refused change ahead of it
    const blocked = new Set<string>()
    let next: OutboxOp | undefined
    for (const op of await db.outbox.orderBy('seq').toArray()) {
      if (blocked.has(op.entityId)) continue
      if (op.status !== 'pending') {
        blocked.add(op.entityId)
        continue
      }
      // made by someone else, with no proof of who: never sent under the signed-in user's name by default
      if (op.userId !== me && !op.attribution && !op.sendAsSelf) {
        await db.outbox.update(op.seq!, { status: 'review', error: UNVERIFIED(op), errorCode: 'creator_unverified' })
        refused.push({ ...op, status: 'review', error: UNVERIFIED(op) })
        blocked.add(op.entityId)
        continue
      }
      next = op
      break
    }
    if (!next) break
    const outcome = await send(next, me)
    if (outcome === 'stop') break
    if (outcome === 'saved') {
      synced++
      failures = 0
    }
    if (outcome === 'refused') {
      const now = await db.outbox.get(next.seq!)
      if (now) refused.push(now)
    }
  }
  return { synced, refused }
}

async function send(op: OutboxOp, me: string | undefined): Promise<Outcome> {
  try {
    const result = await deliver(op, me)
    if (result === 'conflict') return 'refused'
    await complete(op, result)
    return 'saved'
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : 'Sync failed')
    // a two-device race on the same new record (e.g. both added the same customer): a retry links to the winner
    const race = err.status === 409 && err.code === 'P2002' && op.attempts < 3
    if (err.status === 0 || err.status === 429 || err.status >= 500 || race) {
      // not the change's fault: keep it waiting and try again later (same id and idempotency key)
      const isCreate = op.kind === 'bill.create' || op.kind === 'product.create'
      // no answer: the server may have saved it anyway (e.g. it timed out while the server was starting up)
      const maybeSaved = err.status === 0 && isCreate && op.maybeSentRev === undefined
      await db.outbox.update(op.seq!, { attempts: op.attempts + 1, error: err.message, ...(maybeSaved ? { maybeSentRev: op.rev } : {}) })
      scheduleRetry()
      return 'stop'
    }
    if (err.status === 401) return 'stop' // signed out: the sign-in screen is showing; sync resumes after sign-in
    try {
      const recovered = await recover(op, err)
      if (recovered) return recovered
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.status === 0 || e2.status >= 500)) {
        scheduleRetry()
        return 'stop'
      }
    }
    const status = err.code === 'version_conflict' ? 'conflict' : err.code === 'creator_unverified' ? 'review' : 'failed'
    await db.outbox.update(op.seq!, {
      status,
      attempts: op.attempts + 1,
      errorCode: err.code,
      error: status === 'conflict' ? 'This bill was changed on another device after you edited it offline.' : err.message,
    })
    return 'refused'
  }
}

/** Version of a bill just created (created at 1, then settled once) */
const FRESH_BILL_VERSION = 2

/**
 * Refusals that are not real problems, because an earlier send whose answer was lost (timeout, dropped
 * connection) did reach the server:
 *  - a new bill "already saved with different contents": saved in its earlier form, then edited on this device
 *  - an edit refused as outdated: the server already has exactly this edit
 */
async function recover(op: OutboxOp, err: ApiError): Promise<Outcome | null> {
  if (op.kind === 'bill.create' && err.code === 'idempotency_mismatch' && op.maybeSentRev !== undefined) {
    const saved = await api.bill(op.entityId)
    if (op.maybeSentRev === op.rev) {
      // this exact bill was saved, then changed on another device: that newer version stands
      await complete(op, saved)
      return 'saved'
    }
    const untouched = saved.version === FRESH_BILL_VERSION
    await db.transaction('rw', [db.outbox, db.localBills, db.localCustomers], async () => {
      const now = await db.outbox.get(op.seq!)
      if (!now) return
      const edit = followUp(now, saved)
      // untouched since it was created: send this device's edit on top; otherwise let the user choose
      await db.outbox.put(
        untouched ? edit : { ...edit, status: 'conflict', error: 'This bill reached the server before your later offline edit, and was changed on another device since.' },
      )
      await rebuildBill(op.entityId)
    })
    return untouched ? 'requeued' : 'refused'
  }
  if (op.kind === 'bill.update' && err.code === 'version_conflict') {
    const current = await api.bill(op.entityId)
    if (billMatches(current, op.payload.input)) {
      await complete(op, current)
      return 'saved'
    }
  }
  return null
}

/** True when a saved bill already has exactly the contents of `input` */
function billMatches(bill: Bill, input: BillInput): boolean {
  const t = computeTotals(input)
  return (
    same(bill.customer.name, input.customer.name) &&
    same(bill.customer.phone, input.customer.phone) &&
    bill.discountType === input.discountType &&
    bill.discountValue === input.discountValue &&
    bill.gstInclusive === input.gstInclusive &&
    bill.paymentMethod === input.paymentMethod &&
    same(bill.notes, input.notes) &&
    bill.amountPaid === Math.min(t.paid, t.grandTotal) &&
    bill.items.length === input.items.length &&
    input.items.every((it, i) => {
      const b = bill.items[i]
      return same(b.productId, it.productId) && b.name === it.name && b.price === it.price && b.quantity === it.quantity && same(b.unit, it.unit) && same(b.bags, it.bags) && b.gstRate === it.gstRate
    })
  )
}

/** Proof of who made the change: sent only when someone else is signed in now (the server checks it) */
function withProof<T extends object>(input: T, op: OutboxOp, me: string | undefined): T {
  if (op.sendAsSelf || op.userId === me || !op.attribution) return input
  return { ...input, offlineAttribution: op.attribution }
}

/** Sends one change. Returns the server's copy of the record, or 'conflict' when a product edit clashes. */
async function deliver(op: OutboxOp, me: string | undefined): Promise<Bill | Product | 'conflict'> {
  switch (op.kind) {
    case 'bill.create':
      return api.createBill(withProof(op.payload.input, op, me))
    case 'bill.update': {
      // continuing from an earlier change (or keeping my version in a conflict): edit the server's current version
      const version = op.payload.baseVersion === null || op.payload.rebase ? (await api.bill(op.entityId)).version : op.payload.baseVersion
      return api.updateBill(op.entityId, withProof({ ...op.payload.input, version }, op, me))
    }
    case 'bill.payment':
      return api.addPayment(op.entityId, withProof(op.payload.input, op, me))
    case 'product.create':
      return api.createProduct(withProof(op.payload.input, op, me))
    case 'product.update': {
      const merged = await mergeProduct(op)
      return merged === 'conflict' ? 'conflict' : api.updateProduct(op.entityId, withProof(merged, op, me))
    }
  }
}

/* ---------- products: three-way merge ---------- */

const PRODUCT_FIELDS = ['name', 'sku', 'categoryId', 'variety', 'brand', 'hsnCode', 'unit', 'bagWeight', 'price', 'purchasePrice', 'gstRate', 'reorderLevel', 'active'] as const
type Field = (typeof PRODUCT_FIELDS)[number]
const LABELS: Partial<Record<Field, string>> = { sku: 'SKU', categoryId: 'category', hsnCode: 'HSN code', bagWeight: 'bag weight', purchasePrice: 'purchase rate', gstRate: 'GST rate', reorderLevel: 'reorder level', price: 'selling rate', active: 'active' }

export const productInput = (p: Product): ProductInput => ({
  name: p.name,
  sku: p.sku,
  categoryId: p.categoryId,
  variety: p.variety,
  brand: p.brand,
  hsnCode: p.hsnCode,
  unit: p.unit,
  bagWeight: p.bagWeight,
  price: p.price,
  purchasePrice: p.purchasePrice,
  gstRate: p.gstRate,
  reorderLevel: p.reorderLevel,
  active: p.active,
})

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

/**
 * Applies only the fields changed offline on top of the product as it is on the server now. A field changed
 * both here and on the server (to different values) is a conflict, unless the user chose to keep theirs.
 */
async function mergeProduct(op: Extract<OutboxOp, { kind: 'product.update' }>): Promise<ProductInput | 'conflict'> {
  const base = productInput(op.payload.base)
  const mine = op.payload.input
  const theirs = productInput(await api.product(op.entityId))
  const merged: Record<string, unknown> = { ...theirs }
  const clashes: Field[] = []
  for (const f of PRODUCT_FIELDS) {
    if (same(mine[f], base[f])) continue // not changed offline: keep the server's value
    if (same(theirs[f], base[f]) || same(theirs[f], mine[f]) || op.payload.force) merged[f] = mine[f]
    else clashes.push(f)
  }
  if (clashes.length) {
    await db.outbox.update(op.seq!, {
      status: 'conflict',
      attempts: op.attempts + 1,
      error: `Changed on another device after your offline edit: ${clashes.map((f) => LABELS[f] ?? f).join(', ')}.`,
    })
    return 'conflict'
  }
  return merged as unknown as ProductInput
}

/* ---------- after the server saved a change ---------- */

async function complete(sent: OutboxOp, result: Bill | Product) {
  const isBill = sent.kind.startsWith('bill.')
  // show the saved record at once (the local copy is dropped below)
  if (isBill) handlers?.onBill(result as Bill)
  else handlers?.onProduct(result as Product)

  await db.transaction('rw', [db.outbox, db.localBills, db.localProducts, db.localCustomers, db.bills, db.products], async () => {
    // the device's copy of server data gets the saved record in the same step that drops the local copy, so a
    // reload or browser restart at this moment still shows the record
    if (isBill) await db.bills.put(result as Bill)
    else await db.products.put(result as Product)
    const now = await db.outbox.get(sent.seq!)
    // an earlier send of this new record may have been saved before it was edited: the server then returned
    // that older form, so the edit still has to be sent
    const olderMayHaveLanded = sent.maybeSentRev !== undefined && sent.maybeSentRev !== sent.rev
    if (now && (now.rev !== sent.rev || olderMayHaveLanded)) {
      // edited while it was being sent: what is left to send is that edit, on top of what was just saved
      await db.outbox.put(followUp(now, result))
    } else {
      await db.outbox.delete(sent.seq!)
      const later = (await db.outbox.where('entityId').equals(sent.entityId).sortBy('seq'))[0]
      if (later) await db.outbox.put(rebased(later, result))
    }
    // pending number on the remaining changes' labels → the real invoice number
    if (isBill && 'invoiceNo' in result)
      await db.outbox
        .where('entityId')
        .equals(sent.entityId)
        .modify((o) => {
          o.label = o.label.replace(/PENDING-[0-9A-F]{6}/, isPendingInvoiceNo(result.invoiceNo) ? '$&' : result.invoiceNo)
        })
    if (isBill) await rebuildBill(sent.entityId)
    else await rebuildProduct(sent.entityId)
    await pruneLocalCustomers()
  })
}

const freshStart = { status: 'pending' as const, attempts: 0, nextAttemptAt: undefined, error: undefined }

/** A change edited while its earlier form was being sent becomes an edit of the record the server now has */
function followUp(op: OutboxOp, saved: Bill | Product): OutboxOp {
  switch (op.kind) {
    case 'bill.create': {
      const { id: _id, clientRequestId: _key, ...input } = op.payload.input
      const bill = saved as Bill
      return { ...op, ...freshStart, kind: 'bill.update', payload: { input, base: bill, baseVersion: bill.version } }
    }
    case 'bill.update':
      return { ...op, ...freshStart, payload: { ...op.payload, base: saved as Bill, baseVersion: (saved as Bill).version, rebase: false } }
    case 'product.create': {
      const { id: _id, openingStock: _o, ...input } = op.payload.input
      return { ...op, ...freshStart, kind: 'product.update', payload: { input, base: saved as Product } }
    }
    case 'product.update':
      return { ...op, ...freshStart, payload: { ...op.payload, base: saved as Product } }
    default:
      return op
  }
}

/** The next waiting change to the same record now starts from what the server just saved */
function rebased(op: OutboxOp, saved: Bill | Product): OutboxOp {
  if (op.kind === 'bill.update') return { ...op, payload: { ...op.payload, base: saved as Bill, baseVersion: op.payload.baseVersion ?? (saved as Bill).version } }
  if (op.kind === 'bill.payment') return { ...op, payload: { ...op.payload, base: saved as Bill } }
  return op
}
