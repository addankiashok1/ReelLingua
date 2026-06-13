'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionProfile } from '@/hooks/useSessionProfile'

function getRoleChip(role: string | undefined): { label: string; className: string; dotClass: string } | null {
  const value = (role ?? '').toUpperCase()
  if (value === 'ROOT') {
    return {
      label: 'ROOT Access',
      className: 'border-fuchsia-800/60 bg-fuchsia-950/70 text-fuchsia-300',
      dotClass: 'bg-fuchsia-300',
    }
  }
  if (value === 'ADMIN') {
    return {
      label: 'Admin Access',
      className: 'border-sky-800/60 bg-sky-950/70 text-sky-300',
      dotClass: 'bg-sky-300',
    }
  }
  return null
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
  const { profile: user } = useSessionProfile({
    redirectOnUnauthorized: true,
    onUnauthorized: () => router.replace('/login'),
  })

  const displayName = useMemo(() => (user ? getDisplayName(user.email) : 'Creator'), [user])
  const greeting = useMemo(() => getGreeting(displayName), [displayName])
  const isActive = (user?.credit_minutes ?? 0) > 0
  const roleChip = getRoleChip(user?.role)

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
              {roleChip && (
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold ${roleChip.className}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${roleChip.dotClass}`} />
                  {roleChip.label}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="hidden sm:block h-8 w-8" />
    </header>
  )
}
