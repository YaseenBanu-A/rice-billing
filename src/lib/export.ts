import { buildXlsx, type CellStyle, type XCell, type XSheet } from './xlsx'

/*
 * One description of a report (title, period, tables) that can be saved as an Excel workbook or a PDF.
 * The tables are exactly the rows on screen (after search, filters and sorting).
 */

export type ColKind = 'text' | 'money' | 'int' | 'date'
export type ExportValue = string | number | null | undefined

export interface ExportColumn {
  label: string
  kind?: ColKind
  /** relative width in the PDF (default by kind) */
  width?: number
}

export interface ExportTable {
  title: string
  columns: ExportColumn[]
  rows: ExportValue[][]
  totals?: ExportValue[]
}

export interface ExportDoc {
  /** without extension */
  fileName: string
  business: string
  title: string
  /** e.g. "1 Nov – 11 Nov 2026" */
  period?: string
  sections: ExportTable[]
  /** how the figures were worked out, printed under the tables */
  notes?: string[]
  generatedBy?: string
}

const isNum = (k?: ColKind) => k === 'money' || k === 'int'

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const safeFileName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)

const generatedAt = () => new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/* ---------- Excel ---------- */

export function exportExcel(doc: ExportDoc) {
  const sheets: XSheet[] = doc.sections.map((t, idx) => {
    const style = (k: ColKind | undefined, bold = false): CellStyle => (k === 'money' ? (bold ? 'moneyBold' : 'money') : k === 'int' ? (bold ? 'intBold' : 'int') : k === 'date' ? 'date' : bold ? 'bold' : 'text')
    const head: XCell[][] = [
      [{ v: `${doc.business} — ${doc.title}`, style: 'title' }],
      [{ v: [t.title, doc.period].filter(Boolean).join(' · '), style: 'bold' }],
      [{ v: `Generated ${generatedAt()}${doc.generatedBy ? ` by ${doc.generatedBy}` : ''}`, style: 'note' }],
      [],
      t.columns.map((c) => ({ v: c.label, style: isNum(c.kind) ? 'headerRight' : 'header' })),
    ]
    const body: XCell[][] = t.rows.map((r) => r.map((v, i) => ({ v, style: style(t.columns[i]?.kind) })))
    const totals: XCell[][] = t.totals ? [t.totals.map((v, i) => ({ v, style: style(t.columns[i]?.kind, true) }))] : []
    const notes: XCell[][] = idx === 0 && doc.notes?.length ? [[], ...doc.notes.map((n): XCell[] => [{ v: n, style: 'note' }])] : []
    // column widths from the longest value (dates and money have fixed display widths)
    const widths = t.columns.map((c, i) => {
      if (c.kind === 'date') return 13
      const longest = Math.max(c.label.length, ...[...t.rows, ...(t.totals ? [t.totals] : [])].map((r) => (r[i] === null || r[i] === undefined ? 0 : c.kind === 'money' ? String(Math.round(Number(r[i]))).length + 5 : String(r[i]).length)))
      return Math.min(longest + 2, 50)
    })
    return { name: t.title, rows: [...head, ...body, ...totals, ...notes], widths, freezeRows: head.length }
  })
  saveBlob(buildXlsx(sheets), `${safeFileName(doc.fileName)}.xlsx`)
}

/* ---------- PDF ---------- */

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** PDF standard fonts only have Western characters: the rupee sign becomes "Rs." and others a "?" */
const pdfText = (s: string) =>
  s
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^ -~ -ÿ]/g, '?')

function display(v: ExportValue, kind?: ColKind): string {
  if (v === null || v === undefined || v === '') return ''
  if (kind === 'money' && typeof v === 'number') return money(v)
  if (kind === 'int' && typeof v === 'number') return v.toLocaleString('en-IN')
  if (kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
    return new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return pdfText(String(v))
}

export async function exportPdf(doc: ExportDoc) {
  const { jsPDF } = await import('jspdf')
  const wide = doc.sections.some((s) => s.columns.length > 6)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: wide ? 'landscape' : 'portrait' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const M = 12
  const rowH = 6
  let y = M

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.setTextColor(15, 23, 42)
  pdf.text(pdfText(doc.business), M, y + 4)
  y += 10
  pdf.setFontSize(12)
  pdf.text(pdfText(doc.title), M, y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(100, 116, 139)
  const sub = [doc.period, 'Amounts in Rs.', `Generated ${generatedAt()}${doc.generatedBy ? ` by ${doc.generatedBy}` : ''}`].filter(Boolean).join('   ·   ')
  pdf.text(pdfText(sub), M, y + 5)
  y += 12

  const fit = (s: string, w: number) => {
    if (pdf.getTextWidth(s) <= w) return s
    let t = s
    while (t.length > 1 && pdf.getTextWidth(`${t}...`) > w) t = t.slice(0, -1)
    return `${t}...`
  }

  for (const t of doc.sections) {
    const weights = t.columns.map((c) => c.width ?? (c.kind === 'money' ? 1.25 : c.kind === 'int' ? 0.7 : c.kind === 'date' ? 1.05 : 1.8))
    const sum = weights.reduce((a, b) => a + b, 0)
    const widths = weights.map((w) => ((W - 2 * M) * w) / sum)
    const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0))

    const cells = (values: string[], bold: boolean) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal')
      values.forEach((v, i) => {
        const pad = 1.5
        const text = fit(v, widths[i] - 2 * pad)
        if (isNum(t.columns[i].kind)) pdf.text(text, xs[i] + widths[i] - pad, y + 4.1, { align: 'right' })
        else pdf.text(text, xs[i] + pad, y + 4.1)
      })
    }
    const header = () => {
      pdf.setFillColor(238, 243, 255)
      pdf.rect(M, y, W - 2 * M, rowH + 0.5, 'F')
      pdf.setFontSize(8)
      pdf.setTextColor(51, 65, 85)
      cells(t.columns.map((c) => pdfText(c.label.toUpperCase())), true)
      y += rowH + 0.5
      pdf.setTextColor(15, 23, 42)
      pdf.setFontSize(8.5)
    }
    const room = (need: number) => {
      if (y + need <= H - M - 6) return false
      pdf.addPage()
      y = M
      return true
    }

    room(rowH * 4 + 8)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(15, 23, 42)
    pdf.text(pdfText(t.title), M, y + 4)
    y += 7
    header()

    if (!t.rows.length) {
      pdf.setFont('helvetica', 'italic')
      pdf.setTextColor(100, 116, 139)
      pdf.text('No records for this period.', M + 1.5, y + 4.1)
      pdf.setTextColor(15, 23, 42)
      y += rowH
    }
    t.rows.forEach((r, n) => {
      if (room(rowH)) header()
      if (n % 2 === 1) {
        pdf.setFillColor(248, 250, 252)
        pdf.rect(M, y, W - 2 * M, rowH, 'F')
      }
      cells(r.map((v, i) => display(v, t.columns[i]?.kind)), false)
      y += rowH
    })
    if (t.totals) {
      if (room(rowH)) header()
      pdf.setDrawColor(148, 163, 184)
      pdf.line(M, y, W - M, y)
      cells(t.totals.map((v, i) => display(v, t.columns[i]?.kind)), true)
      y += rowH
    }
    y += 6
  }

  if (doc.notes?.length) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    for (const note of doc.notes) {
      const lines = pdf.splitTextToSize(pdfText(note), W - 2 * M) as string[]
      if (y + lines.length * 3.8 > H - M - 6) {
        pdf.addPage()
        y = M
      }
      pdf.text(lines, M, y + 3)
      y += lines.length * 3.8 + 1
    }
  }

  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text(pdfText(`${doc.business} · ${doc.title}`), M, H - 6)
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 6, { align: 'right' })
  }
  pdf.save(`${safeFileName(doc.fileName)}.pdf`)
}
