'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

// ─── Email validation ─────────────────────────────────────────────────────────

const _BLOCKED_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net',
  'test.com', 'test.org', 'test.net',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.org',
  'tempmail.com', 'throwaway.email', 'yopmail.com',
  'sharklasers.com', 'trashmail.com', 'dispostable.com',
  'xyz.com', 'foo.com', 'bar.com',
])
const _TYPO_DOMAINS: Record<string, string> = {
  'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmil.com': 'gmail.com', 'gimail.com': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
}
const _EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

function validateEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  if (!_EMAIL_RE.test(normalized)) return 'Enter a valid email address (e.g. name@domain.com).'
  const domain = normalized.split('@')[1]
  if (_BLOCKED_DOMAINS.has(domain)) return 'Please enter a valid, permanent email address.'
  const suggestion = _TYPO_DOMAINS[domain]
  if (suggestion) return `Did you mean @${suggestion}? Please check your email address.`
  return null
}

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'login' | 'forgot-request' | 'forgot-reset'

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()

  // ── Login state ─────────────────────────────────────────────────────────────
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // ── View controller ─────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('login')

  // Success banner shown on the login view after a completed password reset
  const [resetSuccess, setResetSuccess] = useState('')

  // ── Forgot-request state ─────────────────────────────────────────────────────
  const [frEmail, setFrEmail]   = useState('')
  const [frError, setFrError]   = useState('')
  const [frLoading, setFrLoading] = useState(false)

  // Email carried from forgot-request into forgot-reset
  const [resetEmail, setResetEmail] = useState('')

  // ── Forgot-reset state ───────────────────────────────────────────────────────
  const [rrOtp, setRrOtp]           = useState('')
  const [rrNewPw, setRrNewPw]       = useState('')
  const [rrConfirmPw, setRrConfirmPw] = useState('')
  const [rrError, setRrError]       = useState('')
  const [rrLoading, setRrLoading]   = useState(false)

  // Resend cooldown (mirrors signup OTP page pattern)
  const [resendCooldown, setResendCooldown] = useState(0)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const startResendTimer = () => {
    setResendCooldown(60)
    const id = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(id); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const goToLogin = () => {
    setView('login')
    setFrEmail(''); setFrError('')
    setRrOtp(''); setRrNewPw(''); setRrConfirmPw(''); setRrError('')
    setResendCooldown(0)
  }

  // ── Login handler ─────────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResetSuccess('')

    const emailError = validateEmail(email)
    if (emailError) { setError(emailError); return }

    setLoading(true)
    try {
      const { data } = await api.post('/api/auth/login', { email, password })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('user_id', data.user_id)
      localStorage.setItem('user_email', data.email)
      router.push('/dashboard')
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? (err.response?.data?.detail || 'Login failed. Check your credentials.')
          : 'An unexpected error occurred.'
      )
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot-request handler ────────────────────────────────────────────────────

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setFrError('')

    const emailError = validateEmail(frEmail)
    if (emailError) { setFrError(emailError); return }

    setFrLoading(true)
    try {
      await api.post('/api/auth/forgot-password-request', { email: frEmail })
      setResetEmail(frEmail)
      setView('forgot-reset')
      startResendTimer()
    } catch (err) {
      setFrError(
        axios.isAxiosError(err)
          ? (err.response?.data?.detail || 'Request failed. Please try again.')
          : 'An unexpected error occurred.'
      )
    } finally {
      setFrLoading(false)
    }
  }

  // ── Resend handler (on forgot-reset step) ─────────────────────────────────────

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setRrError('')
    try {
      await api.post('/api/auth/forgot-password-request', { email: resetEmail })
      startResendTimer()
    } catch {
      setRrError('Could not resend code. Please try again.')
    }
  }

  // ── Reset-password handler ────────────────────────────────────────────────────

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setRrError('')

    if (rrNewPw !== rrConfirmPw) {
      setRrError('New passwords do not match.')
      return
    }

    setRrLoading(true)
    try {
      await api.post('/api/auth/reset-password-verify', {
        email: resetEmail,
        otp_code: rrOtp,
        new_password: rrNewPw,
        confirm_new_password: rrConfirmPw,
      })
      setResetSuccess('Password updated successfully! Please log in with your new credentials.')
      goToLogin()
    } catch (err) {
      setRrError(
        axios.isAxiosError(err)
          ? (err.response?.data?.detail || 'Reset failed. Please try again.')
          : 'An unexpected error occurred.'
      )
    } finally {
      setRrLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">ReelSync AI</h1>
          <p className="text-slate-400 mt-2">
            {view === 'login'         && 'Sign in to your account'}
            {view === 'forgot-request' && 'Reset your password'}
            {view === 'forgot-reset'  && 'Enter your reset code'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* ── LOGIN VIEW ─────────────────────────────────────────────────── */}
          {view === 'login' && (
            <>
              {resetSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-6">
                  {resetSuccess}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="••••••••"
                  />
                  <div className="text-right mt-1.5">
                    <button
                      type="button"
                      onClick={() => { setResetSuccess(''); setView('forgot-request') }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                    >
                      Forgot Password?
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-6">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="text-indigo-600 hover:underline font-medium">
                  Sign up
                </Link>
              </p>
            </>
          )}

          {/* ── FORGOT-REQUEST VIEW ────────────────────────────────────────── */}
          {view === 'forgot-request' && (
            <>
              <p className="text-sm text-gray-500 mb-6">
                Enter the email address linked to your account and we&apos;ll send you a
                6-digit reset code.
              </p>

              <form onSubmit={handleForgotRequest} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={frEmail}
                    onChange={e => setFrEmail(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="you@example.com"
                  />
                </div>

                {frError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {frError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={frLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                >
                  {frLoading ? 'Sending…' : 'Send Reset Code'}
                </button>
              </form>

              <button
                type="button"
                onClick={goToLogin}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700 mt-5 transition-colors"
              >
                ← Back to Sign In
              </button>
            </>
          )}

          {/* ── FORGOT-RESET VIEW ──────────────────────────────────────────── */}
          {view === 'forgot-reset' && (
            <>
              <p className="text-sm text-gray-500 mb-1">
                We sent a 6-digit code to
              </p>
              <p className="text-sm font-semibold text-gray-800 mb-6 truncate">{resetEmail}</p>

              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reset Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={rrOtp}
                    onChange={e => setRrOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm tracking-[0.35em] font-mono text-center"
                    placeholder="000000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={rrNewPw}
                    onChange={e => setRrNewPw(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={rrConfirmPw}
                    onChange={e => setRrConfirmPw(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="••••••••"
                  />
                </div>

                {rrError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {rrError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={rrLoading || rrOtp.length < 6}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                >
                  {rrLoading ? 'Resetting…' : 'Reset Password'}
                </button>
              </form>

              {/* Resend + back */}
              <div className="flex items-center justify-between mt-5">
                <button
                  type="button"
                  onClick={goToLogin}
                  className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  className="text-sm text-indigo-500 hover:text-indigo-700 disabled:text-gray-400 font-medium transition-colors"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
