import { useState } from 'react'
import { initials } from '../lib/format'
import { useApp } from '../store/AppContext'

/** The shop's logo file (public/logo.png), served from the app's own address. */
// eslint-disable-next-line react-refresh/only-export-components
export const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`

/** Business logo uploaded in Settings, otherwise the shop logo; a monogram tile only if the image can't load. */
export function BusinessMark({ size = 36, mono = false }: { size?: number; mono?: boolean }) {
  const { settings } = useApp()
  const [failed, setFailed] = useState(false)
  const src = settings.logo || LOGO_URL
  if (!failed) {
    return <img src={src} alt="" onError={() => setFailed(true)} style={{ width: size, height: size }} className="shrink-0 object-contain" />
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={
        mono
          ? 'flex shrink-0 items-center justify-center rounded-lg border-2 border-black font-bold text-black'
          : 'flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 font-semibold text-white shadow-sm shadow-brand-600/30'
      }
    >
      {initials(settings.businessName)}
    </div>
  )
}
