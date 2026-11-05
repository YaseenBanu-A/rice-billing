import type { Role } from '../shared/types.ts'

export interface AuthUser {
  id: string
  username: string
  name: string
  role: Role
}

declare global {
  namespace Express {
    interface Request {
      /** set by `authenticate` */
      user?: AuthUser
    }
  }
}
