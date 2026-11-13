import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { ADMIN, BASE, call, login, resetDatabase, startServer, stopServer, uuid } from './helpers.ts'

/*
 * What the offline app (src/offline) relies on when it syncs: records made offline keep the id the app gave
 * them, and sending the same change again (lost answer, retry, two tabs) never saves it twice.
 */

let admin = { token: '', cookie: '' }
const ids: Record<string, string> = {}
const sent: Record<string, object> = {}

before(async () => {
  await resetDatabase()
  await startServer()
  admin = await login(ADMIN.username, ADMIN.password)
})
after(stopServer)

const stockOf = async (id: string) => (await call('GET', `/products/${id}`, { token: admin.token })).body.stock as number

const offlineBill = (extra: object = {}) => ({
  id: uuid(),
  clientRequestId: `draft-${uuid().slice(0, 12)}`,
  date: new Date(Date.now() - 3 * 3600_000).toISOString(), // made a few hours ago, while offline
  customer: { name: 'Offline Customer', phone: '90000 11111' },
  saveCustomer: true,
  items: [{ productId: ids.product, name: 'Offline Rice', sku: '', price: 50, quantity: 4, unit: 'Kg', gstRate: 5 }],
  discountType: 'percent',
  discountValue: 0,
  gstInclusive: false,
  paymentMethod: 'Cash',
  amountPaid: 0,
  ...extra,
})

describe('offline sync', () => {
  test('a product made offline keeps its id; sending it again returns it without adding stock twice', async () => {
    ids.product = uuid()
    const body = { id: ids.product, name: 'Offline Rice', unit: 'Kg', price: 50, gstRate: 5, openingStock: 100 }
    const first = await call('POST', '/products', { token: admin.token, body })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    assert.equal(first.body.id, ids.product)
    const again = await call('POST', '/products', { token: admin.token, body })
    assert.equal(again.status, 200)
    assert.equal(again.body.id, ids.product)
    assert.equal(await stockOf(ids.product), 100)
  })

  test('a bill made offline keeps its id and creates its new customer with the id the app gave it', async () => {
    ids.customer = uuid()
    const body = offlineBill({ customer: { id: ids.customer, name: 'Offline Customer', phone: '90000 11111' } })
    ids.bill = body.id
    ids.billKey = body.clientRequestId
    sent.bill = body
    const r = await call('POST', '/bills', { token: admin.token, body })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.id, ids.bill)
    assert.equal(r.body.customer.id, ids.customer)
    assert.equal(r.body.date, body.date, 'the time the sale happened is kept')
    assert.equal(await stockOf(ids.product), 96)
    assert.equal((await call('GET', `/customers/${ids.customer}`, { token: admin.token })).body.name, 'Offline Customer')
  })

  test('the same bill synced twice is saved once (same id, stock taken once)', async () => {
    const body = sent.bill // exactly what was sent the first time
    const [a, b] = await Promise.all([call('POST', '/bills', { token: admin.token, body }), call('POST', '/bills', { token: admin.token, body })])
    for (const r of [a, b]) {
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.id, ids.bill)
    }
    assert.equal(await stockOf(ids.product), 96)
    const page = (await call('GET', '/bills?limit=50', { token: admin.token })).body
    assert.equal(page.total, 1)
  })

  test('the same bill id with a different idempotency key is refused, not overwritten', async () => {
    const r = await call('POST', '/bills', { token: admin.token, body: { ...offlineBill(), id: ids.bill, clientRequestId: `other-${uuid().slice(0, 12)}` } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'id_conflict')
    assert.equal(await stockOf(ids.product), 96)
  })

  test('a second offline bill for the same new customer links to the same record', async () => {
    const r = await call('POST', '/bills', { token: admin.token, body: offlineBill({ customer: { id: ids.customer, name: 'Offline Customer', phone: '90000 11111' } }) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.customer.id, ids.customer)
  })

  test('a customer added offline whose phone is already known is linked to the existing customer', async () => {
    // same digits written differently (phones are matched on their digits)
    const r = await call('POST', '/bills', { token: admin.token, body: offlineBill({ customer: { id: uuid(), name: 'Same Phone', phone: '90000-11111' } }) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.customer.id, ids.customer)
    assert.equal(r.body.customer.name, 'Same Phone', 'the bill keeps the name typed on it')
  })

  test('a malformed customer id is ignored instead of failing the bill', async () => {
    const r = await call('POST', '/bills', { token: admin.token, body: offlineBill({ saveCustomer: false, customer: { id: 'not-a-uuid', name: 'Walk-in Customer', phone: '' } }) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.customer.id, undefined)
  })

  test('a payment taken offline keeps its date and is counted once when resent', async () => {
    const key = uuid()
    const date = new Date(Date.now() - 3600_000).toISOString()
    const body = { amount: 50, method: 'Cash', clientRequestId: key, date }
    const first = await call('POST', `/bills/${ids.bill}/payments`, { token: admin.token, body })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const again = await call('POST', `/bills/${ids.bill}/payments`, { token: admin.token, body })
    assert.equal(again.status, 200)
    assert.equal(again.body.amountPaid, 50)
    assert.equal(again.body.payments.length, 1)
    assert.equal(again.body.payments[0].date, date)
    ids.version = again.body.version
  })

  test('an offline edit made on an older version is refused with version_conflict (never overwrites)', async () => {
    const stale = await call('PUT', `/bills/${ids.bill}`, { token: admin.token, body: { ...offlineBill(), id: undefined, notes: 'edited offline', version: ids.version - 1, amountPaid: 50 } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'version_conflict')
    const current = await call('PUT', `/bills/${ids.bill}`, { token: admin.token, body: { ...offlineBill(), id: undefined, notes: 'edited offline', version: ids.version, amountPaid: 50 } })
    assert.equal(current.status, 200, JSON.stringify(current.body))
    assert.equal(current.body.notes, 'edited offline')
  })

  test('the service worker is never cached by the browser, and the CSP lets it fetch the fonts', async () => {
    const res = await fetch(`${BASE}/api/health`)
    assert.match(res.headers.get('content-security-policy') ?? '', /connect-src[^;]*https:\/\/fonts\.gstatic\.com/)
    if (!fs.existsSync('dist/sw.js')) return // the built app is served only after `npm run build`
    const sw = await fetch(`${BASE}/sw.js`)
    assert.equal(sw.status, 200)
    assert.equal(sw.headers.get('cache-control'), 'no-cache')
    const manifest = await fetch(`${BASE}/manifest.webmanifest`)
    assert.equal(manifest.headers.get('cache-control'), 'no-cache')
  })
})

/* ---------- production-readiness fixes ---------- */

const walkIn = { saveCustomer: false, customer: { name: 'Walk-in Customer', phone: '' } }

describe('duplicate and reused requests', () => {
  test('many identical sends racing each other save one bill, all get it back, stock taken once', async () => {
    const before = await stockOf(ids.product)
    const body = offlineBill(walkIn)
    const rs = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/bills', { token: admin.token, body })))
    for (const r of rs) {
      assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body)}`)
      assert.equal(r.body.id, body.id)
    }
    assert.equal(rs.filter((r) => r.status === 201).length, 1, 'created exactly once')
    assert.equal(await stockOf(ids.product), before - 4)
  })

  test('a different idempotency key with an existing bill id is refused and nothing changes', async () => {
    const body = offlineBill(walkIn)
    assert.equal((await call('POST', '/bills', { token: admin.token, body })).status, 201)
    const before = await stockOf(ids.product)
    const r = await call('POST', '/bills', { token: admin.token, body: { ...body, clientRequestId: `other-${uuid().slice(0, 12)}` } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'id_conflict')
    assert.equal(await stockOf(ids.product), before)
  })

  test('the same id and key with different lines or payment is refused, never answered with the old bill', async () => {
    const body = offlineBill(walkIn)
    assert.equal((await call('POST', '/bills', { token: admin.token, body })).status, 201)
    const before = await stockOf(ids.product)
    const changed = { ...body, items: [{ ...body.items[0], quantity: 7 }] }
    const r = await call('POST', '/bills', { token: admin.token, body: changed })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'idempotency_mismatch')
    const paid = await call('POST', '/bills', { token: admin.token, body: { ...body, amountPaid: 50 } })
    assert.equal(paid.status, 409, 'a different payment at billing is a different request too')
    assert.equal(await stockOf(ids.product), before)
    const saved = (await call('GET', `/bills/${body.id}`, { token: admin.token })).body
    assert.equal(saved.items[0].quantity, 4)
  })

  test('the id of a bill saved without an idempotency key cannot be reused', async () => {
    const online = await call('POST', '/bills', { token: admin.token, body: { ...offlineBill(walkIn), clientRequestId: undefined } })
    assert.equal(online.status, 201)
    const r = await call('POST', '/bills', { token: admin.token, body: { ...offlineBill(), id: online.body.id } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'id_conflict')
  })

  test('an unrelated unique clash (same new customer phone from two devices at once) is never taken as a duplicate', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`
    const a = offlineBill({ customer: { id: uuid(), name: 'Device A Customer', phone } })
    const b = offlineBill({ customer: { id: uuid(), name: 'Device B Customer', phone } })
    const rs = await Promise.all([call('POST', '/bills', { token: admin.token, body: a }), call('POST', '/bills', { token: admin.token, body: b })])
    const pairs = [
      [rs[0], a],
      [rs[1], b],
    ] as const
    for (const [r, sent] of pairs) {
      if (r.status === 201) assert.equal(r.body.id, sent.id, 'answered with its own bill')
      else assert.equal(r.status, 409, JSON.stringify(r.body)) // the loser is refused, never given the other bill
    }
    // the app retries such a refusal; the retry links to the customer the other device created
    for (const [r, sent] of pairs) {
      if (r.status === 201) continue
      const again = await call('POST', '/bills', { token: admin.token, body: sent })
      assert.equal(again.status, 201, JSON.stringify(again.body))
      assert.equal(again.body.id, sent.id)
    }
  })

  test('a payment key reused for a different amount is refused', async () => {
    const key = uuid()
    const first = await call('POST', `/bills/${ids.bill}/payments`, { token: admin.token, body: { amount: 1, method: 'Cash', clientRequestId: key } })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const other = await call('POST', `/bills/${ids.bill}/payments`, { token: admin.token, body: { amount: 2, method: 'Cash', clientRequestId: key } })
    assert.equal(other.status, 409)
    assert.equal(other.body.code, 'idempotency_mismatch')
  })
})

describe('offline attribution (who really made an offline change)', () => {
  const users: Record<string, { token: string; cookie: string; id: string }> = {}
  const proof = async (who: string) => (await call('GET', '/offline-attribution', { token: users[who].token })).body.token as string

  before(async () => {
    for (const [username, role] of [
      ['cash1', 'CASHIER'],
      ['cash2', 'CASHIER'],
      ['mgr1', 'MANAGER'],
    ]) {
      const r = await call('POST', '/users', { token: admin.token, body: { username, name: `User ${username}`, role, password: 'Password-123' } })
      assert.equal(r.status, 201, JSON.stringify(r.body))
      users[username] = { ...(await login(username, 'Password-123')), id: r.body.id }
    }
  })

  test('a bill made offline by cashier 1 and synced while cashier 2 is signed in stays credited to cashier 1', async () => {
    const body = { ...offlineBill({ ...walkIn, amountPaid: 50 }), offlineAttribution: await proof('cash1') }
    const r = await call('POST', '/bills', { token: users.cash2.token, body })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.createdByName, 'User cash1')
    assert.equal(r.body.payments[0].userName, 'User cash1', 'cash taken offline is credited to who took it')
    const log = (await call('GET', '/audit-log?entity=invoice&limit=10', { token: admin.token })).body.items
    const entry = log.find((x: { entityId: string; action: string }) => x.entityId === body.id && x.action === 'invoice.create')
    assert.equal(entry.userName, 'User cash1')
    assert.equal(entry.details.syncedBy.name, 'User cash2', 'the audit log also records who sent it')
  })

  test('offline payments keep their creator too', async () => {
    const r = await call('POST', `/bills/${ids.bill}/payments`, { token: users.cash2.token, body: { amount: 1, method: 'Cash', clientRequestId: uuid(), offlineAttribution: await proof('cash1') } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.payments.at(-1).userName, 'User cash1')
  })

  test('a forged or tampered proof is refused and nothing is saved', async () => {
    const before = await stockOf(ids.product)
    const real = await proof('cash1')
    // garbage, a tampered signature, and an access token (which is not a proof)
    for (const fake of ['not-a-token', real.slice(0, -3) + 'abc', users.cash1.token]) {
      const body = { ...offlineBill(walkIn), offlineAttribution: fake }
      const r = await call('POST', '/bills', { token: users.cash2.token, body })
      assert.equal(r.status, 409, JSON.stringify(r.body))
      assert.equal(r.body.code, 'creator_unverified')
      assert.equal((await call('GET', `/bills/${body.id}`, { token: admin.token })).status, 404)
    }
    assert.equal(await stockOf(ids.product), before)
  })

  test('a proof cannot be used to sign in or call the API', async () => {
    assert.equal((await call('GET', '/bills', { token: await proof('cash1') })).status, 401)
  })

  test("a creator's proof stops working when their password is changed", async () => {
    const p = await proof('cash1')
    const u = (await call('GET', '/users', { token: admin.token })).body.find((x: { username: string }) => x.username === 'cash1')
    const reset = await call('PUT', `/users/${u.id}`, { token: admin.token, body: { ...u, password: 'Password-456' } })
    assert.equal(reset.status, 200, JSON.stringify(reset.body))
    const r = await call('POST', '/bills', { token: users.cash2.token, body: { ...offlineBill(walkIn), offlineAttribution: p } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'creator_unverified')
  })

  test("the creator must be allowed to make the change (a cashier's proof can't add a product, even sent by a manager)", async () => {
    const id = uuid()
    const r = await call('POST', '/products', { token: users.mgr1.token, body: { id, name: 'Proof Test', unit: 'Kg', price: 1, gstRate: 5, offlineAttribution: await proof('cash2') } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, 'creator_unverified')
    assert.equal((await call('GET', `/products/${id}`, { token: admin.token })).status, 404)
  })

  test("the sender's own permissions still apply (a cashier can't sync a manager's product)", async () => {
    const r = await call('POST', '/products', { token: users.cash2.token, body: { id: uuid(), name: 'X', unit: 'Kg', price: 1, gstRate: 5, offlineAttribution: await proof('mgr1') } })
    assert.equal(r.status, 403)
  })
})

describe('API caching', () => {
  test('API answers are marked Cache-Control: no-store', async () => {
    for (const path of ['/bills?limit=1', '/bootstrap', '/offline-attribution']) {
      const res = await fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${admin.token}`, 'X-Requested-With': 'ajrice' } })
      assert.match(res.headers.get('cache-control') ?? '', /no-store/, path)
    }
    assert.match((await fetch(`${BASE}/api/health`)).headers.get('cache-control') ?? '', /no-store/)
  })
})
