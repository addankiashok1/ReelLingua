'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'
import { broadcastProfileRefresh, useSessionProfile } from '@/hooks/useSessionProfile'

const API_BASE = 'http://localhost:8000'

const RING_R = 66
const RING_C = 2 * Math.PI * RING_R

function ringStroke(pct: number): string {
  if (pct >= 100) return '#ef4444'
  if (pct >= 75)  return '#f97316'
  if (pct >= 50)  return '#f59e0b'
  return '#22c55e'
}

interface UserProfile {
  user_id: string
  email: string
  role?: string
  credit_minutes: number
  credit_limit_minutes: number
  subscription_plan: string
  phone_number: string | null
  profile_picture_url: string | null
}

function formatRole(role: string | undefined): string {
  const value = (role ?? 'USER').toUpperCase()
  if (value === 'ROOT') return 'ROOT Access'
  if (value === 'ADMIN') return 'Admin Access'
  return 'User Access'
}

export default function ProfilePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving]   = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')

  const [currentPw, setCurrentPw]   = useState('')
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [pwLoading, setPwLoading]   = useState(false)
  const [pwError, setPwError]       = useState('')
  const [pwSuccess, setPwSuccess]   = useState('')

  const {
    profile,
    setProfile,
    loading,
    refreshProfile,
  } = useSessionProfile<UserProfile>({
    redirectOnUnauthorized: true,
    onUnauthorized: () => router.replace('/login'),
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { router.replace('/login'); return }
  }, [])

  useEffect(() => {
    if (!profile) return
    setAvatarSrc(
      profile.profile_picture_url
        ? `${API_BASE}${profile.profile_picture_url}?v=${Date.now()}`
        : null,
    )
  }, [profile])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(''); setSuccess('')

    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      setError('Only PNG or JPEG images are accepted.')
      e.target.value = ''; return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller.')
      e.target.value = ''; return
    }

    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    try {
      const { data } = await api.post<{ profile_picture_url: string }>(
        '/api/user/profile-picture', form,
      )
      setAvatarSrc(`${API_BASE}${data.profile_picture_url}?v=${Date.now()}`)
      setProfile(prev => prev ? { ...prev, profile_picture_url: data.profile_picture_url } : prev)
      broadcastProfileRefresh()
      setSuccess('Profile picture updated.')
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.detail || 'Upload failed.') : 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleRemove = async () => {
    setError(''); setSuccess('')
    setRemoving(true)
    try {
      await api.delete('/api/user/profile-picture')
      setAvatarSrc(null)
      setProfile(prev => prev ? { ...prev, profile_picture_url: null } : prev)
      broadcastProfileRefresh()
      setSuccess('Profile picture removed.')
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.detail || 'Remove failed.') : 'Remove failed.')
    } finally {
      setRemoving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(''); setPwSuccess('')
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.')
      return
    }
    setPwLoading(true)
    try {
      await api.post('/api/user/change-password', {
        current_password: currentPw,
        new_password: newPw,
        confirm_new_password: confirmPw,
      })
      setPwSuccess('Password updated successfully!')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err) {
      setPwError(axios.isAxiosError(err) ? (err.response?.data?.detail || 'Update failed.') : 'Update failed.')
    } finally {
      setPwLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  const credits        = profile?.credit_minutes ?? 0
  const totalMinutes   = profile?.credit_limit_minutes ?? 2
  const usedMinutes    = Math.max(0, totalMinutes - credits)
  const utilizationPct = Math.min((usedMinutes / totalMinutes) * 100, 100)
  const dashOffset     = RING_C * (1 - utilizationPct / 100)
  const stroke         = ringStroke(utilizationPct)
  const initial        = profile ? profile.email.charAt(0).toUpperCase() : '?'
  const planLabel      = (profile?.subscription_plan ?? 'free')
    .charAt(0).toUpperCase() + (profile?.subscription_plan ?? 'free').slice(1)
  const roleLabel      = formatRole(profile?.role)

  return (
    <div className="max-w-xl mx-auto px-6 py-12">

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-8">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-8">
          {success}
        </div>
      )}

      {/* ── Centered avatar section ──────────────────────────────────────────── */}
      <div className="flex flex-col items-center mb-10">

        <div className="relative w-40 h-40 mb-5">
          <svg
            viewBox="0 0 160 160"
            className="absolute inset-0 w-full h-full"
            style={{ transform: 'rotate(-90deg)' }}
            aria-hidden="true"
          >
            <circle cx="80" cy="80" r={RING_R} fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
              cx="80" cy="80" r={RING_R}
              fill="none"
              stroke={stroke}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s ease' }}
            />
          </svg>

          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <span
              className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full text-white shadow-sm"
              style={{ backgroundColor: stroke }}
            >
              {Math.round(utilizationPct)}%
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/jpg"
            onChange={handleFileChange}
          />

          <button
            type="button"
            onClick={() => !uploading && fileInputRef.current?.click()}
            className="absolute inset-[20px] rounded-full overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            aria-label="Upload or change profile picture"
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="Your profile" className="w-full h-full object-cover" />
            ) : (
              <span className="flex w-full h-full items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
                <span className="text-3xl font-bold text-white select-none">{initial}</span>
              </span>
            )}
            <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-full">
              {uploading ? (
                <svg className="animate-spin h-6 w-6 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <>
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-[9px] font-semibold text-white tracking-wide uppercase">Change</span>
                </>
              )}
            </span>
          </button>
        </div>

        <p className="text-base font-semibold text-gray-900 text-center">{profile?.email}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600">
          {roleLabel}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
          {credits} / {totalMinutes} min &middot; {Math.round(utilizationPct)}% utilized
        </p>

        {/* Subscription link */}
        <Link
          href="/dashboard/billing"
          className="mt-3 mb-2 inline-flex items-center gap-1.5 text-xs font-semibold
                     text-indigo-600 border border-indigo-200 rounded-full px-4 py-1.5
                     hover:bg-indigo-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          Manage Subscription &amp; Credits
        </Link>

        {avatarSrc && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="text-sm text-red-500 hover:text-red-700 disabled:text-red-300 font-medium transition-colors"
          >
            {removing ? 'Removing…' : 'Remove Photo'}
          </button>
        )}
      </div>

      {/* ── Change Password card ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-6">Change Password</h2>

        {pwError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {pwError}
          </div>
        )}
        {pwSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-5">
            {pwSuccess}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Current Password</label>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              required
              minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              required
              minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            type="submit"
            disabled={pwLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {pwLoading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* ── Account details card ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-base font-semibold text-gray-900 mb-6">Account Details</h2>
        <dl className="space-y-5">
          <div>
            <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Subscription Plan</dt>
            <dd className="text-sm font-medium text-gray-900">{planLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Phone Number</dt>
            <dd className="text-sm font-medium text-gray-900">
              {profile?.phone_number ?? <span className="text-gray-400 font-normal">Not linked</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Credit Balance</dt>
            <dd className="flex items-center gap-3">
              <span className="text-sm font-bold text-indigo-600">{credits} minutes</span>
              <Link href="/dashboard/billing" className="text-xs text-indigo-500 hover:underline">
                Top up →
              </Link>
            </dd>
          </div>
        </dl>
      </div>

    </div>
  )
}
