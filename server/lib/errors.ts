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

export const notFound = (what: string) => new HttpError(404, `${what} not found`)
export const conflict = (message: string, code?: string) => new HttpError(409, message, undefined, code)
export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields)
