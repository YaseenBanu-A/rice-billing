import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useApp } from '../store/AppContext'
import { cn } from './ui'

const icons = { success: CircleCheck, error: CircleAlert, info: Info }
const tones = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-brand-600',
}

export function Toaster() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto">
      {toasts.map((t) => {
        const Icon = icons[t.kind]
        return (
          <div
            key={t.id}
            role="status"
            className="animate-toast-in pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-surface px-4 py-3 shadow-pop sm:w-[360px]"
          >
            <Icon className={cn('mt-0.5 size-[18px] shrink-0', tones[t.kind])} />
            <p className="flex-1 text-sm text-ink-900">{t.message}</p>
            <button onClick={() => dismissToast(t.id)} className="rounded p-0.5 text-ink-400 hover:text-ink-700" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
