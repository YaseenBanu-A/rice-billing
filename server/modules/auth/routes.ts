import { Router } from 'express'
import { authenticate } from '../../middleware/auth.ts'
import { loginLimiter, sensitiveLimiter } from '../../middleware/security.ts'
import * as c from './controller.ts'

export const authRoutes = Router()
  .post('/login', loginLimiter, c.login)
  .post('/refresh', sensitiveLimiter, c.refresh)
  .post('/logout', c.logout)
  .get('/me', authenticate, c.me)
  .post('/password', sensitiveLimiter, authenticate, c.changePassword)
