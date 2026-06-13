import Link from 'next/link'

export default function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-8 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">404</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This route is not available right now. Use one of the main app entry points below.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Go to login
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
