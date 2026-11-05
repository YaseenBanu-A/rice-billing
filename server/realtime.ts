import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import type { ChangeEvent } from '../shared/types.ts'
import { config } from './config.ts'
import type { Actor } from './lib/audit.ts'
import { userFromToken } from './middleware/auth.ts'

/*
 * Live updates: every signed-in screen joins the "shop" room. After a change is committed the server
 * announces it ({ entity, action, id }) and screens showing that data reload it, so bills, payments and
 * stock stay in step across counters without refreshing the page. The data itself always comes from the
 * REST API, so a missed event can never leave a screen with wrong numbers for long (they reload on reconnect).
 */

let io: Server | null = null

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    serveClient: false,
    cors: config.corsOrigins.length ? { origin: config.corsOrigins, credentials: true } : undefined,
  })

  io.use(async (socket, next) => {
    const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined
    const user = await userFromToken(token).catch(() => null)
    if (user === 'expired') return next(new Error('token_expired'))
    if (!user) return next(new Error('unauthenticated'))
    socket.data.user = user
    // drop the connection when the access token runs out; the app reconnects with a fresh one
    const exp = (jwt.decode(token!) as jwt.JwtPayload | null)?.exp
    if (exp) {
      const timer = setTimeout(() => socket.disconnect(true), Math.max(exp * 1000 - Date.now(), 1000))
      socket.on('disconnect', () => clearTimeout(timer))
    }
    next()
  })

  io.on('connection', (socket) => {
    socket.join('shop')
    sendPresence()
    socket.on('disconnect', sendPresence)
  })
  return io
}

/** Names of users with the app open right now */
async function sendPresence() {
  if (!io) return
  const sockets = await io.in('shop').fetchSockets()
  const names = [...new Set(sockets.map((s) => (s.data.user as { name: string }).name))].sort()
  io.to('shop').emit('presence', names)
}

export function broadcast(ev: ChangeEvent, actor?: Actor) {
  io?.to('shop').emit('change', { ...ev, by: actor?.name, byUserId: actor?.id } satisfies ChangeEvent)
}

/** Signs a user's open screens out at once (deactivated, password reset). */
export async function disconnectUser(userId: string) {
  if (!io) return
  for (const s of await io.in('shop').fetchSockets()) if ((s.data.user as { id: string }).id === userId) s.disconnect(true)
}

export const closeRealtime = () => new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()))
