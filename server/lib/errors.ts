export class HttpError extends Error {
  status: number
  fields?: Record<string, string>
  code?: string
  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message)
    this.status = status
    this.fields = fields
    this.code = code
  }
}

/**
 * Name of the unique constraint a Prisma P2002 error is about (e.g. "Invoice_pkey", "Invoice_clientRequestId_key"),
 * or undefined for any other error. Used to tell a resent request from an unrelated clash (e.g. a phone number).
 */
export function uniqueConstraintOf(e: unknown): string | undefined {
  const err = e as { code?: string; meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } } } }
  if (err?.code !== 'P2002') return undefined
  const c = err.meta?.driverAdapterError?.cause?.constraint
  if (c?.index) return c.index
  const target = err.meta?.target
  return Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : c?.fields?.join(',')
}

export const notFound =(what: string) => new HttpError(404, `${what} not found`)
export const conflict = (message: string, code?: string) => new HttpError(409, message, undefined, code)
export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields)
