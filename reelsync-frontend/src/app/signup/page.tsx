'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function SignupPage() {
  const router = useRouter()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // ── OTP state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(300)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // OTP expiry countdown
  useEffect(() => {
    if (step !== 'otp' || timeLeft <= 0) return
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [step, timeLeft])

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Auto-focus first digit when modal opens
  useEffect(() => {
    if (step === 'otp') {
      const t = setTimeout(() => inputRefs.current[0]?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [step])

  // ── Form submit → /signup-request ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const emailError = validateEmail(email)
    if (emailError) { setError(emailError); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true)
    try {
      const payload: Record<string, string> = { email, password }
      if (phone.trim()) payload.phone_number = phone.trim()
      await api.post('/api/auth/signup-request', payload)
      setStep('otp')
      setTimeLeft(300)
      setResendCooldown(60)
      setOtpDigits(['', '', '', '', '', ''])
      setOtpError('')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail
        setError(Array.isArray(detail) ? (detail[0]?.msg || 'Request failed.') : (detail || 'Request failed.'))
      } else {
        setError('An unexpected error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── OTP digit handlers ───────────────────────────────────────────────────────
  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const digits = [...otpDigits]
    digits[index] = value.slice(-1)
    setOtpDigits(digits)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const digits = ['', '', '', '', '', '']
    pasted.split('').forEach((ch, i) => { digits[i] = ch })
    setOtpDigits(digits)
    inputRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  // ── Verify OTP → /verify-otp ────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    setOtpError('')
    const otp_code = otpDigits.join('')
    if (otp_code.length !== 6) { setOtpError('Please enter all 6 digits.'); return }
    if (timeLeft === 0) { setOtpError('Code expired. Click "Resend code" to get a new one.'); return }

    setOtpLoading(true)
    try {
      const { data } = await api.post('/api/auth/verify-otp', { email, otp_code })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('user_id', data.user_id)
      localStorage.setItem('user_email', data.email)
      router.push('/dashboard')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setOtpError(err.response?.data?.detail || 'Verification failed.')
      } else {
        setOtpError('An unexpected error occurred.')
      }
    } finally {
      setOtpLoading(false)
    }
  }

  // ── Resend code ──────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return
    setOtpError('')
    try {
      const payload: Record<string, string> = { email, password }
      if (phone.trim()) payload.phone_number = phone.trim()
      await api.post('/api/auth/signup-request', payload)
      setOtpDigits(['', '', '', '', '', ''])
      setTimeLeft(300)
      setResendCooldown(60)
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setOtpError(err.response?.data?.detail || 'Failed to resend code.')
      } else {
        setOtpError('Failed to resend. Please try again.')
      }
    }
  }

  // ── OTP Modal ────────────────────────────────────────────────────────────────
  const otpModal = step === 'otp' && (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Check your inbox</h2>
          <p className="text-sm text-gray-500 mt-1">We sent a 6-digit code to</p>
          <p className="text-sm font-semibold text-indigo-600 mt-0.5 break-all">{email}</p>
        </div>

        {/* Digit grid */}
        <div className="flex gap-2 justify-center mb-5" onPaste={handlePaste}>
          {otpDigits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleDigitChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className={`w-10 h-12 text-center text-xl font-bold rounded-xl border-2 transition-all caret-transparent
                focus:outline-none focus:ring-2 focus:ring-indigo-200
                ${digit ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-900'}
              `}
            />
          ))}
        </div>

        {/* Countdown */}
        <div className="text-center mb-4">
          {timeLeft > 0 ? (
            <div className="flex items-center justify-center gap-1.5">
              <svg className={`w-3.5 h-3.5 ${timeLeft <= 60 ? 'text-red-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 6v6l4 2" />
              </svg>
              <span className={`text-sm font-mono font-medium tabular-nums ${timeLeft <= 60 ? 'text-red-500' : 'text-gray-500'}`}>
                {formatTime(timeLeft)}
              </span>
              <span className="text-xs text-gray-400">remaining</span>
            </div>
          ) : (
            <span className="text-sm text-red-500 font-medium">Code expired</span>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 rounded-full mb-5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${timeLeft <= 60 ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${(timeLeft / 300) * 100}%` }}
          />
        </div>

        {/* Error */}
        {otpError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {otpError}
          </div>
        )}

        {/* Verify button */}
        <button
          onClick={handleVerifyOtp}
          disabled={otpLoading || otpDigits.join('').length !== 6 || timeLeft === 0}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
        >
          {otpLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Verifying…
            </span>
          ) : 'Verify & Complete Setup'}
        </button>

        {/* Resend + Back */}
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            type="button"
            onClick={() => { setStep('form'); setOtpError('') }}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="text-indigo-600 hover:underline disabled:text-gray-400 disabled:no-underline transition-colors"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Signup form ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center px-4">
      {otpModal}

      <div className={`w-full max-w-md transition-all duration-300 ${step === 'otp' ? 'opacity-20 pointer-events-none select-none' : ''}`}>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">ReelSync AI</h1>
          <p className="text-slate-400 mt-2">Create your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="you@gmail.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Min. 6 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm ${
                  confirmPassword && password !== confirmPassword
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-300'
                }`}
                placeholder="Re-enter password"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number <span className="text-gray-400 font-normal">(optional — India only)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="9876543210 or +919876543210"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Sending code…
                </span>
              ) : 'Send Verification Code'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
