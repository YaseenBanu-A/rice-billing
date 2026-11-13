import { lazy, Suspense, useEffect } from 'react'
import { Layout } from './components/Layout'
import { PrintHost } from './components/PrintHost'
import { Toaster } from './components/Toaster'
import { UpdatePrompt } from './components/UpdatePrompt'
import { BillsHistory } from './pages/BillsHistory'
import { CreateBill } from './pages/CreateBill'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Settings } from './pages/Settings'
import { AppProvider, useApp } from './store/AppContext'

// loaded when first opened, so the bill screens start as fast as before
const Expenses = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.Expenses })))
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })))

function PageLoading() {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-sm text-ink-500">
      <span className="size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      Loading…
    </div>
  )
}

function Shell() {
  const { page, navigate } = useApp()

  // "N" anywhere outside a form field jumps to Create Bill
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable)
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n' && !document.querySelector('[role="dialog"]')) {
        navigate('create')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <>
      <Layout>
        {page === 'dashboard' && <Dashboard />}
        {page === 'create' && <CreateBill />}
        {page === 'history' && <BillsHistory />}
        {page === 'inventory' && <Inventory />}
        <Suspense fallback={<PageLoading />}>
          {page === 'expenses' && <Expenses />}
          {page === 'reports' && <Reports />}
        </Suspense>
        {page === 'settings' && <Settings />}
      </Layout>
      <Toaster />
      <PrintHost />
    </>
  )
}

export default function App() {
  return (
    <>
      <AppProvider>
        <Shell />
      </AppProvider>
      {/* outside the provider: also offered on the sign-in screen */}
      <UpdatePrompt />
    </>
  )
}
