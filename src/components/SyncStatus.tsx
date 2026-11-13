import { CloudOff, Hourglass, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDate, formatTime } from '../lib/format'
import type { OutboxOp } from '../offline/db'
import { useSyncRunning } from '../offline/sync'
import { useApp } from '../store/AppContext'
import { Button, ConfirmDialog, Modal, cn } from './ui'

/*
 * Connection and sync status: whether the server can be reached, and changes made offline that it doesn't
 * have yet. Shown in the sidebar, the top bar and (while offline) a banner; the sync panel lists the waiting
 * changes and lets the user resolve the ones the server refused.
 */

function useSyncSummary() {
  const { online, connection, outbox } = useApp()
  const running = useSyncRunning()
  const problems = outbox.filter((o) => o.status !== 'pending').length
  return { online, waking: connection === 'waking', running, waiting: outbox.length, problems }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Status box in the sidebar (replaces the old fixed "Connected to server") */
export function SidebarConnection() {
  const { online, waking, running, waiting, problems } = useSyncSummary()
  const [open, setOpen] = useState(false)
  const tone = !online ? 'amber' : problems ? 'red' : 'emerald'
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="relative flex size-2">
          {online && !problems && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
          <span className={cn('relative inline-flex size-2 rounded-full', tone === 'emerald' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-red-400')} />
        </span>
        <p className="text-xs font-medium text-white/90">{online ? 'Connected to server' : waking ? 'Server starting up · saving on this device' : 'Offline · saving on this device'}</p>
      </div>
      {waiting > 0 && (
        <button onClick={() => setOpen(true)} className="mt-1.5 flex items-center gap-1.5 text-left text-xs text-slate-300 underline-offset-2 hover:text-white hover:underline">
          {running ? <RefreshCw className="size-3 animate-spin" /> : problems ? <TriangleAlert className="size-3 text-red-300" /> : <RefreshCw className="size-3" />}
          {problems ? `${plural(problems, 'change')} need${problems === 1 ? 's' : ''} attention` : `${plural(waiting, 'change')} waiting to sync`}
        </button>
      )}
      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** Small status pill for the top bars; hidden while online with nothing to sync */
export function ConnectionPill({ dark = false }: { dark?: boolean }) {
  const { online, waking, running, waiting, problems } = useSyncSummary()
  const [open, setOpen] = useState(false)
  if (online && !waiting) return null
  const away = waking ? 'Connecting…' : 'Offline'
  const label = !online ? (waiting ? `${away} · ${waiting} to sync` : away) : problems ? `${problems} to review` : running ? 'Syncing…' : `${waiting} to sync`
  // the mobile top bar is narrow: icon and count only (the full text is the tooltip / screen-reader label)
  const short = !online ? (waiting ? String(waiting) : '') : String(problems || waiting)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Connection and sync"
        aria-label={label}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap ring-1 ring-inset transition-colors',
          dark ? 'px-2.5' : 'px-3',
          !online
            ? dark
              ? 'bg-amber-400/15 text-amber-200 ring-amber-300/30'
              : 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100'
            : problems
              ? dark
                ? 'bg-red-400/15 text-red-200 ring-red-300/30'
                : 'bg-red-50 text-red-700 ring-red-200 hover:bg-red-100'
              : dark
                ? 'bg-white/10 text-slate-200 ring-white/15'
                : 'bg-brand-50 text-brand-700 ring-brand-200 hover:bg-brand-100',
        )}
      >
        {!online ? waking ? <Hourglass className="size-3.5" /> : <CloudOff className="size-3.5" /> : problems ? <TriangleAlert className="size-3.5" /> : <RefreshCw className={cn('size-3.5', running && 'animate-spin')} />}
        {dark ? short : label}
      </button>
      <SyncPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** "Not synced" marker for a bill or product with changes the server doesn't have yet */
export function SyncChip({ id }: { id: string }) {
  const state = useApp().syncStateOf(id)
  if (!state) return null
  return (
    <span
      title={state === 'pending' ? 'Saved on this device; syncs when connected' : state === 'review' ? 'Made offline by someone not signed in now; open Sync' : 'The server refused this change; open Sync to resolve it'}
      className={cn('mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset', statusStyle[state])}
    >
      {state === 'pending' ? <CloudOff className="size-2.5" /> : <TriangleAlert className="size-2.5" />}
      {state === 'pending' ? 'Not synced' : statusText[state]}
    </span>
  )
}

/** Thin banner above the page while offline */
export function OfflineBanner() {
  const { online, connection, offlineDataFrom } = useApp()
  if (online) return null
  const waking = connection === 'waking'
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
      {waking ? <Hourglass className="size-3.5 shrink-0" /> : <CloudOff className="size-3.5 shrink-0" />}
      <span>
        {waking ? (
          <span className="font-semibold">The server is not answering yet (it may be starting up, which can take a minute).</span>
        ) : (
          <span className="font-semibold">You're offline.</span>
        )}{' '}
        New bills, payments and product changes are saved on this device and sync automatically when the connection is back.
        {offlineDataFrom && ` Showing data saved ${formatDate(offlineDataFrom)}, ${formatTime(offlineDataFrom)}.`}
      </span>
    </div>
  )
}

const statusText: Record<OutboxOp['status'], string> = { pending: 'Waiting', failed: 'Refused', conflict: 'Conflict', review: 'Needs review' }
const statusStyle: Record<OutboxOp['status'], string> = {
  pending: 'bg-slate-100 text-ink-700 ring-slate-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  conflict: 'bg-amber-50 text-amber-800 ring-amber-200',
  review: 'bg-violet-50 text-violet-700 ring-violet-200',
}
const kindText: Record<OutboxOp['kind'], string> = {
  'bill.create': 'New bill',
  'bill.update': 'Bill edit',
  'bill.payment': 'Payment',
  'product.create': 'New product',
  'product.update': 'Product edit',
}

/** Every change waiting to sync; refused ones can be retried or discarded, conflicts resolved */
export function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { online, connection, outbox, syncNow, retryChange, discardChange, toast, can, navigate, storagePersisted } = useApp()
  const isAdmin = can('users.manage')
  const running = useSyncRunning()
  const [discarding, setDiscarding] = useState<OutboxOp | null>(null)
  if (!open) return null

  const act = async (fn: () => Promise<void>, done?: string) => {
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'error')
    }
  }

  // rendered at the end of <body>: the top bar's backdrop blur would otherwise confine a fixed-position dialog to the bar
  return createPortal(
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title="Sync"
        subtitle={
          online
            ? 'Connected to the billing server'
            : connection === 'waking'
              ? 'The server is starting up: changes are kept on this device until it answers'
              : 'Offline: changes are kept on this device until the connection is back'
        }
        footer={
          <>
            <Button onClick={onClose} className="mr-auto">
              Close
            </Button>
            <Button variant="primary" icon={RefreshCw} onClick={syncNow} disabled={!online || running || !outbox.some((o) => o.status === 'pending')}>
              {running ? 'Syncing…' : 'Sync now'}
            </Button>
          </>
        }
      >
        {outbox.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Everything is synced. Nothing is waiting on this device.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {outbox.map((op) => (
              <li key={op.seq} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', statusStyle[op.status])}>{statusText[op.status]}</span>
                  <span className="text-xs text-ink-400">{kindText[op.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{op.label}</span>
                  <span className="text-xs text-ink-400">
                    {formatDate(op.createdAt)} {formatTime(op.createdAt)} · {op.userName}
                  </span>
                </div>
                {op.errorCode === 'insufficient_stock' && op.status === 'failed' && (
                  <p className="mt-1.5 text-xs font-semibold text-red-700">Not enough stock to save this bill</p>
                )}
                {op.error && (
                  <p className={cn('mt-1 text-xs', op.status === 'pending' ? 'text-ink-500' : op.status === 'review' ? 'text-violet-700' : 'text-red-600')}>
                    {op.status === 'pending' ? `Last try: ${op.error}` : op.error}
                  </p>
                )}
                {op.errorCode === 'insufficient_stock' && op.status === 'failed' && (
                  <p className="mt-1 text-xs text-ink-500">
                    {can('inventory.adjust')
                      ? 'Correct the stock in Inventory (or record the purchase), then press Try again. Nothing was saved yet.'
                      : 'Ask a manager to correct the stock, then press Try again. Nothing was saved yet.'}
                  </p>
                )}
                {op.status !== 'pending' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {op.status === 'review' ? (
                      isAdmin ? (
                        <>
                          <Button size="sm" onClick={() => act(() => retryChange(op.seq!, 'asMe'), 'It will be sent under your name')} disabled={!online}>
                            Send under my name
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setDiscarding(op)}>
                            Discard
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-ink-500">Waiting for {op.userName} to sign in, or for an administrator to decide.</p>
                      )
                    ) : op.status === 'conflict' ? (
                      <>
                        <Button size="sm" onClick={() => act(() => retryChange(op.seq!, 'keepMine'), 'Your version will be sent')}>
                          Keep my version
                        </Button>
                        <Button size="sm" onClick={() => setDiscarding(op)}>
                          Keep the server's version
                        </Button>
                      </>
                    ) : (
                      <>
                        {op.errorCode === 'insufficient_stock' && can('inventory.adjust') && (
                          <Button
                            size="sm"
                            onClick={() => {
                              onClose()
                              navigate('inventory')
                            }}
                          >
                            Open Inventory
                          </Button>
                        )}
                        <Button size="sm" onClick={() => act(() => retryChange(op.seq!))} disabled={!online}>
                          Try again
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDiscarding(op)}>
                          Discard
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {outbox.some((o) => o.kind === 'bill.create') && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-500">
            Bills made offline show a temporary number (PENDING-…). The server gives them the next invoice number when they sync; reprint the bill afterwards if the customer needs the final number.
          </p>
        )}
        {outbox.length > 0 && storagePersisted !== null && (
          <p className="mt-2 text-xs text-ink-400">
            {storagePersisted
              ? 'This browser has agreed not to clear offline data automatically. It can still be removed by clearing site data, so sync regularly.'
              : 'This browser may clear offline data when the device is low on storage. Installing the app makes this less likely; sync as soon as you can.'}
          </p>
        )}
      </Modal>
      <ConfirmDialog
        open={!!discarding}
        title={discarding?.status === 'conflict' ? "Keep the server's version?" : 'Discard this change?'}
        message={
          discarding?.kind === 'bill.create' || discarding?.kind === 'product.create'
            ? `${discarding.label} exists only on this device. Discarding it deletes it and everything queued for it. This cannot be undone.`
            : `Your offline change (${discarding?.label}) will be dropped and the server's version kept. This cannot be undone.`
        }
        confirmLabel="Discard"
        onConfirm={() => discarding && act(() => discardChange(discarding.seq!), 'Change discarded')}
        onClose={() => setDiscarding(null)}
      />
    </>,
    document.body,
  )
}
