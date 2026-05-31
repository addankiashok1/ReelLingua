import type { Metadata } from 'next'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { ToastProvider } from '@/components/Toast'

export const metadata: Metadata = { title: 'ReelSync AI — Dashboard' }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-white">
        <Sidebar />
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
