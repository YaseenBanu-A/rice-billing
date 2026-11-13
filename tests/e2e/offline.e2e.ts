/*
 * Offline app, end to end, in real Chrome against the real server and the throw-away `_test` database.
 *
 *   npm run build && npm run test:e2e
 *
 * Needs the local database (`npm run db:local`) and Google Chrome (or set CHROME_PATH). Each test uses its own
 * browser profile on disk, so "closing the browser" and "starting it again" are real restarts.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { ADMIN, BASE, call, login, resetDatabase, startServer, stopServer, uuid } from '../helpers.ts'

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
  (p) => p && fs.existsSync(p),
)
const skip = !CHROME ? 'Chrome not found (set CHROME_PATH)' : !fs.existsSync('dist/sw.js') ? 'run `npm run build` first' : false

let admin = { token: '', cookie: '' }
const ids: Record<string, string> = {}
const CASHIER = { username: 'e2ecash', password: 'Password-123', name: 'E2E Cashier' }

before(async () => {
  if (skip) return
  await resetDatabase()
  await startServer()
  admin = await login(ADMIN.username, ADMIN.password)
  await call('POST', '/users', { token: admin.token, body: { username: CASHIER.username, name: CASHIER.name, role: 'CASHIER', password: CASHIER.password } })
  ids.product = (await call('POST', '/products', { token: admin.token, body: { name: 'E2E Rice', unit: 'Kg', price: 50, gstRate: 5, openingStock: 1000 } })).body.id
})
after(async () => {
  if (!skip) await stopServer()
})

/* ---------- helpers ---------- */

const bills = async () => (await call('GET', '/bills?limit=200', { token: admin.token })).body as { total: number; items: { id: string; customer: { name: string }; createdByName: string; invoiceNo: string }[] }
const billsFor = async (customer: string) => (await bills()).items.filter((b) => b.customer.name === customer)
const stock = async (id = ids.product) => (await call('GET', `/products/${id}`, { token: admin.token })).body.stock as number

interface Browser {
  ctx: BrowserContext
  page: Page
  restart: (opts?: { offline?: boolean }) => Promise<void>
  close: () => Promise<void>
}

async function openBrowser(): Promise<Browser> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ajrice-e2e-'))
  const b = {} as Browser
  const launch = async (offline = false) => {
    b.ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, offline, viewport: { width: 1360, height: 860 } })
    await b.ctx.addInitScript(() => {
      window.print = () => {}
      window.confirm = () => true
    })
    b.page = b.ctx.pages()[0] ?? (await b.ctx.newPage())
  }
  await launch()
  b.restart = async ({ offline = false } = {}) => {
    await b.ctx.close()
    await launch(offline)
    await b.page.goto(BASE)
  }
  b.close = async () => {
    await b.ctx.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true })
  }
  return b
}

const signIn = async (page: Page, username: string, password: string) => {
  await page.fill('#username', username)
  await page.fill('#password', password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=Connected to server', { timeout: 30000 })
}
const signOut = async (page: Page) => {
  await page.locator('button:visible', { hasText: 'Log out' }).first().click()
  await page.waitForSelector('text=Sign in to billing')
}
const goOffline = async (b: Browser) => {
  await b.ctx.setOffline(true)
  await b.page.reload()
  await b.page.waitForSelector("text=You're offline.", { timeout: 20000 })
}
/** The service worker is installed and in control, and the device has its copy of the data */
const readyForOffline = async (page: Page) => {
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForSelector('text=Connected to server', { timeout: 30000 })
}
/** A new bill for `customer` with `qty` kg, saved with Ctrl+S */
const makeBill = async (page: Page, customer: string, qty = 1) => {
  await page.locator('button:visible', { hasText: 'New Bill' }).first().click()
  await page.fill('[aria-label="Search product"]', 'E2E Rice')
  await page.press('[aria-label="Search product"]', 'Enter')
  await page.fill('[aria-label="Quantity of E2E Rice"]', String(qty))
  await page.fill('#cust-name', customer)
  await page.keyboard.press('Control+s')
}
/**
 * Waits for the confirmation that a change was saved on the device. Matched exactly: Playwright's `text=` is a
 * case-insensitive substring match, and the offline banner also says "saved on this device".
 */
const savedOffline = (page: Page, timeout = 15000) =>
  page.getByRole('status').filter({ hasText: 'Saved on this device. It will sync when the connection is back.' }).first().waitFor({ timeout })
const outbox = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ seq: number; kind: string; status: string; userName: string; errorCode?: string; attribution?: string }[]>((resolve) => {
        const r = indexedDB.open('ajrice-billing')
        r.onsuccess = () => {
          const q = r.result.transaction('outbox').objectStore('outbox').getAll()
          q.onsuccess = () => (r.result.close(), resolve(q.result))
        }
      }),
  )
const waitFor = async (what: string, fn: () => Promise<boolean>, ms = 60000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for: ${what}`)
}

/* ---------- tests ---------- */

describe('offline app in the browser', { skip }, () => {
  test('the data copy is saved at once: the app opens offline right after signing in', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await b.page.evaluate(() => navigator.serviceWorker.ready)
      await b.page.reload()
      await b.page.waitForSelector('text=Connected to server')
      // no pause here: the copy must already be on the device
      await goOffline(b)
    } finally {
      await b.close()
    }
  })

  test('an offline bill survives a full browser restart and syncs exactly once', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      const before = await stock()
      await goOffline(b)
      await makeBill(b.page, 'Restart Customer', 3)
      await savedOffline(b.page)
      // closed the moment the save is confirmed: nothing else may run in between
      await b.restart({ offline: true })
      await b.page.waitForSelector("text=You're offline.", { timeout: 20000 })
      assert.equal((await outbox(b.page)).length, 1, 'still waiting after the restart')
      assert.equal((await billsFor('Restart Customer')).length, 0)
      await b.ctx.setOffline(false)
      await waitFor('sync', async () => (await outbox(b.page)).length === 0)
      assert.equal((await billsFor('Restart Customer')).length, 1)
      assert.equal(await stock(), before - 3)
    } finally {
      await b.close()
    }
  })

  test('signing out offline, restarting offline, then signing in online keeps the user signed in (and keeps waiting bills)', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      await goOffline(b)
      await makeBill(b.page, 'Signout Customer')
      await savedOffline(b.page)
      await signOut(b.page)
      assert.equal((await outbox(b.page)).length, 1, 'sign-out keeps the waiting bill')
      await b.restart({ offline: true })
      await b.page.waitForSelector('text=Sign in to billing')
      await b.ctx.setOffline(false)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await waitFor('sync', async () => (await outbox(b.page)).length === 0)
      assert.equal((await billsFor('Signout Customer')).length, 1)
      // an ordinary reload and a browser restart later: still signed in
      await b.page.reload()
      await b.page.waitForSelector('text=Connected to server', { timeout: 20000 })
      await b.restart()
      await b.page.waitForSelector('text=Connected to server', { timeout: 20000 })
    } finally {
      await b.close()
    }
  })

  test('a bill made offline by one user and synced while another is signed in stays credited to its maker', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      await goOffline(b)
      await makeBill(b.page, 'Attribution Customer')
      await savedOffline(b.page)
      assert.ok((await outbox(b.page))[0].attribution, 'proof of the maker stored with the bill')
      await signOut(b.page)
      await b.ctx.setOffline(false)
      await b.page.reload()
      await signIn(b.page, CASHIER.username, CASHIER.password)
      await waitFor('sync', async () => (await outbox(b.page)).length === 0)
      const [bill] = await billsFor('Attribution Customer')
      assert.ok(bill, 'synced')
      assert.equal(bill.createdByName, 'Administrator', 'not credited to the cashier who happened to be signed in')
    } finally {
      await b.close()
    }
  })

  test("without proof of its maker, another user's offline bill is held for review, not sent under the wrong name", async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      await goOffline(b)
      await makeBill(b.page, 'Review Customer')
      await savedOffline(b.page)
      // as if made by an older app version (no proof stored)
      await b.page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const r = indexedDB.open('ajrice-billing')
            r.onsuccess = () => {
              const tx = r.result.transaction('outbox', 'readwrite')
              const store = tx.objectStore('outbox')
              store.getAll().onsuccess = (e) => {
                for (const op of (e.target as IDBRequest).result) store.put({ ...op, attribution: undefined })
              }
              tx.oncomplete = () => (r.result.close(), resolve())
            }
          }),
      )
      await signOut(b.page)
      await b.ctx.setOffline(false)
      await b.page.reload()
      await signIn(b.page, CASHIER.username, CASHIER.password)
      await waitFor('held for review', async () => (await outbox(b.page))[0]?.status === 'review', 20000)
      assert.equal((await billsFor('Review Customer')).length, 0, 'not sent under the cashier')
      // its maker signs in again: it is sent as theirs
      await signOut(b.page)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await waitFor('sync', async () => (await outbox(b.page)).length === 0)
      assert.equal((await billsFor('Review Customer'))[0].createdByName, 'Administrator')
    } finally {
      await b.close()
    }
  })

  test('a save that times out while the server is slow (e.g. waking up) is kept, retried with the same key, and saved once', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      const before = await stock()
      // the first bill request reaches the server only after the app gave up waiting (25 s), like a cold start
      let held = 0
      await b.page.route('**/api/bills', async (route) => {
        if (route.request().method() !== 'POST' || held++) return route.continue()
        await new Promise((r) => setTimeout(r, 27_000))
        const res = await route.fetch() // the server does save it
        await route.fulfill({ response: res }).catch(() => {}) // but the app stopped waiting long ago
      })
      await makeBill(b.page, 'Slow Server Customer', 2)
      await savedOffline(b.page, 40000)
      await waitFor('sync', async () => (await outbox(b.page)).length === 0, 90000)
      await b.page.waitForTimeout(3000) // let the delayed first send finish too
      const saved = await billsFor('Slow Server Customer')
      assert.equal(saved.length, 1, 'one bill, not two')
      assert.equal(await stock(), before - 2, 'stock taken once')
    } finally {
      await b.close()
    }
  })

  test('the server going away mid-day: bills are kept and sent once it is back', async () => {
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      await stopServer()
      await makeBill(b.page, 'Server Down Customer')
      await savedOffline(b.page, 30000)
      await startServer()
      await waitFor('sync', async () => (await outbox(b.page)).length === 0, 90000)
      assert.equal((await billsFor('Server Down Customer')).length, 1)
    } finally {
      await b.close()
    }
  })

  test('a bill refused for lack of stock says which bill and why, and syncs after the stock is corrected', async () => {
    const low = (await call('POST', '/products', { token: admin.token, body: { name: 'E2E Scarce', unit: 'Kg', price: 80, gstRate: 5, openingStock: 1 } })).body
    const b = await openBrowser()
    try {
      await b.page.goto(BASE)
      await signIn(b.page, ADMIN.username, ADMIN.password)
      await readyForOffline(b.page)
      await goOffline(b)
      await b.page.locator('button:visible', { hasText: 'New Bill' }).first().click()
      await b.page.fill('[aria-label="Search product"]', 'E2E Scarce')
      await b.page.press('[aria-label="Search product"]', 'Enter')
      await b.page.fill('#cust-name', 'Stock Customer')
      await b.page.keyboard.press('Control+s')
      await savedOffline(b.page)
      // meanwhile the last kilo is sold at another counter
      const other = await call('POST', '/bills', {
        token: admin.token,
        body: { id: uuid(), customer: { name: 'Walk-in Customer', phone: '' }, items: [{ productId: low.id, name: 'E2E Scarce', sku: '', price: 80, quantity: 1, unit: 'Kg', gstRate: 5 }], discountType: 'percent', discountValue: 0, gstInclusive: false, paymentMethod: 'Cash', amountPaid: 0 },
      })
      assert.equal(other.status, 201)
      await b.ctx.setOffline(false)
      await waitFor('refused', async () => (await outbox(b.page))[0]?.errorCode === 'insufficient_stock', 30000)
      await b.page.waitForSelector('text=Not synced: Bill PENDING-')
      await b.page.locator('button:visible', { hasText: 'to review' }).click()
      await b.page.waitForSelector('text=Not enough stock to save this bill')
      await b.page.waitForSelector('text=Stock Customer')
      assert.ok(await b.page.isVisible('button:has-text("Open Inventory")'), 'authorised staff are offered the way to fix it')
      assert.equal(await stock(low.id), 0, 'nothing taken by the refused bill')
      // a manager corrects the stock, then the cashier tries again
      await call('POST', '/inventory/adjustments', { token: admin.token, body: { productId: low.id, mode: 'set', quantity: 5, note: 'Recount' } })
      await b.page.getByRole('button', { name: 'Try again' }).click()
      await waitFor('sync', async () => (await outbox(b.page)).length === 0)
      assert.equal((await billsFor('Stock Customer')).length, 1)
      assert.equal(await stock(low.id), 4)
    } finally {
      await b.close()
    }
  })
})
