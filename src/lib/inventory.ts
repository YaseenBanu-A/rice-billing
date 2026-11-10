import { toStockQty } from '../../shared/billing.ts'
import type { Product } from '../types'

/* Product search, pricing and stock helpers shared by the Inventory page and the bill screen. */

export type StockState = 'out' | 'low' | 'ok'

/** Out of stock at 0 or below; low at or below the minimum stock level */
export function stockState(p: Pick<Product, 'stock' | 'reorderLevel'>): StockState {
  if (p.stock <= 0) return 'out'
  if (p.stock <= p.reorderLevel) return 'low'
  return 'ok'
}

const trimNum = (n: number) => String(Math.round(n * 1000) / 1000)

/** "5 kg" package size label, or '' when the product has none */
export const packLabel = (p: Pick<Product, 'bagWeight'>) => (p.bagWeight ? `${trimNum(p.bagWeight)} kg` : '')

/** "12 Bag" / "250.5 Kg" */
export const stockLabel = (qty: number, unit: string) => `${trimNum(qty)} ${unit}`

/**
 * Finds products by name, SKU, product ID, variety, brand or category.
 * Exact SKU / ID matches come first, then names starting with the text, then anything containing it.
 */
export function searchProducts(products: Product[], query: string, limit = Infinity): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return products.slice(0, limit)
  const scored: [number, Product][] = []
  for (const p of products) {
    const name = p.name.toLowerCase()
    const sku = p.sku.toLowerCase()
    const id = p.id.toLowerCase()
    let score = -1
    if (sku === q || id === q) score = 0
    else if (name === q) score = 1
    else if (sku.startsWith(q) || (q.length >= 4 && id.startsWith(q))) score = 2
    else if (name.startsWith(q)) score = 3
    else if (
      name.includes(q) ||
      sku.includes(q) ||
      p.variety?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.categoryName?.toLowerCase().includes(q) ||
      (p.bagWeight && `${trimNum(p.bagWeight)}kg`.includes(q.replace(/\s/g, '')))
    )
      score = 4
    if (score >= 0) scored.push([score, p])
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, p]) => p)
}

/** Exact match on SKU, product ID or name: typing it fully links the bill line to the product */
export function exactProduct(products: Product[], text: string): Product | undefined {
  const q = text.trim().toLowerCase()
  if (!q) return undefined
  return products.find((p) => p.sku.toLowerCase() === q || p.id.toLowerCase() === q) ?? products.find((p) => p.name.toLowerCase() === q)
}

/**
 * The product's saved selling price, expressed per `unit`. Bags and kg convert with the package size,
 * e.g. a 25 kg bag at ₹1,250 is ₹50 per Kg.
 */
export function priceFor(p: Pick<Product, 'price' | 'unit' | 'bagWeight'>, unit: string): number {
  const bw = p.bagWeight ?? 0
  if (unit === p.unit || !bw) return p.price
  if (p.unit === 'Bag' && unit === 'Kg') return Math.round((p.price / bw) * 100) / 100
  if (p.unit === 'Kg' && unit === 'Bag') return Math.round(p.price * bw * 100) / 100
  return p.price
}

/** Quantity of the product's stock a bill line uses (bags ↔ kg converted with the package size) */
export const stockNeeded = (p: Product, qty: number, unit?: string) => toStockQty(qty, unit, p)
