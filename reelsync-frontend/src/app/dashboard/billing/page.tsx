'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import api from '@/utils/api'
import { broadcastProfileRefresh, useSessionProfile } from '@/hooks/useSessionProfile'

interface UserProfile {
  user_id: string
  email: string
  role?: string
  credit_minutes: number
  credit_seconds?: number
  credit_balance_credits?: number
  subscription_plan: string
  credit_limit_minutes: number
  credit_limit_seconds?: number
  credit_limit_credits?: number
  advertised_credits?: number
  protected_credit_ratio?: number
}

type PlanId = 'FREE' | 'STARTER' | 'CREATOR' | 'PRO'

interface Tier {
  id: PlanId
  label: string
  badge: string | null
  priceDisplay: string
  minutesDisplay: string
  creditsDisplay: string
  quality: string
  allowDownload: boolean
  watermark: boolean
  crossSubtitles: boolean
  voiceCloning: boolean
  accentClass: string
  buttonClass: string
  cycleCreditsFallback: number
}

const TIERS: Tier[] = [
  {
    id: 'FREE',
    label: 'Free',
    badge: null,
    priceDisplay: 'Rs 0',
    minutesDisplay: '1 min /mo',
    creditsDisplay: '',
    quality: 'Up to 420p',
    allowDownload: false,
    watermark: true,
    crossSubtitles: false,
    voiceCloning: true,
    accentClass: 'text-slate-200',
    buttonClass: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
    cycleCreditsFallback: 7_000,
  },
  {
    id: 'STARTER',
    label: 'Starter',
    badge: null,
    priceDisplay: 'Rs 699',
    minutesDisplay: '21 min /mo',
    creditsDisplay: '21k credits /mo',
    quality: 'Up to 1080p',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    accentClass: 'text-indigo-300',
    buttonClass: 'bg-indigo-600 text-white hover:bg-indigo-500',
    cycleCreditsFallback: 21_000,
  },
  {
    id: 'CREATOR',
    label: 'Creator',
    badge: 'Recommended',
    priceDisplay: 'Rs 2,199',
    minutesDisplay: '84.7 min /mo',
    creditsDisplay: '84.7k credits /mo',
    quality: 'Up to 2160p',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    accentClass: 'text-fuchsia-300',
    buttonClass: 'bg-fuchsia-600 text-white hover:bg-fuchsia-500',
    cycleCreditsFallback: 84_700,
  },
  {
    id: 'PRO',
    label: 'Pro',
    badge: null,
    priceDisplay: 'Rs 9,999',
    minutesDisplay: '420 min /mo',
    creditsDisplay: '420k credits /mo',
    quality: 'Up to 2160p',
    allowDownload: true,
    watermark: false,
    crossSubtitles: true,
    voiceCloning: true,
    accentClass: 'text-amber-300',
    buttonClass: 'bg-amber-500 text-slate-950 hover:bg-amber-400',
    cycleCreditsFallback: 420_000,
  },
]

const TIER_ORDER: PlanId[] = ['FREE', 'STARTER', 'CREATOR', 'PRO']

const FEATURE_ROWS: { label: string; getValue: (tier: Tier) => string | boolean }[] = [
  { label: 'Minutes / month', getValue: tier => tier.minutesDisplay },
  { label: 'Credits / month', getValue: tier => tier.creditsDisplay },
  { label: 'Output quality', getValue: tier => tier.quality },
  { label: 'Project access', getValue: tier => tier.id !== 'FREE' },
  { label: 'Video download', getValue: tier => tier.allowDownload },
  { label: 'No watermark', getValue: tier => !tier.watermark },
  { label: 'Cross-language subtitles', getValue: tier => tier.crossSubtitles },
  { label: 'AI voice cloning', getValue: tier => tier.voiceCloning },
]

function formatPlan(plan: string | undefined): string {
  const value = (plan ?? 'free').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatCreditCount(value: number): string {
  if (value >= 1000) {
    const compact = value % 1000 === 0 ? `${value / 1000}` : `${(value / 1000).toFixed(1)}`
    return `${compact.replace(/\.0$/, '')}k`
  }
  return `${value}`
}

function formatSecondsLabel(value: number): string {
  return `${Math.max(0, value)} sec`
}

function formatRole(role: string | undefined): string {
  const value = (role ?? 'USER').toUpperCase()
  if (value === 'ROOT') return 'ROOT'
  if (value === 'ADMIN') return 'ADMIN'
  return 'USER'
}

function isPrivilegedRole(role: string | undefined): boolean {
  const value = (role ?? '').toUpperCase()
  return value === 'ROOT' || value === 'ADMIN'
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
          Redirecting you to PhonePe to confirm your plan purchase.
        </p>
      </div>
    </div>
  )
}

function BillingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [purchasing, setPurchasing] = useState(false)
  const [switchingFree, setSwitchingFree] = useState(false)
  const [activePlan, setActivePlan] = useState<PlanId | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const {
    profile,
    setProfile,
    loading,
    refreshProfile,
  } = useSessionProfile<UserProfile>({
    redirectOnUnauthorized: true,
    onUnauthorized: () => router.replace('/login'),
  })

  const returnTxn = searchParams.get('txn')
  const returnStatus = searchParams.get('status')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.replace('/login')
    }
  }, [router])

  const handleSubscribe = async (planId: PlanId) => {
    setError('')
    setSuccessMsg('')
    setActivePlan(planId)

    if (planId === 'FREE') {
      setSwitchingFree(true)
      try {
        await api.post('/api/payments/subscribe', { target_plan: 'FREE' })
        setSuccessMsg('Switched to the Free plan successfully.')
        const nextProfile = await refreshProfile()
        if (nextProfile) {
          setProfile(nextProfile)
        }
        broadcastProfileRefresh()
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
      const { data } = await api.post<{
        payment_url?: string
        merchant_txn_id?: string
        status?: string
        message?: string
        subscription_plan?: string
        bypass?: boolean
      }>(
        '/api/payments/subscribe',
        { target_plan: planId },
      )
      if (data.payment_url) {
        window.location.href = data.payment_url
        return
      }

      if (data.status === 'ok') {
        setSuccessMsg(data.message || `Switched to the ${planId} plan successfully.`)
        const nextProfile = await refreshProfile()
        if (nextProfile) {
          setProfile(nextProfile)
        }
        broadcastProfileRefresh()
        return
      }

      throw new Error('Unexpected subscription response.')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Could not start the plan purchase.')
      } else {
        setError('Could not start the plan purchase.')
      }
    } finally {
      setPurchasing(false)
      setActivePlan(null)
    }
  }

  const currentPlan = ((profile?.subscription_plan ?? 'free').toUpperCase()) as PlanId
  const currentTier = TIERS.find(tier => tier.id === currentPlan) ?? TIERS[0]
  const currentPlanIndex = TIER_ORDER.indexOf(currentPlan)
  const currentRole = formatRole(profile?.role)
  const hasPrivilegedAccess = isPrivilegedRole(profile?.role)
  const isFreePlan = currentPlan === 'FREE'
  const minutesLeft = profile?.credit_minutes ?? 0
  const minuteLimit = profile?.credit_limit_minutes ?? 0
  const usedMinutes = Math.max(minuteLimit - minutesLeft, 0)
  const secondsLeft = profile?.credit_seconds ?? 0
  const secondLimit = profile?.credit_limit_seconds ?? 60
  const usedSeconds = Math.max(secondLimit - secondsLeft, 0)
  const credits = profile?.credit_balance_credits ?? 0
  const maxCredits = profile?.credit_limit_credits ?? currentTier.cycleCreditsFallback
  const minutesUsagePct = minuteLimit > 0 ? Math.min(100, Math.round((usedMinutes / minuteLimit) * 100)) : 0
  const secondsUsagePct = secondLimit > 0 ? Math.min(100, Math.round((usedSeconds / secondLimit) * 100)) : 0
  const watermarkLabel = currentTier.watermark ? 'Watermark enabled' : 'Watermark removed'

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
              <button onClick={() => void refreshProfile()} className="ml-2 font-semibold text-amber-100 underline underline-offset-4">
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

        <section className="rounded-[28px] border border-slate-800 bg-slate-950/90 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Monthly plans</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Plan-by-plan comparison</h2>
              {hasPrivilegedAccess && (
                <p className="mt-3 inline-flex items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-200">
                  {currentRole} access enabled for this account. Billing plan remains {formatPlan(profile?.subscription_plan)}.
                </p>
              )}
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
                          <div className="flex min-h-[46px] flex-col items-center justify-center">
                            <span className={`text-sm font-semibold ${tier.accentClass}`}>{tier.label}</span>
                            {isCurrent ? (
                              <span className="mt-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                                Active
                              </span>
                            ) : tier.badge ? (
                              <span className="mt-1 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-fuchsia-200">
                                {tier.badge}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-3 text-2xl font-bold text-white">{tier.priceDisplay}</p>
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
        </section>

        <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))]">
          <div className="px-6 py-7 lg:px-8">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Billing & Credits</p>
                  <p className="mt-2 text-lg font-semibold text-white">Current plan summary</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${credits > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {credits > 0 ? 'Ready to render' : 'Balance empty'}
                </span>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <StatCard
                  label="Current plan"
                  value={formatPlan(profile?.subscription_plan)}
                  helper={hasPrivilegedAccess ? `Billing tier only. ${currentRole} access is handled separately.` : `${currentTier.quality} output with ${watermarkLabel.toLowerCase()}`}
                />
                <StatCard
                  label="Access level"
                  value={currentRole}
                  helper={hasPrivilegedAccess ? 'Privileged backend access is active for this account.' : 'Standard customer access.'}
                />
                <StatCard
                  label={isFreePlan ? 'Seconds left' : 'Minutes left'}
                  value={isFreePlan ? formatSecondsLabel(secondsLeft) : `${minutesLeft} min`}
                  helper={isFreePlan ? `One-time cap: ${formatSecondsLabel(secondLimit)}` : `Cycle cap: ${minuteLimit} min`}
                />
              </div>

              <div className="mt-6">
                <ProgressRail
                  label={isFreePlan ? 'Seconds consumed' : 'Minutes consumed'}
                  valueLabel={
                    isFreePlan
                      ? `${usedSeconds} / ${secondLimit} sec used`
                      : `${usedMinutes} / ${minuteLimit} min used`
                  }
                  percentage={isFreePlan ? secondsUsagePct : minutesUsagePct}
                  fillClass="bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                />
              </div>

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
