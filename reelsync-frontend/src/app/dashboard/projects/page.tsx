'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/utils/api'
import { toast } from '@/components/Toast'

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

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconFolder({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
}
function IconPlus({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}
function IconDots({ className }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
}
function IconArrowRight({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
}
function IconPencil({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
}
function IconTrash({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
}
function IconX({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectFolder) => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Folder name is required.'); return }
    setSaving(true); setError('')
    try {
      const res = await api.post('/api/projects', { name: trimmed })
      onCreated(res.data); onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to create project.')
    } finally { setSaving(false) }
  }, [name, onCreated, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">New Project Folder</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><IconX className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Folder Name</label>
            <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Real Estate Campaign"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RenameModal({ project, onClose, onRenamed }: { project: ProjectFolder; onClose: () => void; onRenamed: (p: ProjectFolder) => void }) {
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Folder name is required.'); return }
    if (trimmed === project.name) { onClose(); return }
    setSaving(true); setError('')
    try {
      const res = await api.put(`/api/projects/${project.project_id}`, { name: trimmed })
      onRenamed(res.data); onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to rename project.')
    } finally { setSaving(false) }
  }, [name, project, onRenamed, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Rename Project</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><IconX className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Folder Name</label>
            <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteModal({ project, onClose, onTrashed }: {
  project: ProjectFolder
  onClose: () => void
  onTrashed: (id: string) => void
}) {
  const [moving, setMoving] = useState(false)

  const handleMoveToTrash = useCallback(async () => {
    setMoving(true)
    try {
      await api.post(`/api/trash/projects/${project.project_id}`)
      onTrashed(project.project_id)
      onClose()
      toast.success(`"${project.name}" moved to Trash. You can recover it within 15 days.`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Could not move project to Trash.')
      setMoving(false)
    }
  }, [project, onTrashed, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <IconTrash className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Move to Trash</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Are you sure you want to move{' '}
              <span className="text-white font-medium">"{project.name}"</span>{' '}
              to the Trash? Items can be restored or will be automatically wiped permanently after 15 days.
            </p>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMoveToTrash}
            disabled={moving}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"
          >
            {moving ? 'Moving…' : 'Move to Trash'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Folder Card ──────────────────────────────────────────────────────────────
//
// WHY mousedown (not click) for outside-close detection:
//
// In React 17+, React delegates synthetic events to the root container
// (#__next in Next.js), NOT to document. When e.stopPropagation() is called
// inside a React onClick handler, it stops the event from propagating through
// the React fiber tree — but the native event has already reached the React
// root and continues to bubble natively from that root up to document.
//
// A document.addEventListener('click', closeHandler) therefore ALWAYS fires
// on every click, even when stopPropagation() is called in React. This causes
// the dropdown to open and immediately close in the same event cycle, making
// it appear broken.
//
// The fix: use mousedown on the document with a DOM-containment check.
// mousedown fires before click. By the time the React onClick fires (on click,
// not mousedown), the outside-close decision has already been settled.
// Additionally, dropdownRef wraps both the trigger button AND the fixed-
// positioned menu in the DOM tree, so contains() returns true for both —
// preventing the menu from closing when items inside it are clicked.

function FolderCard({
  project,
  isDropdownOpen,
  onDropdownToggle,
  onDropdownClose,
  onOpen,
  onRename,
  onDelete,
}: {
  project: ProjectFolder
  isDropdownOpen: boolean
  onDropdownToggle: () => void
  onDropdownClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  // dropdownRef wraps both the trigger button and the (fixed-position) menu
  // panel so that DOM containment checks correctly cover both elements.
  const dropdownRef = useRef<HTMLDivElement>(null)
  const btnRef      = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  // Recalculate fixed position each time the menu opens so it anchors correctly
  // to the trigger button regardless of scroll position.
  useEffect(() => {
    if (!isDropdownOpen || !btnRef.current) return
    const r      = btnRef.current.getBoundingClientRect()
    const menuH  = 3 * 36 + 16                              // 3 items × 36px + padding
    const openUp = r.bottom + menuH > window.innerHeight - 16
    setMenuStyle({
      position: 'fixed',
      right:    window.innerWidth - r.right,
      zIndex:   9999,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top:    r.bottom + 4 }),
    })
  }, [isDropdownOpen])

  // Outside-click detection via native mousedown — not click.
  // This sidesteps the React 17+ event-delegation issue described above.
  // dropdownRef.current.contains(target) returns true for both the trigger
  // button and the fixed-position menu children, so neither interaction closes
  // the menu prematurely.
  useEffect(() => {
    if (!isDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onDropdownClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isDropdownOpen, onDropdownClose])

  // Close on scroll so the fixed menu doesn't visually drift from its anchor.
  useEffect(() => {
    if (!isDropdownOpen) return
    const handler = () => onDropdownClose()
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [isDropdownOpen, onDropdownClose])

  const date = new Date(project.created_at.replace(' ', 'T').replace('+00:00', 'Z'))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="group relative bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 transition-all hover:shadow-lg hover:shadow-indigo-950/30">

      {/* Main clickable area — navigates into the project */}
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
            <IconFolder className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="min-w-0 pr-8">
            <h3 className="text-sm font-semibold text-white truncate group-hover:text-indigo-300 transition-colors">
              {project.name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{date}</p>
          </div>
        </div>
      </button>

      {/* Three-dot context menu
          dropdownRef wraps trigger + menu panel so contains() covers both. */}
      <div ref={dropdownRef} className="absolute top-4 right-4">
        <button
          ref={btnRef}
          type="button"
          aria-label="Project options"
          aria-expanded={isDropdownOpen}
          className="p-1.5 hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 rounded-md transition relative z-30"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation() // keeps the card's onOpen button from activating
            console.log('[FolderCard] three-dot clicked for project_id:', project.project_id)
            onDropdownToggle()
          }}
        >
          <IconDots className="w-4 h-4" />
        </button>

        {isDropdownOpen && (
          <div style={menuStyle} className="w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDropdownClose(); onOpen() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <IconArrowRight className="w-3.5 h-3.5" /> Open
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDropdownClose(); onRename() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <IconPencil className="w-3.5 h-3.5" /> Rename
            </button>
            <div className="border-t border-slate-700/60" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDropdownClose(); onDelete() }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
            >
              <IconTrash className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter()
  const [projects,       setProjects]       = useState<ProjectFolder[]>([])
  const [loading,        setLoading]        = useState(true)
  const [modal,          setModal]          = useState<ModalState>({ type: 'none' })
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)

  // NOTE: No document-level click listener here.
  // The open/close logic lives entirely in FolderCard's mousedown handler so
  // it is immune to the React 17+ event-delegation issue. onDropdownClose is
  // passed as a stable callback; each card registers/unregisters its own
  // listener only while its menu is actually open.

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

  const handleCreated = useCallback((p: ProjectFolder) => setProjects(prev => [p, ...prev]), [])
  const handleRenamed = useCallback((updated: ProjectFolder) => setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p)), [])
  const handleTrashed = useCallback((id: string) => setProjects(prev => prev.filter(p => p.project_id !== id)), [])
  const closeModal    = useCallback(() => setModal({ type: 'none' }), [])

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
            <p className="text-sm text-slate-500 mt-1">Create a project folder to start organising your scenes.</p>
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
              isDropdownOpen={openDropdownId === p.project_id}
              onDropdownToggle={() =>
                setOpenDropdownId(prev => prev === p.project_id ? null : p.project_id)
              }
              onDropdownClose={() => setOpenDropdownId(null)}
              onOpen={() => router.push(`/dashboard/projects/${p.project_id}`)}
              onRename={() => { setOpenDropdownId(null); setModal({ type: 'rename', project: p }) }}
              onDelete={() => { setOpenDropdownId(null); setModal({ type: 'delete', project: p }) }}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {modal.type === 'create' && <CreateModal onClose={closeModal} onCreated={handleCreated} />}
      {modal.type === 'rename' && <RenameModal project={modal.project} onClose={closeModal} onRenamed={handleRenamed} />}
      {modal.type === 'delete' && <DeleteModal project={modal.project} onClose={closeModal} onTrashed={handleTrashed} />}

    </div>
  )
}
