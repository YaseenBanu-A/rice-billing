import { Building2, CircleCheck, Download, ImagePlus, Receipt, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BusinessMark } from '../components/BusinessMark'
import { PasswordCard } from '../components/PasswordCard'
import { LAYOUTS } from '../components/invoice/InvoiceDocument'
import { Button, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader, Select, Textarea, cn } from '../components/ui'
import { formatDate, formatMoney } from '../lib/format'
import { useLocalStorage } from '../lib/useLocalStorage'
import { useApp } from '../store/AppContext'
import type { Settings as SettingsT } from '../types'

const CURRENCIES = [
  { code: 'INR', label: 'Indian Rupee (₹)' },
  { code: 'USD', label: 'US Dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British Pound (£)' },
  { code: 'AED', label: 'UAE Dirham (AED)' },
]

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/

export function Settings() {
  const { settings, saveSettings, toast, resetData, downloadBackup, restoreBackup, bills, nextInvoiceNo, authRequired } = useApp()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<SettingsT>(settings)
  const [submitted, setSubmitted] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  // remembered on this device only, as a reminder
  const [lastBackup, setLastBackup] = useLocalStorage<string>('bd.lastBackup', () => '')
  const [backingUp, setBackingUp] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ data: unknown; bills: number; exportedAt: string } | null>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (p: Partial<SettingsT>) => setForm((f) => ({ ...f, ...p }))

  const dirty = JSON.stringify(form) !== JSON.stringify(settings)
  const errors = {
    businessName: !form.businessName.trim() ? 'Business name is required' : '',
    gstin: form.gstin && !GSTIN_RE.test(form.gstin.trim().toUpperCase()) ? 'GSTIN should be 15 characters, e.g. 29ABCDE1234F1Z5' : '',
    defaultGst: !Number.isFinite(form.defaultGst) || form.defaultGst < 0 || form.defaultGst > 28 ? 'Enter a rate between 0 and 28' : '',
    invoicePrefix: !form.invoicePrefix.trim() ? 'Prefix is required' : /\d$/.test(form.invoicePrefix) ? 'Prefix should not end with a number' : '',
  }
  const valid = Object.values(errors).every((e) => !e)
  // next number with the prefix being typed, so the preview reflects unsaved edits
  const invoicePreview = `${form.invoicePrefix || 'INV-'}${nextInvoiceNo.match(/(\d+)$/)?.[1] ?? '001'}`

  const onLogo = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Please choose an image file (PNG, JPG or SVG).', 'error')
    if (file.size > 400 * 1024) return toast('Logo must be smaller than 400 KB.', 'error')
    const reader = new FileReader()
    reader.onload = () => set({ logo: String(reader.result) })
    reader.readAsDataURL(file)
  }

  const formRef = useRef<HTMLFormElement>(null)

  // Ctrl/Cmd+S saves settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!valid) return toast('Please fix the highlighted fields.', 'error')
    if (saving) return
    setSaving(true)
    try {
      const saved = await saveSettings({ ...form, businessName: form.businessName.trim(), gstin: form.gstin.trim().toUpperCase(), invoicePrefix: form.invoicePrefix.trim() })
      setForm(saved)
      toast('Settings saved')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const backup = async () => {
    if (backingUp) return
    setBackingUp(true)
    try {
      await downloadBackup()
      setLastBackup(new Date().toISOString())
      toast('Backup downloaded. Keep the file somewhere safe, like Google Drive.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not download the backup', 'error')
    } finally {
      setBackingUp(false)
    }
  }

  const onRestoreFile = async (file?: File) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as { app?: string; bills?: unknown[]; tables?: { invoice?: unknown[] }; exportedAt?: string }
      const bills = data?.app === 'aj-rice-billing' ? data.tables?.invoice : data?.app === 'simple-billing' ? data.bills : undefined
      if (!Array.isArray(bills)) throw new Error()
      setPendingRestore({ data, bills: bills.length, exportedAt: data.exportedAt ?? '' })
    } catch {
      toast('This file is not a billing backup. Choose a file named billing-backup-….json', 'error')
    }
  }

  const restore = async () => {
    if (!pendingRestore) return
    try {
      await restoreBackup(pendingRestore.data)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not restore the backup', 'error')
    }
  }

  const reset = async () => {
    try {
      await resetData()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reset data', 'error')
    }
  }

  return (
    <form ref={formRef} onSubmit={save} className={dirty ? 'pb-24' : ''}>
      <PageHeader
        title="Settings"
        subtitle="Business details and billing preferences used on every invoice."
        actions={
          <>
            {dirty && (
              <Button onClick={() => setForm(settings)} icon={RotateCcw}>
                Discard
              </Button>
            )}
            <Button variant="primary" type="submit" icon={Save} disabled={saving}>
              Save Settings
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Business profile" subtitle="Shown in the invoice header" icon={Building2} />
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
              <div className="flex items-center gap-4 sm:col-span-2">
                <div className="rounded-xl border border-dashed border-ink-300 p-2">
                  {form.logo ? (
                    <img src={form.logo} alt="Business logo" className="size-16 rounded-lg object-contain" />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded-lg bg-slate-50 text-ink-400">
                      <ImagePlus className="size-6" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[13px] font-medium text-ink-700">Business logo</p>
                  <p className="mb-2 text-xs text-ink-400">PNG, JPG or SVG, up to 400 KB. Square works best.</p>
                  <div className="flex gap-2">
                    <Button size="sm" icon={ImagePlus} onClick={() => fileRef.current?.click()}>
                      {form.logo ? 'Change' : 'Upload'}
                    </Button>
                    {form.logo && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set({ logo: undefined })}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (onLogo(e.target.files?.[0]), (e.target.value = ''))} />
                </div>
              </div>

              <div className="sm:col-span-2">
                <Field label="Business name" error={submitted ? errors.businessName : ''}>
                  <Input value={form.businessName} invalid={submitted && !!errors.businessName} onChange={(e) => set({ businessName: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Business address">
                  <Textarea value={form.address} onChange={(e) => set({ address: e.target.value })} rows={2} />
                </Field>
              </div>
              <Field label="Phone number">
                <Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              <Field label="Email" optional>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              <Field label="GSTIN" optional error={submitted ? errors.gstin : ''}>
                <Input value={form.gstin} invalid={submitted && !!errors.gstin} onChange={(e) => set({ gstin: e.target.value })} className="font-mono uppercase" placeholder="29ABCDE1234F1Z5" maxLength={15} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Billing preferences" subtitle="Defaults for new bills" icon={Receipt} />
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
              <Field label="Default GST rate (%)" error={submitted ? errors.defaultGst : ''} hint="Used for new bill items">
                <Select value={form.defaultGst} onChange={(e) => set({ defaultGst: Number(e.target.value) })}>
                  {[0, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice prefix" error={submitted ? errors.invoicePrefix : ''} hint={`Next invoice: ${invoicePreview}`}>
                <Input value={form.invoicePrefix} invalid={submitted && !!errors.invoicePrefix} onChange={(e) => set({ invoicePrefix: e.target.value })} className="font-mono" maxLength={10} />
              </Field>

              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-700">Item rates are</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: false, t: 'GST exclusive', d: 'GST added on top' },
                    { v: true, t: 'GST inclusive', d: 'GST included in price' },
                  ].map((o) => (
                    <button
                      key={o.t}
                      type="button"
                      onClick={() => set({ gstInclusive: o.v })}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left transition-all',
                        form.gstInclusive === o.v ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-ink-300',
                      )}
                    >
                      <p className={cn('text-sm font-medium', form.gstInclusive === o.v ? 'text-brand-700' : 'text-ink-900')}>{o.t}</p>
                      <p className="text-xs text-ink-500">{o.d}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] font-medium text-ink-700">Default bill size</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(['a4', 'thermal', 'a5'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => set({ invoiceFormat: f })}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                        form.invoiceFormat === f ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-ink-300',
                      )}
                    >
                      <FormatIcon format={f} active={form.invoiceFormat === f} />
                      <span>
                        <span className={cn('block text-sm font-medium', form.invoiceFormat === f ? 'text-brand-700' : 'text-ink-900')}>{LAYOUTS[f].label}</span>
                        <span className="block text-xs text-ink-500">{LAYOUTS[f].hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-400">Used for Print and PDF unless you pick another size on the bill.</p>
              </div>

              <div className="sm:col-span-2">
                <Field label="Invoice footer message">
                  <Textarea value={form.footerMessage} onChange={(e) => set({ footerMessage: e.target.value })} rows={2} />
                </Field>
              </div>
            </div>
          </Card>

          {authRequired && <PasswordCard />}

          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {dirty ? (
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200 ring-inset">
                  <Save className="size-4" />
                </span>
              ) : (
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 ring-inset">
                  <CircleCheck className="size-4" />
                </span>
              )}
              <div>
                <p className="text-sm font-semibold text-ink-900">{dirty ? 'You have unsaved changes' : 'All settings saved'}</p>
                <p className="text-sm text-ink-500">{dirty ? 'Save to apply them to new bills and invoices.' : 'Your settings are stored in the billing database.'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {dirty && (
                <Button onClick={() => setForm(settings)} icon={RotateCcw}>
                  Discard
                </Button>
              )}
              <Button variant="primary" size="lg" type="submit" icon={Save} disabled={saving}>
                Save Settings
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-900">Backup</p>
              <p className="text-sm text-ink-500">
                Download all {bills.length} bills, customers and settings as one file. Keep it on your computer or Google Drive.
              </p>
              <p className="mt-1 text-xs text-ink-400">{lastBackup ? `Last backup on this device: ${formatDate(lastBackup)}` : 'No backup downloaded on this device yet'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="primary" icon={Download} onClick={backup} disabled={backingUp}>
                {backingUp ? 'Preparing…' : 'Download backup'}
              </Button>
              <Button icon={Upload} onClick={() => restoreRef.current?.click()}>
                Restore
              </Button>
              <input
                ref={restoreRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  onRestoreFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-900">Reset all data</p>
              <p className="text-sm text-ink-500">Delete all bills and customers. Users and settings are kept. Invoice numbers start again from 001.</p>
            </div>
            <Button variant="danger" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
              Reset data
            </Button>
          </Card>
        </div>

        {/* Live preview */}
        <div className="xl:sticky xl:top-22 xl:self-start">
          <Card className="p-5">
            <p className="mb-4 text-xs font-semibold tracking-wider text-ink-400 uppercase">Invoice header preview</p>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
                {form.logo ? <img src={form.logo} alt="" className="size-10 rounded-lg object-contain" /> : <BusinessMark size={40} />}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{form.businessName || 'Business name'}</p>
                  <p className="text-xs whitespace-pre-line text-ink-500">{form.address}</p>
                  <p className="text-xs text-ink-500">{form.phone}</p>
                  {form.gstin && <p className="text-xs font-medium text-ink-700">GSTIN: {form.gstin.toUpperCase()}</p>}
                </div>
              </div>
              <div className="flex justify-between pt-3 text-xs">
                <span className="text-ink-500">Invoice</span>
                <span className="font-mono font-medium text-ink-900">{invoicePreview}</span>
              </div>
              <div className="flex justify-between pt-1 text-xs">
                <span className="text-ink-500">Sample total</span>
                <span className="tabular font-medium text-ink-900">{formatMoney(12500, form.currency)}</span>
              </div>
              <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-ink-500">{form.footerMessage}</p>
            </div>
          </Card>
        </div>
      </div>

      {dirty && (
        <div className="animate-toast-in fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-ink-950 py-2.5 pr-2.5 pl-5 text-white shadow-pop lg:left-64">
          <p className="text-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-amber-400" />
            Unsaved changes
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm(settings)} className="h-9 rounded-lg px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
              Discard
            </button>
            <Button variant="primary" type="submit" icon={Save} disabled={saving}>
              Save Settings
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all data?"
        message="All bills and customers will be permanently deleted. Users and settings are kept. Invoice numbers will start again from 001."
        confirmLabel="Reset data"
        onConfirm={reset}
      />

      <ConfirmDialog
        open={!!pendingRestore}
        onClose={() => setPendingRestore(null)}
        title="Restore this backup?"
        message={`All current bills, customers and settings will be replaced with the backup${pendingRestore?.exportedAt ? ` from ${formatDate(pendingRestore.exportedAt)}` : ''} (${pendingRestore?.bills ?? 0} bills). Bills made after that backup will be lost. Download a backup of the current data first if you are not sure.`}
        confirmLabel="Restore backup"
        onConfirm={restore}
      />
    </form>
  )
}

/** Little paper-shape glyph: tall sheet for A4, narrow strip for a receipt, short sheet for A5. */
function FormatIcon({ format, active }: { format: 'a4' | 'thermal' | 'a5'; active: boolean }) {
  const size = { a4: 'h-9 w-7', thermal: 'h-9 w-3.5', a5: 'h-7 w-6' }[format]
  return (
    <span className="flex h-10 w-8 shrink-0 items-center justify-center">
      <span className={cn('flex flex-col justify-center gap-[3px] rounded-[3px] border-2 px-[3px]', size, active ? 'border-brand-500' : 'border-ink-300')}>
        <span className={cn('h-[2px] rounded', active ? 'bg-brand-400' : 'bg-ink-300')} />
        <span className={cn('h-[2px] rounded', active ? 'bg-brand-400' : 'bg-ink-300')} />
        <span className={cn('h-[2px] w-2/3 rounded', active ? 'bg-brand-400' : 'bg-ink-300')} />
      </span>
    </span>
  )
}
