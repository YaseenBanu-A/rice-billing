import { useSyncExternalStore } from 'react'

/*
 * Can the billing server be reached right now? Three states:
 *  - online:  requests are answered
 *  - waking:  the network is up but the server isn't answering in time. On Render's free plan the server sleeps
 *             after 15 minutes and takes up to a minute to start; requests time out meanwhile.
 *  - offline: no network at all, or the server refuses connections
 * Work is saved on the device while not online. After a failure the server is probed in the background, with
 * growing gaps, until it answers (a probe also wakes a sleeping server).
 */

export type ConnectionState = 'online' | 'waking' | 'offline'

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
/** a sleeping server answers the health check in well under a minute once started; don't wait longer than this */
const PROBE_TIMEOUT_MS = 10_000

let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine
let server: 'up' | 'slow' | 'down' = 'up'
let probeTimer: ReturnType<typeof setTimeout> | undefined
let probeDelay = 3000

const listeners = new Set<() => void>()
const reconnectListeners = new Set<() => void>()

export const connectionState = (): ConnectionState => (!browserOnline ? 'offline' : server === 'up' ? 'online' : server === 'slow' ? 'waking' : 'offline')
export const isOnline = () => connectionState() === 'online'

function set(next: { browser?: boolean; server?: typeof server }) {
  const wasOnline = isOnline()
  const before = connectionState()
  if (next.browser !== undefined) browserOnline = next.browser
  if (next.server !== undefined) server = next.server
  if (connectionState() !== before) listeners.forEach((l) => l())
  if (!wasOnline && isOnline()) {
    probeDelay = 3000
    clearTimeout(probeTimer)
    reconnectListeners.forEach((l) => l())
  }
}

/** Asks the server whether it is up. Any answer below 500 counts; a timeout means it is starting or overloaded. */
export async function probe(): Promise<boolean> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/api/health`, { cache: 'no-store', credentials: 'include', signal: ctl.signal })
    // 5xx from the health check means the database is down: bills can't be saved there either
    const ok = res.status < 500
    set({ server: ok ? 'up' : 'slow', browser: true })
    return ok
  } catch {
    set({ server: ctl.signal.aborted ? 'slow' : 'down' })
    return false
  } finally {
    clearTimeout(t)
  }
}

function scheduleProbe() {
  clearTimeout(probeTimer)
  probeTimer = setTimeout(async () => {
    if (!(await probe())) {
      probeDelay = Math.min(probeDelay * 2, 60_000)
      scheduleProbe()
    }
  }, probeDelay)
}

/** A request got no answer: `timeout` = the server took too long (waking up), otherwise it couldn't be reached */
export function reportNetworkError(kind: 'timeout' | 'unreachable' = 'unreachable') {
  set({ server: kind === 'timeout' ? 'slow' : 'down' })
  scheduleProbe()
}

/** A request got an answer from the server */
export function reportServerResponse() {
  set({ server: 'up', browser: true })
}

if (typeof window !== 'undefined') {
  // the network is back: check the server is reachable before saying so (a successful probe marks us online)
  window.addEventListener('online', () => void probe().then((ok) => !ok && scheduleProbe()))
  window.addEventListener('offline', () => set({ browser: false }))
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

/** True while the billing server can be reached. Re-renders when that changes. */
export const useOnline = () => useSyncExternalStore(subscribe, isOnline)
/** online / waking / offline, for status messages */
export const useConnectionState = () => useSyncExternalStore(subscribe, connectionState)

/** Calls `fn` each time the connection comes back after being lost. */
export function onReconnect(fn: () => void) {
  reconnectListeners.add(fn)
  return () => void reconnectListeners.delete(fn)
}
