import type { Request, Response } from 'express'
import { config } from '../../config.ts'
import { text } from '../../lib/validate.ts'
import * as auth from './service.ts'
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './tokens.ts'

function respond(res: Response, s: auth.Session) {
  if (s.refreshToken) setRefreshCookie(res, s.refreshToken, config.refreshTtlDays * 86_400)
  res.json({ accessToken: s.accessToken, expiresIn: config.accessTtlSec, user: s.user })
}

export async function login(req: Request, res: Response) {
  respond(res, await auth.login(text(req.body?.username, 60), typeof req.body?.password === 'string' ? req.body.password : '', req))
}

export async function refresh(req: Request, res: Response) {
  try {
    respond(res, await auth.refresh(readRefreshCookie(req), req))
  } catch (err) {
    clearRefreshCookie(res)
    throw err
  }
}

export async function logout(req: Request, res: Response) {
  await auth.logout(readRefreshCookie(req))
  clearRefreshCookie(res)
  res.json({ ok: true })
}

export async function me(req: Request, res: Response) {
  res.json({ user: req.user })
}

export async function changePassword(req: Request, res: Response) {
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  respond(res, await auth.changePassword(req.user!.id, current, next, readRefreshCookie(req), req))
}
