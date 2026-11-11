import { CalendarDays, ChartColumn, History, LayoutDashboard, LogOut, Menu, Package, Plus, ReceiptText, Settings as SettingsIcon, Wallet, X, type LucideIcon } from 'lucide-react'
import type { Permission } from '../../shared/permissions.ts'
import { useState, type ReactNode } from 'react'
import { DEMO } from '../lib/api'
import { formatMoney } from '../lib/format'

// Price shown in the demo banner (VITE_DEMO_PRICE in .env.demo; 0 hides it)
const DEMO_PRICE = Number(import.meta.env.VITE_DEMO_PRICE ?? 0)
import { useApp } from '../store/AppContext'
import type { Page } from '../types'
import { BusinessMark } from './BusinessMark'
import { ThemeIconToggle, ThemeToggle } from './ThemeToggle'
import { cn } from './ui'

const NAV: { page: Page; label: string; icon: LucideIcon; hint?: string; perm?: Permission }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'create', label: 'Create Bill', icon: ReceiptText, hint: 'N' },
  { page: 'history', label: 'Bills History', icon: History },
  { page: 'inventory', label: 'Inventory', icon: Package },
  // shown only to roles that may use them (managers and administrators); the server checks again
  { page: 'expenses', label: 'Expenses', icon: Wallet, perm: 'expenses.view' },
  { page: 'reports', label: 'Reports', icon: ChartColumn, perm: 'reports.view' },
  { page: 'settings', label: 'Settings', icon: SettingsIcon },
]

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  create: 'Create Bill',
  history: 'Bills History',
  inventory: 'Inventory',
  expenses: 'Expenses',
  reports: 'Reports',
  settings: 'Settings',
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { page, navigate, products, can } = useApp()
  const lowStock = products.filter((p) => p.stock <= p.reorderLevel).length
  return (
    <nav className="flex flex-col gap-1">
      {NAV.filter((n) => !n.perm || can(n.perm)).map(({ page: p, label, icon: Icon, hint }) => {
        const active = page === p
        return (
          <button
            key={p}
            onClick={() => {
              navigate(p)
              onNavigate?.()
            }}
            className={cn(
              'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-150',
              active
                ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-white',
            )}
          >
            {active && <span className="absolute top-2.5 bottom-2.5 -left-4 w-[3px] rounded-r-full bg-brand-400 shadow-[0_0_12px_2px_rgb(93_128_247/0.6)]" />}
            <Icon className={cn('size-[18px] transition-colors', active ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')} strokeWidth={1.9} />
            {label}
            {p === 'inventory' && lowStock > 0 && (
              <span title={`${lowStock} low on stock`} className="ml-auto rounded-full bg-amber-400/15 px-1.5 text-[10px] leading-4 font-semibold text-amber-300 ring-1 ring-amber-400/30 ring-inset">
                {lowStock}
              </span>
            )}
            {hint && (
              <kbd className="ml-auto hidden rounded-md border border-white/10 bg-white/5 px-1.5 text-[10px] font-medium text-slate-400 lg:inline">{hint}</kbd>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function Brand() {
  const { settings } = useApp()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BusinessMark size={38} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{settings.businessName || 'Your Business'}</p>
        <p className="text-xs text-slate-400">Billing workspace</p>
      </div>
    </div>
  )
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { settings, startNewBill, authRequired, logout } = useApp()
  return (
    <>
      <button
        onClick={() => {
          startNewBill()
          onNavigate?.()
        }}
        className="mb-6 flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-brand-500 to-brand-600 text-sm font-medium text-white shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_8px_20px_-6px_rgb(41_82_227/0.7)] transition-all hover:from-brand-400 hover:to-brand-600"
      >
        <Plus className="size-4" /> New Bill
      </button>
      <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">Workspace</p>
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <p className="text-xs font-medium text-white/90">{DEMO ? 'Demo mode' : 'Connected to server'}</p>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          Prices {settings.gstInclusive ? 'include' : 'exclude'} GST · default rate {settings.defaultGst}%
        </p>
        {authRequired && (
          <button
            onClick={() => {
              onNavigate?.()
              logout()
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="size-3.5" /> Log out
          </button>
        )}
      </div>
    </>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { page, settings, authRequired, logout, resetData } = useApp()
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink-950 px-4 py-5 lg:flex dark:border-r dark:border-white/[0.06]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top_left,rgb(58_94_240/0.22),transparent_70%)]" />
        <div className="relative px-1 pb-6">
          <Brand />
        </div>
        <div className="relative flex flex-1 flex-col">
          <SidebarBody />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-ink-950 px-4 lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeIconToggle />
          {authRequired && (
            <button onClick={logout} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Log out" title="Log out">
              <LogOut className="size-5" />
            </button>
          )}
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="animate-toast-in absolute inset-y-0 left-0 flex w-72 flex-col bg-ink-950 px-4 py-5 shadow-pop">
            <div className="flex items-center justify-between px-1 pb-6">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        {/* Desktop top bar */}
        <div className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-slate-200/70 bg-surface/75 px-8 backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-400">{settings.businessName}</span>
            <span className="text-ink-300">/</span>
            <span className="font-medium text-ink-900">{TITLES[page]}</span>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <CalendarDays className="size-4 text-ink-400" />
              {today}
            </div>
            <ThemeToggle />
            {authRequired && (
              <button
                onClick={logout}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-3 text-xs font-medium text-ink-700 shadow-xs transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="size-3.5" />
                Log out
              </button>
            )}
          </div>
        </div>
        {DEMO && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
            <span>
              <span className="font-semibold">Demo</span> · try anything: your changes are saved only in this browser.
            </span>
            <button onClick={resetData} className="font-semibold underline underline-offset-2 hover:no-underline">
              Reset demo
            </button>
            {DEMO_PRICE > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                Software price: {formatMoney(DEMO_PRICE, 'INR', 0)}
              </span>
            )}
          </div>
        )}
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  )
}
