import { production } from '../config.ts'

type Level = 'info' | 'warn' | 'error'

/** One line per event: JSON in production (searchable in Render's log viewer), readable text locally. */
function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const out = level === 'error' ? console.error : console.log
  if (production) {
    out(JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }))
  } else {
    const extra = data && Object.keys(data).length ? ' ' + JSON.stringify(data) : ''
    out(`${level === 'info' ? '-' : level.toUpperCase()} ${msg}${extra}`)
  }
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
}
