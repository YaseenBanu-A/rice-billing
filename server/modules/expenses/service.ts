import { EXPENSE_CATEGORIES, PAY_METHODS } from '../../../shared/billing.ts'
import type { Expense, ExpenseInput, Paged, PayMethod } from '../../../shared/types.ts'
import { prisma, transaction } from '../../db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { notFound } from '../../lib/errors.ts'
import { dateKeyWhere } from '../../lib/http.ts'
import { n, opt, round2, toDateKey } from '../../lib/num.ts'
import { asObject, fail, isoDate, notFuture, number, requestKey, text } from '../../lib/validate.ts'

type Row = Prisma.ExpenseGetPayload<{ include: { user: { select: { name: true } } } }>

const toExpense = (r: Row): Expense => ({
  id: r.id,
  date: r.date.toISOString(),
  category: r.category,
  description: r.description,
  amount: n(r.amount),
  paymentMethod: r.paymentMethod as PayMethod,
  reference: opt(r.reference),
  userName: r.user?.name,
  createdAt: r.createdAt.toISOString(),
})

export function validateExpense(raw: unknown): ExpenseInput {
  const b = asObject(raw)
  const date = isoDate(b.date)
  const e: ExpenseInput = {
    date: date.toISOString(),
    category: text(b.category, 60),
    description: text(b.description, 300),
    amount: number(b.amount),
    paymentMethod: (b.paymentMethod ?? 'Cash') as PayMethod,
    reference: text(b.reference, 100) || undefined,
    clientRequestId: requestKey(b.clientRequestId),
  }
  fail({
    category: !e.category ? 'Choose a category' : '',
    amount: Number.isNaN(e.amount) || e.amount <= 0 ? 'Enter an amount greater than zero' : '',
    paymentMethod: !PAY_METHODS.includes(e.paymentMethod as never) ? 'Invalid payment method' : '',
  })
  notFuture(date)
  return { ...e, amount: round2(e.amount) }
}

const include = { user: { select: { name: true } } } as const

export async function listExpenses(f: { q?: string; category?: string; from?: string; to?: string; limit: number; offset: number }): Promise<Paged<Expense> & { sum: number }> {
  const term = f.q?.trim()
  const where: Prisma.ExpenseWhereInput = {
    ...(term ? { OR: [{ description: { contains: term, mode: 'insensitive' } }, { reference: { contains: term, mode: 'insensitive' } }, { category: { contains: term, mode: 'insensitive' } }] } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(dateKeyWhere(f.from, f.to) ? { dateKey: dateKeyWhere(f.from, f.to) } : {}),
  }
  const [rows, total, agg] = await Promise.all([
    prisma.expense.findMany({ where, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ])
  return { items: rows.map(toExpense), total, sum: round2(n(agg._sum.amount)) }
}

export async function expenseCategories(): Promise<string[]> {
  const used = await prisma.expense.findMany({ distinct: ['category'], select: { category: true } })
  return [...new Set([...EXPENSE_CATEGORIES, ...used.map((u) => u.category)])]
}

const dataOf = (e: ExpenseInput) => {
  const date = new Date(e.date)
  return { date, dateKey: toDateKey(date), category: e.category, description: e.description, amount: e.amount, paymentMethod: e.paymentMethod, reference: e.reference ?? null }
}

export async function createExpense(e: ExpenseInput, actor: Actor): Promise<{ expense: Expense; created: boolean }> {
  return transaction(async (tx) => {
    if (e.clientRequestId) {
      const dup = await tx.expense.findUnique({ where: { clientRequestId: e.clientRequestId }, include })
      if (dup) return { expense: toExpense(dup), created: false }
    }
    const r = await tx.expense.create({ data: { ...dataOf(e), clientRequestId: e.clientRequestId ?? null, userId: actor.id }, include })
    await audit(tx, actor, 'expense.create', 'expense', r.id, { category: e.category, amount: e.amount })
    return { expense: toExpense(r), created: true }
  })
}

export async function updateExpense(id: string, e: ExpenseInput, actor: Actor) {
  return transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } })
    if (!old) throw notFound('Expense')
    const r = await tx.expense.update({ where: { id }, data: dataOf(e), include })
    await audit(tx, actor, 'expense.update', 'expense', id, { category: e.category, amount: { from: n(old.amount), to: e.amount } })
    return toExpense(r)
  })
}

export async function deleteExpense(id: string, actor: Actor) {
  await transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } })
    if (!old) throw notFound('Expense')
    await tx.expense.delete({ where: { id } })
    await audit(tx, actor, 'expense.delete', 'expense', id, { category: old.category, amount: n(old.amount), date: old.dateKey, description: old.description })
  })
}
