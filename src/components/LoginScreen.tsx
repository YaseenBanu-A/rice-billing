import { Eye, EyeOff, Lock, UserRound } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { LOGO_URL } from './BusinessMark'
import { ThemeToggle } from './ThemeToggle'
import { Button, cn } from './ui'

export function LoginScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return setError('Enter your username')
    if (!password) return setError('Enter the password')
    setBusy(true)
    setError('')
    try {
      await api.login(username.trim(), password)
      await onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={LOGO_URL} alt="A.J Rice Traders" className="mb-5 h-20 w-auto max-w-full object-contain sm:h-24" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in to billing</h1>
          <p className="mt-1.5 text-sm text-ink-500">Enter your username and password to continue.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200/70 bg-surface p-6 shadow-card">
          <label htmlFor="username" className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Username
          </label>
          <div className="relative mb-4">
            <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            <input
              id="username"
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setError('')
              }}
              className="h-11 w-full rounded-lg border border-slate-200 bg-surface pr-3 pl-9 text-sm text-ink-900 outline-none transition-colors hover:border-ink-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
          </div>
          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-700">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            <input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              className={cn(
                'h-11 w-full rounded-lg border bg-surface pr-10 pl-9 text-sm text-ink-900 outline-none transition-colors focus:ring-4',
                error ? 'border-red-400 focus:ring-red-500/15' : 'border-slate-200 hover:border-ink-300 focus:border-brand-500 focus:ring-brand-500/15',
              )}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-ink-400">You'll stay signed in on this device for 30 days.</p>
      </div>
    </div>
  )
}
