import { formatDate, formatMoney } from '../../lib/format'
import { qtyLabel } from '../../lib/billing'
import { amountInWords } from '../../lib/words'
import type { Bill, Settings } from '../../types'

const MIN_ROWS = 10 // ruled rows like a printed bill book
const num = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = 'border border-black px-1.5 py-1'

/** A5 (half-page) bill in the classic textile-shop style: fully bordered, ruled item rows, amount in words. */
export function TextileTemplate({ bill, settings, bare = false }: { bill: Bill; settings: Settings; bare?: boolean }) {
  const t = bill.totals
  const m = (n: number) => formatMoney(n, settings.currency)
  const fillers = Math.max(MIN_ROWS - bill.items.length, 0)
  const qty = bill.items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className={`invoice textile mx-auto w-full max-w-[560px] bg-white font-sans text-[10px] leading-snug text-black ${bare ? 'p-0' : 'p-6'}`}>
      <div className="border-2 border-black">
        {/* Header */}
        <div className="relative border-b-2 border-black px-3 pt-2 pb-2 text-center">
          <p className="absolute top-2 left-3 text-[9px]">{settings.gstin ? `GSTIN: ${settings.gstin}` : ''}</p>
          <p className="absolute top-2 right-3 text-[9px]">{settings.phone && `Ph: ${settings.phone}`}</p>
          <p className="mt-3 inline-block border border-black px-2 py-px text-[9px] font-bold tracking-[0.2em] uppercase">
            {settings.gstin ? 'Tax Invoice' : 'Cash / Credit Bill'}
          </p>
          <p className="mt-1 font-serif text-[20px] leading-tight font-bold tracking-wide uppercase">{settings.businessName}</p>
          <p className="whitespace-pre-line">{settings.address}</p>
          {settings.email && <p>{settings.email}</p>}
        </div>

        {/* Bill details */}
        <div className="grid grid-cols-[1fr_auto] border-b border-black">
          <div className="border-r border-black px-2 py-1.5">
            <p>
              <span className="font-semibold">M/s. </span>
              {bill.customer.name || 'Walk-in Customer'}
            </p>
            {bill.customer.address && <p className="whitespace-pre-line">{bill.customer.address}</p>}
            {bill.customer.phone && <p>Ph: {bill.customer.phone}</p>}
          </div>
          <div className="min-w-[150px] px-2 py-1.5">
            <p>
              <span className="font-semibold">Bill No :</span> {bill.invoiceNo}
            </p>
            <p>
              <span className="font-semibold">Date&nbsp;&nbsp;&nbsp; :</span> {formatDate(bill.date)}
            </p>
            <p>
              <span className="font-semibold">Mode&nbsp;&nbsp;&nbsp;:</span> {bill.paymentMethod === 'Credit' ? 'Credit' : bill.paymentMethod}
            </p>
          </div>
        </div>

        {/* Items */}
        <table className="w-full border-collapse [&_td]:border-y-0 [&_th]:border-t-0">
          <thead>
            <tr className="bg-neutral-100 text-[9px] whitespace-nowrap uppercase">
              <th className={`${cell} w-[8%] border-l-0 text-center`}>S.No</th>
              <th className={`${cell} text-left`}>Particulars</th>
              <th className={`${cell} w-[9%] text-center`}>GST</th>
              <th className={`${cell} w-[9%] text-center`}>Qty</th>
              <th className={`${cell} w-[15%] text-right`}>Rate</th>
              <th className={`${cell} w-[18%] border-r-0 text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((it, i) => (
              <tr key={it.id} style={{ breakInside: 'avoid' }}>
                <td className={`${cell} border-l-0 text-center`}>{i + 1}</td>
                <td className={cell}>
                  {it.name}
                  {it.sku && <span className="text-neutral-600"> ({it.sku})</span>}
                </td>
                <td className={`${cell} text-center`}>{it.gstRate}%</td>
                <td className={`${cell} text-center`}>{qtyLabel(it)}</td>
                <td className={`${cell} text-right`}>{num(it.price)}</td>
                <td className={`${cell} border-r-0 text-right`}>{num(it.price * it.quantity)}</td>
              </tr>
            ))}
            {Array.from({ length: fillers }, (_, i) => (
              <tr key={`f${i}`}>
                <td className={`${cell} border-l-0`}>&nbsp;</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={`${cell} border-r-0`} />
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={`${cell} border-t border-l-0`} />
              <td className={`${cell} border-t text-right`}>Total Qty</td>
              <td className={`${cell} border-t`} />
              <td className={`${cell} border-t text-center`}>{qty}</td>
              <td className={`${cell} border-t text-right`}>Sub Total</td>
              <td className={`${cell} border-t border-r-0 text-right`}>{num(t.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        {/* Words + totals */}
        <div className="grid grid-cols-[1fr_44%] border-t border-black" style={{ breakInside: 'avoid' }}>
          <div className="flex flex-col justify-between border-r border-black px-2 py-1.5">
            <div>
              <p className="text-[9px] font-semibold uppercase">Amount in words</p>
              <p className="italic">{amountInWords(t.grandTotal, settings.currency)}</p>
            </div>
            {t.gstBreakdown.some((g) => g.gst > 0) && (
              <p className="mt-1.5 text-[9px] text-neutral-700">
                {t.gstBreakdown
                  .filter((g) => g.gst > 0)
                  .map((g) => `GST ${g.rate}% on ${num(g.taxable)}`)
                  .join(' · ')}
              </p>
            )}
          </div>
          <div className="px-2 py-1.5 [&>div]:flex [&>div]:justify-between">
            {t.discount > 0 && (
              <div>
                <span>Discount{bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}</span>
                <span>-{num(t.discount)}</span>
              </div>
            )}
            <div>
              <span>CGST</span>
              <span>{num(t.gst / 2)}</span>
            </div>
            <div>
              <span>SGST</span>
              <span>{num(t.gst / 2)}</span>
            </div>
            <div className="mt-1 border-t border-black pt-1 text-[12px] font-bold">
              <span>Grand Total</span>
              <span>{m(t.grandTotal)}</span>
            </div>
            <div>
              <span>Paid</span>
              <span>{num(t.paid)}</span>
            </div>
            <div className="font-semibold">
              <span>Balance</span>
              <span>{num(t.balance)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="grid grid-cols-[1fr_auto] border-t-2 border-black" style={{ breakInside: 'avoid' }}>
          <div className="border-r border-black px-2 py-1.5 text-[9px]">
            <p className="font-semibold uppercase">Terms</p>
            <p className="whitespace-pre-line">{settings.footerMessage}</p>
          </div>
          <div className="flex min-w-[150px] flex-col justify-between px-2 py-1.5 text-right">
            <p className="font-semibold">For {settings.businessName}</p>
            <p className="mt-7 text-[9px]">Authorised Signatory</p>
          </div>
        </div>
      </div>
      <p className="mt-1 text-center text-[8px] text-neutral-500">Customer copy · E. &amp; O.E.</p>
    </div>
  )
}
