import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { DB_URL } from './helpers.ts'

/*
 * Upgrading a database that already holds a shop's data: builds a throw-away database at the schema before the
 * expenses module (the earlier migrations), fills it with customers, bills, payments, settings and expenses,
 * applies the new migration and checks that every existing row is exactly as it was.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrations = path.join(root, 'prisma', 'migrations')
const NEW = '20261111090000_expense_categories_attachments'
const sql = (name: string) => fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8')

const url = new URL(DB_URL)
const dbName = `${url.pathname.slice(1)}_migration_test`
const target = new URL(DB_URL)
target.pathname = `/${dbName}`
if (!/_test$/.test(dbName)) throw new Error('refusing to use a database whose name does not end in _test')

let db: pg.Client

async function admin(q: string) {
  const c = new pg.Client({ connectionString: DB_URL })
  await c.connect()
  await c.query(q)
  await c.end()
}

before(async () => {
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await admin(`CREATE DATABASE "${dbName}"`)
  db = new pg.Client({ connectionString: target.toString() })
  await db.connect()
})
after(async () => {
  await db?.end()
  await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
})

/** Contents of a table (chosen columns) as one comparable string */
async function contents(table: string, cols = '*') {
  const r = await db.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h, count(*)::int AS n FROM (SELECT ${cols} FROM "${table}") t`)
  return `${r.rows[0].n}:${r.rows[0].h}`
}

test('the new migration keeps every existing record and links old expenses to categories', async () => {
  const earlier = fs.readdirSync(migrations).filter((m) => /^\d+_/.test(m) && m < NEW).sort()
  assert.deepEqual(earlier, ['20261105113019_init', '20261105114542_integrity_checks'])
  for (const m of earlier) await db.query(sql(m))

  // an existing shop's data
  await db.query(`
    INSERT INTO "User" (id, username, name, "passwordHash", role, "updatedAt") VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 'Owner', 'x', 'ADMIN', now());
    INSERT INTO "CompanySettings" (id, "businessName", "updatedAt") VALUES (1, 'My Shop', now());
    INSERT INTO "Customer" (id, name, phone, "phoneDigits", "updatedAt") VALUES ('00000000-0000-0000-0000-0000000000c1', 'Ravi', '98765 43210', '9876543210', now());
    INSERT INTO "Invoice" (id, "invoiceNo", date, "dateKey", "customerId", "customerName", "discountType", "paymentMethod", subtotal, discount, taxable, gst, "grandTotal", "amountPaid", balance, status, "updatedAt")
      VALUES ('00000000-0000-0000-0000-0000000000a1', 'INV-001', now(), '2026-11-01', '00000000-0000-0000-0000-0000000000c1', 'Ravi', 'percent', 'Cash', 100, 0, 100, 5, 105, 50, 55, 'Partial', now());
    INSERT INTO "InvoiceItem" (id, "invoiceId", position, name, price, quantity, "gstRate") VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 0, 'Saree', 100, 1, 5);
    INSERT INTO "Payment" (id, "invoiceId", amount, method, date, "dateKey", "userId") VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 50, 'Cash', now(), '2026-11-01', '00000000-0000-0000-0000-000000000001');
    INSERT INTO "Expense" (id, date, "dateKey", category, description, amount, "paymentMethod", "userId", "createdAt", "updatedAt") VALUES
      ('00000000-0000-0000-0000-0000000000e1', now(), '2026-11-01', 'Transport', 'Lorry', 1500, 'Cash', '00000000-0000-0000-0000-000000000001', now() - interval '3 day', now()),
      ('00000000-0000-0000-0000-0000000000e2', now(), '2026-11-02', 'transport ', 'Auto', 80, 'UPI', null, now() - interval '2 day', now()),
      ('00000000-0000-0000-0000-0000000000e3', now(), '2026-11-03', 'Diwali bonus', 'Staff', 2000, 'Cash', null, now() - interval '1 day', now()),
      ('00000000-0000-0000-0000-0000000000e4', now(), '2026-11-03', 'Rent', '', 9000, 'Bank Transfer', null, now(), now());
  `)
  const tables = ['User', 'CompanySettings', 'TaxRate', 'Counter', 'Customer', 'Invoice', 'InvoiceItem', 'Payment', 'SalesReturn', 'Product', 'StockMovement', 'Purchase', 'Supplier', 'AuditLog']
  const before: Record<string, string> = {}
  for (const t of tables) before[t] = await contents(t)
  const expenseCols = 'id, date, "dateKey", category, description, amount, "paymentMethod", reference, "clientRequestId", "userId", "createdAt", "updatedAt"'
  const expensesBefore = await contents('Expense', expenseCols)

  await db.query(sql(NEW))

  for (const t of tables) assert.equal(await contents(t), before[t], `${t} changed`)
  assert.equal(await contents('Expense', expenseCols), expensesBefore, 'existing expense values changed')

  const cats = (await db.query(`SELECT name FROM "ExpenseCategory" ORDER BY name`)).rows.map((r) => r.name)
  // one Transport (two spellings were used), the custom one, and the standard list
  assert.equal(cats.filter((c: string) => c.toLowerCase() === 'transport').length, 1)
  for (const c of ['Diwali bonus', 'Rent', 'Electricity', 'Salary', 'Other']) assert.ok(cats.includes(c), c)
  const unlinked = await db.query(`SELECT count(*)::int AS n FROM "Expense" WHERE "categoryId" IS NULL`)
  assert.equal(unlinked.rows[0].n, 0)
  const linked = await db.query(`SELECT e.category, c.name FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId" WHERE e.id = '00000000-0000-0000-0000-0000000000e2'`)
  assert.deepEqual(linked.rows[0], { category: 'transport ', name: 'Transport' })
  const titles = await db.query(`SELECT DISTINCT title FROM "Expense"`)
  assert.deepEqual(titles.rows, [{ title: '' }])

  // the database's own rules
  await assert.rejects(db.query(`INSERT INTO "ExpenseCategory" (id, name, "updatedAt") VALUES (gen_random_uuid(), 'RENT', now())`), /ExpenseCategory_name_lower_key/)
  await assert.rejects(db.query(`INSERT INTO "ExpenseAttachment" (id, "expenseId", "fileName", "mimeType", size, data) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'a', 'image/png', 0, '')`), /ExpenseAttachment_size/)
  // deleting a category keeps its expenses (they lose only the link)
  await db.query(`DELETE FROM "ExpenseCategory" WHERE name = 'Diwali bonus'`)
  assert.equal((await db.query(`SELECT category FROM "Expense" WHERE id = '00000000-0000-0000-0000-0000000000e3'`)).rows[0].category, 'Diwali bonus')
})
