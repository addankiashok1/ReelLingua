import Link from 'next/link'

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-full min-w-0 items-center justify-center bg-slate-900 px-6 py-10 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950/90 p-8 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Not Found</p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-white">That dashboard page does not exist</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          The page may have moved, or the requested project is no longer available in this workspace.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
