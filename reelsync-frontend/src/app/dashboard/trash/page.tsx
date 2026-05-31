'use client'

import React, { useCallback, useEffect, useState } from 'react'
import api from '@/utils/api'
import { toast } from '@/components/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemKind = 'project' | 'scene' | 'folder'

interface TrashItem {
  id: string
  kind: ItemKind
  name: string
  trashed_at: string          // ISO string
  expires_at: string          // ISO string  (trashed_at + 15 days)
  days_remaining: number
  parent_name: string | null  // project name for scenes/folders
}

interface TrashSummary {
  items: TrashItem[]
  count: number
}

// ─── Days-remaining helpers ───────────────────────────────────────────────────

const TRASH_DAYS = 15

function daysUntilExpiry(trashedAt: string): number {
  const expiry = new Date(trashedAt).getTime() + TRASH_DAYS * 86_400_000
  return Math.max(0, Math.ceil((expiry - Date.now()) / 86_400_000))
}

function urgencyClass(days: number): string {
  if (days <= 1)  return 'text-red-400 bg-red-950/40 border-red-800/40'
  if (days <= 5)  return 'text-amber-400 bg-amber-950/40 border-amber-800/40'
  return 'text-slate-500 bg-slate-800/40 border-slate-700/40'
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IcoFolder({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

function IcoVideo({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}

function IcoTrash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function IcoRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  )
}

function IcoX({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ─── Permanent-delete confirmation modal ──────────────────────────────────────

function ConfirmDeleteModal({
  item,
  onClose,
  onConfirmed,
}: {
  item: TrashItem | null
  onClose: () => void
  onConfirmed: (item: TrashItem) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)

  if (!item) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirmed(item)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <IcoTrash className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Permanently Delete</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                <span className="text-white font-medium">"{item.name}"</span> will be permanently
                deleted from your account. This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Deleting…' : 'Delete Forever'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Empty Trash confirmation modal ───────────────────────────────────────────

function ConfirmEmptyModal({
  count,
  onClose,
  onConfirmed,
}: {
  count: number
  onClose: () => void
  onConfirmed: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setLoading(true)
    try { await onConfirmed() }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <IcoTrash className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Empty Trash</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                All <span className="text-white font-medium">{count} item{count !== 1 ? 's' : ''}</span> in
                your Trash will be permanently deleted. This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handle}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Emptying…' : 'Empty Trash'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Trash Item Row ───────────────────────────────────────────────────────────

function TrashRow({
  item,
  onRestore,
  onDelete,
}: {
  item: TrashItem
  onRestore: (item: TrashItem) => void
  onDelete:  (item: TrashItem) => void
}) {
  const [restoring, setRestoring] = useState(false)
  const days = item.days_remaining

  const handleRestore = async () => {
    setRestoring(true)
    onRestore(item)
  }

  return (
    <tr className="border-b border-slate-800/40 last:border-b-0 hover:bg-slate-900/60 transition-colors">

      {/* Kind icon + name */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-800">
            {item.kind === 'scene'
              ? <IcoVideo   className="w-4 h-4 text-indigo-400" />
              : <IcoFolder  className="w-4 h-4 text-yellow-400" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{item.name}</p>
            {item.parent_name && (
              <p className="text-[11px] text-slate-600 truncate">in {item.parent_name}</p>
            )}
          </div>
        </div>
      </td>

      {/* Type badge */}
      <td className="px-4 py-3.5 hidden sm:table-cell">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
          item.kind === 'scene'
            ? 'bg-indigo-950/40 border-indigo-900/50 text-indigo-400'
            : 'bg-yellow-950/30 border-yellow-800/40 text-yellow-500'
        }`}>
          {item.kind}
        </span>
      </td>

      {/* Trashed date */}
      <td className="px-4 py-3.5 hidden md:table-cell">
        <p className="text-xs text-slate-400">{fmtDate(item.trashed_at)}</p>
      </td>

      {/* Days remaining */}
      <td className="px-4 py-3.5">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${urgencyClass(days)}`}>
          {days === 0 ? 'Expires today' : `${days}d left`}
        </span>
      </td>

      {/* Actions */}
      <td className="px-5 py-3.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleRestore}
            disabled={restoring}
            title="Restore"
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-50"
          >
            {restoring
              ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
              : <IcoRefresh className="w-3 h-3" />
            }
            Restore
          </button>
          <button
            onClick={() => onDelete(item)}
            title="Delete forever"
            className="flex items-center justify-center w-7 h-7 rounded-lg text-red-400 bg-red-950/30 border border-red-800/40 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all"
          >
            <IcoX className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Main Trash Page ──────────────────────────────────────────────────────────

type FilterKind = 'all' | ItemKind

export default function TrashPage() {
  const [items,     setItems]     = useState<TrashItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState<FilterKind>('all')
  const [deleteTarget, setDeleteTarget] = useState<TrashItem | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)

  // ── data fetching ──────────────────────────────────────────────────────────

  const fetchTrash = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<TrashSummary>('/api/trash')
      setItems(res.data.items)
    } catch {
      toast.error('Failed to load Trash.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTrash() }, [fetchTrash])

  // ── restore ────────────────────────────────────────────────────────────────

  const handleRestore = useCallback(async (item: TrashItem) => {
    try {
      await api.post(`/api/trash/${item.kind}s/${item.id}/restore`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast.success(`"${item.name}" restored successfully.`)
    } catch {
      toast.error(`Failed to restore "${item.name}".`)
    }
  }, [])

  // ── permanent delete ───────────────────────────────────────────────────────

  const handlePermanentDelete = useCallback(async (item: TrashItem) => {
    try {
      await api.delete(`/api/trash/${item.kind}s/${item.id}`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      setDeleteTarget(null)
      toast.success(`"${item.name}" permanently deleted.`)
    } catch {
      toast.error(`Failed to permanently delete "${item.name}".`)
    }
  }, [])

  // ── empty trash ────────────────────────────────────────────────────────────

  const handleEmptyTrash = useCallback(async () => {
    try {
      await api.delete('/api/trash/empty')
      setItems([])
      setShowEmpty(false)
      toast.success('Trash emptied. All items permanently deleted.')
    } catch {
      toast.error('Failed to empty Trash.')
    }
  }, [])

  // ── derived state ──────────────────────────────────────────────────────────

  const visible = filter === 'all' ? items : items.filter(i => i.kind === filter)

  const counts: Record<FilterKind, number> = {
    all:     items.length,
    project: items.filter(i => i.kind === 'project').length,
    scene:   items.filter(i => i.kind === 'scene').length,
    folder:  items.filter(i => i.kind === 'folder').length,
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-950 px-8 py-8">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <IcoTrash className="w-6 h-6 text-slate-500" />
            Trash
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Items are automatically and permanently deleted after {TRASH_DAYS} days.
          </p>
        </div>

        {items.length > 0 && (
          <button
            onClick={() => setShowEmpty(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-800/40 text-red-400 hover:text-red-300 text-sm font-medium rounded-xl transition-colors"
          >
            <IcoTrash className="w-4 h-4" />
            Empty Trash
          </button>
        )}
      </div>

      {/* ── Filter tabs ───────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {(['all', 'project', 'scene', 'folder'] as FilterKind[]).map(kind => {
            const count = counts[kind]
            if (kind !== 'all' && count === 0) return null
            return (
              <button
                key={kind}
                onClick={() => setFilter(kind)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  filter === kind
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'text-slate-400 border-slate-700 hover:text-white hover:bg-slate-800'
                }`}
              >
                {kind === 'all' ? 'All' : `${kind.charAt(0).toUpperCase() + kind.slice(1)}s`}
                <span className={`ml-1.5 text-[10px] ${filter === kind ? 'text-indigo-200' : 'text-slate-600'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Loading Trash…</p>
          </div>
        </div>

      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
            <IcoTrash className="w-8 h-8 text-slate-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-300">Your Trash is empty</p>
            <p className="text-sm text-slate-500 mt-1">Deleted projects and scenes will appear here for {TRASH_DAYS} days.</p>
          </div>
        </div>

      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-sm text-slate-500">No {filter}s in Trash.</p>
          <button onClick={() => setFilter('all')} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
            Show all items
          </button>
        </div>

      ) : (
        <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden">

          {/* Notice bar */}
          <div className="px-5 py-3 border-b border-slate-800/60 bg-slate-900/40 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs text-amber-400">
              Items older than {TRASH_DAYS} days are automatically and permanently deleted. Restore items you want to keep.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800/60">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Name</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest hidden md:table-cell">Trashed</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Expires</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <TrashRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onRestore={handleRestore}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer count */}
          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950">
            <p className="text-xs text-slate-600 tabular-nums">
              {visible.length} / {items.length} item{items.length !== 1 ? 's' : ''}
            </p>
          </div>

        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <ConfirmDeleteModal
        item={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirmed={handlePermanentDelete}
      />
      {showEmpty && (
        <ConfirmEmptyModal
          count={items.length}
          onClose={() => setShowEmpty(false)}
          onConfirmed={handleEmptyTrash}
        />
      )}

    </div>
  )
}
