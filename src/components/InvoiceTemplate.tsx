import { formatDate, formatMoney, formatTime } from '../lib/format'
import { qtyLabel } from '../lib/billing'
import type { Bill, Settings } from '../types'
import { BusinessMark } from './BusinessMark'

const PAYMENT_LABEL: Record<Bill['paymentMethod'], string> = {
  Cash: 'Cash',
  UPI: 'UPI',
  Card: 'Card',
  'Bank Transfer': 'Bank Transfer',
  Credit: 'Credit / Pay Later',
}

/** A4 black-and-white invoice used for print, PDF export and the preview modal. */
/** `bare` drops the outer padding: the PDF export adds real page margins itself. */
export function InvoiceTemplate({ bill, settings, bare = false }: { bill: Bill; settings: Settings; bare?: boolean }) {
  const m = (n: number) => formatMoney(n, settings.currency)
  const t = bill.totals

  return (
    <div className={`invoice tabular mx-auto w-full max-w-[794px] bg-white font-sans text-[12px] leading-relaxed text-black print:max-w-none print:p-0 ${bare ? 'p-0' : 'p-10'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
        <div className="flex items-start gap-4">
          <BusinessMark size={56} mono />
          <div>
            <h1 className="text-xl font-bold tracking-tight">{settings.businessName}</h1>
            <p className="whitespace-pre-line text-neutral-700">{settings.address}</p>
            <p className="text-neutral-700">
              {settings.phone}
              {settings.email && ` · ${settings.email}`}
            </p>
            {settings.gstin && <p className="font-medium">GSTIN: {settings.gstin}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-[0.2em] uppercase">Invoice</p>
          <p className="mt-1 text-neutral-500">{bill.gstInclusive ? 'Tax Invoice (GST inclusive)' : 'Tax Invoice'}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-5">
        <div>
          <p className="text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Billed to</p>
          <p className="mt-1 text-sm font-semibold">{bill.customer.name || 'Walk-in Customer'}</p>
          {bill.customer.phone && <p className="text-neutral-700">Phone: {bill.customer.phone}</p>}
          {bill.customer.address && <p className="whitespace-pre-line text-neutral-700">{bill.customer.address}</p>}
        </div>
        <div className="justify-self-end">
          <table className="text-right">
            <tbody>
              <tr>
                <td className="pr-4 text-neutral-500">Invoice No.</td>
                <td className="font-semibold">{bill.invoiceNo}</td>
              </tr>
              <tr>
                <td className="pr-4 text-neutral-500">Date</td>
                <td>
                  {formatDate(bill.date)}, {formatTime(bill.date)}
                </td>
              </tr>
              <tr>
                <td className="pr-4 text-neutral-500">Payment</td>
                <td>{PAYMENT_LABEL[bill.paymentMethod]}</td>
              </tr>
              <tr>
                <td className="pr-4 text-neutral-500">Status</td>
                <td className="font-semibold uppercase">{bill.status}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Items */}
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-[10px] tracking-wider uppercase">
            <th className="w-8 py-2 text-left font-semibold">#</th>
            <th className="py-2 text-left font-semibold">Item</th>
            <th className="py-2 text-right font-semibold">GST</th>
            <th className="py-2 text-right font-semibold">Price</th>
            <th className="py-2 text-right font-semibold">Qty</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((it, i) => (
            <tr key={it.id} className="border-b border-neutral-200 align-top" style={{ breakInside: 'avoid' }}>
              <td className="py-2 text-neutral-500">{i + 1}</td>
              <td className="py-2">
                <p className="font-medium">{it.name}</p>
                {it.sku && <p className="text-[10px] text-neutral-500">{it.sku}</p>}
              </td>
              <td className="py-2 text-right">{it.gstRate}%</td>
              <td className="py-2 text-right">{m(it.price)}</td>
              <td className="py-2 text-right">{qtyLabel(it)}</td>
              <td className="py-2 text-right font-medium">{m(it.price * it.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals + GST breakdown */}
      <div className="mt-6 grid grid-cols-2 gap-8" style={{ breakInside: 'avoid' }}>
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">GST breakdown</p>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-neutral-400">
                <th className="py-1.5 text-left font-semibold">Rate</th>
                <th className="py-1.5 text-right font-semibold">Taxable</th>
                <th className="py-1.5 text-right font-semibold">CGST</th>
                <th className="py-1.5 text-right font-semibold">SGST</th>
              </tr>
            </thead>
            <tbody>
              {t.gstBreakdown.map((g) => (
                <tr key={g.rate} className="border-b border-neutral-200">
                  <td className="py-1.5">{g.rate}%</td>
                  <td className="py-1.5 text-right">{m(g.taxable)}</td>
                  <td className="py-1.5 text-right">{m(g.gst / 2)}</td>
                  <td className="py-1.5 text-right">{m(g.gst / 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-1.5">
          <Row label="Subtotal" value={m(t.subtotal)} />
          {t.discount > 0 && (
            <Row label={`Discount${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`− ${m(t.discount)}`} />
          )}
          <Row label="Taxable value" value={m(t.taxable)} />
          <Row label={`GST${bill.gstInclusive ? ' (included)' : ''}`} value={m(t.gst)} />
          <div className="!my-2 border-t-2 border-black" />
          <div className="flex justify-between text-base font-bold">
            <span>Grand Total</span>
            <span>{m(t.grandTotal)}</span>
          </div>
          <div className="!my-2 border-t border-neutral-300" />
          <Row label="Amount paid" value={m(t.paid)} />
          <Row label="Balance due" value={m(t.balance)} bold />
          {t.change > 0 && <Row label="Change returned" value={m(t.change)} />}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 flex items-end justify-between gap-8 border-t border-neutral-300 pt-5" style={{ breakInside: 'avoid' }}>
        <p className="max-w-[60%] text-neutral-700">{settings.footerMessage}</p>
        <div className="text-center">
          <div className="mb-1 h-10 w-44 border-b border-neutral-400" />
          <p className="text-[10px] text-neutral-500">Authorised signatory</p>
        </div>
      </div>
      <p className="mt-6 text-center text-[10px] text-neutral-400">This is a computer-generated invoice.</p>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-neutral-600'}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
