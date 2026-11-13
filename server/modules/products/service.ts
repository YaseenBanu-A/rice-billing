import { UNITS } from '../../../shared/billing.ts'
import type { Category, Product } from '../../../shared/types.ts'
import { prisma, transaction, type Tx } from '../../db.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import { formatNo } from '../../lib/numbering.ts'
import { n, nOpt, nul, opt, round2, round3 } from '../../lib/num.ts'
import { changeStock } from '../../lib/stock.ts'
import { asObject, clientId, fail, number, optNumber, text } from '../../lib/validate.ts'
import { activeRates, assertRate } from '../settings/service.ts'

const include = { category: { select: { name: true } } } as const
type Row = NonNullable<Awaited<ReturnType<typeof prisma.product.findFirst<{ include: typeof include }>>>>

export const toProduct = (r: Row): Product => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  price: n(r.price),
  gstRate: n(r.gstRate),
  categoryId: opt(r.categoryId),
  categoryName: r.category?.name,
  variety: opt(r.variety),
  brand: opt(r.brand),
  hsnCode: r.hsnCode,
  unit: r.unit,
  bagWeight: nOpt(r.bagWeight),
  purchasePrice: n(r.purchasePrice),
  stock: n(r.stock),
  reorderLevel: n(r.reorderLevel),
  active: r.active,
})

function validate(raw: unknown) {
  const b = asObject(raw)
  const p = {
    name: text(b.name, 160),
    sku: text(b.sku, 40).toUpperCase(),
    categoryId: text(b.categoryId, 64) || null,
    variety: text(b.variety, 80),
    brand: text(b.brand, 80),
    hsnCode: text(b.hsnCode, 10) || '1006',
    unit: text(b.unit, 10) || 'Kg',
    bagWeight: optNumber(b.bagWeight),
    price: number(b.price),
    purchasePrice: optNumber(b.purchasePrice) ?? 0,
    gstRate: number(b.gstRate),
    reorderLevel: optNumber(b.reorderLevel) ?? 0,
    openingStock: optNumber(b.openingStock) ?? 0,
    active: b.active !== false,
  }
  fail({
    name: !p.name ? 'Product name is required' : '',
    sku: p.sku && !/^[A-Z0-9][A-Z0-9._/-]*$/.test(p.sku) ? 'SKU may use letters, digits, dot, dash, slash' : '',
    unit: !UNITS.includes(p.unit) ? `Unit must be one of ${UNITS.join(', ')}` : '',
    hsnCode: !/^\d{4,8}$/.test(p.hsnCode) ? 'HSN code is 4 to 8 digits' : '',
    bagWeight: p.bagWeight !== undefined && (Number.isNaN(p.bagWeight) || p.bagWeight <= 0) ? 'Bag weight must be more than 0' : '',
    price: Number.isNaN(p.price) ? 'Selling rate is required' : p.price < 0 ? 'Rate cannot be negative' : '',
    purchasePrice: Number.isNaN(p.purchasePrice) || p.purchasePrice < 0 ? 'Purchase rate cannot be negative' : '',
    gstRate: Number.isNaN(p.gstRate) ? 'GST rate is required' : '',
    reorderLevel: Number.isNaN(p.reorderLevel) || p.reorderLevel < 0 ? 'Reorder level cannot be negative' : '',
    openingStock: Number.isNaN(p.openingStock) || p.openingStock < 0 ? 'Opening stock cannot be negative' : '',
  })
  return p
}

type ProductData = ReturnType<typeof validate>
const dataOf = (p: ProductData) => ({
  name: p.name,
  sku: p.sku,
  categoryId: p.categoryId,
  variety: nul(p.variety),
  brand: nul(p.brand),
  hsnCode: p.hsnCode,
  unit: p.unit,
  bagWeight: p.bagWeight ?? null,
  price: round2(p.price),
  purchasePrice: round2(p.purchasePrice),
  gstRate: p.gstRate,
  reorderLevel: round3(p.reorderLevel),
  active: p.active,
})

async function checkRefs(tx: Tx, p: ProductData, exceptId = '') {
  await assertRate(tx, p.gstRate)
  if (p.categoryId && !(await tx.category.findUnique({ where: { id: p.categoryId } }))) throw notFound('Category')
  const other = await tx.product.findUnique({ where: { sku: p.sku }, select: { id: true } })
  if (other && other.id !== exceptId) throw conflict('This SKU is already in use')
}

export interface ProductFilters {
  q?: string
  categoryId?: string
  includeInactive?: boolean
  lowStock?: boolean
}

export async function listProducts(f: ProductFilters = {}): Promise<Product[]> {
  const term = f.q?.trim()
  const rows = await prisma.product.findMany({
    where: {
      ...(f.includeInactive ? {} : { active: true }),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(term
        ? { OR: ['name', 'sku', 'variety', 'brand'].map((k) => ({ [k]: { contains: term, mode: 'insensitive' as const } })) }
        : {}),
    },
    include,
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
  const list = rows.map(toProduct)
  return f.lowStock ? list.filter((p) => p.stock <= p.reorderLevel) : list
}

export async function getProduct(id: string) {
  const r = await prisma.product.findUnique({ where: { id }, include })
  if (!r) throw notFound('Product')
  return toProduct(r)
}

/**
 * `id` (optional, UUID) is chosen by the offline app so bills made offline can refer to the product before it
 * is synced. Resending a product that already exists with that id returns it unchanged (`created: false`).
 */
export async function createProduct(raw: unknown, actor: Actor): Promise<{ product: Product; created: boolean }> {
  const p = validate(raw)
  const id = clientId(asObject(raw).id)
  if (id) {
    const existing = await prisma.product.findUnique({ where: { id }, include })
    if (existing) return { product: toProduct(existing), created: false }
  }
  try {
    return { product: await insertProduct(p, actor, id), created: true }
  } catch (e) {
    // the same product sent twice at the same moment: return the one that was saved
    const existing = id && (e as { code?: string })?.code === 'P2002' ? await prisma.product.findUnique({ where: { id }, include }) : null
    if (existing) return { product: toProduct(existing), created: false }
    throw e
  }
}

function insertProduct(p: ProductData, actor: Actor, id?: string) {
  return transaction(async (tx) => {
    if (!p.sku) {
      // short automatic code when none is given: P-001, P-002, ...
      const c = await tx.counter.upsert({ where: { name: 'product' }, create: { name: 'product', value: 1 }, update: { value: { increment: 1 } } })
      let seq = c.value
      while (await tx.product.findUnique({ where: { sku: formatNo('P-', seq) } })) seq++
      p.sku = formatNo('P-', seq)
    }
    await checkRefs(tx, p)
    const r = await tx.product.create({ data: { ...(id ? { id } : {}), ...dataOf(p) } })
    if (p.openingStock > 0) await changeStock(tx, { productId: r.id, delta: p.openingStock, type: 'OPENING', note: 'Opening stock', userId: actor.id }, true)
    await audit(tx, actor, 'product.create', 'product', r.id, { name: p.name, sku: p.sku, price: p.price, openingStock: p.openingStock })
    return toProduct((await tx.product.findUniqueOrThrow({ where: { id: r.id }, include }))!)
  })
}

/** Stock is not edited here; it changes only through purchases, sales, returns and adjustments. */
export function updateProduct(id: string, raw: unknown, actor: Actor) {
  const p = validate(raw)
  return transaction(async (tx) => {
    const old = await tx.product.findUnique({ where: { id } })
    if (!old) throw notFound('Product')
    if (!p.sku) p.sku = old.sku
    await checkRefs(tx, p, id)
    const r = await tx.product.update({ where: { id }, data: dataOf(p), include })
    await audit(tx, actor, 'product.update', 'product', id, {
      name: p.name,
      price: { from: n(old.price), to: p.price },
      gstRate: { from: n(old.gstRate), to: p.gstRate },
      active: p.active,
    })
    return toProduct(r)
  })
}

/** Products used on bills, purchases or stock history are archived instead, so history stays complete. */
export async function deleteProduct(id: string, actor: Actor): Promise<{ archived: boolean }> {
  return transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id } })
    if (!p) throw notFound('Product')
    const used =
      (await tx.stockMovement.count({ where: { productId: id } })) + (await tx.invoiceItem.count({ where: { productId: id } })) + (await tx.purchaseItem.count({ where: { productId: id } }))
    if (used) {
      await tx.product.update({ where: { id }, data: { active: false } })
      await audit(tx, actor, 'product.archive', 'product', id, { name: p.name })
      return { archived: true }
    }
    await tx.product.delete({ where: { id } })
    await audit(tx, actor, 'product.delete', 'product', id, { name: p.name, sku: p.sku })
    return { archived: false }
  })
}

/* ---------- categories ---------- */

export async function listCategories(): Promise<Category[]> {
  const rows = await prisma.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: { where: { active: true } } } } } })
  return rows.map((r) => ({ id: r.id, name: r.name, description: opt(r.description), productCount: r._count.products }))
}

function validateCategory(raw: unknown) {
  const b = asObject(raw)
  const c = { name: text(b.name, 80), description: text(b.description, 300) }
  fail({ name: !c.name ? 'Category name is required' : '' })
  return { name: c.name, description: nul(c.description) }
}

async function assertCategoryName(name: string, exceptId = '') {
  const other = await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })
  if (other && other.id !== exceptId) throw conflict('A category with this name already exists')
}

export async function createCategory(raw: unknown, actor: Actor) {
  const data = validateCategory(raw)
  await assertCategoryName(data.name)
  const r = await prisma.category.create({ data })
  await audit(prisma, actor, 'category.create', 'category', r.id, data)
  return { id: r.id, name: r.name, description: opt(r.description), productCount: 0 }
}

export async function updateCategory(id: string, raw: unknown, actor: Actor) {
  const data = validateCategory(raw)
  if (!(await prisma.category.findUnique({ where: { id } }))) throw notFound('Category')
  await assertCategoryName(data.name, id)
  const r = await prisma.category.update({ where: { id }, data })
  await audit(prisma, actor, 'category.update', 'category', id, data)
  return { id: r.id, name: r.name, description: opt(r.description) }
}

/** Products in the category stay, just without a category. */
export async function deleteCategory(id: string, actor: Actor) {
  const c = await prisma.category.findUnique({ where: { id } })
  if (!c) throw notFound('Category')
  await prisma.category.delete({ where: { id } })
  await audit(prisma, actor, 'category.delete', 'category', id, { name: c.name })
}

export { activeRates }
