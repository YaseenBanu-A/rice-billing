import { CircleCheck, FileDown, Printer, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../store/AppContext'
import type { Bill, InvoiceFormat } from '../types'
import { FormatSwitch } from './invoice/FormatSwitch'
import { InvoiceDocument } from './invoice/InvoiceDocument'
import { Button, ConfirmDialog, Modal } from './ui'

export function BillViewModal({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { settings, printBill, downloadPdf, recordPayment, deleteBill, toast, money } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [format, setFormat] = useState<InvoiceFormat>(settings.invoiceFormat)
  if (!bill) return null

  const markPaid = async () => {
    setBusy(true)
    try {
      await recordPayment(bill.id, bill.totals.grandTotal)
      toast(`${bill.invoiceNo} marked as paid · ${money(bill.totals.balance)} received`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the bill', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      await deleteBill(bill.id)
      toast(`Bill ${bill.invoiceNo} deleted`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the bill', 'error')
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        title={`Invoice ${bill.invoiceNo}`}
        subtitle={bill.customer.name}
        footer={
          <>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} className="mr-auto">
              Delete
            </Button>
            {bill.status !== 'Paid' && (
              <Button icon={CircleCheck} onClick={markPaid} disabled={busy}>
                Mark as Paid
              </Button>
            )}
            <Button icon={FileDown} onClick={() => downloadPdf(bill, format)}>
              Download PDF
            </Button>
            <Button variant="primary" icon={Printer} onClick={() => printBill(bill, format)}>
              Print
            </Button>
          </>
        }
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ink-500">Bill size</span>
          <FormatSwitch value={format} onChange={setFormat} />
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-2 sm:p-4">
          <div className={format === 'a4' ? 'min-w-[640px] shadow-sm' : format === 'a5' ? 'mx-auto w-[560px] shadow-sm' : 'mx-auto w-[302px] shadow-sm'}>
            <InvoiceDocument bill={bill} settings={settings} format={format} />
          </div>
        </div>
        {bill.notes && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span className="font-medium">Note:</span> {bill.notes}
          </p>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${bill.invoiceNo}?`}
        message="This bill will be permanently removed from history. This cannot be undone."
        onConfirm={remove}
      />
    </>
  )
}
