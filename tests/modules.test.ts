import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { ADMIN, BASE, call, login, resetDatabase, startServer, stopServer, uuid } from './helpers.ts'

/*
 * Expenses and Reports modules, against the real server and a throw-away `_test` database.
 * Every expected figure below is worked out by hand from the bills, payments, returns and expenses created here,
 * so the reports are checked against known answers (no payment, refund or expense counted twice).
 */

let admin = { token: '', cookie: '' }
let manager = { token: '', cookie: '' }
let cashier = { token: '', cookie: '' }
const ids: Record<string, string> = {}

const local = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TODAY = local(0)
const YESTERDAY = local(-1)
const period = `from=${TODAY}&to=${TODAY}`

/** Uploads a file as the app does: raw bytes, type in Content-Type, name in X-File-Name */
async function upload(expenseId: string, bytes: Uint8Array, type: string, name = 'receipt.png', token = manager.token) {
  const res = await fetch(`${BASE}/api/expenses/${expenseId}/attachment`, {
    method: 'PUT',
    headers: { 'X-Requested-With': 'ajrice', Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
    body: bytes,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4, 5])

before(async () => {
  await resetDatabase()
  await startServer()
  const a = await login(ADMIN.username, ADMIN.password)
  admin = { token: a.token, cookie: a.cookie }
  for (const [username, role] of [['manager1', 'MANAGER'], ['cashier1', 'CASHIER']]) {
    const r = await call('POST', '/users', { token: admin.token, body: { username, name: username, role, password: 'Password-123' } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }
  const m = await login('manager1', 'Password-123')
  const c = await login('cashier1', 'Password-123')
  manager = { token: m.token, cookie: m.cookie }
  cashier = { token: c.token, cookie: c.cookie }
})
after(stopServer)

const bill = (price: number, quantity: number, amountPaid: number, extra: object = {}) => ({
  customer: { name: 'Walk-in Customer', phone: '' },
  items: [{ name: 'Test item', sku: '', price, quantity, unit: '', gstRate: 5 }],
  discountType: 'percent',
  discountValue: 0,
  gstInclusive: false,
  paymentMethod: amountPaid > 0 ? 'Cash' : 'Credit',
  amountPaid,
  clientRequestId: uuid(),
  ...extra,
})

describe('permissions', () => {
  test('cashiers cannot open expenses or reports; managers and admins can', async () => {
    for (const url of ['/expenses', '/expenses/summary', '/expense-categories', '/reports/summary', '/reports/invoices', '/reports/customers', '/reports/payments', '/reports/outstanding'])
      assert.equal((await call('GET', url, { token: cashier.token })).status, 403, url)
    assert.equal((await call('POST', '/expenses', { token: cashier.token, body: { category: 'Rent', amount: 1 } })).status, 403)
    assert.equal((await call('POST', '/expense-categories', { token: cashier.token, body: { name: 'X' } })).status, 403)
    assert.equal((await call('GET', '/reports/invoices', { token: manager.token })).status, 200)
    assert.equal((await call('GET', '/expenses', { token: admin.token })).status, 200)
    assert.equal((await call('GET', '/expenses')).status, 401)
  })
})

describe('expense categories', () => {
  test('the migration provides the standard categories', async () => {
    const r = await call('GET', '/expense-categories', { token: manager.token })
    assert.equal(r.status, 200)
    const names = r.body.map((c: { name: string }) => c.name)
    for (const n of ['Rent', 'Electricity', 'Salary', 'Transport', 'Other']) assert.ok(names.includes(n), n)
    ids.rent = r.body.find((c: { name: string }) => c.name === 'Rent').id
  })

  test('add, duplicate (any case) refused, rename', async () => {
    const r = await call('POST', '/expense-categories', { token: manager.token, body: { name: '  Tea   & snacks ' } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.name, 'Tea & snacks')
    ids.tea = r.body.id
    assert.equal((await call('POST', '/expense-categories', { token: manager.token, body: { name: 'RENT' } })).status, 409)
    assert.equal((await call('POST', '/expense-categories', { token: manager.token, body: { name: '  ' } })).status, 400)
    assert.equal((await call('PUT', `/expense-categories/${ids.tea}`, { token: manager.token, body: { name: 'rent' } })).status, 409)
    assert.equal((await call('PUT', '/expense-categories/not-an-id', { token: manager.token, body: { name: 'x' } })).status, 404)
  })
})

describe('expenses', () => {
  test('validation', async () => {
    const bad = async (body: object) => (await call('POST', '/expenses', { token: manager.token, body })).status
    assert.equal(await bad({ title: 'x', categoryId: ids.rent, amount: 0, paymentMethod: 'Cash' }), 400)
    assert.equal(await bad({ title: 'x', categoryId: ids.rent, amount: -5, paymentMethod: 'Cash' }), 400)
    assert.equal(await bad({ title: 'x', amount: 10, paymentMethod: 'Cash' }), 400) // no category
    assert.equal(await bad({ title: 'x', categoryId: uuid(), amount: 10, paymentMethod: 'Cash' }), 400) // unknown category
    assert.equal(await bad({ title: 'x', categoryId: ids.rent, amount: 10, paymentMethod: 'Bitcoin' }), 400)
    assert.equal(await bad({ title: 'x', categoryId: ids.rent, amount: 10, paymentMethod: 'Cash', date: local(5) }), 400) // future
    assert.equal((await call('GET', '/expenses', { token: manager.token })).body.total, 0)
  })

  test('add with title, category, method, notes; a retried save is stored once', async () => {
    const key = uuid()
    const body = { date: TODAY, title: 'Shop rent', categoryId: ids.rent, amount: 1000, paymentMethod: 'Bank Transfer', description: 'November rent', reference: 'NEFT-1', clientRequestId: key }
    const r = await call('POST', '/expenses', { token: manager.token, body })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.title, 'Shop rent')
    assert.equal(r.body.category, 'Rent')
    assert.equal(r.body.categoryId, ids.rent)
    assert.equal(r.body.dateKey, TODAY)
    assert.equal(r.body.userName, 'manager1')
    ids.rentExp = r.body.id
    const again = await call('POST', '/expenses', { token: manager.token, body })
    assert.equal(again.status, 200)
    assert.equal(again.body.id, ids.rentExp)

    const tea = await call('POST', '/expenses', { token: admin.token, body: { date: TODAY, title: 'Tea for staff', categoryId: ids.tea, amount: 250.5, paymentMethod: 'Cash' } })
    assert.equal(tea.status, 201)
    ids.teaExp = tea.body.id
    // the original API (category by name) still works and creates the category when new
    const old = await call('POST', '/expenses', { token: manager.token, body: { date: YESTERDAY, category: 'Courier', description: 'Parcel', amount: 99.5, paymentMethod: 'UPI' } })
    assert.equal(old.status, 201, JSON.stringify(old.body))
    assert.ok(old.body.categoryId)
    ids.courierExp = old.body.id
    ids.courier = old.body.categoryId
    assert.equal((await call('GET', '/expense-categories', { token: manager.token })).body.filter((c: { name: string }) => c.name === 'Courier').length, 1)
  })

  test('search and filters', async () => {
    const q = async (s: string) => (await call('GET', `/expenses?${s}`, { token: manager.token })).body
    assert.equal((await q('')).total, 3)
    assert.equal((await q('')).sum, 1350)
    assert.equal((await q('q=rent')).total, 1) // title / notes / category
    assert.equal((await q('q=NEFT')).total, 1) // reference
    assert.equal((await q(`categoryId=${ids.tea}`)).sum, 250.5)
    assert.equal((await q('method=UPI')).total, 1)
    assert.equal((await q(period)).sum, 1250.5)
    assert.equal((await q(`from=${YESTERDAY}&to=${YESTERDAY}`)).sum, 99.5)
    assert.equal((await call('GET', `/expenses?from=${TODAY}&to=${YESTERDAY}`, { token: manager.token })).status, 400)
  })

  test('daily, monthly and period summaries', async () => {
    const s = (await call('GET', `/expenses/summary?from=${YESTERDAY}&to=${TODAY}`, { token: manager.token })).body
    assert.deepEqual(s.today, { total: 1250.5, count: 2 })
    assert.equal(s.period.total, 1350)
    assert.equal(s.period.count, 3)
    assert.equal(s.period.average, 675)
    assert.deepEqual(s.byCategory.map((c: { category: string; total: number }) => [c.category, c.total]), [['Rent', 1000], ['Tea & snacks', 250.5], ['Courier', 99.5]])
    assert.deepEqual(s.daily, [
      { date: YESTERDAY, total: 99.5, count: 1 },
      { date: TODAY, total: 1250.5, count: 2 },
    ])
    // this month: yesterday counts only when it is in the same month
    assert.equal(s.month.total, YESTERDAY.slice(0, 7) === TODAY.slice(0, 7) ? 1350 : 1250.5)
  })

  test('edit; renaming a category renames it on its expenses', async () => {
    const r = await call('PUT', `/expenses/${ids.teaExp}`, { token: manager.token, body: { date: TODAY, title: 'Tea for staff', categoryId: ids.tea, amount: 300, paymentMethod: 'Cash' } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.amount, 300)
    const ren = await call('PUT', `/expense-categories/${ids.tea}`, { token: manager.token, body: { name: 'Refreshments', active: true } })
    assert.equal(ren.status, 200)
    assert.equal((await call('GET', `/expenses/${ids.teaExp}`, { token: manager.token })).body.category, 'Refreshments')
    assert.equal((await call('PUT', `/expenses/${uuid()}`, { token: manager.token, body: { categoryId: ids.tea, amount: 1, paymentMethod: 'Cash' } })).status, 404)
  })

  test('a category in use is archived, not deleted; an unused one is deleted', async () => {
    const d = await call('DELETE', `/expense-categories/${ids.courier}`, { token: manager.token })
    assert.equal(d.status, 200)
    assert.equal(d.body.archived, true)
    const cats = (await call('GET', '/expense-categories', { token: manager.token })).body
    const courier = cats.find((c: { id: string }) => c.id === ids.courier)
    assert.equal(courier.active, false)
    assert.equal(courier.expenseCount, 1)
    // new expenses can't use it, the existing one keeps it when edited
    assert.equal((await call('POST', '/expenses', { token: manager.token, body: { categoryId: ids.courier, amount: 5, paymentMethod: 'Cash' } })).status, 400)
    assert.equal((await call('PUT', `/expenses/${ids.courierExp}`, { token: manager.token, body: { date: YESTERDAY, categoryId: ids.courier, amount: 99.5, paymentMethod: 'UPI', description: 'Parcel' } })).status, 200)
    assert.ok(!(await call('GET', '/expenses/categories', { token: manager.token })).body.includes('Courier'))

    const unused = await call('POST', '/expense-categories', { token: manager.token, body: { name: 'Temporary' } })
    const del = await call('DELETE', `/expense-categories/${unused.body.id}`, { token: manager.token })
    assert.equal(del.body.archived, false)
    assert.ok(!(await call('GET', '/expense-categories', { token: manager.token })).body.some((c: { id: string }) => c.id === unused.body.id))
  })

  test('receipt attachment: upload, view, replace, remove; only real images / PDFs', async () => {
    const up = await upload(ids.rentExp, PNG, 'image/png', 'rent receipt.png')
    assert.equal(up.status, 201, JSON.stringify(up.body))
    assert.deepEqual(up.body, { fileName: 'rent receipt.png', mimeType: 'image/png', size: PNG.length })
    const e = (await call('GET', `/expenses/${ids.rentExp}`, { token: manager.token })).body
    assert.equal(e.attachment.fileName, 'rent receipt.png')

    const res = await fetch(`${BASE}/api/expenses/${ids.rentExp}/attachment`, { headers: { Authorization: `Bearer ${manager.token}` } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG)
    assert.equal((await fetch(`${BASE}/api/expenses/${ids.rentExp}/attachment`, { headers: { Authorization: `Bearer ${cashier.token}` } })).status, 403)

    // not what it claims to be / not allowed / too large / nothing
    assert.equal((await upload(ids.rentExp, new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).status, 400)
    assert.equal((await upload(ids.rentExp, new TextEncoder().encode('hello'), 'text/html')).status, 400)
    const big = new Uint8Array(2 * 1024 * 1024 + 10)
    big.set(PNG)
    assert.ok([400, 413].includes((await upload(ids.rentExp, big, 'image/png')).status))
    assert.equal((await upload(ids.rentExp, PNG, 'image/png', 'x.png', cashier.token)).status, 403)

    // a PDF replaces the photo
    const pdf = new TextEncoder().encode('%PDF-1.4\n%test\n')
    assert.equal((await upload(ids.rentExp, pdf, 'application/pdf', 'bill.pdf')).body.mimeType, 'application/pdf')
    assert.equal((await call('GET', `/expenses/${ids.rentExp}`, { token: manager.token })).body.attachment.fileName, 'bill.pdf')

    // the receipt goes when the expense is deleted
    assert.equal((await upload(ids.courierExp, PNG, 'image/png')).status, 201)
    assert.equal((await call('DELETE', `/expenses/${ids.courierExp}/attachment`, { token: manager.token })).status, 204)
    assert.equal((await call('GET', `/expenses/${ids.courierExp}`, { token: manager.token })).body.attachment, undefined)
    assert.equal((await call('DELETE', `/expenses/${ids.courierExp}/attachment`, { token: manager.token })).status, 404)
  })

  test('delete needs permission and is audited', async () => {
    const tmp = await call('POST', '/expenses', { token: manager.token, body: { date: TODAY, title: 'Mistake', categoryId: ids.rent, amount: 5, paymentMethod: 'Cash' } })
    await upload(tmp.body.id, PNG, 'image/png')
    assert.equal((await call('DELETE', `/expenses/${tmp.body.id}`, { token: cashier.token })).status, 403)
    assert.equal((await call('DELETE', `/expenses/${tmp.body.id}`, { token: manager.token })).status, 204)
    assert.equal((await call('GET', `/expenses/${tmp.body.id}`, { token: manager.token })).status, 404)
    assert.equal((await call('DELETE', `/expenses/${tmp.body.id}`, { token: manager.token })).status, 404)
    const log = (await call('GET', '/audit-log?limit=200', { token: admin.token })).body.items.map((x: { action: string }) => x.action)
    for (const a of ['expense.create', 'expense.update', 'expense.delete', 'expense.attach', 'expense.detach', 'expenseCategory.create', 'expenseCategory.update', 'expenseCategory.archive', 'expenseCategory.delete'])
      assert.ok(log.includes(a), `missing ${a}`)
  })
})

describe('reports', () => {
  test('set up bills: paid, part-paid, cancelled and returned', async () => {
    // A: 2 × 100 + 5% = 210, paid in cash
    const a = await call('POST', '/bills', { token: cashier.token, body: bill(100, 2, 210) })
    assert.equal(a.status, 201, JSON.stringify(a.body))
    // B: 1000 + 5% = 1050 on credit to a saved customer, then 500 by UPI → 550 due
    const b = await call('POST', '/bills', { token: cashier.token, body: bill(1000, 1, 0, { customer: { name: 'Ravi Kumar', phone: '98765 43210' }, saveCustomer: true }) })
    assert.equal(b.status, 201, JSON.stringify(b.body))
    ids.billB = b.body.id
    assert.equal((await call('POST', `/bills/${ids.billB}/payments`, { token: cashier.token, body: { amount: 500, method: 'UPI' } })).status, 201)
    // C: 400 + 5% = 420 paid, then cancelled → 420 refunded; left out of sales
    const c = await call('POST', '/bills', { token: cashier.token, body: bill(400, 1, 420) })
    assert.equal((await call('POST', `/bills/${c.body.id}/cancel`, { token: manager.token, body: { reason: 'Wrong bill', refundMethod: 'Cash' } })).status, 200)
    // D: 4 × 100 + 5% = 420 paid; 1 returned → 105 credited and refunded
    const d = await call('POST', '/bills', { token: cashier.token, body: bill(100, 4, 420) })
    const ret = await call('POST', `/bills/${d.body.id}/returns`, { token: manager.token, body: { items: [{ invoiceItemId: d.body.items[0].id, quantity: 1 }], refundMethod: 'Cash' } })
    assert.equal(ret.status, 201, JSON.stringify(ret.body))
    assert.equal(ret.body.returns[0].refund, 105)
  })

  test('summary: sales, collections, expenses and profit agree with the records', async () => {
    const r = await call('GET', `/reports/summary?${period}`, { token: manager.token })
    assert.equal(r.status, 200)
    const s = r.body
    // sales: A 210 + B 1050 + D 420 (C cancelled) − D's return 105
    assert.equal(s.sales.count, 3)
    assert.equal(s.sales.cancelled, 1)
    assert.equal(s.sales.grandTotal, 1680)
    assert.equal(s.sales.returns, 105)
    assert.equal(s.sales.net, 1575)
    assert.equal(s.sales.gst, 80)
    assert.equal(s.sales.returnsGst, 5)
    assert.equal(s.sales.netGst, 75)
    assert.equal(s.sales.netTaxable, 1500)
    // money: in 210 + 500 + 420 + 420 = 1550; out 420 (C) + 105 (D) = 525; net 1025
    assert.deepEqual(s.collectionTotals, { received: 1550, refunded: 525, net: 1025, count: 6 })
    // …which is exactly what the bills say is paid now: A 210 + B 500 + D 315 (C 0)
    const paidNow = (await call('GET', `/reports/invoices?${period}`, { token: manager.token })).body.rows.reduce((t: number, x: { paid: number }) => t + x.paid, 0)
    assert.equal(paidNow, s.collectionTotals.net)
    // expenses today: rent 1000 + refreshments 300 (yesterday's courier is outside the period)
    assert.equal(s.expenseTotal, 1300)
    assert.equal(s.expenseCount, 2)
    // profit = net sales 1575 − GST 75 = 1500 without GST, − 1300 expenses = 200
    assert.deepEqual(s.profit, { netSales: 1575, gstOnNetSales: 75, netSalesExGst: 1500, expenses: 1300, net: 200 })
    assert.deepEqual(s.outstanding, { total: 550, count: 1 })
    assert.deepEqual(s.daily, [{ date: TODAY, bills: 3, gross: 1680, discount: 0, returns: 105, gst: 75, sales: 1575, collected: 1025, expenses: 1300 }])
    // a two-day period adds yesterday's expense only
    const two = (await call('GET', `/reports/summary?from=${YESTERDAY}&to=${TODAY}`, { token: manager.token })).body
    assert.equal(two.expenseTotal, 1399.5)
    assert.equal(two.profit.net, 100.5)
    assert.equal(two.sales.net, 1575)
  })

  test('invoice report lists every bill, the cancelled one marked', async () => {
    const r = (await call('GET', `/reports/invoices?${period}`, { token: manager.token })).body
    assert.equal(r.rows.length, 4)
    assert.equal(r.truncated, false)
    const cancelled = r.rows.filter((x: { cancelled: boolean }) => x.cancelled)
    assert.equal(cancelled.length, 1)
    assert.equal(cancelled[0].status, 'Cancelled')
    assert.equal(cancelled[0].paid, 0)
    const live = r.rows.filter((x: { cancelled: boolean }) => !x.cancelled)
    assert.equal(live.reduce((t: number, x: { grandTotal: number }) => t + x.grandTotal, 0), 1680)
    assert.equal(live.reduce((t: number, x: { balance: number }) => t + x.balance, 0), 550)
    const b = r.rows.find((x: { id: string }) => x.id === ids.billB)
    assert.deepEqual([b.customer, b.status, b.paid, b.balance, b.items], ['Ravi Kumar', 'Partial', 500, 550, 1])
  })

  test('customer-wise sales', async () => {
    const r = (await call('GET', `/reports/customers?${period}`, { token: manager.token })).body.rows
    assert.equal(r.length, 2)
    const ravi = r.find((x: { name: string }) => x.name === 'Ravi Kumar')
    assert.deepEqual([ravi.bills, ravi.gross, ravi.returns, ravi.net, ravi.paid, ravi.balance], [1, 1050, 0, 1050, 500, 550])
    assert.ok(ravi.customerId)
    const walkin = r.find((x: { name: string }) => x.name === 'Walk-in Customer')
    // A and D (C is cancelled)
    assert.deepEqual([walkin.bills, walkin.gross, walkin.returns, walkin.net, walkin.paid, walkin.balance], [2, 630, 105, 525, 525, 0])
  })

  test('payments and collections: refunds are negative entries, each counted once', async () => {
    const r = (await call('GET', `/reports/payments?${period}`, { token: manager.token })).body.rows
    assert.equal(r.length, 6)
    assert.equal(r.filter((p: { kind: string }) => p.kind === 'REFUND').length, 2)
    assert.equal(r.reduce((t: number, p: { amount: number }) => t + p.amount, 0), 1025)
    assert.equal(r.filter((p: { method: string }) => p.method === 'UPI').reduce((t: number, p: { amount: number }) => t + p.amount, 0), 500)
    assert.ok(r.every((p: { invoiceNo: string }) => /^INV-/.test(p.invoiceNo)))
  })

  test('outstanding balances with age', async () => {
    const r = (await call('GET', '/reports/outstanding', { token: manager.token })).body
    assert.equal(r.rows.length, 1)
    assert.deepEqual([r.rows[0].invoiceNo, r.rows[0].balance, r.rows[0].paid, r.rows[0].days], ['INV-002', 550, 500, 0])
  })

  test('periods are validated; an empty period gives zeros', async () => {
    assert.equal((await call('GET', `/reports/summary?from=${TODAY}&to=${YESTERDAY}`, { token: manager.token })).status, 400)
    assert.equal((await call('GET', '/reports/invoices?from=2024-13-99', { token: manager.token })).status, 400)
    assert.equal((await call('GET', '/expenses/summary?from=2025-02-30&to=2025-03-05', { token: manager.token })).status, 400)
    assert.equal((await call('GET', '/reports/payments?from=2000-01-01&to=2010-01-01', { token: manager.token })).status, 400) // > 3 years
    const empty = (await call('GET', '/reports/summary?from=2001-01-01&to=2001-01-31', { token: manager.token })).body
    assert.equal(empty.sales.net, 0)
    assert.equal(empty.profit.net, 0)
    assert.deepEqual(empty.daily, [])
    assert.deepEqual((await call('GET', '/reports/customers?from=2001-01-01&to=2001-01-31', { token: manager.token })).body.rows, [])
  })
})

describe('backup & restore with the new tables', () => {
  test('categories, expenses and receipt files round-trip', async () => {
    const backup = (await call('GET', '/backup', { token: admin.token })).body
    assert.ok(backup.tables.expenseCategory.length >= 10)
    assert.equal(backup.tables.expenseAttachment.length, 1)
    assert.equal(typeof backup.tables.expenseAttachment[0].data, 'string')
    const before = (await call('GET', '/expenses', { token: admin.token })).body
    assert.equal((await call('POST', '/restore', { token: admin.token, body: backup })).status, 200)
    const after = (await call('GET', '/expenses', { token: admin.token })).body
    assert.deepEqual(after, before)
    const res = await fetch(`${BASE}/api/expenses/${ids.rentExp}/attachment`, { headers: { Authorization: `Bearer ${admin.token}` } })
    assert.match(new TextDecoder().decode(await res.arrayBuffer()), /^%PDF-1\.4/)
  })

  test('a backup made before categories and receipts existed still restores', async () => {
    const backup = (await call('GET', '/backup', { token: admin.token })).body
    delete backup.tables.expenseCategory
    delete backup.tables.expenseAttachment
    for (const e of backup.tables.expense) {
      delete e.categoryId
      delete e.title
    }
    const r = await call('POST', '/restore', { token: admin.token, body: backup })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const list = (await call('GET', '/expenses', { token: admin.token })).body
    assert.equal(list.total, 3)
    assert.equal(list.sum, 1399.5)
    // every expense is linked to a category of the same name
    for (const e of list.items) assert.ok(e.categoryId, e.category)
    const cats = (await call('GET', '/expense-categories', { token: admin.token })).body
    assert.ok(cats.some((c: { name: string }) => c.name === 'Refreshments'))
  })

  test('reset keeps the expense categories', async () => {
    assert.equal((await call('POST', '/reset', { token: admin.token, body: { confirm: 'RESET' } })).status, 200)
    assert.equal((await call('GET', '/expenses', { token: admin.token })).body.total, 0)
    assert.ok((await call('GET', '/expense-categories', { token: admin.token })).body.length >= 10)
  })
})
