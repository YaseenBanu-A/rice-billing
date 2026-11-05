import type { Request, Response } from 'express'
import { prisma } from '../../db.ts'
import { actorOf } from '../../lib/audit.ts'
import { paging, param, qs } from '../../lib/http.ts'
import { disconnectUser } from '../../realtime.ts'
import * as s from './service.ts'

export async function list(_req: Request, res: Response) {
  res.json(await s.listUsers())
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await s.createUser(req.body, actorOf(req)))
}

export async function update(req: Request, res: Response) {
  const { user, signedOut } = await s.updateUser(param(req, 'id'), req.body, actorOf(req))
  if (signedOut) await disconnectUser(user.id)
  res.json(user)
}

/** Recent activity: who created, changed, cancelled or deleted what */
export async function auditLog(req: Request, res: Response) {
  const { limit, offset } = paging(req, 100)
  const entity = qs(req, 'entity')
  const where = entity ? { entity } : {}
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
  ])
  res.json({
    total,
    items: rows.map((r) => ({ id: String(r.id), action: r.action, entity: r.entity, entityId: r.entityId, details: r.details, ip: r.ip, userName: r.user?.name, createdAt: r.createdAt.toISOString() })),
  })
}
