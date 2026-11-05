import type { Role } from './types.ts'

const ALL: Role[] = ['ADMIN', 'MANAGER', 'CASHIER']
const MGMT: Role[] = ['ADMIN', 'MANAGER']
const ADMIN: Role[] = ['ADMIN']

/** Who may do what. Checked on the server for every request; the app uses it only to hide what you can't use. */
export const PERMISSIONS = {
  'bills.view': ALL,
  'bills.create': ALL,
  'bills.edit': ALL,
  'bills.cancel': MGMT,
  'bills.delete': ADMIN,
  'payments.record': ALL,
  'payments.void': ADMIN,
  'returns.create': MGMT,
  'customers.view': ALL,
  'customers.manage': ALL,
  'customers.delete': MGMT,
  'products.view': ALL,
  'products.manage': MGMT,
  'inventory.view': ALL,
  'inventory.adjust': MGMT,
  'suppliers.view': MGMT,
  'suppliers.manage': MGMT,
  'purchases.view': MGMT,
  'purchases.manage': MGMT,
  'expenses.view': MGMT,
  'expenses.manage': MGMT,
  'reports.view': MGMT,
  'settings.manage': ADMIN,
  'users.manage': ADMIN,
  'audit.view': ADMIN,
  'data.admin': ADMIN,
} satisfies Record<string, Role[]>

export type Permission = keyof typeof PERMISSIONS

export const can = (role: Role | undefined, p: Permission) => !!role && (PERMISSIONS[p] as Role[]).includes(role)

export const ROLE_LABELS: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', CASHIER: 'Cashier' }
