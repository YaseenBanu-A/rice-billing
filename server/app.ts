import express, { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'
import { prisma } from './db.ts'
import { authenticate } from './middleware/auth.ts'
import { apiNotFound, errorHandler } from './middleware/errors.ts'
import { requestLog } from './middleware/requestLog.ts'
import { apiLimiter, corsPolicy, requireAppHeader, securityHeaders } from './middleware/security.ts'
import { adminRoutes } from './modules/admin/routes.ts'
import { attributionToken } from './modules/auth/attribution.ts'
import { authRoutes } from './modules/auth/routes.ts'
import { customerRoutes } from './modules/customers/routes.ts'
import { expenseRoutes } from './modules/expenses/routes.ts'
import { inventoryRoutes } from './modules/inventory/routes.ts'
import { invoiceRoutes } from './modules/invoices/routes.ts'
import { productRoutes } from './modules/products/routes.ts'
import { purchaseRoutes } from './modules/purchases/routes.ts'
import { reportRoutes } from './modules/reports/routes.ts'
import { settingsRoutes } from './modules/settings/routes.ts'
import { supplierRoutes } from './modules/suppliers/routes.ts'
import { userRoutes } from './modules/users/routes.ts'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // behind Render's proxy: real client IP + https detection
  app.use(securityHeaders)

  const api = Router()
  // API answers hold business data: never stored by the browser, the service worker or any proxy
  api.use((_req, res, next) => (res.setHeader('Cache-Control', 'no-store'), next()))
  api.use(corsPolicy)
  api.use(requestLog)
  api.use(apiLimiter)
  // restore has its own, larger limit (see modules/admin/routes.ts)
  const json = express.json({ limit: '2mb' })
  api.use((req, res, next) => (req.path === '/restore' ? next() : json(req, res, next)))
  api.use(requireAppHeader)

  api.get('/health', async (_req, res) => {
    // also proves the database is reachable (used by Render's health check)
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, time: new Date().toISOString() })
  })
  api.use('/auth', authRoutes)

  // everything below requires a signed-in user; each route checks its own permission
  api.use(authenticate)
  api.get('/offline-attribution', attributionToken)
  for (const routes of [adminRoutes, settingsRoutes, userRoutes, customerRoutes, supplierRoutes, productRoutes, inventoryRoutes, invoiceRoutes, purchaseRoutes, expenseRoutes, reportRoutes])
    api.use(routes)
  api.use(apiNotFound)
  app.use('/api', api)

  /* ---------- built frontend (same origin as the API) ---------- */
  if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    // hashed assets can be cached for a long time; index.html must always be fresh
    app.use('/assets', express.static(path.join(config.staticDir, 'assets'), { immutable: true, maxAge: '365d' }))
    // the service worker and app manifest must always be checked for a new version (offline app updates)
    const alwaysFresh = new Set(['sw.js', 'manifest.webmanifest'])
    app.use(
      express.static(config.staticDir, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (alwaysFresh.has(path.basename(file))) res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(config.staticDir, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
