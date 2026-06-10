'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import api from '@/utils/api'
import { toast } from '@/components/Toast'

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

// ─── Quality presets ─────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { label: '360p',          height: 360  },
  { label: '480p',          height: 480  },
  { label: '720p (HD)',     height: 720  },
  { label: '1080p (FHD)',   height: 1080 },
  { label: '1440p (2K)',    height: 1440 },
  { label: '2160p (4K)',    height: 2160 },
] as const

/** Returns presets available for a given native height (never allows upscaling). */
const DEFAULT_OUTPUT_HEIGHT = 720

function availablePresets(nativeHeight: number | null) {
  if (!nativeHeight) return QUALITY_PRESETS
  return QUALITY_PRESETS.filter(p => p.height <= nativeHeight)
}

function getQualityLabel(outputHeight: number, nativeHeight: number | null) {
  if (outputHeight === 0) {
    return nativeHeight ? `Match source (${nativeHeight}p)` : 'Match source'
  }
  const preset = QUALITY_PRESETS.find(p => p.height === outputHeight)
  return preset?.label ?? `${outputHeight}p`
}

function estimateRenderTime(outputHeight: number, nativeHeight: number | null) {
  const height = outputHeight === 0 ? nativeHeight ?? DEFAULT_OUTPUT_HEIGHT : outputHeight
  if (height <= 360) return '≈ 1m'
  if (height <= 480) return '≈ 1m 15s'
  if (height <= 720) return '≈ 1m 45s'
  if (height <= 1080) return '≈ 2m 30s'
  if (height <= 1440) return '≈ 4m'
  return '≈ 6m'
}

/** Best-effort browser-side resolution detection before upload. */
function detectVideoHeight(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const h = video.videoHeight
      URL.revokeObjectURL(video.src)
      resolve(h > 0 ? h : null)
    }
    video.onerror = () => { URL.revokeObjectURL(video.src); resolve(null) }
    video.src = URL.createObjectURL(file)
  })
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
  input_video_path: string | null
  original_height: number | null
  output_height: number | null
  output_video_path: string | null
  thumbnail_path: string | null
  thumbnail_url: string | null
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

interface SceneHistoryItem {
  id: string
  target_voice_lang: string
  target_subtitle_lang: string | null
  source_language: string | null
  output_video_path: string | null
  thumbnail_path: string | null
  created_at: string
}

type DragItem =
  | { type: 'folder'; folderId: string }
  | { type: 'scene'; sceneId: string }

type ModalState =
  | { type: 'none' }
  | { type: 'new_folder' }
  | { type: 'add_scene' }
  | { type: 'rename_folder'; folder: FolderItem }
  | { type: 'delete_folder'; folder: FolderItem }
  | { type: 'rename_scene'; scene: SceneItem }
  | { type: 'delete_scene'; scene: SceneItem }
  | { type: 'edit_scene'; scene: SceneItem }



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

function IcoPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function IcoRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  )
}

function IcoClock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
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
                onClick={e => { e.stopPropagation(); setOpen(false); a.onClick() }}
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

// ─── Move-to-Trash confirm modal ──────────────────────────────────────────────

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
  const [moving, setMoving] = useState(false)

  const handle = useCallback(async () => {
    setMoving(true)
    try {
      await onConfirm()
    } catch {
      setMoving(false)
    }
  }, [onConfirm])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <IcoTrash className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button onClick={handle} disabled={moving}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors">
              {moving ? 'Moving…' : 'Move to Trash'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Single-video lightbox (used for version-history item playback) ───────────

function VideoPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md px-4 py-6"
      onClick={onClose}
    >
      <div className="relative w-full max-w-5xl" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-11 right-0 w-9 h-9 flex items-center justify-center rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors border border-slate-700"
        >
          <IcoX className="w-4 h-4" />
        </button>
        <video src={url} controls autoPlay className="w-full max-h-[80vh] rounded-xl shadow-2xl bg-black" />
      </div>
    </div>
  )
}

// ─── QC Comparison lightbox ───────────────────────────────────────────────────
// Derives download_url and original_url directly from the SceneItem so the
// caller only needs to store one piece of state: the scene object itself.

function QCComparisonModal({
  scene,
  token,
  onClose,
}: {
  scene: SceneItem
  token: string
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const base           = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
  const outputFilename = scene.output_video_path?.replace(/\\/g, '/').split('/').pop() ?? ''
  const inputFilename  = scene.input_video_path?.replace(/\\/g, '/').split('/').pop() ?? ''
  const download_url   = outputFilename
    ? `${base}/downloads/${outputFilename}?token=${encodeURIComponent(token)}`
    : ''
  const original_url   = inputFilename
    ? `${base}/originals/${inputFilename}?token=${encodeURIComponent(token)}`
    : null

  const srcLabel    = scene.source_language && scene.source_language !== 'auto'
    ? (LANG_LABEL[scene.source_language] ?? scene.source_language.toUpperCase())
    : 'Auto'
  const targetLabel = LANG_LABEL[scene.target_voice_lang] ?? scene.target_voice_lang.toUpperCase()

  const handleDownload = () => {
    if (!download_url) return
    const a = document.createElement('a')
    a.href     = download_url
    a.download = outputFilename || 'output.mp4'
    a.click()
  }

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              {scene.scene_name ?? 'Untitled'} — QC Comparison View
            </h3>
            <p className="text-xs text-slate-500">Compare original source media against active AI translations</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition"
          >
            <IcoX className="w-5 h-5" />
          </button>
        </div>

        {/* Dual Player Canvas — grid-cols-1 on mobile, 2-col on md+ */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto bg-slate-900/40 flex-1 min-h-0">

          {/* Left Column: Original Video */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider px-1">Original Video</span>
            <div className="relative aspect-[16/10] bg-black rounded-xl border border-slate-800 overflow-hidden">
              {original_url ? (
                <video src={original_url} controls className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <IcoVideo className="w-8 h-8 text-slate-700" />
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Original source is stored on the server.<br />
                    Preview requires the <code className="text-slate-500">/originals/</code> endpoint.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Translated & Dubbed */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider px-1">Translated &amp; Dubbed</span>
            <div className="relative aspect-[16/10] bg-black rounded-xl border border-emerald-900/30 overflow-hidden shadow-[0_0_20px_rgba(16,185,129,0.05)]">
              {download_url ? (
                <video src={download_url} controls className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <p className="text-xs text-slate-600">Output not yet available</p>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-3 shrink-0">
          <span className="text-xs text-slate-500 mr-auto">
            Output profile: {srcLabel} ➔ {targetLabel}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition"
          >
            Close Preview
          </button>
          <button
            onClick={handleDownload}
            disabled={!download_url}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition flex items-center gap-1.5"
          >
            <IcoDownload className="w-3.5 h-3.5" />
            Download Final Master
          </button>
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
  const [file,           setFile]           = useState<File | null>(null)
  const [sceneName,      setSceneName]      = useState('')
  const [voiceLang,      setVoiceLang]      = useState('hi')
  const [subtitleLang,   setSubtitleLang]   = useState('en')
  const [sourceLang,     setSourceLang]     = useState('auto')
  const [outputHeight,   setOutputHeight]   = useState<number>(0)   // 0 = match source
  const [nativeHeight,   setNativeHeight]   = useState<number | null>(null)
  const [uploading,      setUploading]      = useState(false)
  const [error,          setError]          = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!sceneName) setSceneName(f.name.replace(/\.[^.]+$/, ''))
    const h = await detectVideoHeight(f)
    setNativeHeight(h)
    if (h && h >= DEFAULT_OUTPUT_HEIGHT) {
      setOutputHeight(DEFAULT_OUTPUT_HEIGHT)
    } else {
      setOutputHeight(0)
    }
  }, [sceneName])

  const presets = availablePresets(nativeHeight)

  const selectedQualityLabel = useMemo(() => getQualityLabel(outputHeight, nativeHeight), [outputHeight, nativeHeight])
  const estimatedTime = useMemo(() => estimateRenderTime(outputHeight, nativeHeight), [outputHeight, nativeHeight])

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
    fd.append('output_height', String(outputHeight))
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
        input_video_path: null,
        original_height: nativeHeight,
        output_height: outputHeight || null,
        output_video_path: null,
        thumbnail_path: null,
        thumbnail_url: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Upload failed. Please try again.')
      setUploading(false)
    }
  }, [file, sceneName, voiceLang, subtitleLang, sourceLang, outputHeight, nativeHeight, projectId, currentFolderId, onQueued, onClose])

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

          {/* Output quality selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Output Quality
              {nativeHeight && (
                <span className="ml-1.5 text-slate-600 font-normal">
                  — source is {nativeHeight}p; options above it are hidden
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOutputHeight(0)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  outputHeight === 0
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                Match Source
              </button>
              {presets.map(p => (
                <button
                  key={p.height}
                  type="button"
                  onClick={() => setOutputHeight(p.height)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    outputHeight === p.height
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {file && (
            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-slate-300">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-1">Estimated render time</p>
                  <p className="text-sm font-semibold text-white">{estimatedTime}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-1">Output target</p>
                  <p className="text-sm font-medium text-white">{selectedQualityLabel}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Higher resolutions take longer to encode. If you choose a height above the source, the backend will keep the original native height.
              </p>
            </div>
          )}

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

// ─── Edit Scene modal ─────────────────────────────────────────────────────────

function EditSceneModal({
  scene,
  onClose,
  onReprocessed,
}: {
  scene: SceneItem
  onClose: () => void
  onReprocessed: (updated: SceneItem) => void
}) {
  const supportedVoiceCodes = new Set(VOICE_LANGUAGES.map(l => l.code))
  const [voiceLang,    setVoiceLang]    = useState(scene.target_voice_lang)
  const [subtitleLang, setSubtitleLang] = useState(scene.target_subtitle_lang ?? 'en')
  // source_language may be an auto-detected code unsupported by ElevenLabs (e.g. 'te');
  // fall back to 'auto' so the dropdown isn't silently stuck on a hidden bad value.
  const [sourceLang,   setSourceLang]   = useState(
    supportedVoiceCodes.has(scene.source_language ?? '') ? (scene.source_language ?? 'auto') : 'auto'
  )
  // Initialise to the current job's output_height (0 = match source)
  const [outputHeight, setOutputHeight] = useState<number>(scene.output_height ?? 0)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Presets capped to the original resolution — uses the server-derived value
  // so it is always accurate (not the browser estimate used during upload).
  const editPresets = availablePresets(scene.original_height ?? null)
  const selectedQualityLabel = useMemo(
    () => getQualityLabel(outputHeight, scene.original_height ?? null),
    [outputHeight, scene.original_height]
  )
  const estimatedTime = useMemo(
    () => estimateRenderTime(outputHeight, scene.original_height ?? null),
    [outputHeight, scene.original_height]
  )

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await api.post<SceneItem>(`/api/scenes/${scene.job_id}/reprocess`, {
        target_voice_lang:    voiceLang,
        target_subtitle_lang: subtitleLang,
        source_language:      sourceLang,
        output_height:        outputHeight || null,
      })
      onReprocessed(res.data)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Something went wrong.')
      setSaving(false)
    }
  }, [voiceLang, subtitleLang, sourceLang, outputHeight, scene.job_id, onReprocessed, onClose])

  const changed = voiceLang    !== scene.target_voice_lang
    || subtitleLang !== (scene.target_subtitle_lang ?? 'en')
    || sourceLang   !== (scene.source_language ?? 'auto')
    || outputHeight !== (scene.output_height ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <IcoRefresh className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Edit & Reprocess</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <IcoX className="w-4 h-4" />
          </button>
        </div>

        {/* Scene name */}
        <div className="px-5 pt-4">
          <p className="text-xs text-slate-500 mb-3">
            Scene: <span className="text-slate-300 font-medium">{scene.scene_name ?? 'Untitled'}</span>
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-3">
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

          {/* Output quality — options are hard-capped at the original resolution */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Output Quality
              {scene.original_height && (
                <span className="ml-1.5 text-slate-600 font-normal">
                  — source is {scene.original_height}p
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOutputHeight(0)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  outputHeight === 0
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                Match Source
              </button>
              {editPresets.map(p => (
                <button
                  key={p.height}
                  type="button"
                  onClick={() => setOutputHeight(p.height)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    outputHeight === p.height
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-slate-300">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-1">Estimated render time</p>
                <p className="text-sm font-semibold text-white">{estimatedTime}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-1">Output target</p>
                <p className="text-sm font-medium text-white">{selectedQualityLabel}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Higher resolutions take longer to encode. If you choose a height above the source, the backend will preserve the native resolution.
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !changed}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {saving ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Queuing…
                </>
              ) : (
                <>
                  <IcoRefresh className="w-3.5 h-3.5" />
                  Reprocess
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}

// ─── Folder card — compact horizontal row ─────────────────────────────────────

// ─── Subfolder Card ───────────────────────────────────────────────────────────
//
// Layout: a flex row with two fully isolated click zones.
//
//   ZONE 1 (left, flex-1): folder icon + name + date → calls onOpen
//   ZONE 2 (right, shrink-0): three-dot trigger + backdrop + menu panel
//
// The backdrop pattern avoids every React 17+ event-delegation issue:
//   • When the menu is open, a transparent `fixed inset-0 z-40` div covers
//     the entire viewport. Any click that lands outside the menu panel hits
//     the backdrop first and calls onDropdownClose().
//   • The menu panel sits at z-50 (above the backdrop) and uses
//     `absolute` positioning relative to Zone 2, so no position arithmetic
//     or useEffect is needed.
//   • No document listeners, no mousedown timing, no containment checks.

function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
  isDropdownOpen,
  onDropdownToggle,
  onDropdownClose,
  isDragOver,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: FolderItem
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  isDropdownOpen: boolean
  onDropdownToggle: () => void
  onDropdownClose: () => void
  isDragOver?: boolean
  isDragging?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  const date = new Date(folder.created_at.replace(' ', 'T').replace('+00:00', 'Z')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative w-52 border rounded-xl transition-all select-none flex items-center justify-between px-3 py-2.5 ${
        isDragging
          ? 'opacity-40 border-slate-700 bg-slate-900/60'
          : isDragOver
          ? 'border-indigo-400 bg-indigo-500/10 shadow-md shadow-indigo-900/30'
          : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 hover:border-yellow-500/30'
      }`}
    >

      {/* ── ZONE 1: Navigation trigger ──────────────────────────────────────
          draggable={false} prevents the button from being dragged separately
          from the card, keeping the drag handle on the outer div only.      */}
      <button
        type="button"
        draggable={false}
        onClick={onOpen}
        className="flex items-center gap-3 min-w-0 flex-1 text-left pr-2"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isDragOver ? 'bg-indigo-500/20' : 'bg-yellow-500/10'}`}>
          <IcoFolder className={`w-4 h-4 ${isDragOver ? 'text-indigo-400' : 'text-yellow-400'}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate group-hover:text-yellow-300 transition-colors">
            {folder.name}
          </p>
          <p className="text-xs text-slate-500">{date}</p>
        </div>
      </button>

      {/* ── ZONE 2: Isolated three-dot dropdown ─────────────────────────────
          This div is completely independent from Zone 1. The trigger button
          stops propagation so Zone 1's onClick never fires when clicking here.

          When open, a transparent fixed backdrop sits at z-40 and covers
          the full viewport. Clicking it (anywhere outside the menu) closes
          the dropdown. The menu panel renders at z-50 (above the backdrop)
          using absolute positioning — no coordinate math required.           */}
      <div className="relative shrink-0">

        {/* Trigger */}
        <button
          type="button"
          aria-label="Folder options"
          aria-expanded={isDropdownOpen}
          draggable={false}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[FolderCard] three-dot clicked for folder_id:', folder.folder_id)
            onDropdownToggle()
          }}
        >
          <IcoMoreVertical className="w-4 h-4" />
        </button>

        {isDropdownOpen && (
          <>
            {/* Full-viewport transparent backdrop — catches every outside click */}
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDropdownClose()
              }}
            />

            {/* Menu panel — pops upward to avoid bottom-boundary clipping */}
            <div className="absolute right-0 bottom-full mb-1 w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-[100] overflow-hidden">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDropdownClose(); onOpen() }}
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                <IcoFolder className="w-3.5 h-3.5" /> Open
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDropdownClose(); onRename() }}
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                <IcoPencil className="w-3.5 h-3.5" /> Rename
              </button>
              <div className="border-t border-slate-700/60" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDropdownClose(); onDelete() }}
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              >
                <IcoTrash className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </>
        )}

      </div>
      {/* ── end outer card ── */}
    </div>
  )
}

// ─── Table helpers ────────────────────────────────────────────────────────────

const PIPELINE_STAGES = ['PENDING','STARTED','EXTRACTED_AUDIO','CLONED_AUDIO','DUBBING_COMPLETED','APPENDING_TO_VIDEO','RENDERING_IN_PROGRESS','COMPLETED'] as const
const PIPELINE_STEP_LABELS = ['Pending','Started','Extracted','Cloned','Dubbed','Merging','Rendering','Done']

function TblSortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: 'asc' | 'desc' }) {
  if (sortField !== field) return (
    <svg className="w-3 h-3 opacity-25 group-hover:opacity-60 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
    </svg>
  )
  return (
    <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      {sortDir === 'asc'
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
    </svg>
  )
}

function SceneStatusCell({ status, progress }: { status: string; progress: number }) {
  if (status === 'COMPLETED') return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" /> Completed
    </span>
  )
  if (status === 'FAILED') return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-950/60 border border-red-800/40 text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /> Failed
    </span>
  )
  if (status === 'PENDING') return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-slate-400">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 flex-shrink-0" /> Queued
    </span>
  )
  // in-progress
  const idx = PIPELINE_STAGES.indexOf(status as any)
  const label = PIPELINE_STEP_LABELS[idx] ?? status
  return (
    <div className="space-y-1.5" style={{ minWidth: 160 }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-amber-400 animate-pulse">{label}…</span>
        <span className="text-[10px] text-slate-500 tabular-nums">{progress}%</span>
      </div>
      <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#6366f1,#f59e0b)' }} />
      </div>
    </div>
  )
}

function fmtCreated(iso: string | null) {
  if (!iso) return { date: '—', time: '', rel: '' }
  const n = iso.replace(' ', 'T').replace('+00:00', 'Z')
  const d = new Date(n)
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  const rel = m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    rel,
  }
}

const SCENE_THUMB_GRADIENTS = ['from-indigo-500 to-indigo-700','from-purple-500 to-purple-700','from-emerald-500 to-emerald-700','from-amber-500 to-amber-700','from-rose-500 to-rose-700','from-cyan-500 to-cyan-700']

function SceneThumb({ src, initial, gradient, onClick }: {
  src: string | null; initial: string; gradient: string; onClick?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const cls = `relative w-[140px] h-[79px] rounded-xl overflow-hidden shadow-lg flex-shrink-0 ${onClick ? 'cursor-pointer group' : ''}`
  return (
    <div className={cls} onClick={onClick}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          <span className="text-xl font-black text-white/80">{initial}</span>
        </div>
      )}
      {onClick && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <IcoPlay className="w-5 h-5 text-white drop-shadow" />
        </div>
      )}
    </div>
  )
}

// ─── Version history sub-rows ─────────────────────────────────────────────────

function RestoreButton({ jobId, h, onRestored }: {
  jobId: string
  h: SceneHistoryItem
  onRestored: (updated: SceneItem) => void
}) {
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)

  const restore = async () => {
    setLoading(true)
    try {
      const res = await api.post<SceneItem>(`/api/scenes/${jobId}/reprocess`, {
        target_voice_lang:    h.target_voice_lang,
        target_subtitle_lang: h.target_subtitle_lang,
        source_language:      h.source_language ?? 'auto',
      })
      onRestored(res.data)
      setDone(true)
    } catch {
      // silently ignore — user can retry
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <span className="text-[10px] text-emerald-400 font-medium">Queued ✓</span>
  )

  return (
    <button
      onClick={restore}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/30 border border-amber-800/40 hover:bg-amber-600 hover:text-white hover:border-amber-600 rounded-md px-2 py-1 transition-all disabled:opacity-50"
      title="Re-process scene with these language settings"
    >
      {loading ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <IcoRefresh className="w-3 h-3" />
      )}
      Restore
    </button>
  )
}

function HistoryRows({ scene, entries, token, onRestored, onEdit, onPreview }: {
  scene: SceneItem
  entries: SceneHistoryItem[] | null | undefined
  token: string
  onRestored: (updated: SceneItem) => void
  onEdit: (overrideScene: SceneItem) => void
  onPreview: (url: string) => void
}) {
  if (entries === null || entries === undefined) return (
    <tr className="bg-slate-900/40">
      <td colSpan={8} className="px-10 py-2.5">
        <p className="text-xs text-slate-600">Loading history…</p>
      </td>
    </tr>
  )
  if (entries.length === 0) return (
    <tr className="bg-slate-900/40">
      <td colSpan={8} className="px-10 py-2.5">
        <p className="text-xs text-slate-600 italic">No previous versions yet.</p>
      </td>
    </tr>
  )
  // entries newest-first from API; reverse so v1 = oldest
  return (
    <>
      {entries.slice().reverse().map((h, hi) => {
        const vLabel = scene.scene_name ? `${scene.scene_name} — v${hi + 1}` : `v${hi + 1}`
        const d      = fmtCreated(h.created_at)
        const voice  = LANG_LABEL[h.target_voice_lang] ?? h.target_voice_lang.toUpperCase()
        const sub    = h.target_subtitle_lang ? (LANG_LABEL[h.target_subtitle_lang] ?? h.target_subtitle_lang.toUpperCase()) : null
        const src    = h.source_language && h.source_language !== 'auto' ? (LANG_LABEL[h.source_language] ?? h.source_language) : null

        // Build a scene override with historical language settings — used by Edit & Restore
        const histScene: SceneItem = {
          ...scene,
          target_voice_lang:    h.target_voice_lang,
          target_subtitle_lang: h.target_subtitle_lang,
          source_language:      h.source_language,
        }

        const base          = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
        const histThumb     = h.thumbnail_path ? `${base}${h.thumbnail_path}` : null
        const histFilename  = h.output_video_path?.replace(/\\/g, '/').split('/').pop() ?? ''
        const hasOldVideo   = !!h.output_video_path && !!histFilename

        return (
          <tr key={h.id} className="bg-slate-900/50 border-b border-slate-800/30 last:border-0">
            <td className="pl-10 pr-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-px h-5 bg-slate-700 rounded-full flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-400">{vLabel}</p>
                  <p className="text-[10px] text-slate-600 font-mono">{h.id.slice(0, 8)}…</p>
                </div>
              </div>
            </td>
            <td className="px-4 py-2.5 hidden md:table-cell">
              {src
                ? <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-400">{src}</span>
                : <span className="italic text-slate-600 text-xs">Auto</span>}
            </td>
            <td className="px-4 py-2.5 hidden sm:table-cell">
              <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900/40 text-indigo-400">{voice}</span>
            </td>
            <td className="px-4 py-2.5 hidden sm:table-cell">
              {sub
                ? <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-950/40 border border-purple-900/40 text-purple-400">{sub}</span>
                : <span className="text-slate-700 text-xs">—</span>}
            </td>
            <td className="px-4 py-2.5">
              <span className="text-[10px] text-slate-600 italic">Previous</span>
            </td>
            <td className="px-4 py-2.5 hidden md:table-cell">
              <p className="text-xs text-slate-500 tabular-nums">{d.date}</p>
              <p className="text-[10px] text-slate-600 tabular-nums">{d.rel}</p>
            </td>
            {/* Preview thumbnail — real if file exists */}
            <td className="px-4 py-2.5 hidden lg:table-cell">
              <SceneThumb
                src={histThumb}
                initial={vLabel.charAt(0).toUpperCase()}
                gradient={SCENE_THUMB_GRADIENTS[hi % SCENE_THUMB_GRADIENTS.length]}
                onClick={hasOldVideo ? () => onPreview(`${base}/downloads/${histFilename}?token=${token}`) : undefined}
              />
            </td>
            {/* Actions */}
            <td className="px-6 py-2.5">
              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                {/* Play old version */}
                {hasOldVideo && (
                  <button
                    onClick={() => onPreview(`${base}/downloads/${histFilename}?token=${token}`)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-indigo-600/80 hover:bg-indigo-600 border border-indigo-500/50 rounded-md px-2 py-1 transition-all"
                  >
                    <IcoPlay className="w-3 h-3" /> Play
                  </button>
                )}
                {/* Download old version */}
                {hasOldVideo && (
                  <a
                    href={`${base}/downloads/${histFilename}?token=${encodeURIComponent(token)}`}
                    download
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 rounded-md px-2 py-1 transition-all"
                  >
                    <IcoDownload className="w-3 h-3" /> Download
                  </a>
                )}
                {/* Edit */}
                <button
                  onClick={() => onEdit(histScene)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-400 bg-indigo-950/40 border border-indigo-800/40 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-md px-2 py-1 transition-all"
                >
                  <IcoRefresh className="w-3 h-3" /> Edit
                </button>
                {/* Restore */}
                <RestoreButton jobId={scene.job_id} h={h} onRestored={onRestored} />
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ─── Main Explorer Page ───────────────────────────────────────────────────────

export default function ExplorerPage() {
  const params       = useParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const projectId    = params.projectId as string

  const [navHistory,  setNavHistory]  = useState<NavCrumb[]>([{ id: null, name: 'Project Root' }])
  const [contents,    setContents]    = useState<ExplorerContents | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [modal,                   setModal]                   = useState<ModalState>({ type: 'none' })
  const [token,                   setToken]                   = useState('')
  const [selectedScene,           setSelectedScene]           = useState<SceneItem | null>(null)
  const [historyPreviewUrl,       setHistoryPreviewUrl]       = useState<string | null>(null)
  // Tracks which subfolder's three-dot dropdown is currently open.
  // Keeping this in the page (not inside each FolderCard) ensures mutual
  // exclusivity across all folders at every nesting depth, and gives us a
  // single place to close all menus (e.g. on navigation or modal open).
  const [openSubfolderDropdownId, setOpenSubfolderDropdownId] = useState<string | null>(null)
  const [dragItem,      setDragItem]      = useState<DragItem | null>(null)
  const [dragOverId,    setDragOverId]    = useState<string | null>(null)
  const dragItemRef = useRef<DragItem | null>(null)

  // ── Scene version history (expand per row) ──────────────────────────────────
  const [historyMap,     setHistoryMap]     = useState<Record<string, SceneHistoryItem[] | null>>({})
  const [expandedIds,    setExpandedIds]    = useState<Set<string>>(new Set())

  const toggleHistory = useCallback(async (jobId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) { next.delete(jobId); return next }
      next.add(jobId); return next
    })
    if (historyMap[jobId] !== undefined) return // already loaded
    setHistoryMap(prev => ({ ...prev, [jobId]: null })) // null = loading
    try {
      const res = await api.get<SceneHistoryItem[]>(`/api/scenes/${jobId}/history`)
      setHistoryMap(prev => ({ ...prev, [jobId]: res.data }))
    } catch {
      setHistoryMap(prev => ({ ...prev, [jobId]: [] }))
    }
  }, [historyMap])

  // ── Scene search / filter / sort ─────────────────────────────────────────────
  const [sceneSearch,    setSceneSearch]    = useState('')
  const [sceneStatus,    setSceneStatus]    = useState('all')
  const [sceneDate,      setSceneDate]      = useState('all')
  const [sceneSortField, setSceneSortField] = useState('created_at')
  const [sceneSortDir,   setSceneSortDir]   = useState<'asc' | 'desc'>('desc')

  // ── URL-driven folder context ────────────────────────────────────────────────
  // currentFolderId comes from the URL so a hard refresh restores the exact
  // directory. navHistory stays as a local display artifact for the breadcrumb;
  // normal navigation keeps it in sync, and the mount effect below handles the
  // hard-refresh case where the URL has a folderId but history only has root.
  const currentFolderId = searchParams.get('folderId') ?? null

  useEffect(() => {
    const urlFolderId = searchParams.get('folderId') ?? null
    if (!urlFolderId) return  // at project root — navHistory is already correct
    const lastId = navHistory[navHistory.length - 1].id
    if (lastId === urlFolderId) return  // synced from in-session navigation
    // Hard-refresh scenario: URL points inside a folder but history was reset.
    // Show a minimal crumb with a placeholder name; it fills in as the user
    // navigates normally (the folder name appears in the contents response).
    setNavHistory([{ id: null, name: 'Project Root' }, { id: urlFolderId, name: '…' }])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount-only — normal navigation keeps navHistory in sync via enterFolder

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
  // Both functions update the URL (persists across hard refreshes) AND
  // navHistory (drives the breadcrumb display without a round-trip).

  const enterFolder = useCallback((f: FolderItem) => {
    const urlParams = new URLSearchParams(searchParams.toString())
    urlParams.set('folderId', f.folder_id)
    router.push(`${pathname}?${urlParams.toString()}`)
    setNavHistory(prev => [...prev, { id: f.folder_id, name: f.name }])
  }, [pathname, router, searchParams])

  const navigateToCrumb = useCallback((index: number) => {
    const crumb = navHistory[index]
    const urlParams = new URLSearchParams(searchParams.toString())
    if (crumb.id) {
      urlParams.set('folderId', crumb.id)
    } else {
      urlParams.delete('folderId')
    }
    router.push(`${pathname}?${urlParams.toString()}`)
    setNavHistory(prev => prev.slice(0, index + 1))
  }, [navHistory, pathname, router, searchParams])

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
    await api.post(`/api/trash/folders/${folder.folder_id}`)
    setContents(prev => prev ? { ...prev, folders: prev.folders.filter(f => f.folder_id !== folder.folder_id) } : prev)
    closeModal()
    toast.success(`"${folder.name}" moved to Trash. Restore it within 15 days.`)
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
    await api.post(`/api/trash/scenes/${scene.job_id}`)
    setContents(prev => prev ? { ...prev, scenes: prev.scenes.filter(s => s.job_id !== scene.job_id) } : prev)
    closeModal()
    toast.success(`"${scene.scene_name ?? 'Scene'}" moved to Trash. Restore it within 15 days.`)
  }, [closeModal])

  const handleSceneReprocessed = useCallback((updated: SceneItem) => {
    setContents(prev => prev ? { ...prev, scenes: prev.scenes.map(s => s.job_id === updated.job_id ? updated : s) } : prev)
  }, [])

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback(async (targetFolderId: string | null) => {
    // Always read from ref — state may be stale when drop fires
    const item = dragItemRef.current
    if (!item) return
    dragItemRef.current = null
    setDragItem(null)
    setDragOverId(null)

    // Skip no-op drops
    if (item.type === 'folder' && item.folderId === targetFolderId) return
    if (targetFolderId === currentFolderId) return

    try {
      if (item.type === 'folder') {
        await api.patch(`/api/folders/${item.folderId}/move`, { target_folder_id: targetFolderId })
        setContents(prev => prev ? { ...prev, folders: prev.folders.filter(f => f.folder_id !== item.folderId) } : prev)
      } else {
        await api.patch(`/api/scenes/${item.sceneId}/move`, { target_folder_id: targetFolderId })
        setContents(prev => prev ? { ...prev, scenes: prev.scenes.filter(s => s.job_id !== item.sceneId) } : prev)
      }
    } catch {
      // silently ignore — item stays in current view
    }
  }, [currentFolderId])

  // ── Scene filter / sort helpers ──────────────────────────────────────────────
  const handleSceneSort = (field: string) => {
    if (sceneSortField === field) setSceneSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSceneSortField(field); setSceneSortDir('desc') }
  }

  const filteredScenes = useMemo(() => {
    if (!contents) return []
    let list = [...contents.scenes]
    if (sceneSearch.trim()) {
      const q = sceneSearch.toLowerCase()
      list = list.filter(s =>
        (s.scene_name ?? '').toLowerCase().includes(q) ||
        (LANG_LABEL[s.target_voice_lang] ?? s.target_voice_lang).toLowerCase().includes(q) ||
        s.target_voice_lang.toLowerCase().includes(q)
      )
    }
    if (sceneStatus !== 'all') {
      list = list.filter(s => s.status === sceneStatus)
    }
    if (sceneDate !== 'all') {
      const ms = sceneDate === 'today' ? 86_400_000 : sceneDate === 'last7' ? 7 * 86_400_000 : 30 * 86_400_000
      list = list.filter(s => s.created_at && Date.now() - new Date(s.created_at.replace(' ', 'T')).getTime() <= ms)
    }
    list.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (sceneSortField === 'name')    { av = (a.scene_name ?? '').toLowerCase(); bv = (b.scene_name ?? '').toLowerCase() }
      else if (sceneSortField === 'status') { av = a.status; bv = b.status }
      else if (sceneSortField === 'lang')   { av = a.target_voice_lang; bv = b.target_voice_lang }
      else { av = a.created_at ? new Date(a.created_at.replace(' ', 'T')).getTime() : 0; bv = b.created_at ? new Date(b.created_at.replace(' ', 'T')).getTime() : 0 }
      if (av < bv) return sceneSortDir === 'asc' ? -1 : 1
      if (av > bv) return sceneSortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [contents, sceneSearch, sceneStatus, sceneDate, sceneSortField, sceneSortDir])

  const hasSceneFilters = sceneSearch.trim() !== '' || sceneStatus !== 'all' || sceneDate !== 'all'

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
          <div className="space-y-6">

            {/* ── Root drop zone — shown while dragging ─────────────────────── */}
            {dragItem && currentFolderId !== null && (
              <div
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId('root') }}
                onDragLeave={e => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null) }}
                onDrop={e => { e.preventDefault(); handleDrop(null) }}
                className={`flex items-center justify-center gap-2 py-3 border-2 border-dashed rounded-xl transition-colors ${
                  dragOverId === 'root'
                    ? 'border-indigo-400 bg-indigo-500/10 text-indigo-300'
                    : 'border-slate-700 text-slate-500'
                }`}
              >
                <IcoArrowLeft className="w-3.5 h-3.5 rotate-90" />
                <span className="text-xs font-medium">Drop here to move to project root</span>
              </div>
            )}

            {/* ── Folders section ───────────────────────────────────────────── */}
            {contents!.folders.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Folders
                </p>
                <div className="flex flex-wrap gap-2">
                  {contents!.folders.map(f => (
                    <FolderCard
                      key={f.folder_id}
                      folder={f}
                      isDropdownOpen={openSubfolderDropdownId === f.folder_id}
                      onDropdownToggle={() =>
                        setOpenSubfolderDropdownId(prev =>
                          prev === f.folder_id ? null : f.folder_id
                        )
                      }
                      onDropdownClose={() => setOpenSubfolderDropdownId(null)}
                      onOpen={() => { setOpenSubfolderDropdownId(null); enterFolder(f) }}
                      onRename={() => { setOpenSubfolderDropdownId(null); setModal({ type: 'rename_folder', folder: f }) }}
                      onDelete={() => { setOpenSubfolderDropdownId(null); setModal({ type: 'delete_folder', folder: f }) }}
                      isDragOver={dragOverId === f.folder_id && !(dragItem?.type === 'folder' && dragItem.folderId === f.folder_id)}
                      isDragging={dragItem?.type === 'folder' && dragItem.folderId === f.folder_id}
                      onDragStart={e => {
                        const item: DragItem = { type: 'folder', folderId: f.folder_id }
                        dragItemRef.current = item
                        setDragItem(item)
                        setOpenSubfolderDropdownId(null)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', f.folder_id)
                      }}
                      onDragEnd={() => { dragItemRef.current = null; setDragItem(null); setDragOverId(null) }}
                      onDragOver={e => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragItemRef.current?.type === 'folder' && dragItemRef.current.folderId === f.folder_id) return
                        setDragOverId(f.folder_id)
                      }}
                      onDragLeave={e => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null) }}
                      onDrop={e => { e.preventDefault(); handleDrop(f.folder_id) }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Scenes section ────────────────────────────────────────────── */}
            {contents!.scenes.length > 0 && (
              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden">

                {/* ── Section header + search / filter bar ─────────────────── */}
                <div className="px-6 py-4 border-b border-slate-800/60 flex flex-wrap gap-2.5 items-center">

                  {/* Search */}
                  <div className="relative flex-1 min-w-[180px]">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                    </svg>
                    <input
                      type="text"
                      value={sceneSearch}
                      onChange={e => setSceneSearch(e.target.value)}
                      placeholder="Search by scene name or language…"
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-all"
                    />
                    {sceneSearch && (
                      <button onClick={() => setSceneSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>

                  {/* Status filter */}
                  <div className="relative">
                    <select value={sceneStatus} onChange={e => setSceneStatus(e.target.value)}
                      className="bg-slate-900 border border-slate-700/80 rounded-lg pl-3 pr-7 py-2 text-xs text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500/40 cursor-pointer">
                      <option value="all">All Status</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="PENDING">Queued</option>
                      <option value="FAILED">Failed</option>
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  {/* Date filter */}
                  <div className="relative">
                    <select value={sceneDate} onChange={e => setSceneDate(e.target.value)}
                      className="bg-slate-900 border border-slate-700/80 rounded-lg pl-3 pr-7 py-2 text-xs text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500/40 cursor-pointer">
                      <option value="all">All Time</option>
                      <option value="today">Today</option>
                      <option value="last7">Last 7 Days</option>
                      <option value="last30">Last 30 Days</option>
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  {/* Clear */}
                  {hasSceneFilters && (
                    <button onClick={() => { setSceneSearch(''); setSceneStatus('all'); setSceneDate('all') }}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors whitespace-nowrap">
                      Clear filters
                    </button>
                  )}

                  {/* Count */}
                  <span className="text-xs text-slate-600 ml-auto whitespace-nowrap tabular-nums">
                    {filteredScenes.length} / {contents!.scenes.length} scenes
                  </span>
                </div>

                {/* ── Table or empty message ────────────────────────────────── */}
                {filteredScenes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-8">
                    <p className="text-sm font-medium text-slate-500">No scenes match your filters.</p>
                    <button onClick={() => { setSceneSearch(''); setSceneStatus('all'); setSceneDate('all') }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Clear filters</button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-800/60">
                          {/* Scene Name */}
                          <th className="text-left px-6 py-3.5">
                            <button onClick={() => handleSceneSort('name')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                              Scene Name <TblSortIcon field="name" sortField={sceneSortField} sortDir={sceneSortDir} />
                            </button>
                          </th>
                          {/* Original */}
                          <th className="text-left px-4 py-3.5 hidden md:table-cell">
                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Original</span>
                          </th>
                          {/* Dubbed */}
                          <th className="text-left px-4 py-3.5 hidden sm:table-cell">
                            <button onClick={() => handleSceneSort('lang')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                              Dubbed <TblSortIcon field="lang" sortField={sceneSortField} sortDir={sceneSortDir} />
                            </button>
                          </th>
                          {/* Subtitles */}
                          <th className="text-left px-4 py-3.5 hidden sm:table-cell">
                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Subtitles</span>
                          </th>
                          {/* Status */}
                          <th className="text-left px-4 py-3.5">
                            <button onClick={() => handleSceneSort('status')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                              Status <TblSortIcon field="status" sortField={sceneSortField} sortDir={sceneSortDir} />
                            </button>
                          </th>
                          {/* Created */}
                          <th className="text-left px-4 py-3.5 hidden md:table-cell">
                            <button onClick={() => handleSceneSort('created_at')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                              Created <TblSortIcon field="created_at" sortField={sceneSortField} sortDir={sceneSortDir} />
                            </button>
                          </th>
                          {/* Preview */}
                          <th className="text-left px-4 py-3.5 hidden lg:table-cell">
                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Preview</span>
                          </th>
                          {/* Actions */}
                          <th className="text-right px-6 py-3.5 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScenes.map((s, idx) => {
                          const base        = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
                          const thumbSrc    = s.thumbnail_url ? `${base}${s.thumbnail_url}` : null
                          const isCompleted = s.status === 'COMPLETED' && !!s.output_video_path
                          const filename    = s.output_video_path?.replace(/\\/g, '/').split('/').pop() ?? ''
                          const downloadUrl = `${base}/downloads/${filename}?token=${encodeURIComponent(token)}`
                          const gradient    = SCENE_THUMB_GRADIENTS[idx % SCENE_THUMB_GRADIENTS.length]
                          const initial     = (s.scene_name || 'S').charAt(0).toUpperCase()
                          const voiceLabel  = LANG_LABEL[s.target_voice_lang] ?? s.target_voice_lang.toUpperCase()
                          const subLabel    = s.target_subtitle_lang ? (LANG_LABEL[s.target_subtitle_lang] ?? s.target_subtitle_lang.toUpperCase()) : null
                          const srcLabel    = s.source_language && s.source_language !== 'auto' ? (LANG_LABEL[s.source_language] ?? s.source_language.toUpperCase()) : null
                          const created     = fmtCreated(s.created_at)

                          return (
                            <React.Fragment key={s.job_id}>
                            <tr
                              className="border-b border-slate-800/40 last:border-b-0 hover:bg-slate-900/60 transition-colors">

                              {/* Scene name */}
                              <td className="px-6 py-4 max-w-[200px]">
                                <p className="text-sm font-medium text-slate-200 truncate">
                                  {s.scene_name ?? <span className="italic text-slate-500">Untitled</span>}
                                </p>
                                <p className="text-[10px] text-slate-600 mt-0.5 font-mono">{s.job_id.slice(0, 8)}…</p>
                              </td>

                              {/* Original */}
                              <td className="px-4 py-4 hidden md:table-cell">
                                {srcLabel ? (
                                  <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-300">{srcLabel}</span>
                                ) : (
                                  <span className="italic text-slate-600 text-xs">Auto</span>
                                )}
                              </td>

                              {/* Dubbed */}
                              <td className="px-4 py-4 hidden sm:table-cell">
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-950/60 border border-indigo-900/50 text-indigo-300">
                                  {voiceLabel}
                                </span>
                              </td>

                              {/* Subtitles */}
                              <td className="px-4 py-4 hidden sm:table-cell">
                                {subLabel ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-900/50 text-purple-300">
                                    <svg className="w-3 h-3 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                    {subLabel}
                                  </span>
                                ) : <span className="text-slate-700 text-xs">—</span>}
                              </td>

                              {/* Status */}
                              <td className="px-4 py-4">
                                <SceneStatusCell status={s.status} progress={s.progress_percentage} />
                                {s.error_message && (
                                  <p className="text-[10px] text-red-400 mt-1 truncate max-w-[180px]" title={s.error_message}>{s.error_message}</p>
                                )}
                              </td>

                              {/* Created */}
                              <td className="px-4 py-4 hidden md:table-cell">
                                <p className="text-xs text-slate-300 tabular-nums">{created.date}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{created.time}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">{created.rel}</p>
                              </td>

                              {/* Preview thumbnail */}
                              <td className="px-4 py-3 hidden lg:table-cell">
                                <div
                                  className={`w-[140px] h-[79px] rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden relative group transition ${isCompleted ? 'cursor-pointer hover:border-slate-600' : ''}`}
                                  onClick={isCompleted ? () => setSelectedScene(s) : undefined}
                                >
                                  {thumbSrc ? (
                                    <>
                                      <img
                                        src={thumbSrc}
                                        alt={s.scene_name ?? 'Scene thumbnail'}
                                        draggable={false}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none'
                                          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
                                          if (fallback) fallback.style.display = 'flex'
                                        }}
                                      />
                                      {/* Fallback shown via JS if img fails to load */}
                                      <div className="hidden w-full h-full absolute inset-0 flex-col items-center justify-center bg-slate-950 text-[10px] text-slate-500 gap-1">
                                        <IcoVideo className="w-5 h-5 text-slate-700" />
                                        <span>No preview</span>
                                      </div>
                                      {isCompleted && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <IcoPlay className="w-5 h-5 text-white drop-shadow" />
                                        </div>
                                      )}
                                    </>
                                  ) : isCompleted ? (
                                    /* Completed but thumbnail not yet generated */
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-slate-950">
                                      <IcoVideo className="w-5 h-5 text-slate-700" />
                                      <span className="text-[10px] text-slate-600">No preview</span>
                                    </div>
                                  ) : (
                                    /* Still processing */
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 animate-pulse bg-slate-950">
                                      <svg className="w-4 h-4 animate-spin text-slate-600" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                      </svg>
                                      <span className="text-[10px] text-slate-600">Generating…</span>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Actions */}
                              <td className="px-6 py-4">
                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                  {/* Preview — opens QC Comparison Modal */}
                                  {isCompleted && (
                                    <button
                                      onClick={() => setSelectedScene(s)}
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-indigo-600/80 hover:bg-indigo-600 border border-indigo-500/50 rounded-lg px-2.5 py-1.5 transition-all"
                                      title="QC Comparison Preview">
                                      <IcoPlay className="w-3 h-3" /> Play
                                    </button>
                                  )}
                                  {/* Download */}
                                  {isCompleted && filename && (
                                    <a href={downloadUrl} download
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 rounded-lg px-2.5 py-1.5 transition-all">
                                      <IcoDownload className="w-3 h-3" /> Download
                                    </a>
                                  )}
                                  {/* Edit */}
                                  <button onClick={() => setModal({ type: 'edit_scene', scene: s })}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 bg-indigo-950/40 border border-indigo-800/40 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-lg px-2.5 py-1.5 transition-all"
                                    title="Edit languages & reprocess">
                                    <IcoRefresh className="w-3 h-3" /> Edit
                                  </button>
                                  {/* Rename */}
                                  <button onClick={() => setModal({ type: 'rename_scene', scene: s })}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700 hover:text-white transition-all"
                                    title="Rename">
                                    <IcoPencil className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Delete */}
                                  <button onClick={() => setModal({ type: 'delete_scene', scene: s })}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-400 bg-red-950/30 border border-red-800/40 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all"
                                    title="Delete">
                                    <IcoTrash className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Version history toggle */}
                                  <button onClick={() => toggleHistory(s.job_id)}
                                    className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1.5 border transition-all ${
                                      expandedIds.has(s.job_id)
                                        ? 'bg-slate-700 text-white border-slate-600'
                                        : 'text-slate-500 bg-slate-800/40 border-slate-700/40 hover:bg-slate-700 hover:text-white'
                                    }`}
                                    title="Show version history">
                                    <IcoClock className="w-3 h-3" />
                                    History
                                    <svg className={`w-3 h-3 transition-transform ${expandedIds.has(s.job_id) ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                </div>
                              </td>

                            </tr>

                            {/* ── Version history sub-rows ──────────────────── */}
                            {expandedIds.has(s.job_id) && (
                              <HistoryRows
                                scene={s}
                                entries={historyMap[s.job_id]}
                                token={token}
                                onRestored={handleSceneReprocessed}
                                onEdit={overrideScene => setModal({ type: 'edit_scene', scene: overrideScene })}
                                onPreview={url => setHistoryPreviewUrl(url)}
                              />
                            )}
                            </React.Fragment>
                          )
                        })}

                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

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
          title="Move Folder to Trash"
          description={
            <>
              Are you sure you want to move{' '}
              <span className="text-white font-medium">"{modal.folder.name}"</span>
              {' '}and all its nested scenes to the Trash? Items can be restored or will be automatically wiped permanently after 15 days.
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
          title="Move Scene to Trash"
          description={
            <>
              Are you sure you want to move{' '}
              <span className="text-white font-medium">
                "{modal.scene.scene_name ?? 'this scene'}"
              </span>
              {' '}to the Trash? Items can be restored or will be automatically wiped permanently after 15 days.
            </>
          }
          onClose={closeModal}
          onConfirm={() => handleDeleteScene(modal.scene)}
        />
      )}

      {modal.type === 'edit_scene' && (
        <EditSceneModal
          scene={modal.scene}
          onClose={closeModal}
          onReprocessed={handleSceneReprocessed}
        />
      )}

      {/* ── QC Comparison lightbox (main scene click) ────────────────────── */}
      {selectedScene && (
        <QCComparisonModal
          scene={selectedScene}
          token={token}
          onClose={() => setSelectedScene(null)}
        />
      )}

      {/* ── Single-video lightbox (version-history item playback) ─────────── */}
      {historyPreviewUrl && (
        <VideoPreviewModal url={historyPreviewUrl} onClose={() => setHistoryPreviewUrl(null)} />
      )}

    </div>
  )
}
