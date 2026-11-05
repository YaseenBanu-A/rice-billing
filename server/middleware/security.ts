import cors from 'cors'
import type { RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { config } from '../config.ts'
import { HttpError } from '../lib/errors.ts'

export const CSRF_HEADER_VALUE = 'ajrice'

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'self' plus the one small inline script in index.html (applies the saved theme before first paint)
      scriptSrc: ["'self'", "'sha256-swdt40IgCmOrEWu5r2eJac2qm66haikL+hoPNnSFZao='"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", ...config.corsOrigins],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.secureCookies ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
})

/** Same-origin by default. Extra origins only if the frontend is hosted elsewhere (CORS_ORIGINS). */
export const corsPolicy = cors({
  origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  maxAge: 600,
})

/**
 * Changes must carry the app's own header. Browsers can't add custom headers to cross-site form posts,
 * so the refresh cookie can't be used by another site (defence in depth on top of SameSite=Strict).
 */
export const requireAppHeader: RequestHandler = (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.get('X-Requested-With') !== CSRF_HEADER_VALUE) {
    return next(new HttpError(403, 'Request blocked', undefined, 'csrf'))
  }
  next()
}

const limited = (message: string) => (_req: unknown, _res: unknown, next: (e: Error) => void) => next(new HttpError(429, message, undefined, 'rate_limited'))

/** 10 wrong sign-ins per 15 minutes per address; successful ones don't count. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: limited('Too many sign-in attempts. Try again in a few minutes.'),
})

export const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: limited('Too many requests. Please slow down.'),
})

/** General ceiling for the whole API, generous enough for several busy counters behind one shop IP. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.API_RATE_LIMIT ?? 1200),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: limited('Too many requests. Please slow down.'),
})
