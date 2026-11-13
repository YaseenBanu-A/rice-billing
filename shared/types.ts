export type PaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Credit'

/** Methods for recorded payments (money actually received or paid). "Credit" on a bill means pay later. */
export type PayMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Cheque'

export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid' | 'Cancelled'

export type DiscountType = 'amount' | 'percent'

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER'

export interface User {
  id: string
  username: string
  name: string
  role: Role
  active: boolean
  lastLoginAt?: string
  createdAt?: string
}

export interface Category {
  id: string
  name: string
  description?: string
  productCount?: number
}

export interface Product {
  id: string
  name: string
  sku: string
  price: number
  gstRate: number
  categoryId?: string
  categoryName?: string
  /** rice variety, e.g. Ponni, Sona Masoori */
  variety?: string
  brand?: string
  hsnCode: string
  /** unit stock is counted in: Kg, Bag or Loose */
  unit: string
  /** kg per bag */
  bagWeight?: number
  purchasePrice: number
  stock: number
  reorderLevel: number
  active: boolean
}

export interface Customer {
  id: string
  name: string
  phone: string
  email?: string
  address?: string
  gstin?: string
  /** unpaid balance across this customer's bills */
  outstanding?: number
  billCount?: number
}

export interface Supplier {
  id: string
  name: string
  phone: string
  email?: string
  address?: string
  gstin?: string
  outstanding?: number
  purchaseCount?: number
}

export interface BillItem {
  id: string
  productId: string
  name: string
  sku: string
  hsnCode?: string
  price: number
  quantity: number
  /** e.g. Kg, Bag, Loose; empty for plain counts */
  unit?: string
  /** number of bags, alongside the weight in `quantity` */
  bags?: number
  gstRate: number
  /** quantity already taken back through sales returns */
  returnedQty?: number
}

export interface BillCustomer {
  id?: string
  name: string
  phone: string
  address?: string
  gstin?: string
}

export interface BillTotals {
  subtotal: number
  discount: number
  taxable: number
  gst: number
  grandTotal: number
  paid: number
  balance: number
  change: number
  gstBreakdown: { rate: number; taxable: number; gst: number }[]
}

export interface PaymentRecord {
  id: string
  kind: 'PAYMENT' | 'REFUND'
  /** negative for refunds */
  amount: number
  method: string
  date: string
  reference?: string
  note?: string
  userName?: string
  createdAt: string
}

export interface ReturnRecord {
  id: string
  returnNo: string
  date: string
  reason?: string
  total: number
  refund: number
  refundMethod?: string
  userName?: string
  items: { invoiceItemId: string; name: string; quantity: number; amount: number }[]
}

export interface Bill {
  id: string
  invoiceNo: string
  date: string // ISO
  customer: BillCustomer
  items: BillItem[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  paymentMethod: PaymentMethod
  amountPaid: number
  totals: BillTotals
  status: PaymentStatus
  notes?: string
  /** value of goods taken back (credit notes) */
  returnTotal: number
  cancelled: boolean
  cancelledAt?: string
  cancelReason?: string
  payments: PaymentRecord[]
  returns: ReturnRecord[]
  /** optimistic-lock version; send it back when editing */
  version: number
  createdByName?: string
  createdAt: string
  updatedAt?: string
}

export interface Settings {
  businessName: string
  businessType: string
  logo?: string // data URL
  address: string
  phone: string
  email: string
  gstin: string
  defaultGst: number
  invoicePrefix: string
  purchasePrefix: string
  returnPrefix: string
  footerMessage: string
  currency: string
  gstInclusive: boolean
  invoiceFormat: InvoiceFormat
  allowNegativeStock: boolean
}

export interface TaxRate {
  id: string
  name: string
  rate: number
  active: boolean
}

/** a4: full-page tax invoice · thermal: 80mm receipt · a5: half-page bill */
export type InvoiceFormat = 'a4' | 'thermal' | 'a5'

export type Page = 'dashboard' | 'create' | 'history' | 'inventory' | 'expenses' | 'reports' | 'settings'

/* ---------- purchases ---------- */

export interface PurchaseItem {
  id: string
  productId: string
  name: string
  quantity: number
  unit: string
  bags?: number
  price: number
  gstRate: number
}

export interface Purchase {
  id: string
  purchaseNo: string
  supplierId: string
  supplierName: string
  supplierInvoiceNo?: string
  date: string
  items: PurchaseItem[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  totals: BillTotals
  amountPaid: number
  balance: number
  status: PaymentStatus
  notes?: string
  cancelled: boolean
  cancelReason?: string
  payments: PaymentRecord[]
  createdByName?: string
  createdAt: string
}

export interface PurchaseInput {
  supplierId: string
  supplierInvoiceNo?: string
  date: string
  items: Omit<PurchaseItem, 'id'>[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  amountPaid: number
  paymentMethod: PayMethod
  notes?: string
  clientRequestId?: string
}

/* ---------- inventory & expenses ---------- */

export type MovementType = 'OPENING' | 'PURCHASE' | 'PURCHASE_CANCEL' | 'SALE' | 'SALE_EDIT' | 'SALE_CANCEL' | 'SALE_RETURN' | 'ADJUSTMENT'

export interface StockMovement {
  id: string
  productId: string
  productName: string
  unit: string
  type: MovementType
  quantity: number
  balanceAfter: number
  reference?: string
  note?: string
  userName?: string
  createdAt: string
}

export interface ExpenseAttachmentInfo {
  fileName: string
  mimeType: string
  /** bytes */
  size: number
}

export interface Expense {
  id: string
  date: string
  dateKey: string
  title: string
  categoryId?: string
  category: string
  /** description / notes */
  description: string
  amount: number
  paymentMethod: PayMethod
  reference?: string
  attachment?: ExpenseAttachmentInfo
  userName?: string
  createdAt: string
  updatedAt?: string
}

export interface ExpenseInput {
  date: string
  title?: string
  /** either the category's id or its name (a new name creates the category) */
  categoryId?: string
  category: string
  description: string
  amount: number
  paymentMethod: PayMethod
  reference?: string
  clientRequestId?: string
}

export interface ExpenseCategory {
  id: string
  name: string
  active: boolean
  /** number of expenses filed under it */
  expenseCount: number
  total: number
}

export interface ExpensePage extends Paged<Expense> {
  /** sum of every expense matching the filters, not just this page */
  sum: number
}

export interface ExpenseSummary {
  from: string
  to: string
  today: { total: number; count: number }
  month: { total: number; count: number }
  period: { total: number; count: number; average: number }
  byCategory: { category: string; total: number; count: number }[]
  byMethod: { method: string; total: number; count: number }[]
  daily: { date: string; total: number; count: number }[]
}

/* ---------- API payloads ---------- */

export type BillItemInput = Omit<BillItem, 'id' | 'returnedQty'> & { id?: string }

/** What the client sends to create or update a bill. Totals, status and invoice number are set by the server. */
export interface BillInput {
  /** new bills only: id chosen by the client (UUID), so a bill made offline keeps its id after syncing */
  id?: string
  date: string // ISO
  customer: BillCustomer
  /** Create a customer record from `customer` if it has no id */
  saveCustomer?: boolean
  items: BillItemInput[]
  discountType: DiscountType
  discountValue: number
  gstInclusive: boolean
  paymentMethod: PaymentMethod
  amountPaid: number
  notes?: string
  /** idempotency key: resending the same key returns the bill already created */
  clientRequestId?: string
  /** when editing: the version the edit started from */
  version?: number
}

export interface PaymentInput {
  amount: number
  method: PayMethod
  date?: string
  reference?: string
  note?: string
  clientRequestId?: string
}

export interface ReturnInput {
  items: { invoiceItemId: string; quantity: number }[]
  reason?: string
  refundMethod?: PayMethod
  date?: string
}

export interface Paged<T> {
  items: T[]
  total: number
}

export interface BillPage extends Paged<Bill> {
  /** totals over every bill matching the filters, not just this page */
  summary: { grandTotal: number; balance: number }
}

export interface ApiErrorBody {
  error: string
  code?: string
  fields?: Record<string, string>
}

/** Live update pushed to every signed-in screen */
export interface ChangeEvent {
  entity: 'invoice' | 'payment' | 'product' | 'stock' | 'customer' | 'supplier' | 'category' | 'purchase' | 'expense' | 'settings' | 'user' | 'all'
  action: string
  id?: string
  label?: string
  by?: string
  byUserId?: string
}

export interface DashboardStats {
  today: { sales: number; count: number; collected: number; gst: number; byMethod: [PaymentMethod, number][] }
  week: { key: string; total: number }[]
  recentBills: Bill[]
  receivables: number
  payables: number
  monthSales: number
  monthExpenses: number
  lowStock: number
}

export interface ReportSummary {
  from: string
  to: string
  sales: {
    count: number
    cancelled: number
    subtotal: number
    discount: number
    taxable: number
    gst: number
    grandTotal: number
    returns: number
    net: number
    /** taxable value and GST of goods returned in the period */
    returnsTaxable: number
    returnsGst: number
    /** taxable − returnsTaxable */
    netTaxable: number
    /** gst − returnsGst */
    netGst: number
  }
  gstByRate: { rate: number; taxable: number; gst: number }[]
  collections: { method: string; amount: number }[]
  /** money received for bills in the period: payments in, refunds out (refunds are negative entries) */
  collectionTotals: { received: number; refunded: number; net: number; count: number }
  purchases: { count: number; taxable: number; gst: number; grandTotal: number }
  supplierPayments: number
  expenses: { category: string; amount: number }[]
  expenseTotal: number
  expenseCount: number
  /** Net sales excluding GST − expenses. Purchases / cost of goods are not deducted. */
  profit: { netSales: number; gstOnNetSales: number; netSalesExGst: number; expenses: number; net: number }
  /** unpaid balance on all bills right now (not limited to the period) */
  outstanding: { total: number; count: number }
  daily: { date: string; bills: number; gross: number; discount: number; returns: number; gst: number; sales: number; collected: number; expenses: number }[]
  topProducts: { name: string; quantity: number; unit: string; amount: number }[]
  receivables: { id: string; invoiceNo: string; date: string; customer: string; phone: string; grandTotal: number; balance: number }[]
}

export interface InvoiceReportRow {
  id: string
  invoiceNo: string
  date: string
  dateKey: string
  customer: string
  phone: string
  items: number
  subtotal: number
  discount: number
  taxable: number
  gst: number
  grandTotal: number
  /** goods returned against this bill so far */
  returns: number
  paid: number
  balance: number
  status: PaymentStatus
  method: string
  cancelled: boolean
  createdBy?: string
}

export interface CustomerReportRow {
  key: string
  customerId?: string
  name: string
  phone: string
  bills: number
  gross: number
  returns: number
  net: number
  paid: number
  balance: number
  lastBill: string
}

export interface PaymentReportRow {
  id: string
  date: string
  dateKey: string
  invoiceId: string
  invoiceNo: string
  customer: string
  kind: 'PAYMENT' | 'REFUND'
  method: string
  /** negative for refunds */
  amount: number
  reference?: string
  note?: string
  userName?: string
}

export interface OutstandingRow {
  id: string
  invoiceNo: string
  date: string
  dateKey: string
  customer: string
  phone: string
  grandTotal: number
  returns: number
  paid: number
  balance: number
  /** days since the bill date */
  days: number
}

export interface ReportRows<T> {
  from: string
  to: string
  rows: T[]
  /** true when the period had more rows than the report returns */
  truncated: boolean
}

/** Everything in the shop's database except passwords, as downloaded from Settings → Backup. */
export interface Backup {
  app: 'aj-rice-billing'
  version: 2
  exportedAt: string // ISO
  tables: Record<string, unknown[]>
}
