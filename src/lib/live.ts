import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ChangeEvent } from '../types'
import { API_BASE, getAccessToken, onTokenChange, refreshSession } from './api'

/*
 * Live updates over Socket.IO. The server announces each committed change ({ entity, action, id });
 * screens showing that kind of data reload it from the API. On reconnect every screen reloads, so a
 * dropped connection never leaves stale numbers on screen.
 */

type Listener = (ev: ChangeEvent) => void
const listeners = new Set<Listener>()
let socket: Socket | null = null
let connected = false
let online: string[] = []
const statusListeners = new Set<() => void>()
const emitStatus = () => statusListeners.forEach((l) => l())

export function connectLive() {
  if (socket) return
  socket = io(API_BASE || undefined, {
    // a function, so every reconnect uses the current (possibly refreshed) token
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ['websocket', 'polling'],
    withCredentials: true,
  })
  let everConnected = false
  socket.on('connect', () => {
    connected = true
    emitStatus()
    // after a reconnect, catch up on anything missed
    if (everConnected) listeners.forEach((l) => l({ entity: 'all', action: 'reconnect' }))
    everConnected = true
  })
  socket.on('disconnect', async (reason) => {
    connected = false
    emitStatus()
    // the server closes the socket when the access token expires; get a fresh one and reconnect
    if (reason === 'io server disconnect' && (await refreshSession())) socket?.connect()
  })
  socket.on('connect_error', async (err) => {
    connected = false
    emitStatus()
    if (err.message === 'token_expired' || err.message === 'unauthenticated') {
      if (await refreshSession()) socket?.connect()
    }
  })
  socket.on('change', (ev: ChangeEvent) => listeners.forEach((l) => l(ev)))
  socket.on('presence', (names: string[]) => {
    online = names
    emitStatus()
  })
}

export function disconnectLive() {
  socket?.disconnect()
  socket = null
  connected = false
  online = []
  emitStatus()
}

// a new access token (refresh / password change) re-authenticates the socket
onTokenChange((t) => {
  if (!t) disconnectLive()
})

export function onLiveChange(l: Listener) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

const subscribe = (l: () => void) => (statusListeners.add(l), () => void statusListeners.delete(l))
let snapshot = { connected, online }
export function useLiveStatus() {
  return useSyncExternalStore(subscribe, () => {
    if (snapshot.connected !== connected || snapshot.online !== online) snapshot = { connected, online }
    return snapshot
  })
}

/** Calls `fn` whenever one of `entities` changes anywhere (debounced, so a burst of changes reloads once). */
export function useLive(entities: ChangeEvent['entity'][], fn: (ev: ChangeEvent) => void) {
  const ref = useRef(fn)
  ref.current = fn
  const key = entities.join(',')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const set = new Set(key.split(','))
    return onLiveChange((ev) => {
      if (ev.entity !== 'all' && !set.has(ev.entity)) return
      clearTimeout(timer)
      timer = setTimeout(() => ref.current(ev), 150)
    })
  }, [key])
}

/**
 * Loads data from the API, reloads when `deps` change or when a matching live change arrives.
 * Keeps showing the previous data while reloading, so lists don't flash.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[], live: ChangeEvent['entity'][] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadRef
      .current()
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  useLive(live, () => setVersion((v) => v + 1))
  return { data, error, loading, reload: () => setVersion((v) => v + 1), setData }
}
