'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHARS_PER_MINUTE = 750

const PLATFORM_TIPS = [
  'Tip: Trimming raw clips under 60 s maximizes short-form viral potential.',
  'Insight: Multi-language subtitle tracks improve cross-border retention by up to 40%.',
  'Tip: Hindi and Spanish are the fastest-growing dubbing markets — great first targets.',
  'Insight: Dubbed content earns 2–3× more watch time than subtitle-only videos on average.',
  'Tip: Upload in 1080p for the sharpest output after AI voice re-sync.',
  'Insight: Creators who dub into 3+ languages see 70% broader organic reach within 90 days.',
  'Tip: Keep background music under 30% volume for the clearest vocal channel.',
  'Insight: Short-form vertical videos dubbed locally outperform horizontal formats in emerging markets.',
  'Tip: Batch-dubbing a series boosts channel authority signals across all localized versions simultaneously.',
]

const LANGUAGES = [
  { code: 'ar',  label: 'Arabic'      },
  { code: 'bg',  label: 'Bulgarian'   },
  { code: 'zh',  label: 'Chinese'     },
  { code: 'hr',  label: 'Croatian'    },
  { code: 'cs',  label: 'Czech'       },
  { code: 'da',  label: 'Danish'      },
  { code: 'nl',  label: 'Dutch'       },
  { code: 'en',  label: 'English'     },
  { code: 'fil', label: 'Filipino'    },
  { code: 'fi',  label: 'Finnish'     },
  { code: 'fr',  label: 'French'      },
  { code: 'de',  label: 'German'      },
  { code: 'el',  label: 'Greek'       },
  { code: 'hi',  label: 'Hindi'       },
  { code: 'hu',  label: 'Hungarian'   },
  { code: 'id',  label: 'Indonesian'  },
  { code: 'it',  label: 'Italian'     },
  { code: 'ja',  label: 'Japanese'    },
  { code: 'ko',  label: 'Korean'      },
  { code: 'ms',  label: 'Malay'       },
  { code: 'no',  label: 'Norwegian'   },
  { code: 'pl',  label: 'Polish'      },
  { code: 'pt',  label: 'Portuguese'  },
  { code: 'ro',  label: 'Romanian'    },
  { code: 'ru',  label: 'Russian'     },
  { code: 'sk',  label: 'Slovak'      },
  { code: 'es',  label: 'Spanish'     },
  { code: 'sv',  label: 'Swedish'     },
  { code: 'ta',  label: 'Tamil'       },
  { code: 'tr',  label: 'Turkish'     },
  { code: 'uk',  label: 'Ukrainian'   },
  { code: 'vi',  label: 'Vietnamese'  },
]

const LANG_LABEL: Record<string, string> = Object.fromEntries(LANGUAGES.map(l => [l.code, l.label]))

// Subtitle language options — exact codes accepted by deep-translator (GoogleTranslator)
const SUBTITLE_LANGUAGES = [
  { code: 'af',        label: 'Afrikaans' },
  { code: 'sq',        label: 'Albanian' },
  { code: 'am',        label: 'Amharic' },
  { code: 'ar',        label: 'Arabic' },
  { code: 'hy',        label: 'Armenian' },
  { code: 'as',        label: 'Assamese' },
  { code: 'ay',        label: 'Aymara' },
  { code: 'az',        label: 'Azerbaijani' },
  { code: 'bm',        label: 'Bambara' },
  { code: 'eu',        label: 'Basque' },
  { code: 'be',        label: 'Belarusian' },
  { code: 'bn',        label: 'Bengali' },
  { code: 'bho',       label: 'Bhojpuri' },
  { code: 'bs',        label: 'Bosnian' },
  { code: 'bg',        label: 'Bulgarian' },
  { code: 'ca',        label: 'Catalan' },
  { code: 'ceb',       label: 'Cebuano' },
  { code: 'ny',        label: 'Chichewa' },
  { code: 'zh-CN',     label: 'Chinese (Simplified)' },
  { code: 'zh-TW',     label: 'Chinese (Traditional)' },
  { code: 'co',        label: 'Corsican' },
  { code: 'hr',        label: 'Croatian' },
  { code: 'cs',        label: 'Czech' },
  { code: 'da',        label: 'Danish' },
  { code: 'dv',        label: 'Dhivehi' },
  { code: 'doi',       label: 'Dogri' },
  { code: 'nl',        label: 'Dutch' },
  { code: 'en',        label: 'English' },
  { code: 'eo',        label: 'Esperanto' },
  { code: 'et',        label: 'Estonian' },
  { code: 'ee',        label: 'Ewe' },
  { code: 'tl',        label: 'Filipino' },
  { code: 'fi',        label: 'Finnish' },
  { code: 'fr',        label: 'French' },
  { code: 'fy',        label: 'Frisian' },
  { code: 'gl',        label: 'Galician' },
  { code: 'ka',        label: 'Georgian' },
  { code: 'de',        label: 'German' },
  { code: 'el',        label: 'Greek' },
  { code: 'gn',        label: 'Guarani' },
  { code: 'gu',        label: 'Gujarati' },
  { code: 'ht',        label: 'Haitian Creole' },
  { code: 'ha',        label: 'Hausa' },
  { code: 'haw',       label: 'Hawaiian' },
  { code: 'iw',        label: 'Hebrew' },
  { code: 'hi',        label: 'Hindi' },
  { code: 'hmn',       label: 'Hmong' },
  { code: 'hu',        label: 'Hungarian' },
  { code: 'is',        label: 'Icelandic' },
  { code: 'ig',        label: 'Igbo' },
  { code: 'ilo',       label: 'Ilocano' },
  { code: 'id',        label: 'Indonesian' },
  { code: 'ga',        label: 'Irish' },
  { code: 'it',        label: 'Italian' },
  { code: 'ja',        label: 'Japanese' },
  { code: 'jw',        label: 'Javanese' },
  { code: 'kn',        label: 'Kannada' },
  { code: 'kk',        label: 'Kazakh' },
  { code: 'km',        label: 'Khmer' },
  { code: 'rw',        label: 'Kinyarwanda' },
  { code: 'gom',       label: 'Konkani' },
  { code: 'ko',        label: 'Korean' },
  { code: 'kri',       label: 'Krio' },
  { code: 'ku',        label: 'Kurdish (Kurmanji)' },
  { code: 'ckb',       label: 'Kurdish (Sorani)' },
  { code: 'ky',        label: 'Kyrgyz' },
  { code: 'lo',        label: 'Lao' },
  { code: 'la',        label: 'Latin' },
  { code: 'lv',        label: 'Latvian' },
  { code: 'ln',        label: 'Lingala' },
  { code: 'lt',        label: 'Lithuanian' },
  { code: 'lg',        label: 'Luganda' },
  { code: 'lb',        label: 'Luxembourgish' },
  { code: 'mk',        label: 'Macedonian' },
  { code: 'mai',       label: 'Maithili' },
  { code: 'mg',        label: 'Malagasy' },
  { code: 'ms',        label: 'Malay' },
  { code: 'ml',        label: 'Malayalam' },
  { code: 'mt',        label: 'Maltese' },
  { code: 'mi',        label: 'Maori' },
  { code: 'mr',        label: 'Marathi' },
  { code: 'mni-Mtei',  label: 'Meiteilon (Manipuri)' },
  { code: 'lus',       label: 'Mizo' },
  { code: 'mn',        label: 'Mongolian' },
  { code: 'my',        label: 'Myanmar' },
  { code: 'ne',        label: 'Nepali' },
  { code: 'no',        label: 'Norwegian' },
  { code: 'or',        label: 'Odia (Oriya)' },
  { code: 'om',        label: 'Oromo' },
  { code: 'ps',        label: 'Pashto' },
  { code: 'fa',        label: 'Persian' },
  { code: 'pl',        label: 'Polish' },
  { code: 'pt',        label: 'Portuguese' },
  { code: 'pa',        label: 'Punjabi' },
  { code: 'qu',        label: 'Quechua' },
  { code: 'ro',        label: 'Romanian' },
  { code: 'ru',        label: 'Russian' },
  { code: 'sm',        label: 'Samoan' },
  { code: 'sa',        label: 'Sanskrit' },
  { code: 'gd',        label: 'Scots Gaelic' },
  { code: 'nso',       label: 'Sepedi' },
  { code: 'sr',        label: 'Serbian' },
  { code: 'st',        label: 'Sesotho' },
  { code: 'sn',        label: 'Shona' },
  { code: 'sd',        label: 'Sindhi' },
  { code: 'si',        label: 'Sinhala' },
  { code: 'sk',        label: 'Slovak' },
  { code: 'sl',        label: 'Slovenian' },
  { code: 'so',        label: 'Somali' },
  { code: 'es',        label: 'Spanish' },
  { code: 'su',        label: 'Sundanese' },
  { code: 'sw',        label: 'Swahili' },
  { code: 'sv',        label: 'Swedish' },
  { code: 'tg',        label: 'Tajik' },
  { code: 'ta',        label: 'Tamil' },
  { code: 'tt',        label: 'Tatar' },
  { code: 'te',        label: 'Telugu' },
  { code: 'th',        label: 'Thai' },
  { code: 'ti',        label: 'Tigrinya' },
  { code: 'ts',        label: 'Tsonga' },
  { code: 'tr',        label: 'Turkish' },
  { code: 'tk',        label: 'Turkmen' },
  { code: 'ak',        label: 'Twi' },
  { code: 'uk',        label: 'Ukrainian' },
  { code: 'ur',        label: 'Urdu' },
  { code: 'ug',        label: 'Uyghur' },
  { code: 'uz',        label: 'Uzbek' },
  { code: 'vi',        label: 'Vietnamese' },
  { code: 'cy',        label: 'Welsh' },
  { code: 'xh',        label: 'Xhosa' },
  { code: 'yi',        label: 'Yiddish' },
  { code: 'yo',        label: 'Yoruba' },
  { code: 'zu',        label: 'Zulu' },
]
const SUBTITLE_LANG_LABEL: Record<string, string> = Object.fromEntries(SUBTITLE_LANGUAGES.map(l => [l.code, l.label]))

const PLAN_META: Record<string, {
  label:       string
  color:       string
  textClass:   string
  bgClass:     string
  borderClass: string
  ringColor:   string
}> = {
  free:    { label: 'Free',    color: '#64748b', textClass: 'text-slate-400',  bgClass: 'bg-slate-800/40',  borderClass: 'border-slate-700',     ringColor: 'rgba(100,116,139,0.25)' },
  starter: { label: 'Starter', color: '#6366f1', textClass: 'text-indigo-400', bgClass: 'bg-indigo-950/40', borderClass: 'border-indigo-600/50', ringColor: 'rgba(99,102,241,0.25)'  },
  creator: { label: 'Creator', color: '#a855f7', textClass: 'text-purple-400', bgClass: 'bg-purple-950/40', borderClass: 'border-purple-600/50', ringColor: 'rgba(168,85,247,0.25)'  },
  pro:     { label: 'Pro',     color: '#f59e0b', textClass: 'text-amber-400',  bgClass: 'bg-amber-950/30',  borderClass: 'border-amber-500/50',  ringColor: 'rgba(245,158,11,0.25)'  },
}

const THUMB_GRADIENTS = [
  'from-indigo-500 to-indigo-700',
  'from-purple-500 to-purple-700',
  'from-emerald-500 to-emerald-700',
  'from-amber-500 to-amber-700',
  'from-rose-500 to-rose-700',
  'from-cyan-500 to-cyan-700',
]

// ─── Render Milestones ────────────────────────────────────────────────────────

const MILESTONES = [
  { key: 'STARTED',               pct: 5,   label: 'Started',   desc: 'Initializing project…',                     eta: '~45s' },
  { key: 'EXTRACTED_AUDIO',       pct: 20,  label: 'Extracted', desc: 'Extracting original source audio…',         eta: '~35s' },
  { key: 'CLONED_AUDIO',          pct: 45,  label: 'Cloned',    desc: 'Cloning speech signatures via ElevenLabs…', eta: '~25s' },
  { key: 'DUBBING_COMPLETED',     pct: 65,  label: 'Dubbed',    desc: 'Audio localization complete…',              eta: '~15s' },
  { key: 'APPENDING_TO_VIDEO',    pct: 80,  label: 'Merging',   desc: 'Merging audio tracks & subtitles…',         eta: '~8s'  },
  { key: 'RENDERING_IN_PROGRESS', pct: 95,  label: 'Rendering', desc: 'Finalizing composition render pass…',       eta: '~3s'  },
  { key: 'COMPLETED',             pct: 100, label: 'Done',      desc: 'Render complete!',                          eta: '0s'   },
] as const

const IN_PROGRESS_STATUSES = new Set([
  'STARTED', 'EXTRACTED_AUDIO', 'CLONED_AUDIO',
  'DUBBING_COMPLETED', 'APPENDING_TO_VIDEO', 'RENDERING_IN_PROGRESS',
])

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadPhase = 'idle' | 'uploading' | 'queued' | 'error'

interface UserProfile {
  user_id: string
  email: string
  credit_minutes: number
  credit_limit_minutes: number
  subscription_plan: string
  phone_number: string | null
  profile_picture_url: string | null
}

interface ProjectHistoryItem {
  project_id: string
  title: string
  created_at: string | null             // project upload date
  latest_job_id: string | null
  latest_job_status: string | null
  latest_job_language: string | null
  latest_job_subtitle_language: string | null
  latest_job_source_language: string | null
  latest_job_scene_name: string | null
  latest_job_created_at: string | null  // when the latest job was queued
  latest_job_updated_at: string | null  // last status change
  output_video_path: string | null
  progress_percentage: number | null
}

interface UploadResponse {
  project_id: string
  title: string
  local_path: string
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayName(email: string): string {
  const local = email.split('@')[0]
  const cleaned = local
    .replace(/[._\-]/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return cleaned || local
}

function getGreeting(name: string): string {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const diffMs = Date.now() - d.getTime()
  const m = Math.floor(diffMs / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return `${days}d ago`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function deriveTitleFromFilename(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .trim() || 'Untitled Project'
}

// ─── Character Reservoir Ring ─────────────────────────────────────────────────

const RING_R = 50
const RING_C = 2 * Math.PI * RING_R

function CharReservoirRing({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  const offset  = RING_C * (1 - clamped / 100)
  const stroke  = clamped > 60 ? '#10b981' : clamped > 30 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative w-[116px] h-[116px] mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={RING_R} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle cx="60" cy="60" r={RING_R} fill="none"
          stroke={stroke} strokeWidth="14" strokeOpacity="0.10"
          strokeDasharray={RING_C} strokeDashoffset={0} />
        <circle cx="60" cy="60" r={RING_R} fill="none"
          stroke={stroke} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={RING_C} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-black tabular-nums leading-none" style={{ color: stroke }}>
          {Math.round(clamped)}%
        </span>
        <span className="text-[9px] text-slate-600 uppercase tracking-widest mt-1">remaining</span>
      </div>
    </div>
  )
}

// ─── API Status Beacon ────────────────────────────────────────────────────────

function ApiBeacon() {
  return (
    <div className="flex items-center gap-2 bg-slate-950 border border-slate-800/80 rounded-full px-3.5 py-1.5 w-fit">
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[11px] font-medium text-emerald-400 tracking-wide whitespace-nowrap">
        ElevenLabs Audio Cluster: Operational
      </span>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-700 text-xs">—</span>
  const cfg: Record<string, { wrap: string; dot: string; label: string }> = {
    COMPLETED:  { wrap: 'bg-emerald-950/60 border border-emerald-800/40 text-emerald-400', dot: 'bg-emerald-400',             label: 'Completed'  },
    PROCESSING: { wrap: 'bg-amber-950/60 border border-amber-800/40 text-amber-400',       dot: 'bg-amber-400 animate-pulse', label: 'Processing' },
    PENDING:    { wrap: 'bg-slate-800/80 border border-slate-700/60 text-slate-400',       dot: 'bg-slate-500',               label: 'Queued'     },
    FAILED:     { wrap: 'bg-red-950/60 border border-red-800/40 text-red-400',             dot: 'bg-red-500',                 label: 'Failed'     },
  }
  const c = cfg[status] ?? cfg.PENDING
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${c.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  )
}

// ─── Mini Stepper (in-progress table cell) ────────────────────────────────────

const STEPPER_STEPS = MILESTONES.slice(0, 6) // excludes terminal COMPLETED

function MiniStepper({ status, pct, desc, eta }: {
  status: string; pct: number; desc: string; eta: string
}) {
  const currentIdx = STEPPER_STEPS.findIndex(m => m.key === status)

  return (
    <div className="flex flex-col gap-1.5" style={{ minWidth: 190 }}>
      {/* Dot trail */}
      <div className="flex items-center">
        {STEPPER_STEPS.map((m, i) => (
          <div key={m.key} className={`flex items-center ${i < STEPPER_STEPS.length - 1 ? 'flex-1' : ''}`}>
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 transition-all duration-300 ${
                i < currentIdx   ? 'bg-indigo-500' :
                i === currentIdx ? 'bg-amber-400 animate-pulse' :
                'bg-slate-700'
              }`}
              style={i === currentIdx ? { boxShadow: '0 0 7px rgba(251,191,36,0.65)' } : undefined}
            />
            {i < STEPPER_STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-0.5 transition-colors ${i < currentIdx ? 'bg-indigo-500/50' : 'bg-slate-700/40'}`} />
            )}
          </div>
        ))}
      </div>
      {/* Progress bar + % + ETA */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #6366f1, #f59e0b)' }}
          />
        </div>
        <span className="text-[10px] font-black text-amber-400 tabular-nums whitespace-nowrap">{pct}%</span>
        {eta && <span className="text-[10px] text-slate-600 whitespace-nowrap">{eta}</span>}
      </div>
      {/* Current step description */}
      <p className="text-[10px] text-amber-400/80 truncate leading-tight">{desc}</p>
    </div>
  )
}

// ─── Sort Icon ────────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: 'asc' | 'desc' }) {
  if (sortField !== field) {
    return (
      <svg className="w-3 h-3 opacity-25 group-hover:opacity-60 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      {sortDir === 'asc'
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      }
    </svg>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router     = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [profile,        setProfile]        = useState<UserProfile | null>(null)
  const [projects,       setProjects]       = useState<ProjectHistoryItem[]>([])
  const [loading,        setLoading]        = useState(true)
  const [pageError,      setPageError]      = useState('')
  const [dragOver,       setDragOver]       = useState(false)
  const [selectedFile,   setSelectedFile]   = useState<File | null>(null)
  const [dropError,      setDropError]      = useState('')
  const [language,       setLanguage]       = useState('hi')
  const [titleInput,        setTitleInput]        = useState('')
  const [subtitleLanguage,  setSubtitleLanguage]  = useState('en')
  const [uploadPhase,       setUploadPhase]       = useState<UploadPhase>('idle')
  const [uploadProgress,    setUploadProgress]    = useState(0)
  const [uploadError,       setUploadError]       = useState('')
  const [refreshing,        setRefreshing]        = useState(false)
  const [deleteTarget,      setDeleteTarget]      = useState<{ project_id: string; title: string } | null>(null)
  const [deleting,          setDeleting]          = useState(false)
  const [searchQuery,       setSearchQuery]       = useState('')
  const [statusFilter,      setStatusFilter]      = useState('all')
  const [dateFilter,        setDateFilter]        = useState('all')
  const [sortField,         setSortField]         = useState('created_at')
  const [sortDir,           setSortDir]           = useState<'asc' | 'desc'>('desc')
  const [reworkTarget,      setReworkTarget]      = useState<{ project_id: string; title: string; scene_name?: string } | null>(null)
  const [reworkVoiceLang,   setReworkVoiceLang]   = useState('hi')
  const [reworkSubLang,     setReworkSubLang]     = useState('en')
  const [reworkSceneName,   setReworkSceneName]   = useState('')
  const [reworking,         setReworking]         = useState(false)
  const [reworkError,       setReworkError]       = useState('')

  const tip = useMemo(() => PLATFORM_TIPS[Math.floor(Math.random() * PLATFORM_TIPS.length)], [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { router.replace('/login'); return }
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [profileRes, projectsRes] = await Promise.allSettled([
        api.get<UserProfile>('/api/auth/me'),
        api.get<ProjectHistoryItem[]>('/api/videos/projects'),
      ])

      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value.data)
      } else {
        const reason = (profileRes as PromiseRejectedResult).reason
        if (axios.isAxiosError(reason) && reason.response?.status === 401) {
          localStorage.clear()
          router.replace('/login')
          return
        }
        setPageError('Failed to load workspace data.')
      }

      if (projectsRes.status === 'fulfilled') {
        setProjects(projectsRes.value.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const refreshProjects = async () => {
    setRefreshing(true)
    try {
      const { data } = await api.get<ProjectHistoryItem[]>('/api/videos/projects')
      setProjects(data)
    } catch { /* silent — empty state stays */ }
    finally { setRefreshing(false) }
  }

  // Auto-poll every 4 s while any job is in-progress or pending.
  // The effect re-runs whenever `projects` changes, which naturally restarts
  // the interval and keeps the closure over the latest data fresh.
  // Returns a cleanup that clears the interval before the next run.
  useEffect(() => {
    const hasActive = projects.some(
      p => IN_PROGRESS_STATUSES.has(p.latest_job_status ?? '') || p.latest_job_status === 'PENDING'
    )
    if (!hasActive) return

    const id = setInterval(async () => {
      try {
        const { data } = await api.get<ProjectHistoryItem[]>('/api/videos/projects')
        setProjects(data)
      } catch { /* silent */ }
    }, 4000)

    return () => clearInterval(id)
  }, [projects])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/videos/projects/${deleteTarget.project_id}`)
      setProjects(prev => prev.filter(p => p.project_id !== deleteTarget.project_id))
    } catch { /* silent — row stays if delete fails */ }
    finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const handleRework = async () => {
    if (!reworkTarget) return
    setReworking(true)
    setReworkError('')
    try {
      const res = await api.post<{ new_project_title?: string }>(
        `/api/videos/rework/${reworkTarget.project_id}`,
        {
          scene_name:               reworkSceneName.trim() || null,
          target_voice_language:    reworkVoiceLang,
          target_subtitle_language: reworkSubLang,
          source_language:          'auto',
        },
      )
      setReworkTarget(null)
      setReworkSceneName('')
      await refreshProjects()
      // Brief toast-like feedback via page error slot (green override not wired, so silent)
      void res.data.new_project_title  // consumed to avoid lint warning
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? (err.response?.data?.detail ?? 'Failed to queue job. Check your credits.')
        : 'Failed to queue job.'
      setReworkError(typeof detail === 'string' ? detail : JSON.stringify(detail))
    } finally {
      setReworking(false)
    }
  }

  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setDropError('Please select a valid video file (MP4, MOV, AVI).')
      return
    }
    setSelectedFile(file)
    setDropError('')
    setUploadPhase('idle')
    setUploadError('')
    setTitleInput(deriveTitleFromFilename(file.name))
  }

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedFile(null)
    setTitleInput('')
    setUploadPhase('idle')
    setUploadError('')
    setUploadProgress(0)
    setDropError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleLaunchStudio = async () => {
    if (!selectedFile || uploadPhase === 'uploading' || uploadPhase === 'queued') return

    setUploadPhase('uploading')
    setUploadProgress(0)
    setUploadError('')

    try {
      // Step 1 — upload the raw video file
      const form = new FormData()
      form.append('file', selectedFile)
      form.append('title', titleInput.trim() || selectedFile.name)

      const { data: uploadData } = await api.post<UploadResponse>(
        '/api/videos/upload',
        form,
        {
          onUploadProgress: (evt) => {
            if (evt.total) {
              setUploadProgress(Math.min(Math.round((evt.loaded / evt.total) * 88), 88))
            }
          },
        },
      )

      setUploadProgress(93)

      // Step 2 — queue the AI processing job
      await api.post(`/api/videos/process/${uploadData.project_id}`, {
        target_voice_language:    language,
        target_subtitle_language: subtitleLanguage,
      })

      setUploadProgress(100)
      setUploadPhase('queued')

      // Refresh the renders list so the new entry appears immediately
      await refreshProjects()

      // Auto-reset the drop zone after 4 s
      setTimeout(() => {
        setSelectedFile(null)
        setTitleInput('')
        setUploadPhase('idle')
        setUploadProgress(0)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }, 4000)

    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? (err.response?.data?.detail ?? 'Upload failed. Please try again.')
        : 'Upload failed. Please try again.'
      setUploadError(typeof detail === 'string' ? detail : JSON.stringify(detail))
      setUploadPhase('error')
    }
  }

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setDateFilter('all')
  }

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || dateFilter !== 'all'

  const filteredProjects = useMemo(() => {
    let result = [...projects]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(p =>
        (p.title ?? '').toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q) ||
        (p.latest_job_language ?? '').toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'all') {
      result = result.filter(p => p.latest_job_status === statusFilter)
    }

    if (dateFilter !== 'all') {
      const ms = dateFilter === 'today' ? 86_400_000 : dateFilter === 'last7' ? 7 * 86_400_000 : 30 * 86_400_000
      result = result.filter(p => p.created_at && Date.now() - new Date(p.created_at).getTime() <= ms)
    }

    result.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortField === 'title') {
        av = (a.title ?? '').toLowerCase()
        bv = (b.title ?? '').toLowerCase()
      } else if (sortField === 'status') {
        av = a.latest_job_status ?? ''
        bv = b.latest_job_status ?? ''
      } else if (sortField === 'language') {
        av = a.latest_job_language ?? ''
        bv = b.latest_job_language ?? ''
      } else {
        av = a.created_at ? new Date(a.created_at).getTime() : 0
        bv = b.created_at ? new Date(b.created_at).getTime() : 0
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [projects, searchQuery, statusFilter, dateFilter, sortField, sortDir])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="w-9 h-9 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
          <span className="text-slate-500 text-sm tracking-wide">Loading workspace…</span>
        </div>
      </div>
    )
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const plan        = (profile?.subscription_plan ?? 'free').toLowerCase()
  const isFree      = plan === 'free'
  const planMeta    = PLAN_META[plan] ?? PLAN_META.free
  const credits     = profile?.credit_minutes ?? 0
  const maxMin      = profile?.credit_limit_minutes ?? 2
  const totalChars  = maxMin * CHARS_PER_MINUTE
  const availChars  = credits * CHARS_PER_MINUTE
  const charPct     = totalChars > 0 ? (availChars / totalChars) * 100 : 0
  const displayName = profile ? getDisplayName(profile.email) : 'Creator'
  const greeting    = getGreeting(displayName)
  const isActive    = credits > 0
  const isUploading = uploadPhase === 'uploading'
  const canSubmit   = !!selectedFile && (isFree || credits > 0) && !isUploading && uploadPhase !== 'queued'
  const submitButtonLabel = uploadPhase === 'error'
    ? 'Retry upload'
    : isUploading
      ? 'Uploading video'
      : uploadPhase === 'queued'
        ? 'Job queued'
        : !selectedFile && credits > 0
          ? 'Click to Render Video'
          : credits <= 0 && !isFree
            ? 'Top up credits first'
            : 'Launch studio'

  return (
    <>
    {/* ── Delete confirmation modal ─────────────────────────────────────────── */}
    {deleteTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-7">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Delete Render?</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                <span className="text-slate-200 font-medium">"{deleteTarget.title}"</span> and all its
                render jobs will be permanently removed. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-900 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {deleting ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Deleting…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Rework modal ─────────────────────────────────────────────────────── */}
    {reworkTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-7">

          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white">Create New Version</h3>
              <p className="text-xs text-slate-400 mt-1">
                A new project will be created from{' '}
                <span className="text-slate-200 font-medium">"{reworkTarget.title}"</span>
                {' '}— the original is kept intact.
              </p>
            </div>
            <button
              onClick={() => { setReworkTarget(null); setReworkError(''); setReworkSceneName('') }}
              className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* New project name */}
          <div className="mb-4">
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
              New Project Name
              <span className="ml-2 normal-case font-normal text-slate-600">(leave blank to auto-version)</span>
            </label>
            <input
              type="text"
              value={reworkSceneName}
              onChange={e => setReworkSceneName(e.target.value)}
              maxLength={80}
              disabled={reworking}
              placeholder={`e.g. Climax Scene  (blank → "${reworkTarget.title} v2")`}
              className="w-full bg-slate-800 border border-slate-700/80 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-40"
            />
          </div>

          {/* Language selectors */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Voice Language
              </label>
              <div className="relative">
                <select
                  value={reworkVoiceLang}
                  onChange={e => setReworkVoiceLang(e.target.value)}
                  disabled={reworking}
                  className="w-full bg-slate-800 border border-slate-700/80 rounded-xl px-3 py-2.5 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-600/60 cursor-pointer transition-all disabled:opacity-40"
                >
                  {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Subtitle Language
              </label>
              <div className="relative">
                <select
                  value={reworkSubLang}
                  onChange={e => setReworkSubLang(e.target.value)}
                  disabled={reworking}
                  className="w-full bg-slate-800 border border-slate-700/80 rounded-xl px-3 py-2.5 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-600/60 cursor-pointer transition-all disabled:opacity-40"
                >
                  {SUBTITLE_LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Cost strip */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 mb-5 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Voice</p>
              <p className="text-xs font-bold text-indigo-300 mt-0.5">{LANG_LABEL[reworkVoiceLang] ?? reworkVoiceLang}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Subtitles</p>
              <p className="text-xs font-bold text-purple-300 mt-0.5">{SUBTITLE_LANG_LABEL[reworkSubLang] ?? reworkSubLang}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Cost</p>
              <p className="text-xs font-bold text-amber-300 mt-0.5">1 credit</p>
            </div>
          </div>

          {/* Error */}
          {reworkError && (
            <div className="bg-red-950/50 border border-red-800/40 text-red-400 text-xs rounded-xl px-4 py-2.5 mb-4 leading-relaxed">
              {reworkError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => { setReworkTarget(null); setReworkError('') }}
              disabled={reworking}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleRework}
              disabled={reworking}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', boxShadow: '0 4px 16px rgba(99,102,241,0.3)' }}
            >
              {reworking ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Queuing…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Queue New Job
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    )}

    <div className="px-6 py-7 space-y-5 min-h-full">

      {pageError && (
        <div className="bg-red-950/50 border border-red-800/40 text-red-400 text-sm rounded-xl px-5 py-3">
          {pageError}
        </div>
      )}

      {/* ── 1. Greeting Header Panel ─────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-2xl border border-slate-800/80 px-8 py-6"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0d1525 50%, #0f172a 100%)' }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="pointer-events-none absolute -top-20 -left-20 w-64 h-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 right-10 w-48 h-48 rounded-full bg-purple-600/8 blur-3xl" />

        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <h1 className="text-2xl font-black text-white tracking-tight leading-tight">{greeting}</h1>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full border ${
                  isActive
                    ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-400'
                    : 'bg-amber-950/70 border-amber-800/60 text-amber-400'
                }`}
                style={{ boxShadow: isActive ? '0 0 14px rgba(16,185,129,0.2)' : '0 0 14px rgba(245,158,11,0.2)' }}
              >
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {isActive ? 'Active Creator' : 'Ready to Refuel'}
              </span>
            </div>
            <div className="inline-flex items-start gap-2.5 bg-indigo-950/50 border border-indigo-900/50 rounded-xl px-4 py-2.5 max-w-2xl">
              <svg className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
              <p className="text-xs text-indigo-300/80 leading-relaxed">{tip}</p>
            </div>
          </div>
          <div className="flex-shrink-0 mt-1">
            <ApiBeacon />
          </div>
        </div>
      </div>

      {/* ── 2. Analytics Metric Grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* Card A — Character Reservoir */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Character Reservoir</p>
              <p className="text-sm text-slate-300 font-medium mt-0.5">Audio token budget</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          </div>
          <CharReservoirRing pct={charPct} />
          <div className="mt-5 pt-4 border-t border-slate-800/60 grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-base font-black text-white tabular-nums leading-tight">{availChars.toLocaleString()}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">chars available</p>
            </div>
            <div>
              <p className="text-base font-black text-slate-500 tabular-nums leading-tight">{totalChars.toLocaleString()}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">total chars</p>
            </div>
          </div>
        </div>

        {/* Card B — Processing Minutes */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Processing Time</p>
              <p className="text-sm text-slate-300 font-medium mt-0.5">Remaining video minutes</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M12 6v6l4 2" />
              </svg>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center py-2">
            <span className="text-[64px] font-black text-white tabular-nums leading-none">{credits}</span>
            <span className="text-slate-500 text-sm mt-2">of {maxMin} min remaining</span>
          </div>
          <div className="mt-4">
            <div className="flex gap-px mb-2">
              {Array.from({ length: 10 }).map((_, i) => {
                const threshold = ((i + 1) / 10) * maxMin
                const filled    = credits >= threshold
                return (
                  <div
                    key={i}
                    className="flex-1 h-2 rounded-sm transition-all duration-500"
                    style={{ backgroundColor: filled ? '#6366f1' : '#1e293b', transitionDelay: `${i * 40}ms` }}
                  />
                )
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>0</span>
              <span className="text-indigo-400 font-semibold tabular-nums">
                {maxMin > 0 ? Math.round((credits / maxMin) * 100) : 0}% left
              </span>
              <span>{maxMin}</span>
            </div>
          </div>
        </div>

        {/* Card C — Subscription Status */}
        <div
          className={`relative overflow-hidden rounded-2xl border p-6 flex flex-col ${planMeta.bgClass} ${planMeta.borderClass}`}
          style={{ boxShadow: `0 0 32px ${planMeta.ringColor}` }}
        >
          <div className="absolute inset-0 rounded-2xl border-2 animate-pulse pointer-events-none"
            style={{ borderColor: planMeta.color, opacity: 0.15 }} />
          <div className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl opacity-20"
            style={{ backgroundColor: planMeta.color }} />

          <div className="relative flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Subscription</p>
              <p className="text-sm text-slate-300 font-medium mt-0.5">Active plan</p>
            </div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${planMeta.color}18`, border: `1px solid ${planMeta.color}38` }}>
              <svg className="w-4 h-4" style={{ color: planMeta.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
          </div>

          <div className="relative flex-1 flex flex-col items-center justify-center py-2">
            <span className="text-[52px] font-black tracking-tight leading-none"
              style={{ color: planMeta.color, textShadow: `0 0 40px ${planMeta.ringColor}` }}>
              {planMeta.label}
            </span>
            <span className="text-[10px] text-slate-600 mt-2 uppercase tracking-widest">Monthly Plan</span>
          </div>

          <div className="relative mt-4 pt-4 border-t border-slate-800/50 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Allowance / cycle</span>
              <span className={`font-semibold ${planMeta.textClass}`}>{maxMin} min</span>
            </div>
            <Link
              href="/dashboard/billing"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                backgroundColor: `${planMeta.color}12`,
                border:           `1px solid ${planMeta.color}35`,
                color:             planMeta.color,
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              Manage Plans
            </Link>
          </div>
        </div>
      </div>

      {/* ── 3. Fast-Track Studio Zone ────────────────────────────────────────── */}
      <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden">
        <div className="px-7 py-5 border-b border-slate-800/60 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Fast-Track Studio</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drop a video, choose a language, and launch directly — no page change required
            </p>
          </div>
        </div>

        <div className="p-6 grid md:grid-cols-[1fr_280px] gap-5">

          {/* ── Drop Zone ───────────────────────────────────────────────────── */}
          <div
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => {
              if (!selectedFile && uploadPhase === 'idle') fileInputRef.current?.click()
            }}
            className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed min-h-[210px] px-8 py-10 transition-all duration-300 ${
              isUploading || uploadPhase === 'queued'
                ? 'border-slate-700/40 bg-slate-900/20 cursor-default'
                : dragOver
                  ? 'border-indigo-500 bg-indigo-950/40 scale-[1.01] cursor-copy'
                  : selectedFile && uploadPhase === 'error'
                    ? 'border-red-700/50 bg-red-950/10 cursor-default'
                    : selectedFile
                      ? 'border-emerald-600/50 bg-emerald-950/15 cursor-default'
                      : 'border-slate-700/50 bg-slate-900/30 hover:border-indigo-600/40 hover:bg-indigo-950/10 cursor-pointer'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/avi,video/*"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
            />

            {/* ── State: uploading ── */}
            {isUploading && (
              <div className="w-full flex flex-col items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center">
                  <svg className="w-7 h-7 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
                <div className="w-full max-w-xs text-center">
                  <p className="text-sm font-semibold text-indigo-300 truncate px-2">
                    {uploadProgress < 90 ? 'Uploading' : 'Queuing AI job…'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 truncate">{selectedFile?.name}</p>
                </div>
                {/* Progress bar */}
                <div className="w-full max-w-xs">
                  <p className="text-[10px] text-slate-500 mb-2">
                    {uploadProgress < 90 ? 'Uploading file…' : 'Almost done…'}
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${uploadProgress}%`,
                          background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
                          boxShadow: '0 0 8px rgba(99,102,241,0.5)',
                        }}
                      />
                    </div>
                    <span className="text-lg font-black text-indigo-400 tabular-nums w-12 text-right leading-none flex-shrink-0">
                      {uploadProgress}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── State: queued (success) ── */}
            {uploadPhase === 'queued' && !isUploading && (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-400">Job queued successfully!</p>
                  <p className="text-xs text-slate-500 mt-1">Track progress in Recent Renders below</p>
                </div>
              </div>
            )}

            {/* ── State: error ── */}
            {uploadPhase === 'error' && (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-800/40 flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-400">Upload failed</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[260px]">{uploadError}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setUploadPhase('idle'); setUploadError('') }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {/* ── State: file selected, idle ── */}
            {selectedFile && uploadPhase === 'idle' && !isUploading && (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center">
                  <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.882v6.236a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-400 max-w-[260px] truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleRemoveFile}
                    className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                  >
                    Remove
                  </button>
                  <span className="text-slate-700 text-xs">·</span>
                  <button
                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    Change file
                  </button>
                </div>
              </div>
            )}

            {/* ── State: no file (idle) ── */}
            {!selectedFile && uploadPhase === 'idle' && (
              <>
                <div className="relative">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                    dragOver ? 'bg-indigo-600/20 border border-indigo-500/40 scale-110' : 'bg-slate-800/80 border border-slate-700/60'
                  }`}>
                    <svg
                      className={`w-8 h-8 transition-all duration-300 ${dragOver ? 'text-indigo-300 -translate-y-0.5' : 'text-slate-500'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  {dragOver && (
                    <div className="absolute -inset-3 rounded-2xl border border-indigo-500/25 animate-ping pointer-events-none" />
                  )}
                </div>
                <div className="text-center">
                  <p className={`text-sm font-semibold transition-colors ${dragOver ? 'text-indigo-300' : 'text-slate-400'}`}>
                    {dragOver ? 'Release to add video' : 'Drag & drop your video here'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">MP4, MOV, AVI — or click to browse</p>
                </div>
              </>
            )}

            {dropError && (
              <p className="text-xs text-red-400 mt-1">{dropError}</p>
            )}
          </div>

          {/* ── Config Panel ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Project title */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Project Title
              </label>
              <input
                type="text"
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                placeholder="Auto-filled from filename…"
                maxLength={255}
                disabled={isUploading || uploadPhase === 'queued'}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-600/60 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              />
            </div>

            {/* Target language */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Target Language
              </label>
              <div className="relative">
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  disabled={isUploading || uploadPhase === 'queued'}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-600/60 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Burn Subtitles Language */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Burn Subtitles Language
              </label>
              <div className="relative">
                <select
                  value={subtitleLanguage}
                  onChange={e => setSubtitleLanguage(e.target.value)}
                  disabled={isUploading || uploadPhase === 'queued'}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-600/60 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {SUBTITLE_LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Cost preview */}
            <div className="bg-slate-900/80 border border-slate-800/60 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Credits required</span>
                <span className="text-white font-semibold">1 credit</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Balance after job</span>
                <span className={`font-semibold tabular-nums ${credits > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {Math.max(credits - 1, 0)} min
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Voice dubbed to</span>
                <span className="text-indigo-400 font-semibold">{LANG_LABEL[language] ?? language}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Subtitles in</span>
                <span className="font-semibold text-purple-400">
                  {SUBTITLE_LANG_LABEL[subtitleLanguage] ?? subtitleLanguage}
                </span>
              </div>
            </div>

            {/* Launch button */}
            <button
              type="button"
              onClick={handleLaunchStudio}
              disabled={isUploading || !selectedFile}
              aria-label={submitButtonLabel}
              title={submitButtonLabel}
              className={`mt-auto w-full h-12 flex items-center justify-center rounded-xl font-semibold text-sm transition-all duration-200 gap-2.5 ${
                (selectedFile && !isUploading)
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg cursor-pointer opacity-100'
                  : 'bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
              }`}
            >
              {isUploading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span className="text-white block">Uploading…</span>
                </>
              ) : uploadPhase === 'queued' ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2 2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-16 0 8 8 0 0116 0z" />
                  </svg>
                  <span className="text-white block">Job queued</span>
                </>
              ) : uploadPhase === 'error' ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-white block">Retry Upload</span>
                </>
              ) : selectedFile && credits > 0 ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-white block">Launch studio</span>
                </>
              ) : credits <= 0 && !isFree ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="block">Top Up Credits First</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-white block">Click to Render Video</span>
                </>
              )}
            </button>

            {credits <= 0 && !isFree && (
              <Link href="/dashboard/billing" className="text-center text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                View plans &amp; pricing →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Recent Renders Activity Stream ───────────────────────────────── */}
      <div className="bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden">
        {/* ── Section header ──────────────────────────────────────────────── */}
        <div className="px-7 py-5 border-b border-slate-800/60 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Recent Renders</h2>
            <p className="text-xs text-slate-500 mt-0.5">Your latest AI dubbing output history</p>
          </div>
          <button
            onClick={refreshProjects}
            disabled={refreshing}
            title="Reload the renders list — does not affect running jobs"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? 'Loading…' : 'Reload List'}
          </button>
        </div>

        {/* ── Search / Filter / Sort bar ───────────────────────────────────── */}
        {projects.length > 0 && (
          <div className="px-6 py-3.5 border-b border-slate-800/60 flex flex-wrap gap-2.5 items-center">
            {/* Search input */}
            <div className="relative flex-1 min-w-[160px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by title or language…"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-600/50 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg pl-3 pr-7 py-2 text-xs text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500/40 cursor-pointer transition-all"
              >
                <option value="all">All Status</option>
                <option value="COMPLETED">Completed</option>
                <option value="PROCESSING">Processing</option>
                <option value="PENDING">Queued</option>
                <option value="FAILED">Failed</option>
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Date filter */}
            <div className="relative">
              <select
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg pl-3 pr-7 py-2 text-xs text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500/40 cursor-pointer transition-all"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="last7">Last 7 Days</option>
                <option value="last30">Last 30 Days</option>
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}

            {/* Result count */}
            <span className="text-xs text-slate-600 ml-auto whitespace-nowrap tabular-nums">
              {filteredProjects.length} / {projects.length} renders
            </span>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.882v6.236a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-400">No renders yet</p>
            <p className="text-xs text-slate-600 mt-2 text-center max-w-sm leading-relaxed">
              Uploaded and processed creations will populate here automatically for instant playback and secure management.
            </p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-8">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-400">No results found</p>
            <p className="text-xs text-slate-600 mt-1.5 text-center">
              No renders match your current filters.
            </p>
            <button
              onClick={clearFilters}
              className="mt-4 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800/60">
                  <th className="text-left px-6 py-3.5 text-[10px] font-semibold text-slate-600 uppercase tracking-widest w-14" />
                  <th className="text-left px-4 py-3.5">
                    <button onClick={() => handleSort('title')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                      Project
                      <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3.5 hidden md:table-cell">
                    <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Original</span>
                  </th>
                  <th className="text-left px-4 py-3.5 hidden sm:table-cell">
                    <button onClick={() => handleSort('language')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                      Dubbed
                      <SortIcon field="language" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3.5 hidden sm:table-cell">
                    <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Subtitles</span>
                  </th>
                  <th className="text-left px-4 py-3.5">
                    <button onClick={() => handleSort('status')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                      Status
                      <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3.5 hidden md:table-cell">
                    <button onClick={() => handleSort('created_at')} className="group flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-400 uppercase tracking-widest transition-colors">
                      Created
                      <SortIcon field="created_at" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-right px-6 py-3.5 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p, idx) => {
                  const gradient     = THUMB_GRADIENTS[idx % THUMB_GRADIENTS.length]
                  const initial      = (p.title || 'V').charAt(0).toUpperCase()
                  const isCompleted   = p.latest_job_status === 'COMPLETED'
                  const isInProgress  = IN_PROGRESS_STATUSES.has(p.latest_job_status ?? '')
                  const isPending     = p.latest_job_status === 'PENDING'
                  const milestone     = MILESTONES.find(m => m.key === p.latest_job_status) ?? MILESTONES[0]
                  const pct           = p.progress_percentage ?? milestone.pct
                  const filename      = p.output_video_path?.replace(/\\/g, '/').split('/').pop() ?? ''
                  const token         = typeof window !== 'undefined' ? (localStorage.getItem('access_token') ?? '') : ''
                  const downloadUrl   = `http://localhost:8000/downloads/${filename}?token=${encodeURIComponent(token)}`

                  return (
                    <tr
                      key={p.project_id}
                      className="border-b border-slate-800/40 last:border-b-0 hover:bg-slate-900/60 transition-colors"
                    >
                      {/* Gradient thumbnail */}
                      <td className="px-6 py-4">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                          <span className="text-sm font-black text-white">{initial}</span>
                        </div>
                      </td>

                      {/* Title + scene name + short ID */}
                      <td className="px-4 py-4 max-w-[200px]">
                        <p className="text-sm font-medium text-slate-200 truncate">{p.title || 'Untitled Project'}</p>
                        {p.latest_job_scene_name && (
                          <p className="text-[11px] text-indigo-400 mt-0.5 truncate font-medium">🎬 {p.latest_job_scene_name}</p>
                        )}
                        <p className="text-[10px] text-slate-600 mt-0.5 font-mono">{p.project_id.slice(0, 8)}…</p>
                      </td>

                      {/* Original (source) language */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        {p.latest_job_source_language ? (
                          <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-300">
                            {p.latest_job_source_language === 'auto'
                              ? <span className="italic text-slate-500">Auto</span>
                              : p.latest_job_source_language.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-slate-700 text-xs">—</span>
                        )}
                      </td>

                      {/* Dubbed language badge */}
                      <td className="px-4 py-4 hidden sm:table-cell">
                        {p.latest_job_language ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-950/60 border border-indigo-900/50 text-indigo-300">
                            <span className="font-bold">{p.latest_job_language.toUpperCase()}</span>
                          </span>
                        ) : (
                          <span className="text-slate-700 text-xs">—</span>
                        )}
                      </td>

                      {/* Subtitle language badge */}
                      <td className="px-4 py-4 hidden sm:table-cell">
                        {p.latest_job_subtitle_language ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-900/50 text-purple-300">
                            <svg className="w-3 h-3 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            <span className="font-bold">{p.latest_job_subtitle_language.toUpperCase()}</span>
                          </span>
                        ) : (
                          <span className="text-slate-700 text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        {isInProgress ? (
                          <MiniStepper
                            status={p.latest_job_status!}
                            pct={pct}
                            desc={milestone.desc}
                            eta={milestone.eta}
                          />
                        ) : (
                          <StatusBadge status={p.latest_job_status} />
                        )}
                      </td>

                      {/* Date — shows latest job timestamp so rework updates it */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        <p className="text-xs text-slate-300 tabular-nums">{formatDate(p.latest_job_created_at ?? p.created_at)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{formatTime(p.latest_job_created_at ?? p.created_at)}</p>
                        <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">{formatRelativeTime(p.latest_job_created_at ?? p.created_at)}</p>
                        {p.latest_job_updated_at && p.latest_job_updated_at !== p.latest_job_created_at && (
                          <p className="text-[10px] text-slate-700 mt-0.5 tabular-nums">
                            upd {formatRelativeTime(p.latest_job_updated_at)}
                          </p>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">

                          {/* Completed — download available to all plans */}
                          {isCompleted && filename && (
                            <a
                              href={downloadUrl}
                              download
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 rounded-lg px-3 py-1.5 transition-all shadow-sm shadow-emerald-900/40"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download Video
                            </a>
                          )}

                          {/* In-progress / pending: disabled locked button */}
                          {(isInProgress || isPending) && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-1.5 cursor-not-allowed select-none">
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                              Processing… 🔒
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setReworkTarget({ project_id: p.project_id, title: p.title || 'Untitled Project', scene_name: p.latest_job_scene_name ?? '' })
                              setReworkVoiceLang(p.latest_job_language ?? 'hi')
                              setReworkSceneName('')  // always blank — user picks a name or auto-version is used
                              setReworkError('')
                            }}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 bg-indigo-950/40 border border-indigo-800/40 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-lg px-2.5 py-1.5 transition-all flex-shrink-0"
                            title="Rework — re-process with different language settings"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Rework
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ project_id: p.project_id, title: p.title || 'Untitled Project' })}
                            className="ml-1 inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-400 bg-red-950/30 border border-red-800/40 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all flex-shrink-0"
                            title="Delete project"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
    </>
  )
}
