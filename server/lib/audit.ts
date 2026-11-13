import type { Request } from 'express'
import { prisma, type Tx } from '../db.ts'
import { log } from './logger.ts'

export interface Actor {
  id: string
  name: string
  ip?: string
  /** an offline change sent by someone other than its (verified) creator: who sent it */
  syncedBy?: { id: string; name: string }
}

export const actorOf = (req: Request): Actor => ({ id: req.user!.id, name: req.user!.name, ip: req.ip })

/** Records who did what. Inside a transaction it commits (or rolls back) together with the change. */
export async function audit(db: Tx, actor: Actor | null, action: string, entity: string, entityId?: string, details?: Record<string, unknown>) {
  await db.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      action,
      entity,
      entityId: entityId ?? null,
      details: details || actor?.syncedBy ? (JSON.parse(JSON.stringify({ ...details, ...(actor?.syncedBy ? { syncedBy: actor.syncedBy } : {}) })) as object) : undefined,
      ip: actor?.ip ?? null,
    },
  })
}

/** Fire-and-forget audit for events outside a transaction (e.g. sign-in). */
export function auditLater(actor: Actor | null, action: string, entity: string, entityId?: string, details?: Record<string, unknown>) {
  audit(prisma, actor, action, entity, entityId, details).catch((err) => log.error('audit write failed', { err: String(err) }))
}
