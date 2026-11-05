import type { Tx } from '../db.ts'

export const formatNo = (prefix: string, seq: number) => `${prefix}${String(seq).padStart(3, '0')}`

/**
 * Next document number (invoice, purchase, return). The counter row stays locked by this update until the
 * transaction commits, so two simultaneous bills can never get the same number; numbers only move forward.
 */
export async function allocateNumber(tx: Tx, name: string, prefix: string, taken: (no: string) => Promise<boolean>): Promise<string> {
  const row = await tx.counter.upsert({ where: { name }, create: { name, value: 1 }, update: { value: { increment: 1 } } })
  let seq = row.value
  // skip numbers already used (e.g. after the prefix was changed back)
  while (await taken(formatNo(prefix, seq))) seq++
  if (seq !== row.value) await tx.counter.update({ where: { name }, data: { value: seq } })
  return formatNo(prefix, seq)
}

/** Preview of the next number; not reserved. */
export async function peekNumber(db: Tx, name: string, prefix: string, taken: (no: string) => Promise<boolean>): Promise<string> {
  let seq = ((await db.counter.findUnique({ where: { name } }))?.value ?? 0) + 1
  while (await taken(formatNo(prefix, seq))) seq++
  return formatNo(prefix, seq)
}
