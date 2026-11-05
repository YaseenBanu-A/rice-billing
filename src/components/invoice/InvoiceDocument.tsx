import type { Bill, InvoiceFormat, Settings } from '../../types'
import { InvoiceTemplate } from '../InvoiceTemplate'
import { ReceiptTemplate } from './ReceiptTemplate'
import { TextileTemplate } from './TextileTemplate'

/** Paper size and margins per format, shared by printing and PDF export. Heights of `null` grow with content. */
export const LAYOUTS: Record<InvoiceFormat, { label: string; hint: string; pageW: number; pageH: number | null; margin: number }> = {
  a4: { label: 'A4', hint: 'Full page tax invoice', pageW: 210, pageH: 297, margin: 12 },
  thermal: { label: 'Receipt', hint: '80mm thermal roll', pageW: 80, pageH: null, margin: 3 },
  a5: { label: 'A5', hint: 'Half page textile bill', pageW: 148, pageH: 210, margin: 8 },
}

export const PX_PER_MM = 96 / 25.4
/** Width in CSS px of the printable area, so the on-screen capture matches the printed size. */
export const contentWidthPx = (f: InvoiceFormat) => Math.round((LAYOUTS[f].pageW - LAYOUTS[f].margin * 2) * PX_PER_MM)

export function InvoiceDocument({ bill, settings, format, bare }: { bill: Bill; settings: Settings; format: InvoiceFormat; bare?: boolean }) {
  if (format === 'thermal') return <ReceiptTemplate bill={bill} settings={settings} bare={bare} />
  if (format === 'a5') return <TextileTemplate bill={bill} settings={settings} bare={bare} />
  return <InvoiceTemplate bill={bill} settings={settings} bare={bare} />
}
