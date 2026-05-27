'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

interface UserMeta {
  email: string
  profile_picture_url: string | null
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

  return (
    <header className="bg-slate-900 text-white px-6 py-3.5 flex items-center justify-between border-b border-slate-800 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400 font-medium">Dashboard</span>
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
