import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

export interface PdfPage {
  pageW: number // mm
  pageH: number | null // mm; null = one page as tall as the content (thermal roll)
  margin: number // mm; keeps content inside what printers can print
}

/** Captures a rendered invoice element and saves it as a PDF with margins (multi-page if needed). */
export async function exportInvoicePdf(el: HTMLElement, filename: string, page: PdfPage) {
  await document.fonts?.ready
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })

  const contentW = page.pageW - page.margin * 2
  const pxPerMm = canvas.width / contentW
  const fullH = canvas.height / pxPerMm
  // a roll receipt is a single page exactly as long as the content
  const pageH = page.pageH ?? Math.max(fullH + page.margin * 2, page.pageW)
  const contentH = pageH - page.margin * 2
  const slicePx = Math.floor(contentH * pxPerMm)

  const pdf = new jsPDF({ unit: 'mm', format: [page.pageW, pageH], orientation: 'portrait' })

  // Places where a page may end without cutting through text: below each table row and each section
  const scale = canvas.width / el.offsetWidth
  const top = el.getBoundingClientRect().top
  const breaks = [...el.querySelectorAll('tr, .invoice > div, .invoice > div > div')]
    .map((n) => Math.round((n.getBoundingClientRect().bottom - top) * scale))
    .sort((a, b) => a - b)

  // Cut the capture into page-sized slices so long invoices continue on the next page inside the margins
  for (let y = 0, n = 0; y < canvas.height; n++) {
    let h = Math.min(slicePx, canvas.height - y)
    if (y + h < canvas.height) {
      const safe = breaks.filter((b) => b > y && b <= y + h).pop()
      if (safe && safe - y > slicePx * 0.5) h = safe - y
    }
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = h
    const ctx = slice.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, h)
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (n > 0) pdf.addPage([page.pageW, pageH], 'portrait')
    pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', page.margin, page.margin, contentW, h / pxPerMm)
    y += h
  }
  pdf.save(filename)
}
