import { X, type LucideIcon } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { PaymentStatus } from '../types'

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

/* ---------- Button ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_1px_2px_0_rgb(15_23_42/0.1),0_6px_16px_-6px_rgb(41_82_227/0.6)] hover:from-brand-500 hover:to-brand-700 active:translate-y-px focus-visible:ring-brand-500/40',
  dark: 'bg-ink-900 text-white shadow-sm hover:bg-slate-800 active:bg-black focus-visible:ring-slate-500/40',
  secondary:
    'bg-surface text-ink-900 border border-slate-200/90 shadow-[0_1px_2px_0_rgb(15_23_42/0.05)] hover:bg-slate-50 hover:border-ink-300 active:translate-y-px focus-visible:ring-brand-500/30',
  ghost: 'text-ink-700 hover:bg-slate-100 hover:text-ink-900 focus-visible:ring-brand-500/30',
  danger:
    'bg-surface text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300 focus-visible:ring-red-500/30',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, className, tone = 'default', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: 'default' | 'danger' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-ink-500 transition-colors outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30',
        tone === 'danger' ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-ink-900',
        className,
      )}
      {...rest}
    >
      <Icon className="size-4" />
    </button>
  )
}

/* ---------- Card ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-slate-200/70 bg-surface shadow-card', className)}>{children}</div>
}

export function CardHeader({ title, subtitle, action, icon: Icon }: { title: string; subtitle?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-b from-brand-50 to-brand-100 text-brand-600 ring-1 ring-brand-200/60 ring-inset">
            <Icon className="size-4" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink-900">{title}</h3>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

/* ---------- Page header ---------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ---------- Form fields ---------- */

const fieldBase =
  'w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-xs transition-colors outline-none hover:border-ink-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-ink-500'

export function Label({ children, htmlFor, optional }: { children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-700">
      {children}
      {optional && <span className="ml-1 font-normal text-ink-400">(optional)</span>}
    </label>
  )
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(fieldBase, 'h-10', invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/15', className)}
      {...rest}
    />
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'min-h-[80px] py-2.5', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-10 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, optional, error, children, htmlFor, hint }: { label: string; optional?: boolean; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <Label htmlFor={htmlFor} optional={optional}>
        {label}
      </Label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <svg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
      {value && (
        <button onClick={() => onChange('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/* ---------- Segmented control ---------- */

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
            value === o.value ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Badge ---------- */

const statusStyles: Record<PaymentStatus, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  Partial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Unpaid: 'bg-red-50 text-red-700 ring-red-600/15',
  Cancelled: 'bg-slate-100 text-ink-500 ring-slate-400/30',
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', statusStyles[status])}>
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-700">{children}</span>
}

/* ---------- Modal ---------- */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cn('animate-toast-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-500 border-transparent"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-700">{message}</p>
    </Modal>
  )
}

/* ---------- Empty state ---------- */

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-ink-400">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ---------- Table helpers ---------- */

export const th = 'px-5 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-ink-400 uppercase whitespace-nowrap'
export const td = 'px-5 py-3.5 text-sm text-ink-700 whitespace-nowrap'

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  // stable soft hue per name
  const hues = ['bg-brand-50 text-brand-700 ring-brand-200/70', 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', 'bg-amber-50 text-amber-700 ring-amber-200/70', 'bg-violet-50 text-violet-700 ring-violet-200/70', 'bg-rose-50 text-rose-700 ring-rose-200/70', 'bg-sky-50 text-sky-700 ring-sky-200/70']
  const h = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % hues.length
  const text = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.36 }} className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset', hues[h])}>
      {text}
    </span>
  )
}
