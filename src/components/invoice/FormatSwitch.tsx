import type { InvoiceFormat } from '../../types'
import { Segmented } from '../ui'
import { LAYOUTS } from './InvoiceDocument'

const ORDER: InvoiceFormat[] = ['a4', 'thermal', 'a5']

/** A4 / Receipt / A5 picker used next to Print and PDF. */
export function FormatSwitch({ value, onChange, className }: { value: InvoiceFormat; onChange: (f: InvoiceFormat) => void; className?: string }) {
  return (
    <Segmented<InvoiceFormat>
      className={className}
      value={value}
      onChange={onChange}
      options={ORDER.map((f) => ({ value: f, label: <span title={LAYOUTS[f].hint}>{LAYOUTS[f].label}</span> }))}
    />
  )
}
