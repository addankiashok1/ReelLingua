'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import api from '@/utils/api'

interface UserProfile {
  user_id: string
  email: string
  credit_minutes: number
  subscription_plan: string
  credit_limit_minutes: number
}

interface TierUsage {
  user_id: string
  subscription_plan: string
  tier_label: string
  chars_per_credit?: number
  chars_balance?: number
  credit_minutes?: number
  chars_total_grant?: number
  chars_utilization_pct?: number
}

type PlanId = 'FREE' | 'STARTER' | 'CREATOR' | 'PRO'
type PackId = 'starter' | 'creator'

interface Tier {
  id: PlanId
  label: string
  badge: string | null
  priceDisplay: string
  basePrice: number
  gstAmount: number
  handlingFee: number
  totalPerMonth: number
  minLimit: number
  charLimit: number
  quality: string
  allowDownload: boolean
  watermark: boolean
  crossSubtitles: boolean
  voiceCloning: boolean
  providerPriceUsd: number
  providerCharsIncluded: number
  accentClass: string
  surfaceClass: string
  buttonClass: string
}

interface CreditPack {
  id: PackId
  label: string
  credits: number
  priceDisplay: string
  amountInr: number
  accentClass: string
  description: string
}

const TIERS: Tier[] = [
  {
    id: 'FREE',
    label: 'Free',
    badge: null,
    priceDisplay: 'Rs 0',
    basePrice: 0,
    gstAmount: 0,
    handlingFee: 0,
    totalPerMonth: 0,
    minLimit: 13,
    charLimit: 9_750,
    quality: '720p',
    allowDownload: false,
    watermark: true,
    crossSubtitles: false,
    voiceCloning: true,
    providerPriceUsd: 0,
    providerCharsIncluded: 10_000,
    accentClass: 'text-slate-200',
    surfaceClass: 'border-slate-800 bg-slate-950/85',
    buttonClass: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
  },
  {
    id: 'STARTER',
    label: 'Starter',
    badge: null,
    priceDisplay: 'Rs 599',
    basePrice: 599,
    gstAmount: 107.82,
    handlingFee: 0,
    totalPerMonth: 706.82,
    minLimit: 80,
    charLimit: 60_000,
    quality: '1080p',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    providerPriceUsd: 6,
    providerCharsIncluded: 60_000,
    accentClass: 'text-indigo-300',
    surfaceClass: 'border-indigo-900/70 bg-indigo-950/25',
    buttonClass: 'bg-indigo-600 text-white hover:bg-indigo-500',
  },
  {
    id: 'CREATOR',
    label: 'Creator',
    badge: 'Recommended',
    priceDisplay: 'Rs 2,099',
    basePrice: 2_099,
    gstAmount: 377.82,
    handlingFee: 0,
    totalPerMonth: 2_476.82,
    minLimit: 293,
    charLimit: 219_750,
    quality: '4K',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    providerPriceUsd: 22,
    providerCharsIncluded: 220_000,
    accentClass: 'text-fuchsia-300',
    surfaceClass: 'border-fuchsia-900/70 bg-fuchsia-950/20',
    buttonClass: 'bg-fuchsia-600 text-white hover:bg-fuchsia-500',
  },
  {
    id: 'PRO',
    label: 'Pro',
    badge: null,
    priceDisplay: 'Rs 9,499',
    basePrice: 9_499,
    gstAmount: 1_709.82,
    handlingFee: 0,
    totalPerMonth: 11_208.82,
    minLimit: 1_320,
    charLimit: 990_000,
    quality: '4K',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    providerPriceUsd: 99,
    providerCharsIncluded: 990_000,
    accentClass: 'text-amber-300',
    surfaceClass: 'border-amber-900/70 bg-amber-950/20',
    buttonClass: 'bg-amber-500 text-slate-950 hover:bg-amber-400',
  },
]

const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'starter',
    label: 'Starter Pack',
    credits: 30,
    priceDisplay: 'Rs 299',
    amountInr: 299,
    accentClass: 'text-emerald-300',
    description: 'Best for short bursts of dubbing when your monthly pool runs low.',
  },
  {
    id: 'creator',
    label: 'Creator Pack',
    credits: 120,
    priceDisplay: 'Rs 999',
    amountInr: 999,
    accentClass: 'text-cyan-300',
    description: 'Ideal for active creators who need extra renders without switching plans.',
  },
]

const TIER_ORDER: PlanId[] = ['FREE', 'STARTER', 'CREATOR', 'PRO']

const FEATURE_ROWS: { label: string; getValue: (tier: Tier) => string | boolean }[] = [
  { label: 'Processing minutes / month', getValue: tier => `${tier.minLimit.toLocaleString()} min` },
  { label: 'Transcript capacity / month', getValue: tier => `${tier.charLimit.toLocaleString()} chars` },
  { label: 'Underlying base plan', getValue: tier => tier.providerPriceUsd > 0 ? `$${tier.providerPriceUsd}/mo` : 'Free' },
  { label: 'Included monthly chars', getValue: tier => tier.providerCharsIncluded.toLocaleString() },
  { label: 'Output quality', getValue: tier => tier.quality },
  { label: 'Video download', getValue: tier => tier.allowDownload },
  { label: 'No watermark', getValue: tier => !tier.watermark },
  { label: 'Cross-language subtitles', getValue: tier => tier.crossSubtitles },
  { label: 'AI voice cloning', getValue: tier => tier.voiceCloning },
]

function formatPlan(plan: string | undefined): string {
  const value = (plan ?? 'free').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatCurrency(amount: number): string {
  return `Rs ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string
  value: string
  helper: string
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{helper}</p>
    </div>
  )
}

function ProgressRail({
  label,
  valueLabel,
  percentage,
  fillClass,
}: {
  label: string
  valueLabel: string
  percentage: number
  fillClass: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className="text-xs font-semibold text-slate-200">{valueLabel}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-300 ${fillClass}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

function FeatureValue({
  value,
}: {
  value: string | boolean
}) {
  if (typeof value === 'string') {
    return <span className="text-xs font-semibold text-slate-100">{value}</span>
  }

  return value ? (
    <svg className="mx-auto h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="mx-auto h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function PurchaseOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10">
          <div className="h-6 w-6 rounded-full border-2 border-indigo-400/25 border-t-indigo-300 animate-spin" />
        </div>
        <p className="mt-5 text-lg font-semibold text-white">Opening secure payment</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Redirecting you to PhonePe to confirm your plan or top-up purchase.
        </p>
      </div>
    </div>
  )
}

function BillingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tierUsage, setTierUsage] = useState<TierUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [switchingFree, setSwitchingFree] = useState(false)
  const [activePlan, setActivePlan] = useState<PlanId | null>(null)
  const [activePack, setActivePack] = useState<PackId | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const returnTxn = searchParams.get('txn')
  const returnStatus = searchParams.get('status')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.replace('/login')
      return
    }

    void fetchBillingState()
  }, [router])

  const fetchBillingState = async () => {
    try {
      const [profileRes, tierRes] = await Promise.all([
        api.get<UserProfile>('/api/auth/me'),
        api.get<TierUsage>('/api/videos/tier'),
      ])
      setProfile(profileRes.data)
      setTierUsage(tierRes.data)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        localStorage.clear()
        router.replace('/login')
      } else {
        setError('Could not load your billing profile right now.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribe = async (planId: PlanId) => {
    setError('')
    setSuccessMsg('')
    setActivePack(null)
    setActivePlan(planId)

    if (planId === 'FREE') {
      setSwitchingFree(true)
      try {
        await api.post('/api/payments/subscribe', { target_plan: 'FREE' })
        setSuccessMsg('Switched to the Free plan successfully.')
        await fetchBillingState()
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.detail || 'Could not switch plans right now.')
        } else {
          setError('Could not switch plans right now.')
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
        setError(err.response?.data?.detail || 'Could not start the plan purchase.')
      } else {
        setError('Could not start the plan purchase.')
      }
    }
  }

  const handleTopUp = async (packId: PackId) => {
    setError('')
    setSuccessMsg('')
    setActivePlan(null)
    setActivePack(packId)
    setPurchasing(true)

    try {
      const { data } = await api.post<{ payment_url: string; merchant_txn_id: string }>(
        '/api/payments/initiate',
        { package_id: packId },
      )
      window.location.href = data.payment_url
    } catch (err) {
      setPurchasing(false)
      setActivePack(null)
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Could not start the credit top-up.')
      } else {
        setError('Could not start the credit top-up.')
      }
    }
  }

  const currentPlan = ((profile?.subscription_plan ?? 'free').toUpperCase()) as PlanId
  const currentTier = TIERS.find(tier => tier.id === currentPlan) ?? TIERS[0]
  const currentPlanIndex = TIER_ORDER.indexOf(currentPlan)
  const credits = profile?.credit_minutes ?? 0
  const maxMinutes = profile?.credit_limit_minutes ?? currentTier.minLimit
  const charsBalance = tierUsage?.chars_balance ?? credits * 750
  const charsTotalGrant = tierUsage?.chars_total_grant ?? maxMinutes * 750
  const charsPerCredit = tierUsage?.chars_per_credit ?? 750
  const usedMinutes = Math.max(maxMinutes - credits, 0)
  const minuteUsagePct = maxMinutes > 0 ? Math.min(100, Math.round((usedMinutes / maxMinutes) * 100)) : 0
  const charUsagePct = Math.max(0, Math.min(100, Math.round(tierUsage?.chars_utilization_pct ?? 0)))
  const watermarkLabel = currentTier.watermark ? 'Watermark enabled' : 'Watermark removed'

  const featurePills = useMemo(
    () => [
      `${currentTier.quality} output`,
      currentTier.allowDownload ? 'Downloads enabled' : 'Downloads locked',
      currentTier.crossSubtitles ? 'Cross subtitles included' : 'Single-language subtitles',
      currentTier.voiceCloning ? 'Voice cloning included' : 'Voice cloning locked',
    ],
    [currentTier],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-indigo-500/20 border-t-indigo-400 animate-spin" />
          <span className="text-sm tracking-wide text-slate-500">Loading billing workspace...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {purchasing && <PurchaseOverlay />}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">
        {returnTxn && returnStatus === 'pending' && (
          <div className="rounded-2xl border border-amber-800/70 bg-amber-950/40 px-5 py-4 text-sm text-amber-100">
            <p className="font-semibold">Payment received, activation in progress</p>
            <p className="mt-1 text-amber-200/80">
              Your PhonePe transaction is being confirmed. Credits usually refresh within a few seconds.
              <button onClick={() => void fetchBillingState()} className="ml-2 font-semibold text-amber-100 underline underline-offset-4">
                Refresh now
              </button>
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-900/80 bg-rose-950/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="rounded-2xl border border-emerald-900/80 bg-emerald-950/40 px-5 py-4 text-sm text-emerald-200">
            {successMsg}
          </div>
        )}

        <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]">
          <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.4fr_1fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300/80">Billing & Credits</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Manage ReelSync rendering capacity</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Your plan controls monthly render minutes, transcript character allowance, export quality, and feature access.
                One completed dub consumes 1 credit minute. Character balance keeps transcript-heavy jobs within the correct tier.
              </p>
              <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-500">
                Updated against current upstream plan pricing and limits on June 10, 2026.
                ReelSync packages those cost bands into INR pricing for this dubbing workflow.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {featurePills.map(item => (
                  <span key={item} className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200">
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Current plan"
                  value={formatPlan(profile?.subscription_plan)}
                  helper={`${watermarkLabel} · current usage tier`}
                />
                <StatCard
                  label="Minutes left"
                  value={`${credits} min`}
                  helper={`${usedMinutes} of ${maxMinutes} used this cycle`}
                />
                <StatCard
                  label="Transcript balance"
                  value={charsBalance.toLocaleString()}
                  helper={`${charsPerCredit.toLocaleString()} chars available per credit minute`}
                />
                <StatCard
                  label="PhonePe billing"
                  value="Secure"
                  helper="Plans and top-ups both redirect through PhonePe checkout"
                />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Live usage</p>
                  <p className="mt-2 text-lg font-semibold text-white">Current allocation status</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${credits > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {credits > 0 ? 'Ready to render' : 'Balance empty'}
                </span>
              </div>

              <div className="mt-6 space-y-5">
                <ProgressRail
                  label="Minutes consumed"
                  valueLabel={`${minuteUsagePct}% used`}
                  percentage={minuteUsagePct}
                  fillClass="bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                />
                <ProgressRail
                  label="Transcript capacity consumed"
                  valueLabel={`${charUsagePct}% used`}
                  percentage={charUsagePct}
                  fillClass="bg-gradient-to-r from-cyan-500 to-emerald-500"
                />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-xs font-medium text-slate-500">Monthly included</p>
                  <p className="mt-1 text-lg font-semibold text-white">{maxMinutes.toLocaleString()} min</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Current plan allocation from auth profile.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-xs font-medium text-slate-500">Current char pool</p>
                  <p className="mt-1 text-lg font-semibold text-white">{charsTotalGrant.toLocaleString()} chars</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Live tier budget tied to your remaining credits.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">What this means</p>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <p>1. Every completed dub uses 1 credit minute.</p>
                  <p>2. Transcript-heavy jobs are limited by the remaining character pool.</p>
                  <p>3. Top-ups add credits immediately after payment confirmation.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-[28px] border border-slate-800 bg-slate-950/90 p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Monthly plans</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Plan-by-plan comparison</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-slate-400">
                One clean comparison table for every plan, with the same purchase buttons kept directly in the plan columns.
              </p>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-3xl border border-slate-800">
                <thead>
                  <tr className="bg-slate-900 align-top">
                    <th className="border-b border-slate-800 px-5 py-5 text-left text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Feature
                    </th>
                    {TIERS.map(tier => {
                      const isCurrent = tier.id === currentPlan
                      const tierIndex = TIER_ORDER.indexOf(tier.id)
                      const isUpgrade = tierIndex > currentPlanIndex
                      const anyBusy = purchasing || switchingFree
                      const isActive = activePlan === tier.id
                      const isDisabled = anyBusy || isCurrent

                      let buttonLabel = 'Switch plan'
                      if (isCurrent) buttonLabel = 'Current plan'
                      else if (tier.id === 'FREE') buttonLabel = switchingFree && isActive ? 'Switching...' : 'Switch to Free'
                      else if (isUpgrade) buttonLabel = purchasing && isActive ? 'Connecting...' : 'Upgrade plan'
                      else buttonLabel = purchasing && isActive ? 'Connecting...' : 'Move to this plan'

                      return (
                        <th
                          key={tier.id}
                          className={`border-b border-slate-800 px-4 py-5 text-center ${isCurrent ? 'bg-emerald-950/20' : ''}`}
                        >
                          <div className="mx-auto flex max-w-[180px] flex-col items-center">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold ${tier.accentClass}`}>{tier.label}</span>
                              {isCurrent ? (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                                  Active
                                </span>
                              ) : tier.badge ? (
                                <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-300">
                                  {tier.badge}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-3 text-2xl font-bold text-white">{tier.priceDisplay}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {tier.totalPerMonth === 0 ? 'Forever free' : `${formatCurrency(tier.totalPerMonth)} / month`}
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleSubscribe(tier.id)}
                              disabled={isDisabled}
                              className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isCurrent ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' : tier.buttonClass}`}
                            >
                              {buttonLabel}
                            </button>
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((row, index) => (
                    <tr key={row.label} className={index % 2 === 0 ? 'bg-slate-950/85' : 'bg-slate-900/80'}>
                      <td className="border-b border-slate-800 px-5 py-4 text-sm text-slate-400">{row.label}</td>
                      {TIERS.map(tier => (
                        <td key={tier.id} className="border-b border-slate-800 px-4 py-4 text-center">
                          <FeatureValue value={row.getValue(tier)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-800 bg-slate-950/90 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Credit top-ups</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Boost balance without changing plan</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              These one-time packs already exist in your backend payment flow. They add minutes after PhonePe confirmation and use your current plan&apos;s character rate.
            </p>

            <div className="mt-6 space-y-4">
              {CREDIT_PACKS.map(pack => {
                const isActive = activePack === pack.id
                const anyBusy = purchasing || switchingFree

                return (
                  <article key={pack.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-sm font-semibold ${pack.accentClass}`}>{pack.label}</p>
                        <p className="mt-1 text-3xl font-bold text-white">{pack.priceDisplay}</p>
                      </div>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                        +{pack.credits} min
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-400">{pack.description}</p>
                    <p className="mt-4 text-xs text-slate-500">
                      Estimated transcript value on your current plan: {(pack.credits * charsPerCredit).toLocaleString()} chars
                    </p>

                    <button
                      type="button"
                      onClick={() => void handleTopUp(pack.id)}
                      disabled={anyBusy}
                      className="mt-5 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {purchasing && isActive ? 'Connecting...' : `Buy ${pack.label}`}
                    </button>
                  </article>
                )
              })}
            </div>

            <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-sm font-semibold text-white">Voice cloning notice</p>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Use AI dubbing only when you own the source voice or hold explicit permission from the rights holder to recreate it.
                Unauthorised impersonation may violate applicable law and platform policies.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 rounded-full border-2 border-indigo-500/20 border-t-indigo-400 animate-spin" />
            <span className="text-sm tracking-wide text-slate-500">Loading billing workspace...</span>
          </div>
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  )
}
