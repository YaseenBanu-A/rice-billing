import type { RequestHandler } from 'express'
import { config } from '../config.ts'
import { log } from '../lib/logger.ts'

/** method, path, status, duration and user for every API call */
export const requestLog: RequestHandler = (req, res, next) => {
  if (!config.logRequests) return next()
  const start = performance.now()
  res.on('finish', () => {
    const data = { status: res.statusCode, ms: Math.round(performance.now() - start), user: req.user?.username, ip: req.ip }
    const line = `${req.method} ${req.originalUrl.split('?')[0]}`
    if (res.statusCode >= 500) log.error(line, data)
    else if (res.statusCode >= 400) log.warn(line, data)
    else log.info(line, data)
  })
  next()
}
