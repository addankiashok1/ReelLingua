'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard-error]', error)
  }, [error])

  return (
    <div className="flex min-h-full min-w-0 items-center justify-center bg-slate-900 px-6 py-10 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950/90 p-8 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Dashboard Error</p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-white">This workspace view hit an error</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          The dashboard section failed to render. Retry this view without reloading the full app.
        </p>
        {error?.message ? (
          <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-left text-xs text-slate-500">
            {error.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          Retry dashboard
        </button>
      </div>
    </div>
  )
}
