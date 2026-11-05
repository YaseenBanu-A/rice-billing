import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useApp } from '../store/AppContext'
import { Button, Card, CardHeader, Field, Input } from './ui'

const MIN = 8

/**
 * Lives inside the Settings <form>, so it can't be a form itself: Enter is handled here
 * so it changes the password instead of submitting the settings.
 */
export function PasswordCard() {
  const { toast } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<{ field?: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const errors = {
    current: !current ? 'Enter your current password' : serverError?.field === 'currentPassword' ? serverError.message : '',
    next: next.length < MIN ? `At least ${MIN} characters` : next === current ? 'Must be different from the current password' : '',
    confirm: confirm !== next ? 'Passwords do not match' : '',
  }

  const change = async () => {
    setSubmitted(true)
    setServerError(null)
    if (errors.next || errors.confirm || !current) return
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSubmitted(false)
      toast('Password changed. Other devices have been signed out.')
    } catch (e) {
      const field = e instanceof ApiError ? Object.keys(e.fields ?? {})[0] : undefined
      setServerError({ field, message: e instanceof Error ? e.message : 'Could not change password' })
      if (!field) toast(e instanceof Error ? e.message : 'Could not change password', 'error')
    } finally {
      setBusy(false)
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      change()
    }
  }

  const type = show ? 'text' : 'password'
  const err = (k: keyof typeof errors) => (submitted || (k === 'current' && serverError) ? errors[k] : '')

  return (
    <Card>
      <CardHeader title="Change password" subtitle="The password used to sign in to this app" icon={KeyRound} />
      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2 sm:max-w-[calc(50%-10px)]">
          <Field label="Current password" error={err('current')}>
            <Input
              type={type}
              autoComplete="current-password"
              value={current}
              invalid={!!err('current')}
              onChange={(e) => {
                setCurrent(e.target.value)
                setServerError(null)
              }}
              onKeyDown={onEnter}
            />
          </Field>
        </div>
        <Field label="New password" error={err('next')} hint={`At least ${MIN} characters`}>
          <Input type={type} autoComplete="new-password" value={next} invalid={!!err('next')} onChange={(e) => setNext(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <Field label="Confirm new password" error={err('confirm')}>
          <Input type={type} autoComplete="new-password" value={confirm} invalid={!!err('confirm')} onChange={(e) => setConfirm(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-900">
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {show ? 'Hide passwords' : 'Show passwords'}
          </button>
          <Button variant="dark" icon={KeyRound} onClick={change} disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-ink-500 sm:col-span-2">
          Changing the password signs out every other phone and computer. Forgot it? The owner can reset it with{' '}
          <span className="font-mono text-ink-700">npm run user:reset-password</span> (on Render: Shell).
        </p>
      </div>
    </Card>
  )
}
