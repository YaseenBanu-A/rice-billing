import { CloudDownload, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/*
 * Registers the service worker (offline copy of the app) and offers new versions after a deploy. The new
 * version is only switched to when the user clicks Reload, so a bill being typed is never interrupted
 * (the bill draft is kept in the browser either way).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // an installed app can stay open for days: look for a new version every hour
      if (registration) setInterval(() => navigator.onLine && registration.update().catch(() => {}), 60 * 60_000)
    },
  })
  if (!needRefresh) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex max-w-[calc(100vw-2rem)]">
      <div role="status" className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-surface px-4 py-3 shadow-pop sm:w-[360px]">
        <CloudDownload className="mt-0.5 size-[18px] shrink-0 text-brand-600" />
        <div className="flex-1">
          <p className="text-sm text-ink-900">A new version of the app is ready.</p>
          <button onClick={() => void updateServiceWorker(true)} className="mt-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
            Reload to update
          </button>
        </div>
        <button onClick={() => setNeedRefresh(false)} className="rounded p-0.5 text-ink-400 hover:text-ink-700" aria-label="Later">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
