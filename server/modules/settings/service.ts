import { DEFAULT_SETTINGS, DEFAULT_TAX_RATES } from '../../../shared/defaults.ts'
import type { InvoiceFormat, Settings, TaxRate } from '../../../shared/types.ts'
import { prisma, type Tx } from '../../db.ts'
import type { Actor } from '../../lib/audit.ts'
import { audit } from '../../lib/audit.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import { n, opt } from '../../lib/num.ts'
import { asObject, emailError, fail, gstinError, number, text } from '../../lib/validate.ts'

const FORMATS: InvoiceFormat[] = ['a4', 'thermal', 'a5']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']
const MAX_LOGO_CHARS = 600_000 // ~400 KB image as a data URL

type Row = NonNullable<Awaited<ReturnType<typeof prisma.companySettings.findUnique>>>

const toSettings = (r: Row): Settings => ({
  businessName: r.businessName,
  businessType: r.businessType,
  logo: opt(r.logo),
  address: r.address,
  phone: r.phone,
  email: r.email,
  gstin: r.gstin,
  defaultGst: n(r.defaultGst),
  invoicePrefix: r.invoicePrefix,
  purchasePrefix: r.purchasePrefix,
  returnPrefix: r.returnPrefix,
  footerMessage: r.footerMessage,
  currency: r.currency,
  gstInclusive: r.gstInclusive,
  invoiceFormat: (FORMATS.includes(r.invoiceFormat as InvoiceFormat) ? r.invoiceFormat : 'a4') as InvoiceFormat,
  allowNegativeStock: r.allowNegativeStock,
})

export async function getSettings(db: Tx = prisma): Promise<Settings> {
  const r = await db.companySettings.findUnique({ where: { id: 1 } })
  return r ? toSettings(r) : DEFAULT_SETTINGS
}

/** First start: A.J RICE TRADERS company details and the standard GST slabs. */
export async function ensureSettings() {
  if (!(await prisma.companySettings.findUnique({ where: { id: 1 } }))) {
    const { logo: _logo, ...s } = DEFAULT_SETTINGS
    await prisma.companySettings.create({ data: { id: 1, ...s } })
  }
  if ((await prisma.taxRate.count()) === 0) await prisma.taxRate.createMany({ data: DEFAULT_TAX_RATES })
}

export function validateSettings(raw: unknown): Settings {
  const b = asObject(raw)
  const s: Settings = {
    businessName: text(b.businessName, 120),
    businessType: text(b.businessType, 120),
    logo: typeof b.logo === 'string' && b.logo ? b.logo : undefined,
    address: text(b.address, 500),
    phone: text(b.phone, 40),
    email: text(b.email, 120),
    gstin: text(b.gstin, 15).toUpperCase(),
    defaultGst: number(b.defaultGst),
    invoicePrefix: text(b.invoicePrefix, 10),
    purchasePrefix: text(b.purchasePrefix ?? DEFAULT_SETTINGS.purchasePrefix, 10),
    returnPrefix: text(b.returnPrefix ?? DEFAULT_SETTINGS.returnPrefix, 10),
    footerMessage: text(b.footerMessage, 500),
    currency: text(b.currency, 3).toUpperCase() || 'INR',
    gstInclusive: b.gstInclusive === true,
    invoiceFormat: (FORMATS.includes(b.invoiceFormat as InvoiceFormat) ? b.invoiceFormat : 'a4') as InvoiceFormat,
    allowNegativeStock: b.allowNegativeStock === true,
  }
  const prefixErr = (p: string) => (!p ? 'Prefix is required' : /\d$/.test(p) ? 'Prefix should not end with a number' : '')
  fail({
    businessName: !s.businessName ? 'Business name is required' : '',
    email: emailError(s.email),
    gstin: gstinError(s.gstin),
    defaultGst: Number.isNaN(s.defaultGst) ? 'Default GST is required' : '',
    invoicePrefix: prefixErr(s.invoicePrefix),
    purchasePrefix: prefixErr(s.purchasePrefix),
    returnPrefix: prefixErr(s.returnPrefix),
    currency: !CURRENCIES.includes(s.currency) ? `Currency must be one of ${CURRENCIES.join(', ')}` : '',
    logo:
      s.logo && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(s.logo)
        ? 'Logo must be a PNG, JPG, GIF, WebP or SVG image'
        : s.logo && s.logo.length > MAX_LOGO_CHARS
          ? 'Logo must be smaller than 400 KB'
          : '',
  })
  return s
}

export async function saveSettings(s: Settings, actor: Actor): Promise<Settings> {
  await assertRate(prisma, s.defaultGst, 'defaultGst')
  const { logo, ...rest } = s
  const data = { ...rest, logo: logo ?? null }
  return prisma.$transaction(async (tx) => {
    const r = await tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
    await audit(tx, actor, 'settings.update', 'settings', '1', { ...rest, logo: logo ? '(image)' : null })
    return toSettings(r)
  })
}

/* ---------- tax rates ---------- */

const toRate = (r: { id: string; name: string; rate: unknown; active: boolean }): TaxRate => ({ id: r.id, name: r.name, rate: n(r.rate), active: r.active })

export const listTaxRates = async (db: Tx = prisma) => (await db.taxRate.findMany({ orderBy: { rate: 'asc' } })).map(toRate)

export async function activeRates(db: Tx): Promise<Set<number>> {
  return new Set((await db.taxRate.findMany({ where: { active: true }, select: { rate: true } })).map((r) => n(r.rate)))
}

/** GST rates on bills/products must be one of the active rates in Settings. */
export async function assertRate(db: Tx, rate: number, field = 'gstRate', rates?: Set<number>) {
  const set = rates ?? (await activeRates(db))
  if (!set.has(rate)) throw badRequest(`GST rate ${rate}% is not an active tax rate (allowed: ${[...set].sort((a, b) => a - b).join(', ')}%)`, { [field]: 'Invalid GST rate' })
}

function validateRate(raw: unknown) {
  const b = asObject(raw)
  const r = { name: text(b.name, 60), rate: number(b.rate), active: b.active !== false }
  fail({
    name: !r.name ? 'Name is required' : '',
    rate: Number.isNaN(r.rate) || r.rate < 0 || r.rate > 100 ? 'Rate must be between 0 and 100' : '',
  })
  return { ...r, rate: Math.round(r.rate * 100) / 100 }
}

export async function createTaxRate(raw: unknown, actor: Actor) {
  const data = validateRate(raw)
  if (await prisma.taxRate.findUnique({ where: { rate: data.rate } })) throw conflict(`A ${data.rate}% rate already exists`)
  const r = await prisma.taxRate.create({ data })
  await audit(prisma, actor, 'taxrate.create', 'taxrate', r.id, data)
  return toRate(r)
}

export async function updateTaxRate(id: string, raw: unknown, actor: Actor) {
  const data = validateRate(raw)
  const existing = await prisma.taxRate.findUnique({ where: { id } })
  if (!existing) throw notFound('Tax rate')
  const clash = await prisma.taxRate.findUnique({ where: { rate: data.rate } })
  if (clash && clash.id !== id) throw conflict(`A ${data.rate}% rate already exists`)
  if (!data.active && n(existing.rate) === (await getSettings()).defaultGst) throw conflict('This is the default GST rate. Choose another default first.')
  const r = await prisma.taxRate.update({ where: { id }, data })
  await audit(prisma, actor, 'taxrate.update', 'taxrate', id, data)
  return toRate(r)
}

export async function deleteTaxRate(id: string, actor: Actor) {
  const existing = await prisma.taxRate.findUnique({ where: { id } })
  if (!existing) throw notFound('Tax rate')
  if (n(existing.rate) === (await getSettings()).defaultGst) throw conflict('This is the default GST rate. Choose another default first.')
  // bills keep their own copy of the rate, so removing it never changes history
  await prisma.taxRate.delete({ where: { id } })
  await audit(prisma, actor, 'taxrate.delete', 'taxrate', id, { rate: n(existing.rate) })
}
