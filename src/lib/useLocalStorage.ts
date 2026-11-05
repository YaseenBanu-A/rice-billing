import { useEffect, useState } from 'react'

function read<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw) as T
  } catch {
    // ignore corrupt or blocked storage
  }
  return fallback()
}

/** State that mirrors itself into localStorage. `initial` is used only when nothing is stored. */
export function useLocalStorage<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => read(key, initial))

  useEffect(() => {
    // Runs on first render too, so seeded sample data is persisted on first launch
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      console.warn(`Could not save "${key}" to localStorage`)
    }
  }, [key, value])

  return [value, setValue] as const
}
