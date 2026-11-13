import Dexie, { type EntityTable } from 'dexie'
import type { ProductInput } from '../lib/api'
import type { Bill, BillInput, Category, Customer, PaymentInput, Product, Settings, TaxRate, User } from '../types'

/*
 * The browser's own copy of the billing data (IndexedDB, through Dexie), so the app opens and bills without a
 * connection. Three kinds of tables:
 *
 *  - server copy:  bills, products, customers + `kv` (settings, tax rates, categories, user). The last data
 *                  the server sent; replaced wholesale on every successful load. Never edited offline.
 *  - local copy:   localBills, localProducts, localCustomers. How records with unsynced changes look right
 *                  now. The screens show these on top of the server copy. Rebuilt from the outbox.
 *  - outbox:       changes waiting to be sent, in the order they were made. A change leaves the outbox only
 *                  after the server has saved it.
 *
 * A bill's items and payments are kept inside the bill record (as the API returns them), so a bill and its
 * lines are always written together and can never be half-saved.
 */

export type OpKind = 'bill.create' | 'bill.update' | 'bill.payment' | 'product.create' | 'product.update'
/**
 * pending = waiting to be sent; failed = the server refused it; conflict = someone else changed the record;
 * review = who made it can't be verified (made offline by another user), held until they sign in or an
 * administrator decides
 */
export type OpStatus = 'pending' | 'failed' | 'conflict' | 'review'

interface OpBase {
  /** auto-increment: changes are sent in this order */
  seq?: number
  /** the bill or product the change is for */
  entityId: string
  /** shown in the sync panel, e.g. "Bill PENDING-3FA2C1 · Ravi" */
  label: string
  status: OpStatus
  /** bumped whenever the change is edited while waiting, so a send that raced an edit doesn't drop the edit */
  rev: number
  /**
   * New records only: the rev of a send whose answer was lost (it may have been saved). If the record is edited
   * after that, the server may hold the older form, so the edit is sent again as an update once the create lands.
   */
  maybeSentRev?: number
  attempts: number
  /** earliest time (ms) to try again after a network failure */
  nextAttemptAt?: number
  error?: string
  /** the server's reason code for the last refusal, e.g. insufficient_stock */
  errorCode?: string
  /** who made the change, and when */
  userId: string
  userName: string
  /**
   * Server-signed proof that `userId` was signed in when the change was made. Sent with the change so the server
   * records it under that person even if someone else is signed in when it syncs.
   */
  attribution?: string
  /** an administrator chose to send a change whose maker can't be verified under their own name */
  sendAsSelf?: boolean
  createdAt: string
}

export type OutboxOp =
  | (OpBase & { kind: 'bill.create'; payload: { input: BillInput & { id: string } } })
  | (OpBase & {
      kind: 'bill.update'
      /**
       * `base`: the bill as the server last had it, for the first change to a synced bill.
       * `baseVersion`: version the edit started from; null = continue from the previous queued change to this bill.
       * `rebase`: the user chose to keep their edit over a newer server change (sync conflict).
       */
      payload: { input: BillInput; base?: Bill; baseVersion: number | null; rebase?: boolean }
    })
  | (OpBase & { kind: 'bill.payment'; payload: { input: PaymentInput & { clientRequestId: string }; base?: Bill } })
  | (OpBase & { kind: 'product.create'; payload: { input: ProductInput & { id: string } } })
  | (OpBase & {
      kind: 'product.update'
      /** `base`: the product as the server had it when the offline edit began (for the three-way merge) */
      payload: { input: ProductInput; base: Product; force?: boolean }
    })

export interface KV {
  key: string
  value: unknown
}

export interface CachedResponse {
  path: string
  data: unknown
  savedAt: string
}

class OfflineDb extends Dexie {
  bills!: EntityTable<Bill, 'id'>
  products!: EntityTable<Product, 'id'>
  customers!: EntityTable<Customer, 'id'>
  kv!: EntityTable<KV, 'key'>
  localBills!: EntityTable<Bill, 'id'>
  localProducts!: EntityTable<Product, 'id'>
  localCustomers!: EntityTable<Customer, 'id'>
  outbox!: EntityTable<OutboxOp, 'seq'>
  httpCache!: EntityTable<CachedResponse, 'path'>

  constructor() {
    /*
     * strict: a save counts as done only once it is on disk. Chrome's default ("relaxed") may keep a committed
     * write in memory for a moment, so a bill saved offline could be lost if the browser is closed, crashes or
     * the device loses power right after "Saved on this device". Slower writes are worth it for unsynced sales.
     */
    super('ajrice-billing', { chromeTransactionDurability: 'strict' })
    this.version(1).stores({
      bills: 'id, invoiceNo, date',
      products: 'id, name, sku',
      customers: 'id, name, phone',
      kv: 'key',
      localBills: 'id',
      localProducts: 'id',
      localCustomers: 'id, phone',
      outbox: '++seq, entityId, status, kind',
      httpCache: 'path',
    })
  }
}

export const db = new OfflineDb()

/* ---------- server copy ---------- */

export interface Snapshot {
  settings: Settings
  taxRates: TaxRate[]
  categories: Category[]
  user: User
  nextInvoiceNo: string
  products: Product[]
  customers: Customer[]
  bills: Bill[]
  savedAt: string
}

/** Saves everything the server sent, replacing the previous copy (so records deleted on the server go too). */
export async function saveSnapshot(s: Omit<Snapshot, 'savedAt'>) {
  await db.transaction('rw', [db.kv, db.bills, db.products, db.customers], async () => {
    await Promise.all([db.bills.clear(), db.products.clear(), db.customers.clear()])
    await Promise.all([db.bills.bulkPut(s.bills), db.products.bulkPut(s.products), db.customers.bulkPut(s.customers)])
    await db.kv.bulkPut([
      { key: 'settings', value: s.settings },
      { key: 'taxRates', value: s.taxRates },
      { key: 'categories', value: s.categories },
      { key: 'user', value: s.user },
      { key: 'nextInvoiceNo', value: s.nextInvoiceNo },
      { key: 'savedAt', value: new Date().toISOString() },
    ])
  })
}

/** The last saved copy, or null if this browser has none (never signed in here, or signed out since). */
export async function loadSnapshot(): Promise<Snapshot | null> {
  const kv = new Map((await db.kv.toArray()).map((r) => [r.key, r.value]))
  if (!kv.has('user') || !kv.has('settings')) return null
  const [bills, products, customers] = await Promise.all([db.bills.toArray(), db.products.toArray(), db.customers.toArray()])
  return {
    settings: kv.get('settings') as Settings,
    taxRates: (kv.get('taxRates') as TaxRate[]) ?? [],
    categories: (kv.get('categories') as Category[]) ?? [],
    user: kv.get('user') as User,
    nextInvoiceNo: (kv.get('nextInvoiceNo') as string) ?? '',
    products,
    customers,
    bills,
    savedAt: (kv.get('savedAt') as string) ?? '',
  }
}

/**
 * Forgets the server copy (on sign-out). Unsynced changes (outbox and local copies) are kept: they are sent
 * after the next sign-in, so a sale made offline is never lost.
 */
export async function clearSnapshot() {
  await db.transaction('rw', [db.kv, db.bills, db.products, db.customers, db.httpCache], () =>
    Promise.all([db.kv.clear(), db.bills.clear(), db.products.clear(), db.customers.clear(), db.httpCache.clear()]),
  )
}

/* ---------- proof of who is signed in (offline attribution) ---------- */

export interface Attribution {
  userId: string
  token: string
  expiresAt: string
}

export const saveAttribution = (a: Attribution) => db.kv.put({ key: 'attribution', value: a })

/** The saved proof, only if it belongs to `userId` and hasn't expired */
export async function loadAttribution(userId: string): Promise<Attribution | undefined> {
  const a = (await db.kv.get('attribution'))?.value as Attribution | undefined
  return a && a.userId === userId && Date.parse(a.expiresAt) > Date.now() ? a : undefined
}

/* ---------- last-seen API responses (reports, expenses) ---------- */

export async function cacheResponse(path: string, data: unknown) {
  try {
    await db.httpCache.put({ path, data, savedAt: new Date().toISOString() })
  } catch {
    // storage full or unavailable: the screen still works online
  }
}

export async function cachedResponse(path: string): Promise<CachedResponse | undefined> {
  try {
    return await db.httpCache.get(path)
  } catch {
    return undefined
  }
}
