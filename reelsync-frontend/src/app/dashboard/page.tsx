'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/utils/api'
import axios from 'axios'

interface UserProfile {
  user_id: string
  email: string
  credit_minutes: number
  phone_number: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.replace('/login')
      return
    }
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const { data } = await api.get('/api/auth/me')
      setProfile(data)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        localStorage.clear()
        router.replace('/login')
      } else {
        setError('Failed to load profile.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.clear()
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Nav */}
      <nav className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-indigo-400">ReelSync AI</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">{profile?.email}</span>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Credit Minutes</p>
            <p className="text-4xl font-bold text-indigo-600 mt-1">{profile?.credit_minutes ?? 0}</p>
            <p className="text-xs text-gray-400 mt-1">1 credit = 1 video dub</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Account</p>
            <p className="text-sm font-semibold text-gray-800 mt-2 truncate">{profile?.email}</p>
            <p className="text-xs text-gray-400 mt-1">
              {profile?.phone_number ?? 'No phone linked'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Need More Credits?</p>
            <p className="text-xs text-gray-400 mt-2">Top up via PhonePe to get +15 minutes instantly.</p>
          </div>
        </div>

        {/* Action Card */}
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-8 text-white shadow-lg">
          <h2 className="text-2xl font-bold mb-2">Start a New Dub</h2>
          <p className="text-indigo-200 text-sm mb-6">
            Upload your video, choose a language, and let AI handle the rest.
            Each dub costs 1 credit minute.
          </p>
          {(profile?.credit_minutes ?? 0) > 0 ? (
            <Link
              href="/dashboard/sync"
              className="inline-block bg-white text-indigo-700 font-semibold px-6 py-3 rounded-xl hover:bg-indigo-50 transition-colors text-sm shadow"
            >
              Upload &amp; Dub Video
            </Link>
          ) : (
            <div className="inline-block bg-white/20 text-white font-semibold px-6 py-3 rounded-xl text-sm cursor-not-allowed">
              No credits remaining
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
