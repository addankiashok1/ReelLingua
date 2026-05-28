'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/utils/api'

// ─── Language maps ────────────────────────────────────────────────────────────

const VOICE_LANGUAGES = [
  { code: 'ar', label: 'Arabic' },     { code: 'bg', label: 'Bulgarian' },
  { code: 'zh', label: 'Chinese' },    { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },      { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },      { code: 'en', label: 'English' },
  { code: 'fil', label: 'Filipino' },  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },     { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },      { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },    { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },     { code: 'ms', label: 'Malay' },
  { code: 'no', label: 'Norwegian' },  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' }, { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },    { code: 'sk', label: 'Slovak' },
  { code: 'es', label: 'Spanish' },    { code: 'sv', label: 'Swedish' },
  { code: 'ta', label: 'Tamil' },      { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },  { code: 'vi', label: 'Vietnamese' },
]

const SUBTITLE_LANGUAGES = [
  { code: 'af', label: 'Afrikaans' }, { code: 'ar', label: 'Arabic' },
  { code: 'bn', label: 'Bengali' },   { code: 'bg', label: 'Bulgarian' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' }, { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'hr', label: 'Croatian' },  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },    { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },   { code: 'et', label: 'Estonian' },
  { code: 'tl', label: 'Filipino' },  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },    { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },     { code: 'gu', label: 'Gujarati' },
  { code: 'iw', label: 'Hebrew' },    { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' }, { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },   { code: 'ja', label: 'Japanese' },
  { code: 'jw', label: 'Javanese' },  { code: 'kn', label: 'Kannada' },
  { code: 'ko', label: 'Korean' },    { code: 'lt', label: 'Lithuanian' },
  { code: 'ms', label: 'Malay' },     { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },   { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' }, { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },    { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },   { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },   { code: 'sr', label: 'Serbian' },
  { code: 'si', label: 'Sinhala' },   { code: 'sk', label: 'Slovak' },
  { code: 'es', label: 'Spanish' },   { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },   { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },    { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },   { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },      { code: 'vi', label: 'Vietnamese' },
]

const LANG_LABEL: Record<string, string> = Object.fromEntries(
  [...VOICE_LANGUAGES, ...SUBTITLE_LANGUAGES].map(l => [l.code, l.label])
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface FolderItem {
  folder_id: string
  project_id: string
  parent_id: string | null
  name: string
  created_at: string
}

interface SceneItem {
  job_id: string
  project_id: string
  folder_id: string | null
  scene_name: string | null
  target_voice_lang: string
  target_subtitle_lang: string | null
  source_language: string | null
  status: string
  progress_percentage: number
  output_video_path: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

interface ExplorerContents {
  project_id: string
  project_name: string
  current_folder_id: string | null
  folders: FolderItem[]
  scenes: SceneItem[]
}

interface NavCrumb {
  id: string | null
  name: string
}

type ModalState =
  | { type: 'none' }
  | { type: 'new_folder' }
  | { type: 'add_scene' }
  | { type: 'rename_folder'; folder: FolderItem }
  | { type: 'delete_folder'; folder: FolderItem }
  | { type: 'rename_scene'; scene: SceneItem }
  | { type: 'delete_scene'; scene: SceneItem }

// ─── Pipeline stages ──────────────────────────────────────────────────────────

const STAGES = ['PENDING', 'STARTED', 'EXTRACTED_AUDIO', 'DUBBED_AUDIO', 'TRANSCRIBED', 'BURNED', 'COMPLETED']

function stageIdx(s: string) {
  const i = STAGES.indexOf(s)
  return i === -1 ? 0 : i
}

// ─── Inline SVG icons (Lucide-geometry) ──────────────────────────────────────

function IcoFolder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function IcoFolderPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

function IcoVideo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}

function IcoPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IcoArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function IcoMoreVertical({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5"  r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}

function IcoPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function IcoTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  )
}

function IcoDownload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IcoUpload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function IcoX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6"  y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ─── Milestone stepper ────────────────────────────────────────────────────────

function Stepper({ status, progress }: { status: string; progress: number }) {
  if (status === 'FAILED') {
    return <span className="text-xs font-medium text-red-400">Failed</span>
  }
  const cur = stageIdx(status)
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {STAGES.map((s, i) => {
        const done   = i < cur || status === 'COMPLETED'
        const active = i === cur && status !== 'COMPLETED'
        return (
          <span key={s} className="flex items-center gap-0.5">
            <span
              title={s.replace('_', ' ')}
              className={`inline-block w-2 h-2 rounded-full transition-colors ${
                done ? 'bg-emerald-400' : active ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'
              }`}
            />
            {i < STAGES.length - 1 && (
              <span className={`inline-block w-2.5 h-px ${done ? 'bg-emerald-400/50' : 'bg-slate-700'}`} />
            )}
          </span>
        )
      })}
      {status !== 'COMPLETED' && status !== 'FAILED' && status !== 'PENDING' && (
        <span className="ml-1.5 text-xs text-slate-400">{progress}%</span>
      )}
    </div>
  )
}

// ─── Generic 3-dot dropdown ───────────────────────────────────────────────────

interface DropdownAction {
  label: string
  icon: React.ReactNode
  danger?: boolean
  onClick: () => void
}

function Dropdown({ actions }: { actions: DropdownAction[] }) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll so the fixed menu doesn't drift from its anchor
  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuH = actions.length * 36 + 16
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
    setOpen(v => !v)
  }

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
      >
        <IcoMoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div
          style={menuStyle}
          className="w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        >
          {actions.map((a, i) => (
            <div key={i}>
              {a.danger && i > 0 && <div className="border-t border-slate-700/60" />}
              <button
                onClick={() => { setOpen(false); a.onClick() }}
                className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium transition-colors ${
                  a.danger
                    ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {a.icon}
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Simple text-input modal ──────────────────────────────────────────────────

function TextModal({
  title,
  label,
  placeholder,
  defaultValue = '',
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string
  label: string
  placeholder: string
  defaultValue?: string
  submitLabel: string
  onClose: () => void
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(defaultValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (defaultValue) inputRef.current?.select()
  }, [defaultValue])

  const handle = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) { setError(`${label} is required.`); return }
    setSaving(true); setError('')
    try {
      await onSubmit(trimmed)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Something went wrong.')
      setSaving(false)
    }
  }, [value, label, onSubmit])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <IcoX className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handle} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

function DeleteModal({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string
  description: React.ReactNode
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handle = useCallback(async () => {
    setDeleting(true); setError('')
    try {
      await onConfirm()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Something went wrong.')
      setDeleting(false)
    }
  }, [onConfirm])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
              <IcoTrash className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button onClick={handle} disabled={deleting}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Scene modal ──────────────────────────────────────────────────────────

function AddSceneModal({
  projectId,
  currentFolderId,
  onClose,
  onQueued,
}: {
  projectId: string
  currentFolderId: string | null
  onClose: () => void
  onQueued: (scene: SceneItem) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [sceneName, setSceneName] = useState('')
  const [voiceLang, setVoiceLang] = useState('hi')
  const [subtitleLang, setSubtitleLang] = useState('en')
  const [sourceLang, setSourceLang] = useState('auto')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!sceneName) setSceneName(f.name.replace(/\.[^.]+$/, ''))
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Please select a video file.'); return }
    setUploading(true); setError('')

    const fd = new FormData()
    fd.append('file', file)
    fd.append('project_id', projectId)
    if (currentFolderId) fd.append('folder_id', currentFolderId)
    fd.append('target_language', voiceLang)
    fd.append('subtitle_language', subtitleLang)
    fd.append('source_language', sourceLang)
    if (sceneName.trim()) fd.append('scene_name', sceneName.trim())

    try {
      const res = await api.post('/api/scenes', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onQueued({
        job_id: res.data.job_id,
        project_id: projectId,
        folder_id: currentFolderId,
        scene_name: sceneName.trim() || null,
        target_voice_lang: voiceLang,
        target_subtitle_lang: subtitleLang,
        source_language: sourceLang,
        status: 'PENDING',
        progress_percentage: 0,
        output_video_path: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Upload failed. Please try again.')
      setUploading(false)
    }
  }, [file, sceneName, voiceLang, subtitleLang, sourceLang, projectId, currentFolderId, onQueued, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Add Scene</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <IcoX className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          {/* File drop zone */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 transition-colors ${
              file
                ? 'border-indigo-500/60 bg-indigo-500/5'
                : 'border-slate-700 hover:border-slate-600 bg-slate-800/40'
            }`}
          >
            <IcoUpload className={`w-6 h-6 ${file ? 'text-indigo-400' : 'text-slate-500'}`} />
            {file ? (
              <span className="text-sm text-indigo-300 font-medium truncate max-w-full px-2">{file.name}</span>
            ) : (
              <>
                <span className="text-sm text-slate-400">Click to choose a video file</span>
                <span className="text-xs text-slate-600">MP4 · MOV · MKV · AVI</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-matroska,video/avi"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Scene name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Scene Name <span className="text-slate-600">(optional)</span>
            </label>
            <input
              value={sceneName}
              onChange={e => setSceneName(e.target.value)}
              placeholder="e.g. Opening Act, Climax Scene"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Language selectors */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Source</label>
              <select
                value={sourceLang}
                onChange={e => setSourceLang(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="auto">Auto-detect</option>
                {VOICE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Voice (Dub)</label>
              <select
                value={voiceLang}
                onChange={e => setVoiceLang(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {VOICE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Subtitle</label>
              <select
                value={subtitleLang}
                onChange={e => setSubtitleLang(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SUBTITLE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={uploading || !file}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
              {uploading ? 'Uploading…' : 'Upload & Queue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Folder card ──────────────────────────────────────────────────────────────

function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderItem
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const date = new Date(folder.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="group relative bg-slate-900 border border-slate-800 hover:border-yellow-500/40 rounded-2xl p-4 transition-all hover:shadow-lg hover:shadow-yellow-950/20 flex flex-col gap-3">
      {/* Clickable body */}
      <button onClick={onOpen} className="flex items-center gap-3 text-left w-full pr-8">
        <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center shrink-0">
          <IcoFolder className="w-5 h-5 text-yellow-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate group-hover:text-yellow-300 transition-colors">
            {folder.name}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{date}</p>
        </div>
      </button>

      {/* 3-dot menu */}
      <div className="absolute top-3 right-3">
        <Dropdown actions={[
          { label: 'Open',   icon: <IcoFolder className="w-3.5 h-3.5" />,  onClick: onOpen },
          { label: 'Rename', icon: <IcoPencil className="w-3.5 h-3.5" />,  onClick: onRename },
          { label: 'Delete', icon: <IcoTrash  className="w-3.5 h-3.5" />,  onClick: onDelete, danger: true },
        ]} />
      </div>
    </div>
  )
}

// ─── Scene card ───────────────────────────────────────────────────────────────

function SceneCard({
  scene,
  token,
  onRename,
  onDelete,
}: {
  scene: SceneItem
  token: string
  onRename: () => void
  onDelete: () => void
}) {
  const handleDownload = () => {
    if (!scene.output_video_path) return
    const filename = scene.output_video_path.split(/[\\/]/).pop() ?? 'output.mp4'
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
    const a = document.createElement('a')
    a.href = `${base}/downloads/${filename}?token=${token}`
    a.download = filename
    a.click()
  }

  const voiceLabel    = LANG_LABEL[scene.target_voice_lang]    ?? scene.target_voice_lang.toUpperCase()
  const subLabel      = scene.target_subtitle_lang ? (LANG_LABEL[scene.target_subtitle_lang] ?? scene.target_subtitle_lang.toUpperCase()) : null
  const isActive      = !['COMPLETED', 'FAILED'].includes(scene.status)

  return (
    <div className="relative bg-slate-900 border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-4 transition-all flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3 pr-8">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0 mt-0.5">
          <IcoVideo className="w-5 h-5 text-indigo-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {scene.scene_name ?? <span className="italic text-slate-500">Untitled</span>}
          </p>
          {/* Language badge */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
              {voiceLabel}
            </span>
            {subLabel && (
              <>
                <span className="text-slate-600 text-xs">→</span>
                <span className="text-xs bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded-full">
                  {subLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status */}
      <Stepper status={scene.status} progress={scene.progress_percentage} />

      {/* Error message */}
      {scene.error_message && (
        <p className="text-xs text-red-400 truncate" title={scene.error_message}>
          {scene.error_message}
        </p>
      )}

      {/* Download / active indicator */}
      {scene.status === 'COMPLETED' && scene.output_video_path ? (
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/30 transition-colors w-fit"
        >
          <IcoDownload className="w-3.5 h-3.5" />
          Download
        </button>
      ) : isActive ? (
        <span className="text-xs text-slate-500 flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Processing…
        </span>
      ) : null}

      {/* 3-dot menu */}
      <div className="absolute top-3 right-3">
        <Dropdown actions={[
          { label: 'Rename', icon: <IcoPencil className="w-3.5 h-3.5" />, onClick: onRename },
          { label: 'Delete', icon: <IcoTrash  className="w-3.5 h-3.5" />, onClick: onDelete, danger: true },
        ]} />
      </div>
    </div>
  )
}

// ─── Main Explorer Page ───────────────────────────────────────────────────────

export default function ExplorerPage() {
  const params    = useParams()
  const router    = useRouter()
  const projectId = params.projectId as string

  const [navHistory, setNavHistory] = useState<NavCrumb[]>([{ id: null, name: 'Project Root' }])
  const [contents,   setContents]   = useState<ExplorerContents | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState<ModalState>({ type: 'none' })
  const [token,      setToken]      = useState('')

  const currentFolderId = navHistory[navHistory.length - 1].id

  useEffect(() => { setToken(localStorage.getItem('access_token') ?? '') }, [])

  // ── Fetch contents whenever the active folder changes ───────────────────────
  const fetchContents = useCallback(async (folderId: string | null) => {
    setLoading(true)
    try {
      const params = folderId ? `?folder_id=${folderId}` : ''
      const res = await api.get<ExplorerContents>(
        `/api/projects/${projectId}/contents${params}`
      )
      setContents(res.data)
    } catch {
      // stay on last good contents
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchContents(currentFolderId)
  }, [currentFolderId, fetchContents])

  // ── Auto-refresh while scenes are active ────────────────────────────────────
  useEffect(() => {
    if (!contents) return
    const hasActive = contents.scenes.some(
      s => !['COMPLETED', 'FAILED'].includes(s.status)
    )
    if (!hasActive) return
    const timer = setInterval(() => fetchContents(currentFolderId), 6000)
    return () => clearInterval(timer)
  }, [contents, currentFolderId, fetchContents])

  // ── Navigation helpers ───────────────────────────────────────────────────────
  const enterFolder = useCallback((f: FolderItem) => {
    setNavHistory(prev => [...prev, { id: f.folder_id, name: f.name }])
  }, [])

  const navigateToCrumb = useCallback((index: number) => {
    setNavHistory(prev => prev.slice(0, index + 1))
  }, [])

  const closeModal = useCallback(() => setModal({ type: 'none' }), [])

  // ── Folder CRUD ──────────────────────────────────────────────────────────────
  const handleCreateFolder = useCallback(async (name: string) => {
    const body: Record<string, string> = { project_id: projectId, name }
    if (currentFolderId) body.parent_id = currentFolderId
    const res = await api.post<FolderItem>('/api/folders', body)
    setContents(prev => prev ? { ...prev, folders: [...prev.folders, res.data].sort((a, b) => a.name.localeCompare(b.name)) } : prev)
    closeModal()
  }, [projectId, currentFolderId, closeModal])

  const handleRenameFolder = useCallback(async (folder: FolderItem, name: string) => {
    const res = await api.put<FolderItem>(`/api/folders/${folder.folder_id}`, { name })
    setContents(prev => prev ? {
      ...prev,
      folders: prev.folders.map(f => f.folder_id === folder.folder_id ? res.data : f)
                            .sort((a, b) => a.name.localeCompare(b.name)),
    } : prev)
    closeModal()
  }, [closeModal])

  const handleDeleteFolder = useCallback(async (folder: FolderItem) => {
    await api.delete(`/api/folders/${folder.folder_id}`)
    setContents(prev => prev ? { ...prev, folders: prev.folders.filter(f => f.folder_id !== folder.folder_id) } : prev)
    closeModal()
  }, [closeModal])

  // ── Scene CRUD ───────────────────────────────────────────────────────────────
  const handleSceneQueued = useCallback((scene: SceneItem) => {
    setContents(prev => prev ? { ...prev, scenes: [scene, ...prev.scenes] } : prev)
    closeModal()
  }, [closeModal])

  const handleRenameScene = useCallback(async (scene: SceneItem, name: string) => {
    const res = await api.put<SceneItem>(`/api/scenes/${scene.job_id}`, { scene_name: name })
    setContents(prev => prev ? { ...prev, scenes: prev.scenes.map(s => s.job_id === scene.job_id ? res.data : s) } : prev)
    closeModal()
  }, [closeModal])

  const handleDeleteScene = useCallback(async (scene: SceneItem) => {
    await api.delete(`/api/scenes/${scene.job_id}`)
    setContents(prev => prev ? { ...prev, scenes: prev.scenes.filter(s => s.job_id !== scene.job_id) } : prev)
    closeModal()
  }, [closeModal])

  // ─────────────────────────────────────────────────────────────────────────────

  const projectName = contents?.project_name ?? 'Project'
  const isEmpty     = !loading && contents && contents.folders.length === 0 && contents.scenes.length === 0

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-950">

      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <div className="px-8 pt-7 pb-5 border-b border-slate-800">
        {/* Back to projects */}
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-4"
        >
          <IcoArrowLeft className="w-3.5 h-3.5" />
          All Projects
        </button>

        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-white truncate">{projectName}</h1>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setModal({ type: 'new_folder' })}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium rounded-xl transition-colors border border-slate-700"
            >
              <IcoFolderPlus className="w-3.5 h-3.5" />
              New Folder
            </button>
            <button
              onClick={() => setModal({ type: 'add_scene' })}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-xl transition-colors shadow-lg shadow-indigo-900/30"
            >
              <IcoPlus className="w-3.5 h-3.5" />
              Add Scene
            </button>
          </div>
        </div>

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1.5 mt-3 flex-wrap">
          {navHistory.map((crumb, i) => {
            const isLast = i === navHistory.length - 1
            return (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-600 text-xs">›</span>}
                <button
                  onClick={() => !isLast && navigateToCrumb(i)}
                  disabled={isLast}
                  className={`text-xs font-medium transition-colors ${
                    isLast
                      ? 'text-white cursor-default'
                      : 'text-slate-500 hover:text-indigo-400'
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            )
          })}
        </nav>
      </div>

      {/* ── Explorer canvas ────────────────────────────────────────────────── */}
      <div className="flex-1 px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Loading…</p>
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
              <IcoFolder className="w-8 h-8 text-slate-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-300">This folder is empty</p>
              <p className="text-sm text-slate-500 mt-1">Create a subfolder or upload a scene to get started.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setModal({ type: 'new_folder' })}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-colors border border-slate-700"
              >
                <IcoFolderPlus className="w-4 h-4" />
                New Folder
              </button>
              <button
                onClick={() => setModal({ type: 'add_scene' })}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <IcoPlus className="w-4 h-4" />
                Add Scene
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {/* ── Folders first ─────────────────────────────────────────────── */}
            {contents!.folders.map(f => (
              <FolderCard
                key={f.folder_id}
                folder={f}
                onOpen={() => enterFolder(f)}
                onRename={() => setModal({ type: 'rename_folder', folder: f })}
                onDelete={() => setModal({ type: 'delete_folder', folder: f })}
              />
            ))}

            {/* ── Scenes after folders ──────────────────────────────────────── */}
            {contents!.scenes.map(s => (
              <SceneCard
                key={s.job_id}
                scene={s}
                token={token}
                onRename={() => setModal({ type: 'rename_scene', scene: s })}
                onDelete={() => setModal({ type: 'delete_scene', scene: s })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {modal.type === 'new_folder' && (
        <TextModal
          title="New Folder"
          label="Folder Name"
          placeholder="e.g. Assets, Promos, Episode 01"
          submitLabel="Create"
          onClose={closeModal}
          onSubmit={handleCreateFolder}
        />
      )}

      {modal.type === 'add_scene' && (
        <AddSceneModal
          projectId={projectId}
          currentFolderId={currentFolderId}
          onClose={closeModal}
          onQueued={handleSceneQueued}
        />
      )}

      {modal.type === 'rename_folder' && (
        <TextModal
          title="Rename Folder"
          label="Folder Name"
          placeholder=""
          defaultValue={modal.folder.name}
          submitLabel="Save"
          onClose={closeModal}
          onSubmit={name => handleRenameFolder(modal.folder, name)}
        />
      )}

      {modal.type === 'delete_folder' && (
        <DeleteModal
          title="Delete Folder"
          description={
            <>
              Are you sure you want to delete{' '}
              <span className="text-white font-medium">"{modal.folder.name}"</span>
              {' '}and all its nested subfolders and scenes? This cannot be undone.
            </>
          }
          onClose={closeModal}
          onConfirm={() => handleDeleteFolder(modal.folder)}
        />
      )}

      {modal.type === 'rename_scene' && (
        <TextModal
          title="Rename Scene"
          label="Scene Name"
          placeholder="e.g. Climax Scene"
          defaultValue={modal.scene.scene_name ?? ''}
          submitLabel="Save"
          onClose={closeModal}
          onSubmit={name => handleRenameScene(modal.scene, name)}
        />
      )}

      {modal.type === 'delete_scene' && (
        <DeleteModal
          title="Delete Scene"
          description={
            <>
              Are you sure you want to permanently delete{' '}
              <span className="text-white font-medium">
                "{modal.scene.scene_name ?? 'this scene'}"
              </span>
              {' '}and its rendered output? This cannot be undone.
            </>
          }
          onClose={closeModal}
          onConfirm={() => handleDeleteScene(modal.scene)}
        />
      )}

    </div>
  )
}
