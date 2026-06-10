'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem('dashboard_sidebar_collapsed')
    setSidebarCollapsed(stored === 'true')
  }, [])

  useEffect(() => {
    window.localStorage.setItem('dashboard_sidebar_collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const toggleSidebar = () => setSidebarCollapsed(current => !current)

  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-white">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto bg-slate-900">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
