import { Moon, Sun } from 'lucide-react'
import { useTheme, type Theme } from '../lib/theme'
import { cn } from './ui'

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/** Light / Dark segmented switch for the desktop top bar. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-full border border-slate-200 bg-slate-100/70 p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all',
              active ? 'bg-surface text-ink-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            <Icon className={cn('size-3.5', active && value === 'light' && 'text-amber-500', active && value === 'dark' && 'text-brand-400')} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Single icon button for the mobile top bar (which is always dark). */
export function ThemeIconToggle() {
  const { theme, setTheme } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const Icon = theme === 'dark' ? Sun : Moon
  return (
    <button onClick={() => setTheme(next)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon className="size-5" />
    </button>
  )
}
