'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import api from '@/utils/api'

// ─── Nav item definitions ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    exact: true,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/projects',
    label: 'Projects',
    exact: false,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/billing',
    label: 'Billing & Credits',
    exact: false,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
]

// ─── Trash icon ───────────────────────────────────────────────────────────────

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname()
  const [trashCount, setTrashCount] = useState<number>(0)

  // Load trash item count for the badge — best-effort, silent on failure
  useEffect(() => {
    api.get<{ count: number }>('/api/trash/count')
      .then(res => setTrashCount(res.data.count ?? 0))
      .catch(() => {})
  }, [pathname]) // re-fetch whenever the user navigates (e.g. after deleting)

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href)

  const isTrashActive = pathname.startsWith('/dashboard/trash')

  return (
    <aside className="w-60 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">

      {/* Brand strip */}
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-indigo-400 font-extrabold text-lg tracking-tight">ReelSync AI</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActive(item.href, item.exact)
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      {/* ── Bottom section: Trash + Profile ─────────────────────────────── */}
      <div className="px-3 pb-5 space-y-1 border-t border-slate-800/60 pt-3">

        {/* Trash link */}
        <Link
          href="/dashboard/trash"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            isTrashActive
              ? 'bg-red-600/20 text-red-300 border border-red-800/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <TrashIcon className="w-5 h-5" />
          <span className="flex-1">Trash</span>

          {/* Item count badge — only shown when trash is non-empty */}
          {trashCount > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
              isTrashActive
                ? 'bg-red-600/40 text-red-300'
                : 'bg-slate-700 text-slate-400'
            }`}>
              {trashCount > 99 ? '99+' : trashCount}
            </span>
          )}
        </Link>

        {/* Profile settings */}
        <Link
          href="/dashboard/profile"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            pathname.startsWith('/dashboard/profile')
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          Profile Settings
        </Link>

      </div>
    </aside>
  )
}
