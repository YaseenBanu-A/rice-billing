import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/AppContext'
import { contentWidthPx, InvoiceDocument, LAYOUTS, PX_PER_MM } from './invoice/InvoiceDocument'

/** Lays out the print frame off-screen at the roll width to measure how long the printed receipt is. */
function measureRollMm(pageWmm: number): number {
  const root = document.getElementById('print-root')
  if (!root) return 200
  const prev = root.getAttribute('style')
  root.setAttribute('style', `display:block;position:absolute;left:-10000px;top:0;width:${pageWmm}mm`)
  const heightPx = root.getBoundingClientRect().height
  if (prev === null) root.removeAttribute('style')
  else root.setAttribute('style', prev)
  return Math.ceil(heightPx / PX_PER_MM + 6) // a little extra so the last line never spills onto a second slip
}

/**
 * Renders the invoice for the active print job in the chosen format (A4, 80mm receipt, A5):
 * - print: into #print-root (only visible under @media print) with a matching @page size, then opens the print dialog
 * - pdf: captured from an off-screen copy rendered at the printable width
 */
export function PrintHost() {
  const { printJob, finishPrintJob, settings, toast } = useApp()
  const captureRef = useRef<HTMLDivElement>(null)
  const pageStyleRef = useRef<HTMLStyleElement>(null)
  // Keep callbacks in a ref so the job effect runs once per job, not on every state change
  const cb = useRef({ finishPrintJob, toast })
  useEffect(() => {
    cb.current = { finishPrintJob, toast }
  })

  useEffect(() => {
    if (!printJob) return
    const { finishPrintJob, toast } = cb.current
    const layout = LAYOUTS[printJob.format]
    const frame = requestAnimationFrame(() => {
      const el = captureRef.current
      if (printJob.mode === 'print') {
        // A receipt roll is exactly as long as the bill; sheet formats use their fixed paper height
        const heightMm = layout.pageH ?? measureRollMm(layout.pageW)
        if (pageStyleRef.current) pageStyleRef.current.textContent = `@page { size: ${layout.pageW}mm ${heightMm}mm; margin: 0; }`
        const title = document.title
        document.title = printJob.bill.invoiceNo
        window.print()
        document.title = title
        finishPrintJob()
        return
      }
      if (!el) return finishPrintJob()
      import('../lib/pdf')
        .then(({ exportInvoicePdf }) => exportInvoicePdf(el, `${printJob.bill.invoiceNo}.pdf`, layout))
        .then(() => toast(`Invoice ${printJob.bill.invoiceNo} downloaded as PDF (${layout.label})`))
        .catch(() => toast('Could not generate PDF. Try Print → Save as PDF instead.', 'error'))
        .finally(finishPrintJob)
    })
    return () => cancelAnimationFrame(frame)
  }, [printJob])

  if (!printJob) return null
  const { bill, format } = printJob
  const doc = <InvoiceDocument bill={bill} settings={settings} format={format} bare />

  const capture = (
    <div aria-hidden className="pdf-capture" style={{ position: 'fixed', left: -10000, top: 0, width: contentWidthPx(format) }}>
      <div ref={captureRef}>{doc}</div>
    </div>
  )

  if (printJob.mode === 'pdf') return capture

  const target = document.getElementById('print-root')
  if (!target) return null
  // The repeating header/footer rows give every printed page the same top/bottom margin,
  // independent of the browser's margin setting (see .print-frame in index.css)
  return (
    <>
      {capture}
      {createPortal(
        <>
          <style ref={pageStyleRef} />
          <table className="print-frame" style={{ '--frame': `${LAYOUTS[format].margin}mm` } as CSSProperties}>
            <thead>
              <tr>
                <td>
                  <div className="print-frame-space" />
                </td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="print-frame-body">
                  <InvoiceDocument bill={bill} settings={settings} format={format} bare />
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <div className="print-frame-space" />
                </td>
              </tr>
            </tfoot>
          </table>
        </>,
        target,
      )}
    </>
  )
}
