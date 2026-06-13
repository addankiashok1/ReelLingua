'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '@/utils/api'
import { useSessionProfile } from '@/hooks/useSessionProfile'

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

function formatRoleLabel(role: string | undefined): string {
  const value = (role ?? 'USER').toUpperCase()
  if (value === 'ROOT') return 'ROOT Access'
  if (value === 'ADMIN') return 'Admin Access'
  return 'User Access'
}

function isPrivilegedRole(role: string | undefined): boolean {
  const value = (role ?? '').toUpperCase()
  return value === 'ROOT' || value === 'ADMIN'
}

function formatPlanCredits(value: number): string {
  if (value >= 1000) {
    const formatted = value % 1000 === 0 ? `${value / 1000}` : `${(value / 1000).toFixed(1)}`
    return `${formatted.replace(/\.0$/, '')}k`
  }
  return `${value}`
}

function formatSecondsLabel(value: number): string {
  return `${Math.max(0, value)} sec`
}

function SidebarLink({
  label,
  active,
  collapsed,
  disabled = false,
  onClick,
  title,
  children,
  trailing,
}: {
  label: string
  active: boolean
  collapsed: boolean
  disabled?: boolean
  onClick?: () => void
  title?: string
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  const className = `flex items-center rounded-xl text-sm font-medium transition-all ${
    disabled
      ? 'cursor-not-allowed text-slate-600 hover:bg-slate-900 hover:text-slate-500'
      : active
        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
  } ${collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'}`

  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? (title ?? label) : undefined}
      className={className}
    >
      {children}
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && trailing}
    </button>
  )
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const profileWrapperRef = useRef<HTMLDivElement | null>(null)
  const [trashCount, setTrashCount] = useState(0)
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false)
  const { profile, refreshProfile } = useSessionProfile({
    redirectOnUnauthorized: true,
    onUnauthorized: () => router.replace('/login'),
  })

  useEffect(() => {
    api.get<{ count: number }>('/api/trash/count')
      .then(res => setTrashCount(res.data.count ?? 0))
      .catch(() => {})
  }, [pathname])

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

  useEffect(() => {
    void refreshProfile().catch(() => {})
  }, [pathname, refreshProfile])

  const planLabel = profile?.subscription_plan
    ? `${profile.subscription_plan.charAt(0).toUpperCase()}${profile.subscription_plan.slice(1)}`
    : 'Free'
  const roleLabel = formatRoleLabel(profile?.role)
  const hasPrivilegedAccess = isPrivilegedRole(profile?.role)
  const hasWorkspaceAccess = hasPrivilegedAccess || (profile?.subscription_plan ?? 'free').toLowerCase() !== 'free'
  const isFreePlan = (profile?.subscription_plan ?? 'free').toLowerCase() === 'free'
  const remainingPlanCredits = profile?.credit_balance_credits ?? 0
  const planCreditTotal = profile?.credit_limit_credits ?? 0
  const remainingPct = planCreditTotal > 0 ? Math.min(100, Math.round((remainingPlanCredits / planCreditTotal) * 100)) : 0
  const usedPlanCredits = Math.max(planCreditTotal - remainingPlanCredits, 0)
  const remainingPlanSeconds = profile?.credit_seconds ?? 0
  const planSecondsTotal = profile?.credit_limit_seconds ?? 60
  const remainingSecondsPct = planSecondsTotal > 0 ? Math.min(100, Math.round((remainingPlanSeconds / planSecondsTotal) * 100)) : 0
  const usedPlanSeconds = Math.max(planSecondsTotal - remainingPlanSeconds, 0)
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
            label={item.label}
            active={isActive(item.href, item.exact)}
            collapsed={collapsed}
            disabled={item.href === '/dashboard/projects' && !hasWorkspaceAccess}
            onClick={() => {
              if (item.href === '/dashboard/projects' && !hasWorkspaceAccess) {
                router.push('/dashboard/billing?restricted=projects')
                return
              }
              router.push(item.href)
            }}
            title={
              item.href === '/dashboard/projects' && !hasWorkspaceAccess
                ? 'Upgrade to Starter or above to access Projects'
                : undefined
            }
          >
            {item.icon}
          </SidebarLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="border-t border-slate-800/60 px-3 pb-5 pt-4">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {isFreePlan ? 'Usage & Plan' : 'Credits & Plan'}
          </p>

          <div className="space-y-4 px-1">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-2.21 0-4 1.79-4 4m4-4c2.21 0 4 1.79 4 4m-4-4V4m0 8v8m0 0H8m4 0h4" />
                </svg>
                <span className="font-medium text-slate-200">
                  {isFreePlan
                    ? `Seconds left: ${formatSecondsLabel(remainingPlanSeconds)} / ${formatSecondsLabel(planSecondsTotal)}`
                    : `Credits: ${formatPlanCredits(remainingPlanCredits)} / ${formatPlanCredits(planCreditTotal)}`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${isFreePlan ? remainingSecondsPct : remainingPct}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isFreePlan
                  ? `${formatSecondsLabel(usedPlanSeconds)} used from your one-time free limit`
                  : `${formatPlanCredits(usedPlanCredits)} credits used this cycle`}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {hasPrivilegedAccess ? 'Access & Plan' : 'Your Plan'}
                  </p>
                  {hasPrivilegedAccess && (
                    <p className="mt-1 text-xs font-semibold text-emerald-300">{roleLabel}</p>
                  )}
                  <p className="mt-1 text-sm font-semibold text-white">{planLabel}</p>
                  {hasPrivilegedAccess && (
                    <p className="mt-1 text-[11px] text-slate-500">Billing plan stays separate from privileged access.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/billing')}
                  className="text-[11px] font-semibold text-indigo-400 transition hover:text-indigo-300"
                >
                  Manage
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`border-t border-slate-800/60 pt-3 ${collapsed ? 'px-2 pb-4' : 'px-3 pb-5'}`}>
        <div className="space-y-1">
          <SidebarLink
            label="Trash"
            title="Trash"
            active={pathname.startsWith('/dashboard/trash')}
            collapsed={collapsed}
            onClick={() => router.push('/dashboard/trash')}
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

              <button
                type="button"
                onClick={() => {
                  setIsProfileDropdownOpen(false)
                  router.push('/dashboard/profile')
                }}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-800"
              >
                <ProfileIcon className="h-4 w-4 text-slate-400" />
                Profile Settings
              </button>

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
