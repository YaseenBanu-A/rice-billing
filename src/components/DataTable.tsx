import { ArrowDown, ArrowUp, ArrowUpDown, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { ColKind, ExportTable, ExportValue } from '../lib/export'
import { dayLabel, PRESET_LABELS, periodError, periodLabel, periodOf, type Period, type PeriodPreset } from '../lib/period'
import { useApp } from '../store/AppContext'
import { Button, Card, Input, cn, td, th } from './ui'

/* ---------- sortable, totalled table used by Reports and Expenses ---------- */

export interface Column<T> {
  key: string
  label: string
  kind?: ColKind
  /** raw value: used for sorting, searching and export */
  value: (r: T) => ExportValue
  /** what the screen shows (defaults to the formatted value) */
  render?: (r: T) => ReactNode
  /** add up this column in the totals row */
  total?: boolean
  /** hidden on small screens (still exported) */
  hide?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  sortable?: boolean
  /** left out of exports (e.g. action buttons) */
  noExport?: boolean
}

export type Sort = { key: string; dir: 'asc' | 'desc' }

const cmp = (a: ExportValue, b: ExportValue) => {
  if (a === b) return 0
  if (a === null || a === undefined || a === '') return 1
  if (b === null || b === undefined || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' })
}

/** Searches (all text columns, or `searchText`) and sorts rows; returns what the table and the exports show. */
export function useTableView<T>(rows: T[] | undefined, columns: Column<T>[], opts: { search?: string; searchText?: (r: T) => string; initial: Sort }) {
  const [sort, setSort] = useState<Sort>(opts.initial)
  const { search = '', searchText } = opts
  const view = useMemo(() => {
    const q = search.trim().toLowerCase()
    const text = searchText ?? ((r: T) => columns.map((c) => (c.kind === 'money' || c.kind === 'int' ? '' : String(c.value(r) ?? ''))).join(' '))
    const list = q ? (rows ?? []).filter((r) => text(r).toLowerCase().includes(q)) : [...(rows ?? [])]
    const col = columns.find((c) => c.key === sort.key)
    if (col) list.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(col.value(a), col.value(b)))
    return list
  }, [rows, columns, search, searchText, sort])
  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: columns.find((c) => c.key === key)?.kind === 'text' ? 'asc' : 'desc' }))
  return { view, sort, onSort }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function totalsOf<T>(columns: Column<T>[], rows: T[]): ExportValue[] | undefined {
  if (!columns.some((c) => c.total)) return undefined
  return columns.map((c, i) => (c.total ? round2(rows.reduce((s, r) => s + (Number(c.value(r)) || 0), 0)) : i === 0 ? `Total (${rows.length})` : ''))
}

/** The rows on screen as an export section */
export function toExportTable<T>(title: string, columns: Column<T>[], rows: T[]): ExportTable {
  const cols = columns.filter((c) => !c.noExport)
  return {
    title,
    columns: cols.map((c) => ({ label: c.label, kind: c.kind })),
    rows: rows.map((r) => cols.map((c) => c.value(r))),
    totals: totalsOf(cols, rows),
  }
}

const hideCls = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell' }
const PAGE = 200

export function DataTable<T>({
  columns,
  rows,
  sort,
  onSort,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
}: {
  columns: Column<T>[]
  rows: T[]
  sort: Sort
  onSort: (key: string) => void
  rowKey: (r: T) => string
  onRowClick?: (r: T) => void
  rowClassName?: (r: T) => string | undefined
  empty?: ReactNode
}) {
  const { money } = useApp()
  const [shown, setShown] = useState(PAGE)
  const totals = totalsOf(columns, rows)
  // the "Total" label goes in the first column that is visible on every screen size
  const labelAt = Math.max(0, columns.findIndex((c) => !c.hide && !c.total))
  const right = (c: Column<T>) => c.kind === 'money' || c.kind === 'int'

  const show = (c: Column<T>, r: T): ReactNode => {
    if (c.render) return c.render(r)
    const v = c.value(r)
    if (v === null || v === undefined || v === '') return <span className="text-ink-400">—</span>
    if (c.kind === 'money') return money(Number(v))
    if (c.kind === 'int') return Number(v).toLocaleString('en-IN')
    if (c.kind === 'date') return dayLabel(String(v).slice(0, 10))
    return String(v)
  }

  if (!rows.length) return <>{empty}</>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              {columns.map((c) => {
                const active = sort.key === c.key
                const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <th key={c.key} className={cn(th, right(c) && 'text-right', c.hide && hideCls[c.hide])} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortable === false ? (
                      c.label
                    ) : (
                      <button onClick={() => onSort(c.key)} className={cn('inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-700', active && 'text-ink-700', right(c) && 'flex-row-reverse')}>
                        {c.label}
                        <Icon className={cn('size-3', !active && 'opacity-40')} />
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, shown).map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn('transition-colors hover:bg-slate-50/70', onRowClick && 'cursor-pointer', rowClassName?.(r))}>
                {columns.map((c) => (
                  <td key={c.key} className={cn(td, right(c) && 'tabular text-right', c.hide && hideCls[c.hide])}>
                    {show(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn(td, 'font-semibold text-ink-900', right(c) && 'tabular text-right', c.hide && hideCls[c.hide])}>
                    {c.total ? (c.kind === 'money' ? money(Number(totals[i])) : Number(totals[i]).toLocaleString('en-IN')) : i === labelAt ? `Total (${rows.length})` : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > shown && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 px-4 py-3 text-xs text-ink-500">
          Showing {shown.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} rows (totals and exports include all).
          <Button size="sm" variant="ghost" onClick={() => setShown((s) => s + PAGE * 5)}>
            Show more
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShown(rows.length)}>
            Show all
          </Button>
        </div>
      )}
    </>
  )
}

/* ---------- period picker ---------- */

const PRESETS: Exclude<PeriodPreset, 'custom'>[] = ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'fy']

/** Today / week / month / financial year presets, or any custom dates (applied once both are valid). */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [draft, setDraft] = useState({ from: value.from, to: value.to })
  const [custom, setCustom] = useState(value.preset === 'custom')
  const error = custom ? periodError(draft) : ''

  const setDates = (d: { from: string; to: string }) => {
    setDraft(d)
    if (!periodError(d)) onChange({ preset: 'custom', ...d })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5">
          {[...PRESETS, 'custom' as const].map((p) => {
            const active = custom ? p === 'custom' : value.preset === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  if (p === 'custom') {
                    setCustom(true)
                    setDraft({ from: value.from, to: value.to })
                  } else {
                    setCustom(false)
                    onChange(periodOf(p))
                  }
                }}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-all', active ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900')}
              >
                {PRESET_LABELS[p]}
              </button>
            )
          })}
        </div>
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
          From
          <Input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDates({ ...draft, from: e.target.value })} className="h-9 w-auto!" aria-label="From date" />
          to
          <Input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDates({ ...draft, to: e.target.value })} className="h-9 w-auto!" aria-label="To date" />
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </div>
  )
}

export const periodText = (p: Period) => (p.preset === 'custom' ? periodLabel(p) : `${PRESET_LABELS[p.preset]} · ${periodLabel(p)}`)

/* ---------- summary card ---------- */

// shades the dark theme redefines (index.css), so the icons read well in both themes
const TONES = {
  brand: 'bg-gradient-to-b from-brand-50 to-brand-100 text-brand-600 ring-brand-200/60',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-600 ring-amber-200',
  red: 'bg-red-50 text-red-600 ring-red-200',
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'brand', valueClass }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: keyof typeof TONES; valueClass?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONES[tone])}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className={cn('tabular mt-1 text-xl font-semibold tracking-[-0.01em] text-ink-900 sm:text-[22px]', valueClass)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </Card>
  )
}

/* ---------- tabs ---------- */

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; icon?: LucideIcon }[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
      <div className="inline-flex min-w-full gap-1 border-b border-slate-200">
        {tabs.map(({ value: v, label, icon: Icon }) => (
          <button
            key={v}
            role="tab"
            aria-selected={value === v}
            onClick={() => onChange(v)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              value === v ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:border-slate-300 hover:text-ink-900',
            )}
          >
            {Icon && <Icon className={cn('size-4', value === v ? 'text-brand-600' : 'text-ink-400')} />}
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
