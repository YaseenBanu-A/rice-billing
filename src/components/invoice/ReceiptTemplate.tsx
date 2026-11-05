import { formatDate, formatTime } from '../../lib/format'
import { bagsLabel, qtyLabel } from '../../lib/billing'
import type { Bill, Settings } from '../../types'

const num = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PAYMENT: Record<Bill['paymentMethod'], string> = { Cash: 'Cash', UPI: 'UPI', Card: 'Card', 'Bank Transfer': 'Bank', Credit: 'Pay Later' }

function Rule({ double }: { double?: boolean }) {
  return <div className={`my-1.5 border-t ${double ? 'border-double border-t-[3px]' : 'border-dashed'} border-black`} />
}

function Line({ label, value, bold, big }: { label: string; value: string; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''} ${big ? 'text-[15px]' : ''}`}>
      <span>{label}</span>
      <span className="text-right whitespace-nowrap">{value}</span>
    </div>
  )
}

/** 80mm thermal-roll receipt, restaurant style. Monospace so columns line up like a till slip. */
export function ReceiptTemplate({ bill, settings, bare = false }: { bill: Bill; settings: Settings; bare?: boolean }) {
  const t = bill.totals
  const sym = settings.currency === 'INR' ? '₹' : settings.currency + ' '
  const qty = bill.items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div
      className={`invoice receipt mx-auto w-full max-w-[302px] bg-white text-[11px] leading-snug text-black ${bare ? 'p-0' : 'p-3'}`}
      style={{ fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace" }}
    >
      {/* Header */}
      <div className="text-center">
        {settings.logo && <img src={settings.logo} alt="" className="mx-auto mb-1 h-10 w-10 object-contain grayscale" />}
        <p className="text-[15px] leading-tight font-bold uppercase">{settings.businessName}</p>
        <p className="mt-0.5 whitespace-pre-line">{settings.address}</p>
        {settings.phone && <p>Ph: {settings.phone}</p>}
        {settings.gstin && <p>GSTIN: {settings.gstin}</p>}
      </div>

      <Rule />
      <p className="text-center font-bold tracking-widest">{settings.gstin ? 'TAX INVOICE' : 'CASH BILL'}</p>
      <Rule />

      <Line label={`Bill: ${bill.invoiceNo}`} value={formatDate(bill.date)} />
      <Line label={`Pay : ${PAYMENT[bill.paymentMethod]}`} value={formatTime(bill.date)} />
      <p className="truncate">Cust: {bill.customer.name || 'Walk-in Customer'}</p>
      {bill.customer.phone && <p>Ph  : {bill.customer.phone}</p>}

      <Rule />
      {/* Items */}
      <div className="grid grid-cols-[1fr_4.4em_5em_6.2em] gap-x-1 font-bold">
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amt</span>
      </div>
      <Rule />
      {bill.items.map((it) => (
        <div key={it.id} className="grid grid-cols-[1fr_4.4em_5em_6.2em] gap-x-1" style={{ breakInside: 'avoid' }}>
          <span className="break-words">
            {it.name}
            {!!it.bags && <span className="block">({bagsLabel(it.bags)})</span>}
          </span>
          <span className="text-right whitespace-nowrap">{qtyLabel({ ...it, bags: undefined })}</span>
          <span className="text-right whitespace-nowrap">{num(it.price)}</span>
          <span className="text-right whitespace-nowrap">{num(it.price * it.quantity)}</span>
        </div>
      ))}
      <Rule />

      {/* Totals */}
      <Line label={`Items: ${bill.items.length}  Qty: ${qty}`} value="" />
      <Line label="Subtotal" value={num(t.subtotal)} />
      {t.discount > 0 && <Line label={`Discount${bill.discountType === 'percent' ? ` ${bill.discountValue}%` : ''}`} value={`-${num(t.discount)}`} />}
      {t.gstBreakdown
        .filter((g) => g.gst > 0)
        .map((g) => (
          <div key={g.rate}>
            <Line label={`CGST @${g.rate / 2}%`} value={num(g.gst / 2)} />
            <Line label={`SGST @${g.rate / 2}%`} value={num(g.gst / 2)} />
          </div>
        ))}
      {bill.gstInclusive && <p className="text-[10px]">(GST included in prices)</p>}
      <Rule double />
      <Line label="TOTAL" value={`${sym}${num(t.grandTotal)}`} bold big />
      <Rule double />
      <Line label={`Paid (${PAYMENT[bill.paymentMethod]})`} value={num(t.paid)} />
      {t.change > 0 ? <Line label="Change" value={num(t.change)} /> : <Line label="Balance" value={num(t.balance)} bold={t.balance > 0} />}

      <Rule />
      <p className="text-center whitespace-pre-line">{settings.footerMessage}</p>
      <p className="mt-1 text-center font-bold">*** Thank you, visit again ***</p>
    </div>
  )
}
