import type { ErrorRequestHandler, RequestHandler } from 'express'
import { HttpError } from '../lib/errors.ts'
import { log } from '../lib/logger.ts'

export const apiNotFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'API route not found'))

const PRISMA_MESSAGES: Record<string, [number, string]> = {
  P2002: [409, 'This record conflicts with an existing one'],
  P2003: [409, 'This record is in use and cannot be removed'],
  P2025: [404, 'Record not found'],
  P2034: [409, 'Another change happened at the same time. Please try again.'],
}

/** One place that turns every error into `{ error, code?, fields? }` and never leaks internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large' })
    return
  }
  const prisma = typeof err?.code === 'string' ? PRISMA_MESSAGES[err.code] : undefined
  if (prisma) {
    res.status(prisma[0]).json({ error: prisma[1], code: err.code })
    return
  }
  log.error('unhandled error', { method: req.method, path: req.originalUrl, user: req.user?.username, err: err?.stack ?? String(err) })
  res.status(500).json({ error: 'Something went wrong on the server' })
}
