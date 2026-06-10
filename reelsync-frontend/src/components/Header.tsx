'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

interface UserMeta {
  email: string
  profile_picture_url: string | null
  credit_minutes?: number
}

function getDisplayName(email: string): string {
  const local = email.split('@')[0]
  const cleaned = local
    .replace(/[._\-]/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return cleaned || local
}

function getGreeting(name: string): string {
  const hour = new Date().getHours()
  if (hour < 12) return `Good Morning, ${name}`
  if (hour < 17) return `Good Afternoon, ${name}`
  return `Good Evening, ${name}`
}

export default function Header() {
  const router = useRouter()
  const [user, setUser] = useState<UserMeta | null>(null)
  const vRef = useRef(Date.now())

  useEffect(() => {
    api.get<UserMeta>('/api/auth/me')
      .then(r => setUser(r.data))
      .catch(err => {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          localStorage.clear()
          router.replace('/login')
        }
      })
  }, [])

  const handleLogout = () => {
    localStorage.clear()
    router.replace('/login')
  }

  const avatarSrc = user?.profile_picture_url
    ? `http://localhost:8000${user.profile_picture_url}?v=${vRef.current}`
    : null
  const initial = user?.email.charAt(0).toUpperCase() ?? '?'
  const displayName = user ? getDisplayName(user.email) : 'Creator'
  const greeting = getGreeting(displayName)
  const isActive = (user?.credit_minutes ?? 0) > 0

  return (
    <header className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between gap-4 border-b border-slate-800 shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-sm text-slate-400 font-medium">Dashboard</span>
        {user && (
          <>
            <span className="hidden h-4 w-px bg-slate-800 md:block" />
            <div className="hidden min-w-0 items-center gap-3 md:flex">
              <span className="truncate text-sm font-bold text-white">{greeting}</span>
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  isActive
                    ? 'border-emerald-800/60 bg-emerald-950/70 text-emerald-400'
                    : 'border-amber-800/60 bg-amber-950/70 text-amber-400'
                }`}
                style={{ boxShadow: isActive ? '0 0 14px rgba(16,185,129,0.2)' : '0 0 14px rgba(245,158,11,0.2)' }}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {isActive ? 'Active Creator' : 'Ready to Refuel'}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {user ? (
          <>
            <span className="text-sm text-slate-400 hidden sm:block">{user.email}</span>
            <Link
              href="/dashboard/profile"
              aria-label="Profile settings"
              className="block w-8 h-8 rounded-full overflow-hidden ring-2 ring-slate-700 hover:ring-indigo-400 focus:outline-none transition-all flex-shrink-0"
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="flex w-full h-full items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
                  <span className="text-xs font-bold text-white select-none">{initial}</span>
                </span>
              )}
            </Link>
          </>
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse" />
        )}
        <button
          onClick={handleLogout}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
