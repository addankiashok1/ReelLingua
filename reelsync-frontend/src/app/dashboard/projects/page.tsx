'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/utils/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectFolder {
  project_id: string
  name: string
  created_at: string
}

type ModalState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'rename'; project: ProjectFolder }
  | { type: 'delete'; project: ProjectFolder }

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function IconFolder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function IconDots({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <circle cx="5"  cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  )
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (p: ProjectFolder) => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Folder name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await api.post('/api/projects', { name: trimmed })
      onCreated(res.data)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to create project.')
    } finally {
      setSaving(false)
    }
  }, [name, onCreated, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">New Project Folder</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Folder Name
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Real Estate Campaign"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Rename Modal ─────────────────────────────────────────────────────────────

function RenameModal({
  project,
  onClose,
  onRenamed,
}: {
  project: ProjectFolder
  onClose: () => void
  onRenamed: (p: ProjectFolder) => void
}) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Folder name is required.'); return }
    if (trimmed === project.name) { onClose(); return }
    setSaving(true)
    setError('')
    try {
      const res = await api.put(`/api/projects/${project.project_id}`, { name: trimmed })
      onRenamed(res.data)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to rename project.')
    } finally {
      setSaving(false)
    }
  }, [name, project, onRenamed, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Rename Project</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Folder Name
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteModal({
  project,
  onClose,
  onDeleted,
}: {
  project: ProjectFolder
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setError('')
    try {
      await api.delete(`/api/projects/${project.project_id}`)
      onDeleted(project.project_id)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to delete project.')
      setDeleting(false)
    }
  }, [project, onDeleted, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <IconTrash className="w-4.5 h-4.5 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Delete Project</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="text-white font-medium">"{project.name}"</span>
                {' '}and all its nested scenes? This cannot be undone.
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

          <div className="flex gap-3 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Folder Card ─────────────────────────────────────────────────────────────

function FolderCard({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: ProjectFolder
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = () => setDropdownOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [dropdownOpen])

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!dropdownOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // 3 items × ~36px + padding
      const menuH = 3 * 36 + 16
      const openUp = rect.bottom + menuH > window.innerHeight - 16
      setMenuStyle({
        position: 'fixed',
        right: window.innerWidth - rect.right,
        zIndex: 9999,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      })
    }
    setDropdownOpen(v => !v)
  }

  const createdDate = new Date(project.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="group relative bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 transition-all hover:shadow-lg hover:shadow-indigo-950/30">
      {/* Clickable body — opens the folder */}
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
            <IconFolder className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="min-w-0 pr-6">
            <h3 className="text-sm font-semibold text-white truncate group-hover:text-indigo-300 transition-colors">
              {project.name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{createdDate}</p>
          </div>
        </div>
      </button>

      {/* Three-dot trigger */}
      <div ref={wrapRef} className="absolute top-4 right-4">
        <button
          ref={btnRef}
          onClick={handleToggle}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <IconDots className="w-4 h-4" />
        </button>
      </div>

      {/* Fixed-position menu — escapes overflow-y-auto clipping */}
      {dropdownOpen && (
        <div
          style={menuStyle}
          className="w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        >
          <button
            onClick={() => { setDropdownOpen(false); onOpen() }}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <IconArrowRight className="w-3.5 h-3.5" />
            Open
          </button>
          <button
            onClick={() => { setDropdownOpen(false); onRename() }}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <IconPencil className="w-3.5 h-3.5" />
            Rename
          </button>
          <div className="border-t border-slate-700/60" />
          <button
            onClick={() => { setDropdownOpen(false); onDelete() }}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <IconTrash className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalState>({ type: 'none' })

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<ProjectFolder[]>('/api/projects')
      setProjects(res.data)
    } catch {
      // stay empty on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  const handleCreated = useCallback((p: ProjectFolder) => {
    setProjects(prev => [p, ...prev])
  }, [])

  const handleRenamed = useCallback((updated: ProjectFolder) => {
    setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p))
  }, [])

  const handleDeleted = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.project_id !== id))
  }, [])

  const closeModal = useCallback(() => setModal({ type: 'none' }), [])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-950 px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-slate-400 mt-1">
            Organise your work into project folders. Open a folder to manage its scenes.
          </p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-indigo-900/30"
        >
          <IconPlus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Loading projects…</p>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
            <IconFolder className="w-8 h-8 text-slate-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-300">No projects yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Create a project folder to start organising your scenes.
            </p>
          </div>
          <button
            onClick={() => setModal({ type: 'create' })}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <IconPlus className="w-4 h-4" />
            Create First Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map(p => (
            <FolderCard
              key={p.project_id}
              project={p}
              onOpen={() => router.push(`/dashboard/projects/${p.project_id}`)}
              onRename={() => setModal({ type: 'rename', project: p })}
              onDelete={() => setModal({ type: 'delete', project: p })}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {modal.type === 'create' && (
        <CreateModal onClose={closeModal} onCreated={handleCreated} />
      )}
      {modal.type === 'rename' && (
        <RenameModal
          project={modal.project}
          onClose={closeModal}
          onRenamed={handleRenamed}
        />
      )}
      {modal.type === 'delete' && (
        <DeleteModal
          project={modal.project}
          onClose={closeModal}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
