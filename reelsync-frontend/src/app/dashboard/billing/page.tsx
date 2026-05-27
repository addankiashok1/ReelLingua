'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import api from '@/utils/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  user_id: string
  email: string
  credit_minutes: number
  subscription_plan: string
  credit_limit_minutes: number
}

type PlanId = 'FREE' | 'STARTER' | 'CREATOR' | 'PRO'

interface Tier {
  id: PlanId
  label: string
  badge: string | null
  priceDisplay: string
  basePrice: number
  gstAmount: number
  handlingFee: number
  totalPerMonth: number
  billingNote: string
  minLimit: number
  charLimit: number
  quality: string
  allowDownload: boolean
  allowRecording: boolean
  watermark: boolean
  crossSubtitles: boolean
  voiceCloning: boolean
  allowPriority: boolean
  accentColor: string
  btnClass: string
}

// ─── Tier catalogue — mirrors billing.py FINAL_TIERS ─────────────────────────

const TIERS: Tier[] = [
  {
    id: 'FREE',
    label: 'Free',
    badge: null,
    priceDisplay: '₹0',
    basePrice: 0,
    gstAmount: 0,
    handlingFee: 0,
    totalPerMonth: 0,
    billingNote: 'forever free',
    minLimit: 2,
    charLimit: 1_500,
    quality: '720p',
    allowDownload: false,
    allowRecording: false,
    watermark: true,
    crossSubtitles: false,
    voiceCloning: true,
    allowPriority: false,
    accentColor: 'gray',
    btnClass: 'bg-gray-700 hover:bg-gray-800 text-white',
  },
  {
    id: 'STARTER',
    label: 'Starter',
    badge: null,
    priceDisplay: '₹750',
    basePrice: 750,
    gstAmount: 135,
    handlingFee: 7.5,
    totalPerMonth: 892.5,
    billingNote: '+ 18% GST + 1% handling',
    minLimit: 15,
    charLimit: 11_250,
    quality: '1080p',
    allowDownload: true,
    allowRecording: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    allowPriority: false,
    accentColor: 'indigo',
    btnClass: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  },
  {
    id: 'CREATOR',
    label: 'Creator',
    badge: 'Popular',
    priceDisplay: '₹1,200',
    basePrice: 1_200,
    gstAmount: 216,
    handlingFee: 0,
    totalPerMonth: 1_416,
    billingNote: '+ 18% GST',
    minLimit: 40,
    charLimit: 30_000,
    quality: '4K',
    allowDownload: true,
    allowRecording: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    allowPriority: false,
    accentColor: 'purple',
    btnClass: 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white',
  },
  {
    id: 'PRO',
    label: 'Pro',
    badge: null,
    priceDisplay: '₹10,000',
    basePrice: 10_000,
    gstAmount: 1_800,
    handlingFee: 0,
    totalPerMonth: 11_800,
    billingNote: '+ 18% GST',
    minLimit: 400,
    charLimit: 300_000,
    quality: '4K',
    allowDownload: true,
    allowRecording: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    allowPriority: true,
    accentColor: 'amber',
    btnClass: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white',
  },
]

const TIER_ORDER: PlanId[] = ['FREE', 'STARTER', 'CREATOR', 'PRO']

const FEATURE_ROWS: { label: string; getValue: (t: Tier) => boolean | string }[] = [
  { label: 'Processing min / month', getValue: t => `${t.minLimit.toLocaleString()} min` },
  { label: 'Output quality',         getValue: t => t.quality },
  { label: 'Chars/min cap',          getValue: t => t.charLimit.toLocaleString() },
  { label: 'Download video',         getValue: t => t.allowDownload },
  { label: 'Studio recording',       getValue: t => t.allowRecording },
  { label: 'No watermark',           getValue: t => !t.watermark },
  { label: 'Cross subtitles',        getValue: t => t.crossSubtitles },
  { label: 'AI voice cloning',       getValue: t => t.voiceCloning },
  { label: 'Priority queue',         getValue: t => t.allowPriority },
]

// ─── Accent colour map ────────────────────────────────────────────────────────

const ACCENT: Record<string, { border: string; text: string; bg: string }> = {
  gray:   { border: 'border-gray-200',   text: 'text-gray-700',   bg: 'bg-gray-50'   },
  indigo: { border: 'border-indigo-200', text: 'text-indigo-600', bg: 'bg-indigo-50' },
  purple: { border: 'border-purple-200', text: 'text-purple-600', bg: 'bg-purple-50' },
  amber:  { border: 'border-amber-200',  text: 'text-amber-600',  bg: 'bg-amber-50'  },
}

// ─── Feature cell ─────────────────────────────────────────────────────────────

function FeatureCell({ value, accent }: { value: boolean | string; accent: string }) {
  if (typeof value === 'string') {
    return <span className={`text-sm font-semibold ${ACCENT[accent].text}`}>{value}</span>
  }
  return value ? (
    <svg className={`w-5 h-5 ${ACCENT[accent].text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ─── Redirect overlay ─────────────────────────────────────────────────────────

function PurchaseOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl px-10 py-9 flex flex-col items-center gap-5 max-w-xs w-full mx-4">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
          <div
            className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 animate-spin"
            style={{ animationDuration: '0.85s' }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-indigo-600 font-black text-xl select-none">P</span>
        </div>
        <div className="text-center">
          <p className="text-gray-900 font-semibold text-base">Connecting to PhonePe</p>
          <p className="text-gray-400 text-sm mt-1 leading-relaxed">Preparing your secure UPI checkout&hellip;</p>
        </div>
      </div>
    </div>
  )
}

// ─── Trust badge ──────────────────────────────────────────────────────────────

function TrustBadge({ icon, label, sub }: { icon: 'shield' | 'zap' | 'refresh'; label: string; sub: string }) {
  const icons = {
    shield:  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
    zap:     <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />,
    refresh: <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
  }
  return (
    <div className="flex items-center gap-2.5 text-left">
      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {icons[icon]}
        </svg>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400">{sub}</p>
      </div>
    </div>
  )
}

// ─── Main billing content ─────────────────────────────────────────────────────

function BillingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [profile, setProfile]             = useState<UserProfile | null>(null)
  const [loading, setLoading]             = useState(true)
  const [purchasing, setPurchasing]       = useState(false)
  const [switchingFree, setSwitchingFree] = useState(false)
  const [activePlan, setActivePlan]       = useState<PlanId | null>(null)
  const [error, setError]                 = useState('')
  const [successMsg, setSuccessMsg]       = useState('')

  const returnTxn    = searchParams.get('txn')
  const returnStatus = searchParams.get('status')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { router.replace('/login'); return }
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const { data } = await api.get<UserProfile>('/api/auth/me')
      setProfile(data)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        localStorage.clear()
        router.replace('/login')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribe = async (planId: PlanId) => {
    setError('')
    setSuccessMsg('')
    setActivePlan(planId)

    if (planId === 'FREE') {
      setSwitchingFree(true)
      try {
        await api.post('/api/payments/subscribe', { target_plan: 'FREE' })
        setSuccessMsg('Switched to Free plan successfully.')
        await fetchProfile()
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.detail || 'Could not switch plan. Please try again.')
        } else {
          setError('An unexpected error occurred. Please try again.')
        }
      } finally {
        setSwitchingFree(false)
        setActivePlan(null)
      }
      return
    }

    setPurchasing(true)
    try {
      const { data } = await api.post<{ payment_url: string; merchant_txn_id: string }>(
        '/api/payments/subscribe',
        { target_plan: planId },
      )
      window.location.href = data.payment_url
    } catch (err) {
      setPurchasing(false)
      setActivePlan(null)
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Could not initiate payment. Please try again.')
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  const currentPlan      = ((profile?.subscription_plan ?? 'free').toUpperCase()) as PlanId
  const currentPlanLabel = TIERS.find(t => t.id === currentPlan)?.label ?? 'Free'
  const credits          = profile?.credit_minutes ?? 0

  return (
    <>
      {purchasing && <PurchaseOverlay />}

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* ── Post-payment return banner ────────────────────────────────── */}
        {returnTxn && returnStatus === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-8 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-800">Payment received — activating plan</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Your transaction is being confirmed. Credits will update within a few seconds.{' '}
                <button onClick={fetchProfile} className="underline font-medium hover:text-amber-900 transition-colors">Refresh</button>
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-5 py-4 mb-8">{error}</div>
        )}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-5 py-4 mb-8 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {successMsg}
          </div>
        )}

        {/* ── Current plan card ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-7 py-6 mb-10 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Current Plan</p>
              <p className="text-2xl font-bold text-gray-900">{currentPlanLabel}</p>
            </div>
            <div className="h-10 w-px bg-gray-100 hidden sm:block" />
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Credit Balance</p>
              <p className="text-2xl font-bold text-indigo-600">
                {credits} <span className="text-sm font-medium text-gray-500">min remaining</span>
              </p>
            </div>
          </div>
          <div
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full ${
              credits >= 5 ? 'bg-green-50 text-green-700 ring-1 ring-green-400/50' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-400/50'
            }`}
            style={{ boxShadow: credits >= 5 ? '0 0 10px rgba(34,197,94,0.2)' : '0 0 10px rgba(245,158,11,0.2)' }}
          >
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${credits >= 5 ? 'bg-green-500' : 'bg-amber-500'}`} />
            {credits >= 5 ? 'Active' : 'Low Credits'}
          </div>
        </div>

        {/* ── Section header ────────────────────────────────────────────── */}
        <div className="mb-7">
          <h2 className="text-xl font-bold text-gray-900">Choose Your Plan</h2>
          <p className="text-sm text-gray-500 mt-1">
            Monthly subscriptions. Upgrade or switch at any time. Payments processed securely via PhonePe UPI.
          </p>
        </div>

        {/* ── Voice clone legal disclaimer ──────────────────────────────── */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-8 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold">Voice Cloning Notice:</span> By subscribing and using the AI Voice Dubbing feature you confirm
            that you are the original voice owner or hold explicit written permission from the rights holder. Misuse to impersonate
            individuals without consent may violate applicable laws. ReelSync AI accepts no liability for unauthorised use.
          </p>
        </div>

        {/* ── Tier cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-10">
          {TIERS.map(tier => {
            const accent      = ACCENT[tier.accentColor]
            const isCurrent   = tier.id === currentPlan
            const tierIdx     = TIER_ORDER.indexOf(tier.id)
            const currentIdx  = TIER_ORDER.indexOf(currentPlan)
            const isHigher    = tierIdx > currentIdx
            const isActive    = activePlan === tier.id
            const anyBusy     = purchasing || switchingFree
            const isDisabled  = anyBusy || isCurrent

            let btnLabel: string
            if (isCurrent)        btnLabel = 'Current Plan'
            else if (tier.id === 'FREE') btnLabel = switchingFree && isActive ? 'Switching…' : 'Switch to Free'
            else if (isHigher)    btnLabel = purchasing && isActive ? 'Connecting…' : 'Upgrade'
            else                  btnLabel = purchasing && isActive ? 'Connecting…' : 'Switch Plan'

            return (
              <div
                key={tier.id}
                className={`relative bg-white rounded-2xl border shadow-sm flex flex-col transition-all duration-200 hover:shadow-md ${
                  isCurrent
                    ? 'border-green-300 shadow-green-100/60 ring-1 ring-green-300/40'
                    : `${accent.border} hover:border-opacity-60`
                }`}
              >
                {/* Badges */}
                {tier.badge && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-gradient-to-r from-orange-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm uppercase tracking-wider">
                      {tier.badge}
                    </span>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-green-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm uppercase tracking-wider flex items-center gap-1">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Your Plan
                    </span>
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1 pt-7">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">{tier.label}</p>

                  {/* Price */}
                  <div className="flex items-baseline gap-1 mb-0.5">
                    <span className={`text-3xl font-extrabold ${accent.text}`}>{tier.priceDisplay}</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">{tier.billingNote}</p>

                  {/* Price breakdown for paid plans */}
                  {tier.basePrice > 0 && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 text-xs space-y-0.5">
                      <div className="flex justify-between text-gray-500">
                        <span>Base</span><span>₹{tier.basePrice.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>GST (18%)</span><span>₹{tier.gstAmount.toLocaleString()}</span>
                      </div>
                      {tier.handlingFee > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>Handling (1%)</span><span>₹{tier.handlingFee}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-gray-800 border-t border-gray-200 pt-0.5 mt-0.5">
                        <span>Total / mo</span><span>₹{tier.totalPerMonth.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  {/* Credits highlight */}
                  <div className={`rounded-xl px-3 py-2.5 mb-4 ${accent.bg}`}>
                    <p className={`text-lg font-bold ${accent.text}`}>{tier.minLimit.toLocaleString()} min</p>
                    <p className="text-xs text-gray-500 mt-0.5">processing per month</p>
                  </div>

                  {/* Key features */}
                  <ul className="space-y-1.5 flex-1 mb-5">
                    {[
                      `${tier.quality} quality`,
                      tier.allowDownload ? 'Download video' : null,
                      tier.allowRecording ? 'Studio recording' : null,
                      !tier.watermark ? 'No watermark' : 'Watermarked',
                      tier.crossSubtitles ? 'Cross subtitles' : null,
                      tier.allowPriority ? 'Priority queue' : null,
                    ].filter(Boolean).map(f => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                        <svg className={`w-3.5 h-3.5 flex-shrink-0 ${accent.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSubscribe(tier.id)}
                    className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                      isCurrent
                        ? 'bg-green-50 text-green-700 ring-1 ring-green-400/60 cursor-default'
                        : tier.btnClass
                    }`}
                  >
                    {(purchasing || switchingFree) && isActive ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        {btnLabel}
                      </span>
                    ) : btnLabel}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Feature comparison matrix ──────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-10">
          <div className="px-6 py-4 border-b border-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">Feature Comparison</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide w-48">Feature</th>
                  {TIERS.map(t => (
                    <th key={t.id} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide ${ACCENT[t.accentColor].text}`}>
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-6 py-3 text-xs text-gray-500">{row.label}</td>
                    {TIERS.map(t => (
                      <td key={t.id} className="px-4 py-3 text-center">
                        <FeatureCell value={row.getValue(t)} accent={t.accentColor} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Trust footer ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-center gap-6 py-6 border-t border-gray-100">
          <TrustBadge icon="shield"   label="Secure Checkout"      sub="256-bit SSL encrypted" />
          <TrustBadge icon="zap"      label="Instant Activation"   sub="Plan activates after payment" />
          <TrustBadge icon="refresh"  label="Switch Anytime"       sub="Upgrade or downgrade freely" />
        </div>

      </div>
    </>
  )
}

// ─── Page export — Suspense boundary required for useSearchParams ─────────────

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="text-slate-400 text-sm">Loading…</div>
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  )
}
