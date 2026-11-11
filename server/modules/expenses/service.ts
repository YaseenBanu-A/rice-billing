import { PAY_METHODS } from '../../../shared/billing.ts'
import type { Expense, ExpenseCategory, ExpenseInput, ExpensePage, ExpenseSummary, PayMethod } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import { dateKeyWhere } from '../../lib/http.ts'
import { n, opt, round2, toDateKey } from '../../lib/num.ts'
import { asObject, fail, isoDate, notFuture, number, requestKey, text } from '../../lib/validate.ts'

/* ---------- reading ---------- */

const include = {
  user: { select: { name: true } },
  attachment: { select: { fileName: true, mimeType: true, size: true } },
} satisfies Prisma.ExpenseInclude

type Row = Prisma.ExpenseGetPayload<{ include: typeof include }>

const toExpense = (r: Row): Expense => ({
  id: r.id,
  date: r.date.toISOString(),
  dateKey: r.dateKey,
  title: r.title,
  categoryId: opt(r.categoryId),
  category: r.category,
  description: r.description,
  amount: n(r.amount),
  paymentMethod: r.paymentMethod as PayMethod,
  reference: opt(r.reference),
  attachment: r.attachment ? { fileName: r.attachment.fileName, mimeType: r.attachment.mimeType, size: r.attachment.size } : undefined,
  userName: r.user?.name,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

/** Largest amount a single expense may have (keeps typos like an extra zero ×1000 out, and fits the column) */
const MAX_AMOUNT = 1_000_000_000

export function validateExpense(raw: unknown): ExpenseInput {
  const b = asObject(raw)
  const date = isoDate(b.date)
  const e: ExpenseInput = {
    date: date.toISOString(),
    title: text(b.title, 120),
    categoryId: text(b.categoryId, 64) || undefined,
    category: text(b.category, 60),
    description: text(b.description, 1000),
    amount: number(b.amount),
    paymentMethod: (b.paymentMethod ?? 'Cash') as PayMethod,
    reference: text(b.reference, 100) || undefined,
    clientRequestId: requestKey(b.clientRequestId),
  }
  fail({
    category: !e.category && !e.categoryId ? 'Choose a category' : '',
    categoryId: e.categoryId && !/^[0-9a-f-]{36}$/i.test(e.categoryId) ? 'Choose a category' : '',
    amount: Number.isNaN(e.amount) || e.amount <= 0 ? 'Enter an amount greater than zero' : e.amount > MAX_AMOUNT ? 'Amount is too large' : '',
    paymentMethod: !PAY_METHODS.includes(e.paymentMethod as never) ? 'Invalid payment method' : '',
  })
  notFuture(date)
  return { ...e, amount: round2(e.amount) }
}

export interface ExpenseFilters {
  q?: string
  category?: string
  categoryId?: string
  method?: string
  from?: string
  to?: string
  limit: number
  offset: number
}

function whereOf(f: Omit<ExpenseFilters, 'limit' | 'offset'>): Prisma.ExpenseWhereInput {
  const term = f.q?.trim()
  const range = dateKeyWhere(f.from, f.to)
  return {
    ...(term
      ? {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { reference: { contains: term, mode: 'insensitive' } },
            { category: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.method ? { paymentMethod: f.method } : {}),
    ...(range ? { dateKey: range } : {}),
  }
}

export async function listExpenses(f: ExpenseFilters): Promise<ExpensePage> {
  const where = whereOf(f)
  const [rows, total, agg] = await Promise.all([
    prisma.expense.findMany({ where, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ])
  return { items: rows.map(toExpense), total, sum: round2(n(agg._sum.amount)) }
}

export async function getExpense(id: string): Promise<Expense> {
  const r = await prisma.expense.findUnique({ where: { id }, include })
  if (!r) throw notFound('Expense')
  return toExpense(r)
}

/**
 * Totals for today, this month and a period (inclusive, shop time zone). Every expense row is counted once:
 * the figures are plain sums of the Expense table, grouped by its own date.
 */
export async function expenseSummary(from: string, to: string): Promise<ExpenseSummary> {
  const today = toDateKey(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const [todayAgg, monthAgg, rows] = await Promise.all([
    prisma.expense.aggregate({ where: { dateKey: today }, _sum: { amount: true }, _count: true }),
    prisma.expense.aggregate({ where: { dateKey: { gte: monthStart, lte: today } }, _sum: { amount: true }, _count: true }),
    prisma.expense.findMany({ where: { dateKey: { gte: from, lte: to } }, select: { amount: true, category: true, paymentMethod: true, dateKey: true } }),
  ])
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { total: number; count: number }>()
    for (const r of rows) {
      const e = m.get(key(r)) ?? { total: 0, count: 0 }
      e.total += n(r.amount)
      e.count++
      m.set(key(r), e)
    }
    return m
  }
  const total = rows.reduce((s, r) => s + n(r.amount), 0)
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  return {
    from,
    to,
    today: { total: round2(n(todayAgg._sum.amount)), count: todayAgg._count },
    month: { total: round2(n(monthAgg._sum.amount)), count: monthAgg._count },
    period: { total: round2(total), count: rows.length, average: round2(days > 0 ? total / days : 0) },
    byCategory: [...group((r) => r.category)].map(([category, v]) => ({ category, total: round2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    byMethod: [...group((r) => r.paymentMethod)].map(([method, v]) => ({ method, total: round2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    daily: [...group((r) => r.dateKey)].map(([date, v]) => ({ date, total: round2(v.total), count: v.count })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/* ---------- create / edit / delete ---------- */

/**
 * Finds the category for an expense: by id, or by name ignoring case. A name that doesn't exist yet becomes a
 * new category (the API has always accepted free-text categories). Archived categories can't be used for new
 * entries, but an expense that is already filed under one may keep it.
 */
async function resolveCategory(tx: Tx, e: ExpenseInput, actor: Actor, keepId?: string | null): Promise<{ id: string; name: string }> {
  if (e.categoryId) {
    const c = await tx.expenseCategory.findUnique({ where: { id: e.categoryId } })
    if (!c) throw badRequest('Choose a category', { categoryId: 'This category no longer exists' })
    if (!c.active && c.id !== keepId) throw badRequest('This category is archived', { categoryId: 'This category is archived' })
    return c
  }
  const found = await tx.expenseCategory.findFirst({ where: { name: { equals: e.category, mode: 'insensitive' } } })
  if (found) {
    if (!found.active && found.id !== keepId) throw badRequest('This category is archived', { category: 'This category is archived' })
    return found
  }
  const c = await tx.expenseCategory.create({ data: { name: e.category } })
  await audit(tx, actor, 'expenseCategory.create', 'expenseCategory', c.id, { name: c.name })
  return c
}

const dataOf = (e: ExpenseInput, cat: { id: string; name: string }) => {
  const date = new Date(e.date)
  return {
    date,
    dateKey: toDateKey(date),
    title: e.title ?? '',
    categoryId: cat.id,
    category: cat.name,
    description: e.description,
    amount: e.amount,
    paymentMethod: e.paymentMethod,
    reference: e.reference ?? null,
  }
}

export async function createExpense(e: ExpenseInput, actor: Actor): Promise<{ expense: Expense; created: boolean }> {
  return transaction(async (tx) => {
    if (e.clientRequestId) {
      const dup = await tx.expense.findUnique({ where: { clientRequestId: e.clientRequestId }, include })
      if (dup) return { expense: toExpense(dup), created: false }
    }
    const cat = await resolveCategory(tx, e, actor)
    const r = await tx.expense.create({ data: { ...dataOf(e, cat), clientRequestId: e.clientRequestId ?? null, userId: actor.id }, include })
    await audit(tx, actor, 'expense.create', 'expense', r.id, { title: r.title, category: r.category, amount: e.amount, date: r.dateKey })
    return { expense: toExpense(r), created: true }
  })
}

export async function updateExpense(id: string, e: ExpenseInput, actor: Actor) {
  return transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } })
    if (!old) throw notFound('Expense')
    const cat = await resolveCategory(tx, e, actor, old.categoryId)
    const r = await tx.expense.update({ where: { id }, data: dataOf(e, cat), include })
    await audit(tx, actor, 'expense.update', 'expense', id, {
      title: r.title,
      category: old.category === r.category ? r.category : { from: old.category, to: r.category },
      amount: { from: n(old.amount), to: e.amount },
      date: old.dateKey === r.dateKey ? r.dateKey : { from: old.dateKey, to: r.dateKey },
    })
    return toExpense(r)
  })
}

export async function deleteExpense(id: string, actor: Actor) {
  await transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id }, include: { attachment: { select: { fileName: true } } } })
    if (!old) throw notFound('Expense')
    // the receipt (if any) goes with it (ON DELETE CASCADE)
    await tx.expense.delete({ where: { id } })
    await audit(tx, actor, 'expense.delete', 'expense', id, {
      title: old.title,
      category: old.category,
      amount: n(old.amount),
      date: old.dateKey,
      description: old.description,
      receipt: old.attachment?.fileName,
    })
  })
}

/* ---------- categories ---------- */

/** Active category names (kept for the original `/expenses/categories` endpoint) */
export async function expenseCategoryNames(): Promise<string[]> {
  const rows = await prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { name: true } })
  return rows.map((r) => r.name)
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const [cats, usage] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.expense.groupBy({ by: ['categoryId'], _count: true, _sum: { amount: true } }),
  ])
  const used = new Map(usage.map((u) => [u.categoryId, u]))
  return cats.map((c) => ({ id: c.id, name: c.name, active: c.active, expenseCount: used.get(c.id)?._count ?? 0, total: round2(n(used.get(c.id)?._sum.amount)) }))
}

export function validateCategory(raw: unknown): { name: string; active: boolean } {
  const b = asObject(raw)
  const name = text(b.name, 60).replace(/\s+/g, ' ')
  fail({ name: !name ? 'Enter a category name' : '' })
  return { name, active: b.active === undefined ? true : b.active === true }
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const clash = await tx.expenseCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  if (clash) throw conflict(`A category named "${clash.name}" already exists`)
}

export async function createExpenseCategory(input: { name: string }, actor: Actor) {
  return transaction(async (tx) => {
    await assertNameFree(tx, input.name)
    const c = await tx.expenseCategory.create({ data: { name: input.name } })
    await audit(tx, actor, 'expenseCategory.create', 'expenseCategory', c.id, { name: c.name })
    return c
  })
}

/** Renames (expenses filed under it show the new name) and archives / restores a category. */
export async function updateExpenseCategory(id: string, input: { name: string; active: boolean }, actor: Actor) {
  return transaction(async (tx) => {
    const old = await tx.expenseCategory.findUnique({ where: { id } })
    if (!old) throw notFound('Category')
    await assertNameFree(tx, input.name, id)
    const c = await tx.expenseCategory.update({ where: { id }, data: { name: input.name, active: input.active } })
    let renamed = 0
    if (old.name !== c.name) renamed = (await tx.expense.updateMany({ where: { categoryId: id }, data: { category: c.name } })).count
    await audit(tx, actor, 'expenseCategory.update', 'expenseCategory', id, {
      name: old.name === c.name ? c.name : { from: old.name, to: c.name },
      active: old.active === c.active ? c.active : { from: old.active, to: c.active },
      expensesRenamed: renamed,
    })
    return c
  })
}

/** Deletes an unused category; one that expenses use is archived instead (they keep its name). */
export async function deleteExpenseCategory(id: string, actor: Actor): Promise<{ archived: boolean }> {
  return transaction(async (tx) => {
    const c = await tx.expenseCategory.findUnique({ where: { id } })
    if (!c) throw notFound('Category')
    const used = await tx.expense.count({ where: { categoryId: id } })
    if (used > 0) {
      await tx.expenseCategory.update({ where: { id }, data: { active: false } })
      await audit(tx, actor, 'expenseCategory.archive', 'expenseCategory', id, { name: c.name, expenses: used })
      return { archived: true }
    }
    await tx.expenseCategory.delete({ where: { id } })
    await audit(tx, actor, 'expenseCategory.delete', 'expenseCategory', id, { name: c.name })
    return { archived: false }
  })
}

/**
 * After restoring an older backup (made before categories existed): creates a category for every name the
 * expenses use and links them. Never changes an expense's own category text or amount.
 */
export async function linkExpenseCategories(tx: Tx) {
  const rows = await tx.expense.findMany({ where: { categoryId: null }, select: { id: true, category: true } })
  for (const r of rows) {
    const name = r.category.trim() || 'Other'
    const cat = (await tx.expenseCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) ?? (await tx.expenseCategory.create({ data: { name } }))
    await tx.expense.update({ where: { id: r.id }, data: { categoryId: cat.id } })
  }
}

/* ---------- receipt / bill attachment ---------- */

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

/** Checks the file really is what its type says (first bytes), so nothing else can be stored or served. */
function sniff(data: Buffer): (typeof ATTACHMENT_TYPES)[number] | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

const safeName = (name: string, mime: string) => {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[mime] ?? ''
  // strips characters not allowed in file names, control characters included (on purpose)
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'receipt'
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : base + ext
}

export async function saveAttachment(expenseId: string, file: { data: unknown; mimeType: string; fileName: string }, actor: Actor) {
  if (!Buffer.isBuffer(file.data) || file.data.length === 0) throw badRequest('Choose a photo or PDF of the receipt')
  if (file.data.length > MAX_ATTACHMENT_BYTES) throw badRequest('The receipt file is too large (2 MB at most)')
  const type = sniff(file.data)
  if (!type || type !== file.mimeType.split(';')[0].trim().toLowerCase()) throw badRequest('Only JPG, PNG or WebP photos and PDF files can be attached')
  const data = file.data
  return transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: expenseId }, select: { id: true } })
    if (!e) throw notFound('Expense')
    const fileName = safeName(file.fileName, type)
    const row = { fileName, mimeType: type, size: data.length, data: new Uint8Array(data) }
    await tx.expenseAttachment.upsert({ where: { expenseId }, create: { expenseId, ...row }, update: { ...row, createdAt: new Date() } })
    await audit(tx, actor, 'expense.attach', 'expense', expenseId, { fileName, size: data.length })
    return { fileName, mimeType: type, size: data.length }
  })
}

export async function getAttachment(expenseId: string) {
  const a = await prisma.expenseAttachment.findUnique({ where: { expenseId } })
  if (!a) throw notFound('Receipt')
  return a
}

export async function deleteAttachment(expenseId: string, actor: Actor) {
  await transaction(async (tx) => {
    const a = await tx.expenseAttachment.findUnique({ where: { expenseId }, select: { fileName: true } })
    if (!a) throw notFound('Receipt')
    await tx.expenseAttachment.delete({ where: { expenseId } })
    await audit(tx, actor, 'expense.detach', 'expense', expenseId, { fileName: a.fileName })
  })
}
