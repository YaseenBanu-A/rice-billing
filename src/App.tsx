import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { PrintHost } from './components/PrintHost'
import { Toaster } from './components/Toaster'
import { BillsHistory } from './pages/BillsHistory'
import { CreateBill } from './pages/CreateBill'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { AppProvider, useApp } from './store/AppContext'

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
        {page === 'settings' && <Settings />}
      </Layout>
      <Toaster />
      <PrintHost />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
