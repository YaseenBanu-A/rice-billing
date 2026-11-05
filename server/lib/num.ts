/** Prisma returns NUMERIC columns as Decimal objects; the API speaks plain numbers. */
export const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
export const nOpt = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v))
export const opt = (v: string | null | undefined): string | undefined => (v === null || v === undefined || v === '' ? undefined : v)
export const iso = (d: Date | null | undefined): string | undefined => (d ? d.toISOString() : undefined)
export const nul = (v: string | undefined) => (v === undefined || v === '' ? null : v)
export { round2, toDateKey } from '../../shared/util.ts'
export { round3 } from '../../shared/billing.ts'
