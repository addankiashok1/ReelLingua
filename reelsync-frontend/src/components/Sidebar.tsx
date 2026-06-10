'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '@/utils/api'

const CHARS_PER_MINUTE = 750

interface UserProfile {
  email: string
  credit_minutes: number
  credit_limit_minutes: number
  subscription_plan: string
  profile_picture_url: string | null
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    exact: true,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/dashboard/projects',
    label: 'Projects',
    exact: false,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/billing',
    label: 'Billing & Credits',
    exact: false,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
] as const

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 5H7a2 2 0 00-2 2v10a2 2 0 002 2h6" />
    </svg>
  )
}

function getDisplayName(email: string | undefined): string {
  if (!email) return 'Creator'
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

function SidebarLink({
  href,
  label,
  active,
  collapsed,
  title,
  children,
  trailing,
}: {
  href: string
  label: string
  active: boolean
  collapsed: boolean
  title?: string
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={collapsed ? (title ?? label) : undefined}
      className={`flex items-center rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      } ${collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'}`}
    >
      {children}
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && trailing}
    </Link>
  )
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const profileWrapperRef = useRef<HTMLDivElement | null>(null)
  const [trashCount, setTrashCount] = useState(0)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false)

  useEffect(() => {
    api.get<{ count: number }>('/api/trash/count')
      .then(res => setTrashCount(res.data.count ?? 0))
      .catch(() => {})
  }, [pathname])

  useEffect(() => {
    api.get<UserProfile>('/api/auth/me')
      .then(res => setProfile(res.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!profileWrapperRef.current?.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
    }
  }, [])

  useEffect(() => {
    setIsProfileDropdownOpen(false)
  }, [collapsed, pathname])

  const credits = profile?.credit_minutes ?? 0
  const maxMin = profile?.credit_limit_minutes ?? 2
  const totalChars = maxMin * CHARS_PER_MINUTE
  const availChars = credits * CHARS_PER_MINUTE
  const charPct = totalChars > 0 ? Math.min(100, Math.round((availChars / totalChars) * 100)) : 0
  const videoPct = maxMin > 0 ? Math.min(100, Math.round((credits / maxMin) * 100)) : 0
  const planLabel = profile?.subscription_plan
    ? `${profile.subscription_plan.charAt(0).toUpperCase()}${profile.subscription_plan.slice(1)}`
    : 'Free'
  const displayName = useMemo(() => getDisplayName(profile?.email), [profile?.email])
  const avatarSrc = profile?.profile_picture_url
    ? `http://localhost:8000${profile.profile_picture_url}`
    : null
  const avatarInitial = (profile?.email?.charAt(0) ?? 'C').toUpperCase()

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href)

  const handleSignOut = () => {
    localStorage.clear()
    router.replace('/login')
  }

  return (
    <aside className={`flex shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-[width] duration-300 ${collapsed ? 'w-20' : 'w-60'}`}>
      <div className={`border-b border-slate-800 ${collapsed ? 'px-3 py-4' : 'px-5 py-5'}`}>
        <div className={`flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between gap-3'}`}>
          {collapsed ? (
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600/15 text-base font-black text-indigo-300">
              R
            </span>
          ) : (
            <span className="text-lg font-extrabold tracking-tight text-indigo-400">ReelSync AI</span>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <svg className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(item => (
          <SidebarLink
            key={item.href}
            href={item.href}
            label={item.label}
            active={isActive(item.href, item.exact)}
            collapsed={collapsed}
          >
            {item.icon}
          </SidebarLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="border-t border-slate-800/60 px-3 pb-5 pt-4">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Usage & Limits</p>

          <div className="space-y-4 px-1">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span className="font-medium text-slate-200">Audio: {availChars.toLocaleString()} / {totalChars.toLocaleString()} chars</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-red-500/80 transition-all duration-300" style={{ width: `${charPct}%` }} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m-8 6a9 9 0 100-18 9 9 0 000 18z" />
                </svg>
                <span className="font-medium text-slate-200">Video: {credits} / {maxMin} min</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-slate-700 transition-all duration-300" style={{ width: `${videoPct}%` }} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your Plan</p>
                  <p className="mt-1 text-sm font-semibold text-white">Plan: {planLabel}</p>
                </div>
                <Link href="/dashboard/billing" className="text-[11px] font-semibold text-purple-400 transition hover:text-purple-300">
                  Upgrade
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`border-t border-slate-800/60 pt-3 ${collapsed ? 'px-2 pb-4' : 'px-3 pb-5'}`}>
        <div className="space-y-1">
          <SidebarLink
            href="/dashboard/trash"
            label="Trash"
            title="Trash"
            active={pathname.startsWith('/dashboard/trash')}
            collapsed={collapsed}
            trailing={
              trashCount > 0 ? (
                <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-300">
                  {trashCount > 99 ? '99+' : trashCount}
                </span>
              ) : undefined
            }
          >
            <TrashIcon className="h-5 w-5" />
          </SidebarLink>
        </div>

        <div ref={profileWrapperRef} className={`relative ${collapsed ? 'mt-2' : 'mt-3'}`}>
          <button
            type="button"
            onClick={() => setIsProfileDropdownOpen(current => !current)}
            className={`flex w-full items-center rounded-xl border border-slate-800 bg-slate-900/80 text-left transition-colors hover:border-slate-700 hover:bg-slate-900 ${
              collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'
            }`}
            aria-expanded={isProfileDropdownOpen}
            aria-label={collapsed ? 'Open profile menu' : undefined}
            title={collapsed ? 'Profile menu' : undefined}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt="Profile avatar"
                className="h-9 w-9 rounded-full object-cover ring-2 ring-slate-700"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white ring-2 ring-slate-700">
                {avatarInitial}
              </span>
            )}

            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                </div>
                <ChevronDownIcon
                  className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${
                    isProfileDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
          </button>

          {isProfileDropdownOpen && (
            <div className={`absolute z-50 w-56 space-y-1 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl ${collapsed ? 'bottom-0 left-16' : 'bottom-14 left-4'}`}>
              <div className="mb-1 break-all border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
                {profile?.email ?? 'Loading account...'}
              </div>

              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-800"
              >
                <ProfileIcon className="h-4 w-4 text-slate-400" />
                Profile Settings
              </Link>

              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-400 transition-colors hover:bg-rose-950/30"
              >
                <LogoutIcon className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
