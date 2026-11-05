import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { io } from 'socket.io-client'
import { ADMIN, BASE, call, login, resetDatabase, startServer, stopServer, uuid } from './helpers.ts'

/*
 * End-to-end API tests: real server process + real PostgreSQL. Steps build on each other (shared state),
 * so they run in order.
 */

let admin = { token: '', cookie: '' }
let manager = { token: '', cookie: '' }
let cashier = { token: '', cookie: '' }
const ids: Record<string, string> = {}

before(async () => {
  await resetDatabase()
  await startServer()
})
after(stopServer)

const stockOf = async (id: string) => (await call('GET', `/products/${id}`, { token: admin.token })).body.stock as number

describe('authentication & security', () => {
  test('health check works without signing in', async () => {
    const r = await call('GET', '/health')
    assert.equal(r.status, 200)
    assert.equal(r.body.ok, true)
  })

  test('wrong password is rejected; right one returns tokens and an HttpOnly refresh cookie', async () => {
    assert.equal((await call('POST', '/auth/login', { body: { username: 'admin', password: 'nope-nope' } })).status, 401)
    assert.equal((await call('POST', '/auth/login', { body: { username: 'ghost', password: 'whatever1' } })).status, 401)
    const r = await call('POST', '/auth/login', { body: ADMIN })
    assert.equal(r.status, 200)
    assert.ok(r.body.accessToken)
    assert.equal(r.body.user.role, 'ADMIN')
    assert.match(r.cookie!, /^ajr_refresh=/)
    admin = { token: r.body.accessToken, cookie: r.cookie! }
  })

  test('protected APIs need a token; changes need the app header', async () => {
    assert.equal((await call('GET', '/bootstrap')).status, 401)
    assert.equal((await call('GET', '/bootstrap', { token: 'garbage' })).status, 401)
    assert.equal((await call('POST', '/customers', { token: admin.token, body: {}, noAppHeader: true })).status, 403)
  })

  test('refresh rotates the token; reusing an old one revokes the sign-in', async () => {
    const r1 = await call('POST', '/auth/refresh', { cookie: admin.cookie })
    assert.equal(r1.status, 200)
    assert.ok(r1.body.accessToken)
    assert.notEqual(r1.cookie, admin.cookie)
    // replaying the first cookie = stolen token: the whole family is revoked
    assert.equal((await call('POST', '/auth/refresh', { cookie: admin.cookie })).status, 401)
    assert.equal((await call('POST', '/auth/refresh', { cookie: r1.cookie })).status, 401)
    const again = await login(ADMIN.username, ADMIN.password)
    admin = { token: again.token, cookie: again.cookie }
  })

  test('logout revokes the refresh token', async () => {
    const s = await login(ADMIN.username, ADMIN.password)
    assert.equal((await call('POST', '/auth/logout', { cookie: s.cookie })).status, 200)
    assert.equal((await call('POST', '/auth/refresh', { cookie: s.cookie })).status, 401)
  })

  test('admin creates manager and cashier accounts', async () => {
    for (const [username, role] of [['manager1', 'MANAGER'], ['cashier1', 'CASHIER']]) {
      const r = await call('POST', '/users', { token: admin.token, body: { username, name: username, role, password: 'Password-123' } })
      assert.equal(r.status, 201, JSON.stringify(r.body))
    }
    assert.equal((await call('POST', '/users', { token: admin.token, body: { username: 'manager1', name: 'x', role: 'CASHIER', password: 'Password-123' } })).status, 409)
    const m = await login('manager1', 'Password-123')
    const c = await login('cashier1', 'Password-123')
    manager = { token: m.token, cookie: m.cookie }
    cashier = { token: c.token, cookie: c.cookie }
  })

  test('role permissions are enforced on the server', async () => {
    assert.equal((await call('GET', '/suppliers', { token: cashier.token })).status, 403)
    assert.equal((await call('GET', '/reports/summary', { token: cashier.token })).status, 403)
    assert.equal((await call('PUT', '/settings', { token: manager.token, body: {} })).status, 403)
    assert.equal((await call('GET', '/users', { token: manager.token })).status, 403)
    assert.equal((await call('POST', '/products', { token: cashier.token, body: {} })).status, 403)
    assert.equal((await call('GET', '/suppliers', { token: manager.token })).status, 200)
    assert.equal((await call('GET', '/bootstrap', { token: cashier.token })).status, 200)
  })
})

describe('settings', () => {
  test('company details for A.J RICE TRADERS are set up on first start', async () => {
    const s = (await call('GET', '/settings', { token: cashier.token })).body
    assert.equal(s.businessName, 'A.J RICE TRADERS')
    assert.equal(s.gstin, '33ACRPJ6462A1ZQ')
    assert.equal(s.phone, '96552 33786')
    assert.match(s.address, /Pollachi/)
  })

  test('admin can edit company details; invalid GSTIN is rejected', async () => {
    const s = (await call('GET', '/settings', { token: admin.token })).body
    assert.equal((await call('PUT', '/settings', { token: admin.token, body: { ...s, gstin: 'BAD' } })).status, 400)
    const r = await call('PUT', '/settings', { token: admin.token, body: { ...s, email: 'ajrice@example.com' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.email, 'ajrice@example.com')
  })

  test('tax rates come from the database', async () => {
    const rates = (await call('GET', '/tax-rates', { token: cashier.token })).body.map((r: { rate: number }) => r.rate)
    assert.deepEqual(rates, [0, 5, 12, 18, 28, 40])
  })
})

describe('customers, products, suppliers', () => {
  test('customer create / edit / duplicate phone / search', async () => {
    const c = await call('POST', '/customers', { token: cashier.token, body: { name: 'Sri Murugan Stores', phone: '94430 11111', address: 'Pollachi' } })
    assert.equal(c.status, 201)
    ids.customer = c.body.id
    assert.equal((await call('POST', '/customers', { token: cashier.token, body: { name: 'Other', phone: '9443011111' } })).status, 409)
    assert.equal((await call('POST', '/customers', { token: cashier.token, body: { name: '', phone: '1' } })).status, 400)
    const u = await call('PUT', `/customers/${ids.customer}`, { token: cashier.token, body: { name: 'Sri Murugan Stores', phone: '94430 11111', gstin: '33ABCDE1234F1Z5' } })
    assert.equal(u.body.gstin, '33ABCDE1234F1Z5')
    const found = (await call('GET', '/customers?q=murugan', { token: cashier.token })).body
    assert.equal(found.length, 1)
  })

  test('category and rice product with opening stock', async () => {
    const cat = await call('POST', '/categories', { token: manager.token, body: { name: 'Raw Rice' } })
    assert.equal(cat.status, 201)
    const p = await call('POST', '/products', {
      token: manager.token,
      body: { name: 'Ponni Raw Rice', categoryId: cat.body.id, variety: 'Ponni', unit: 'Kg', bagWeight: 25, price: 52, purchasePrice: 45, gstRate: 5, openingStock: 500, reorderLevel: 100 },
    })
    assert.equal(p.status, 201, JSON.stringify(p.body))
    assert.equal(p.body.stock, 500)
    assert.equal(p.body.categoryName, 'Raw Rice')
    assert.match(p.body.sku, /^P-\d{3}$/)
    ids.ponni = p.body.id
    assert.equal((await call('POST', '/products', { token: manager.token, body: { name: 'X', sku: p.body.sku, price: 1, gstRate: 5 } })).status, 409)
    assert.equal((await call('POST', '/products', { token: manager.token, body: { name: 'X', price: 1, gstRate: 7 } })).status, 400)
  })

  test('purchase from a supplier adds stock and tracks the supplier balance', async () => {
    const s = await call('POST', '/suppliers', { token: manager.token, body: { name: 'Kongu Rice Mill', phone: '0422 555 1234', gstin: '33AAAAA1111A1Z5' } })
    assert.equal(s.status, 201)
    ids.supplier = s.body.id
    const key = uuid()
    const body = {
      supplierId: ids.supplier,
      supplierInvoiceNo: 'KRM-778',
      items: [{ productId: ids.ponni, quantity: 40, unit: 'Bag', price: 1100, gstRate: 5 }],
      discountType: 'amount',
      discountValue: 0,
      amountPaid: 20000,
      paymentMethod: 'Bank Transfer',
      clientRequestId: key,
    }
    const p = await call('POST', '/purchases', { token: manager.token, body })
    assert.equal(p.status, 201, JSON.stringify(p.body))
    assert.equal(p.body.purchaseNo, 'PUR-001')
    assert.equal(p.body.totals.grandTotal, 46200) // 40 × 1100 + 5%
    assert.equal(p.body.status, 'Partial')
    assert.equal(p.body.balance, 26200)
    assert.equal(await stockOf(ids.ponni), 1500) // 500 + 40 bags × 25 kg
    // same request again: not duplicated
    const dup = await call('POST', '/purchases', { token: manager.token, body })
    assert.equal(dup.status, 200)
    assert.equal(dup.body.id, p.body.id)
    assert.equal(await stockOf(ids.ponni), 1500)

    assert.equal((await call('POST', `/purchases/${p.body.id}/payments`, { token: manager.token, body: { amount: 30000, method: 'Cash' } })).status, 400)
    const paid = await call('POST', `/purchases/${p.body.id}/payments`, { token: manager.token, body: { amount: 26200, method: 'UPI', reference: 'UTR123' } })
    assert.equal(paid.body.status, 'Paid')
    const sup = (await call('GET', '/suppliers', { token: manager.token })).body.find((x: { id: string }) => x.id === ids.supplier)
    assert.equal(sup.outstanding, 0)
  })
})

describe('sales billing', () => {
  const billBody = (extra: object = {}) => ({
    customer: { name: 'Ravi Kumar', phone: '98765 43210', address: 'Kottur Road' },
    saveCustomer: true,
    items: [
      { productId: ids.ponni, name: 'Ponni Raw Rice', sku: '', price: 1300, quantity: 2, unit: 'Bag', gstRate: 5 },
      { productId: ids.ponni, name: 'Ponni Raw Rice (loose)', sku: '', price: 52, quantity: 10, unit: 'Kg', gstRate: 5 },
      { productId: '', name: 'Gunny bag', sku: '', price: 30, quantity: 1, unit: 'Loose', gstRate: 0 },
    ],
    discountType: 'percent',
    discountValue: 10,
    gstInclusive: false,
    paymentMethod: 'UPI',
    amountPaid: 2000,
    ...extra,
  })

  test('invoice: number, GST maths, stock deduction, payment, new customer', async () => {
    ids.billKey = uuid()
    const r = await call('POST', '/bills', { token: cashier.token, body: billBody({ clientRequestId: ids.billKey }) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const b = r.body
    ids.bill = b.id
    assert.equal(b.invoiceNo, 'INV-001')
    // subtotal 2600 + 520 + 30 = 3150; 10% off → 2835 taxable; 5% GST on 2808 = 140.40
    assert.equal(b.totals.subtotal, 3150)
    assert.equal(b.totals.discount, 315)
    assert.equal(b.totals.taxable, 2835)
    assert.equal(b.totals.gst, 140.4)
    assert.equal(b.totals.grandTotal, 2975.4)
    assert.equal(b.totals.balance, 975.4)
    assert.equal(b.status, 'Partial')
    assert.equal(b.payments.length, 1)
    assert.equal(b.payments[0].method, 'UPI')
    assert.ok(b.customer.id, 'customer saved from the bill')
    assert.equal(b.items[0].hsnCode, '1006')
    assert.equal(await stockOf(ids.ponni), 1440) // 1500 − (2 bags × 25 + 10 kg)
    const cust = (await call('GET', `/customers/${b.customer.id}`, { token: cashier.token })).body
    assert.equal(cust.outstanding, 975.4)
  })

  test('double submission of the same bill creates it once', async () => {
    const r = await call('POST', '/bills', { token: cashier.token, body: billBody({ clientRequestId: ids.billKey }) })
    assert.equal(r.status, 200)
    assert.equal(r.body.id, ids.bill)
    assert.equal(await stockOf(ids.ponni), 1440)
    assert.equal((await call('GET', '/invoices/next', { token: cashier.token })).body.invoiceNo, 'INV-002')
  })

  test('simultaneous bills from several counters get unique, gap-free numbers and exact stock', async () => {
    const one = (i: number) =>
      call('POST', '/bills', {
        token: i % 2 ? cashier.token : manager.token,
        body: { ...billBody(), items: [{ productId: ids.ponni, name: 'Ponni', sku: '', price: 52, quantity: 5, unit: 'Kg', gstRate: 5 }], amountPaid: 0, paymentMethod: 'Credit', saveCustomer: false },
      })
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => one(i)))
    for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body))
    const numbers = results.map((r) => r.body.invoiceNo).sort()
    assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => `INV-${String(i + 2).padStart(3, '0')}`))
    assert.equal(await stockOf(ids.ponni), 1390)
  })

  test('selling more than the stock is refused and nothing is saved', async () => {
    const r = await call('POST', '/bills', { token: cashier.token, body: { ...billBody(), items: [{ productId: ids.ponni, name: 'Ponni', sku: '', price: 52, quantity: 99999, unit: 'Kg', gstRate: 5 }] } })
    assert.equal(r.status, 409)
    assert.match(r.body.error, /Not enough stock/)
    assert.equal(await stockOf(ids.ponni), 1390)
    assert.equal((await call('GET', '/invoices/next', { token: cashier.token })).body.invoiceNo, 'INV-012')
  })

  test('validation: empty bill, negative price, inactive GST rate', async () => {
    assert.equal((await call('POST', '/bills', { token: cashier.token, body: { ...billBody(), items: [] } })).status, 400)
    assert.equal((await call('POST', '/bills', { token: cashier.token, body: { ...billBody(), items: [{ name: 'X', price: -1, quantity: 1, gstRate: 5 }] } })).status, 400)
    assert.equal((await call('POST', '/bills', { token: cashier.token, body: { ...billBody(), items: [{ name: 'X', price: 1, quantity: 1, gstRate: 7 }] } })).status, 400)
  })

  test('partial payments up to the balance; overpayment refused', async () => {
    assert.equal((await call('POST', `/bills/${ids.bill}/payments`, { token: cashier.token, body: { amount: 5000, method: 'Cash' } })).status, 400)
    const key = uuid()
    const p1 = await call('POST', `/bills/${ids.bill}/payments`, { token: cashier.token, body: { amount: 500, method: 'Cash', clientRequestId: key } })
    assert.equal(p1.status, 201)
    assert.equal(p1.body.totals.balance, 475.4)
    assert.equal(p1.body.status, 'Partial')
    // retried payment is not counted twice
    const again = await call('POST', `/bills/${ids.bill}/payments`, { token: cashier.token, body: { amount: 500, method: 'Cash', clientRequestId: key } })
    assert.equal(again.body.totals.balance, 475.4)
    const p2 = await call('POST', `/bills/${ids.bill}/payments`, { token: cashier.token, body: { amount: 475.4, method: 'UPI' } })
    assert.equal(p2.body.status, 'Paid')
    assert.equal(p2.body.payments.length, 3)
    ids.version = p2.body.version
  })

  test('editing with an outdated version is refused; a current edit fixes stock by the difference', async () => {
    const stale = await call('PUT', `/bills/${ids.bill}`, { token: cashier.token, body: { ...billBody(), version: ids.version - 1, amountPaid: 2975.4 } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'version_conflict')
    // drop the loose 10 kg line → 10 kg back in stock; amount received reduced → refund entry
    const body = { ...billBody(), items: billBody().items.filter((_, i) => i !== 1), version: ids.version, amountPaid: 2000 }
    const r = await call('PUT', `/bills/${ids.bill}`, { token: cashier.token, body })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.invoiceNo, 'INV-001')
    assert.equal(await stockOf(ids.ponni), 1400)
    // 2630 subtotal, 10% → 2367 taxable; 5% on 2340 = 117 → 2484
    assert.equal(r.body.totals.grandTotal, 2484)
    assert.equal(r.body.amountPaid, 2000)
    assert.equal(r.body.payments.at(-1).kind, 'REFUND')
    assert.equal(r.body.totals.balance, 484)
  })

  test('sales return puts goods back and credits the bill', async () => {
    const bill = (await call('GET', `/bills/${ids.bill}`, { token: manager.token })).body
    const bagLine = bill.items.find((i: { unit: string }) => i.unit === 'Bag')
    assert.equal((await call('POST', `/bills/${ids.bill}/returns`, { token: cashier.token, body: { items: [{ invoiceItemId: bagLine.id, quantity: 1 }] } })).status, 403)
    assert.equal((await call('POST', `/bills/${ids.bill}/returns`, { token: manager.token, body: { items: [{ invoiceItemId: bagLine.id, quantity: 5 }] } })).status, 400)
    const r = await call('POST', `/bills/${ids.bill}/returns`, { token: manager.token, body: { items: [{ invoiceItemId: bagLine.id, quantity: 1 }], reason: 'Damaged bag' } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    // 1300 × 0.9 = 1170 + 5% = 1228.50 credited
    assert.equal(r.body.returnTotal, 1228.5)
    assert.equal(r.body.returns[0].returnNo, 'RET-001')
    // value now 2484 − 1228.50 = 1255.50; 2000 was paid → 744.50 refunded
    assert.equal(r.body.returns[0].refund, 744.5)
    assert.equal(r.body.totals.balance, 0)
    assert.equal(r.body.status, 'Paid')
    assert.equal(await stockOf(ids.ponni), 1425)
    // edits are blocked once goods have been returned
    assert.equal((await call('PUT', `/bills/${ids.bill}`, { token: manager.token, body: { ...billBody(), version: r.body.version } })).status, 409)
  })

  test('cancelling restores the remaining stock, refunds and keeps the bill as Cancelled', async () => {
    assert.equal((await call('POST', `/bills/${ids.bill}/cancel`, { token: cashier.token, body: { reason: 'x' } })).status, 403)
    assert.equal((await call('POST', `/bills/${ids.bill}/cancel`, { token: manager.token, body: {} })).status, 400)
    const r = await call('POST', `/bills/${ids.bill}/cancel`, { token: manager.token, body: { reason: 'Customer changed mind', refundMethod: 'Cash' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'Cancelled')
    assert.equal(r.body.totals.balance, 0)
    assert.equal(r.body.amountPaid, 0)
    assert.equal(await stockOf(ids.ponni), 1450) // the bag not returned comes back
    assert.equal((await call('POST', `/bills/${ids.bill}/payments`, { token: manager.token, body: { amount: 1, method: 'Cash' } })).status, 409)
    const list = (await call('GET', '/bills?status=Cancelled', { token: manager.token })).body
    assert.equal(list.total, 1)
  })

  test('bill search, filters and paging', async () => {
    const all = (await call('GET', '/bills?limit=5', { token: cashier.token })).body
    assert.equal(all.total, 11)
    assert.equal(all.items.length, 5)
    assert.equal((await call('GET', '/bills?q=INV-005', { token: cashier.token })).body.total, 1)
    assert.equal((await call('GET', '/bills?q=98765', { token: cashier.token })).body.total, 11)
    assert.equal((await call('GET', '/bills?status=Unpaid', { token: cashier.token })).body.total, 10)
    assert.equal((await call('GET', '/bills?from=2000-01-01&to=2000-01-02', { token: cashier.token })).body.total, 0)
    assert.equal((await call('GET', '/bills?from=bad', { token: cashier.token })).status, 400)
  })

  test('only an administrator can delete a bill; stock comes back', async () => {
    const list = (await call('GET', '/bills?q=INV-011', { token: admin.token })).body.items
    assert.equal((await call('DELETE', `/bills/${list[0].id}`, { token: manager.token })).status, 403)
    assert.equal((await call('DELETE', `/bills/${list[0].id}`, { token: admin.token })).status, 204)
    assert.equal(await stockOf(ids.ponni), 1455)
    // the deleted bill was the latest (INV-011) and cancelled INV-001 still exists: neither number is reused
    assert.equal((await call('GET', '/invoices/next', { token: cashier.token })).body.invoiceNo, 'INV-012')
    const next = await call('POST', '/bills', { token: cashier.token, body: billBody() })
    assert.equal(next.status, 201)
    assert.equal(next.body.invoiceNo, 'INV-012')
    assert.equal((await call('DELETE', `/bills/${next.body.id}`, { token: admin.token })).status, 204)
    assert.equal(await stockOf(ids.ponni), 1455)
  })
})

describe('inventory, expenses, reports', () => {
  test('stock adjustment needs a reason and is recorded as a movement', async () => {
    assert.equal((await call('POST', '/inventory/adjustments', { token: manager.token, body: { productId: ids.ponni, mode: 'set', quantity: 1450 } })).status, 400)
    const r = await call('POST', '/inventory/adjustments', { token: manager.token, body: { productId: ids.ponni, mode: 'set', quantity: 1450, note: 'Physical count' } })
    assert.equal(r.status, 201)
    assert.equal(await stockOf(ids.ponni), 1450)
    const mv = (await call('GET', `/inventory/movements?productId=${ids.ponni}`, { token: cashier.token })).body
    assert.equal(mv.items[0].type, 'ADJUSTMENT')
    assert.equal(mv.items[0].quantity, -5)
    assert.ok(mv.items.some((m: { type: string; reference?: string }) => m.type === 'PURCHASE' && m.reference === 'PUR-001'))
  })

  test('expenses', async () => {
    assert.equal((await call('POST', '/expenses', { token: manager.token, body: { category: 'Transport', amount: 0 } })).status, 400)
    const e = await call('POST', '/expenses', { token: manager.token, body: { category: 'Transport', description: 'Lorry hire', amount: 1500, paymentMethod: 'Cash' } })
    assert.equal(e.status, 201)
    await call('POST', '/expenses', { token: manager.token, body: { category: 'Labour', description: 'Loading', amount: 600, paymentMethod: 'UPI' } })
    const list = (await call('GET', '/expenses', { token: manager.token })).body
    assert.equal(list.total, 2)
    assert.equal(list.sum, 2100)
  })

  test('reports agree with the bills', async () => {
    const r = (await call('GET', '/reports/summary', { token: manager.token })).body
    // 9 credit bills of 5 kg × 52, 10% off, + 5% = 245.70 each (one cancelled, one deleted)
    assert.equal(r.sales.count, 9)
    assert.equal(r.sales.cancelled, 1)
    assert.equal(r.sales.grandTotal, 2211.3)
    assert.equal(r.gstByRate.find((g: { rate: number }) => g.rate === 5).gst, 105.3)
    assert.equal(r.purchases.grandTotal, 46200)
    assert.equal(r.supplierPayments, 46200)
    assert.equal(r.expenseTotal, 2100)
    assert.equal(r.receivables.length, 9)
    const d = (await call('GET', '/reports/dashboard', { token: cashier.token })).body
    assert.equal(d.today.count, 9)
    assert.equal(d.today.sales, 2211.3)
    assert.equal(d.receivables, 2211.3)
    assert.equal(d.monthExpenses, 2100)
    assert.equal(d.recentBills.length, 7)
  })

  test('audit log records who did what', async () => {
    const log = (await call('GET', '/audit-log?limit=200', { token: admin.token })).body
    const actions = new Set(log.items.map((x: { action: string }) => x.action))
    for (const a of ['auth.login', 'invoice.create', 'invoice.update', 'invoice.return', 'invoice.cancel', 'invoice.delete', 'payment.create', 'purchase.create', 'stock.adjust', 'settings.update'])
      assert.ok(actions.has(a), `missing ${a}`)
    assert.equal((await call('GET', '/audit-log', { token: manager.token })).status, 403)
  })
})

describe('multi-user real-time updates', () => {
  test('a bill made on one counter is announced to every other signed-in screen', async () => {
    const socket = io(BASE, { auth: { token: admin.token }, transports: ['websocket'] })
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve())
      socket.on('connect_error', reject)
    })
    const got = new Promise<{ entity: string; label?: string; by?: string }>((resolve) => socket.on('change', (ev) => ev.entity === 'invoice' && resolve(ev)))
    const r = await call('POST', '/bills', { token: cashier.token, body: { customer: { name: 'Walk-in Customer', phone: '' }, items: [{ name: 'Gunny bag', price: 30, quantity: 2, gstRate: 0 }], discountType: 'percent', discountValue: 0, paymentMethod: 'Cash', amountPaid: 60 } })
    const ev = await Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no event')), 5000))])
    assert.equal(ev.label, r.body.invoiceNo)
    assert.equal(ev.by, 'cashier1')
    socket.close()
  })

  test('sockets without a valid token are refused', async () => {
    const socket = io(BASE, { auth: { token: 'bad' }, transports: ['websocket'], reconnection: false })
    const err = await new Promise<Error>((resolve) => socket.on('connect_error', resolve))
    assert.match(err.message, /unauthenticated/)
    socket.close()
  })

  test('deactivating a user locks them out at once', async () => {
    const users = (await call('GET', '/users', { token: admin.token })).body
    const c = users.find((u: { username: string }) => u.username === 'cashier1')
    await call('PUT', `/users/${c.id}`, { token: admin.token, body: { name: c.name, role: c.role, active: false } })
    assert.equal((await call('GET', '/bootstrap', { token: cashier.token })).status, 401)
    assert.equal((await call('POST', '/auth/refresh', { cookie: cashier.cookie })).status, 401)
  })
})

describe('persistence & backup', () => {
  test('data survives a server restart, and the session continues via the refresh cookie', async () => {
    const before = (await call('GET', '/bills', { token: admin.token })).body.total
    await stopServer()
    await startServer()
    const r = await call('POST', '/auth/refresh', { cookie: admin.cookie })
    assert.equal(r.status, 200)
    admin = { token: r.body.accessToken, cookie: r.cookie ?? admin.cookie }
    assert.equal((await call('GET', '/bills', { token: admin.token })).body.total, before)
    assert.equal(await stockOf(ids.ponni), 1450)
  })

  test('backup and restore round-trip', async () => {
    const backup = (await call('GET', '/backup', { token: admin.token })).body
    assert.equal(backup.app, 'aj-rice-billing')
    const bills = backup.tables.invoice.length
    assert.equal((await call('POST', '/reset', { token: admin.token, body: {} })).status, 400)
    assert.equal((await call('POST', '/reset', { token: admin.token, body: { confirm: 'RESET' } })).status, 200)
    assert.equal((await call('GET', '/bills', { token: admin.token })).body.total, 0)
    const r = await call('POST', '/restore', { token: admin.token, body: backup })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await call('GET', '/bills', { token: admin.token })).body.total, bills)
    assert.equal(await stockOf(ids.ponni), 1450)
    assert.equal((await call('GET', '/invoices/next', { token: admin.token })).body.invoiceNo, 'INV-014') // deleted INV-012 stays used after a restore
  })
})
