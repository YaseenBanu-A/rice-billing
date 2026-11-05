import type { Settings } from './types.ts'

/** Company details used when the database is first created. Editable in Settings. */
export const DEFAULT_SETTINGS: Settings = {
  businessName: 'A.J RICE TRADERS',
  businessType: 'Rice Wholesale and Retail Trading',
  address: '10/1/72, Kottur Road, Azhag...patti,\nPollachi, Tamil Nadu',
  phone: '96552 33786',
  email: '',
  gstin: '33ACRPJ6462A1ZQ',
  defaultGst: 5,
  invoicePrefix: 'INV-',
  purchasePrefix: 'PUR-',
  returnPrefix: 'RET-',
  footerMessage: 'Thank you for your business! Goods once sold will be taken back only as per our return policy.',
  currency: 'INR',
  gstInclusive: false,
  invoiceFormat: 'a4',
  allowNegativeStock: false,
}

/** GST slabs offered on first start; edit them in Settings → Tax rates. */
export const DEFAULT_TAX_RATES = [
  { name: 'Exempt (loose rice)', rate: 0 },
  { name: 'GST 5% (packaged rice)', rate: 5 },
  { name: 'GST 12%', rate: 12 },
  { name: 'GST 18%', rate: 18 },
  { name: 'GST 28%', rate: 28 },
  { name: 'GST 40%', rate: 40 },
]
