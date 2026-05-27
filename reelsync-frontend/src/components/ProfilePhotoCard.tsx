'use client'

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import api from '@/utils/api'

// ─── SVG ring constants ────────────────────────────────────────────────────────
// ViewBox 128×128 · ring center (64,64) · r=54 · strokeWidth=6
// Avatar sits inside inset-[15px] → 98px diameter (< ring inner edge of 102px)
const R = 54
const C = 2 * Math.PI * R // ≈ 339.3

function ringColor(pct: number): string {
  if (pct >= 100) return '#ef4444' // red   — fully utilized
  if (pct >= 75)  return '#f97316' // orange
  if (pct >= 50)  return '#f59e0b' // amber
  return '#22c55e'                 // green  — plenty left
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProfilePhotoCardProps {
  email: string
  userId: string
  creditMinutes: number
  /**
   * Reference total used as the 100% mark for the ring.
   * Defaults to 15 (one standard top-up). Pass a higher value if
   * the user has topped up multiple times.
   */
  totalMinutes?: number
  profilePictureUrl: string | null
  /** Called after a successful upload or removal so the parent can update state. */
  onPhotoChange: (newUrl: string | null) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProfilePhotoCard({
  email,
  userId,
  creditMinutes,
  totalMinutes = 15,
  profilePictureUrl,
  onPhotoChange,
}: ProfilePhotoCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cache-bust the image URL after every upload without a page reload
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  // Build the authenticated image URL so the browser can load it directly.
  // The token is only available client-side, so we defer via useEffect.
  const [token, setToken] = useState('')
  useEffect(() => {
    setToken(localStorage.getItem('access_token') ?? '')
  }, [])

  const avatarSrc =
    profilePictureUrl && token
      ? `http://localhost:8000/api/user/profile-picture/${userId}` +
        `?token=${encodeURIComponent(token)}&v=${avatarVersion}`
      : null

  // ── Credit ring math ────────────────────────────────────────────────────────
  const usedMinutes   = Math.max(0, totalMinutes - creditMinutes)
  const utilizationPct = Math.min((usedMinutes / totalMinutes) * 100, 100)
  const dashOffset    = C * (1 - utilizationPct / 100)
  const stroke        = ringColor(utilizationPct)

  // ── Handlers ────────────────────────────────────────────────────────────────
  const openPicker = () => !uploading && fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')

    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      setError('Only PNG or JPEG images are accepted.')
      e.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller.')
      e.target.value = ''
      return
    }

    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    try {
      const { data } = await api.post<{ profile_picture_url: string }>(
        '/api/user/profile-picture',
        form,
      )
      setAvatarVersion(v => v + 1)
      onPhotoChange(data.profile_picture_url)
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail || 'Upload failed.'
          : 'Upload failed.',
      )
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleRemove = async () => {
    setError('')
    setRemoving(true)
    try {
      await api.delete('/api/user/profile-picture')
      setAvatarVersion(v => v + 1)
      onPhotoChange(null)
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail || 'Remove failed.'
          : 'Remove failed.',
      )
    } finally {
      setRemoving(false)
    }
  }

  const initial = email.charAt(0).toUpperCase()

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">

      {/* ── Ring + Avatar ──────────────────────────────────────────────────── */}
      <div className="relative w-32 h-32 mb-4">

        {/* SVG credit ring — rotated so progress starts at 12 o'clock */}
        <svg
          viewBox="0 0 128 128"
          className="absolute inset-0 w-full h-full"
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx="64" cy="64" r={R}
            fill="none" stroke="#e5e7eb" strokeWidth="6"
          />
          {/* Progress arc */}
          <circle
            cx="64" cy="64" r={R}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s ease' }}
          />
        </svg>

        {/* Utilization badge at the bottom of the ring */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span
            className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full text-white shadow"
            style={{ backgroundColor: stroke }}
          >
            {Math.round(utilizationPct)}%
          </span>
        </div>

        {/* Clickable avatar — sits inside the ring */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/jpg"
          onChange={handleFileChange}
        />

        <button
          type="button"
          onClick={openPicker}
          className="absolute inset-[15px] rounded-full overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          aria-label="Change profile picture"
        >
          {/* Photo or initials */}
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={`${email} avatar`}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex w-full h-full items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
              <span className="text-2xl font-bold text-white select-none">
                {initial}
              </span>
            </span>
          )}

          {/* Camera overlay on hover */}
          <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
            {uploading ? (
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[9px] font-semibold text-white tracking-wide uppercase">
                  Change
                </span>
              </>
            )}
          </span>
        </button>
      </div>

      {/* ── Credit info ────────────────────────────────────────────────────── */}
      <p className="text-xs text-gray-400 mt-1 mb-1 tabular-nums">
        {creditMinutes} / {totalMinutes} min remaining
      </p>
      <p className="text-[11px] font-medium mb-4" style={{ color: stroke }}>
        {Math.round(utilizationPct)}% utilized
      </p>

      {/* Edit Profile link — opens file picker */}
      <button
        type="button"
        onClick={openPicker}
        disabled={uploading}
        className="text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-full px-5 py-1.5 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
      >
        Edit Profile
      </button>

      {/* Remove link — only shown when photo exists */}
      {(profilePictureUrl || avatarSrc) && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="text-[11px] text-red-400 hover:text-red-600 disabled:text-red-300 mt-2 transition-colors"
        >
          {removing ? 'Removing…' : 'Remove current photo'}
        </button>
      )}

      {/* Inline error */}
      {error && (
        <p className="text-xs text-red-500 mt-2 text-center max-w-[180px]">{error}</p>
      )}
    </div>
  )
}
