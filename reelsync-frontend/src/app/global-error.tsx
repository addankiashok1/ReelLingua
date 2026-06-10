'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-white">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-8 text-center shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400">Critical error</p>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white">The app needs a fresh reload</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              A root-level rendering error occurred. Reload the app or retry from here.
            </p>
            {error?.message ? (
              <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-left text-xs text-slate-500">
                {error.message}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Retry app
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
