import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'bd.theme'
const listeners = new Set<() => void>()

/** Saved choice, else the operating system preference. index.html applies the same rule before first paint. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // storage blocked: fall back to the system setting
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current: Theme = initialTheme()

export function setTheme(next: Theme) {
  current = next
  const root = document.documentElement
  root.classList.add('theme-switching')
  root.classList.toggle('dark', next === 'dark')
  window.setTimeout(() => root.classList.remove('theme-switching'), 250)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // not persisted; the choice still applies for this visit
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current)
  return { theme, setTheme }
}
