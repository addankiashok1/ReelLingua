'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import api from '@/utils/api'

export const SESSION_PROFILE_UPDATED_EVENT = 'reelsync:profile-updated'
const PROFILE_CACHE_TTL_MS = 3000

export interface SessionProfile {
  user_id: string
  email: string
  role?: string
  credit_minutes?: number
  credit_seconds?: number
  credit_balance_credits?: number
  subscription_plan?: string
  credit_limit_minutes?: number
  credit_limit_seconds?: number
  credit_limit_credits?: number
  phone_number?: string | null
  profile_picture_url?: string | null
}

export function broadcastProfileRefresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_PROFILE_UPDATED_EVENT))
  }
}

interface UseSessionProfileOptions {
  pollMs?: number
  redirectOnUnauthorized?: boolean
  onUnauthorized?: () => void
}

let cachedProfile: SessionProfile | null = null
let cachedProfileFetchedAt = 0
let inFlightProfileRequest: Promise<SessionProfile> | null = null

function normalizeSessionProfile<T extends SessionProfile>(profile: T): T {
  return {
    ...profile,
    credit_minutes: Math.floor(profile.credit_minutes ?? 0),
    credit_seconds: Math.floor(profile.credit_seconds ?? 0),
    credit_balance_credits: Math.floor(profile.credit_balance_credits ?? 0),
    credit_limit_minutes: Math.floor(profile.credit_limit_minutes ?? 0),
    credit_limit_seconds: Math.floor(profile.credit_limit_seconds ?? 0),
    credit_limit_credits: Math.floor(profile.credit_limit_credits ?? 0),
  }
}

async function fetchSharedProfile<T extends SessionProfile = SessionProfile>(
  forceRefresh = false,
): Promise<T> {
  const now = Date.now()
  if (!forceRefresh && cachedProfile && now - cachedProfileFetchedAt < PROFILE_CACHE_TTL_MS) {
    return cachedProfile as T
  }

  if (inFlightProfileRequest) {
    return inFlightProfileRequest as Promise<T>
  }

  inFlightProfileRequest = api.get<T>('/api/auth/me')
    .then(({ data }) => {
      const normalized = normalizeSessionProfile(data)
      cachedProfile = normalized
      cachedProfileFetchedAt = Date.now()
      return normalized
    })
    .finally(() => {
      inFlightProfileRequest = null
    })

  return inFlightProfileRequest as Promise<T>
}

export function useSessionProfile<T extends SessionProfile = SessionProfile>({
  pollMs: _pollMs = 15000,
  redirectOnUnauthorized = false,
  onUnauthorized,
}: UseSessionProfileOptions = {}) {
  const [profile, setProfile] = useState<T | null>(cachedProfile as T | null)
  const [loading, setLoading] = useState(cachedProfile === null)
  const onUnauthorizedRef = useRef(onUnauthorized)
  const redirectOnUnauthorizedRef = useRef(redirectOnUnauthorized)

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized
    redirectOnUnauthorizedRef.current = redirectOnUnauthorized
  }, [onUnauthorized, redirectOnUnauthorized])

  const refreshProfile = useCallback(async (forceRefresh = true) => {
    try {
      const data = await fetchSharedProfile<T>(forceRefresh)
      setProfile(data)
      return data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.clear()
        }
        if (redirectOnUnauthorizedRef.current) {
          onUnauthorizedRef.current?.()
        }
      }
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('access_token')) {
      setLoading(false)
      if (redirectOnUnauthorizedRef.current) {
        onUnauthorizedRef.current?.()
      }
      return
    }

    void refreshProfile(false).catch(() => {})

    const handleProfileUpdated = () => {
      void refreshProfile().catch(() => {})
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshProfile().catch(() => {})
      }
    }

    window.addEventListener(SESSION_PROFILE_UPDATED_EVENT, handleProfileUpdated)
    window.addEventListener('focus', handleProfileUpdated)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener(SESSION_PROFILE_UPDATED_EVENT, handleProfileUpdated)
      window.removeEventListener('focus', handleProfileUpdated)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshProfile])

  return {
    profile,
    setProfile,
    loading,
    refreshProfile,
  }
}
