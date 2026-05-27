'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import api from '@/utils/api'

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

// Subtitle languages — exact codes accepted by deep-translator (GoogleTranslator)
const SUBTITLE_LANGUAGES = [
  { code: 'af',        label: 'Afrikaans' },        { code: 'sq',    label: 'Albanian' },
  { code: 'am',        label: 'Amharic' },           { code: 'ar',    label: 'Arabic' },
  { code: 'hy',        label: 'Armenian' },          { code: 'as',    label: 'Assamese' },
  { code: 'ay',        label: 'Aymara' },            { code: 'az',    label: 'Azerbaijani' },
  { code: 'bm',        label: 'Bambara' },           { code: 'eu',    label: 'Basque' },
  { code: 'be',        label: 'Belarusian' },        { code: 'bn',    label: 'Bengali' },
  { code: 'bho',       label: 'Bhojpuri' },          { code: 'bs',    label: 'Bosnian' },
  { code: 'bg',        label: 'Bulgarian' },         { code: 'ca',    label: 'Catalan' },
  { code: 'ceb',       label: 'Cebuano' },           { code: 'ny',    label: 'Chichewa' },
  { code: 'zh-CN',     label: 'Chinese (Simplified)' }, { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'co',        label: 'Corsican' },          { code: 'hr',    label: 'Croatian' },
  { code: 'cs',        label: 'Czech' },             { code: 'da',    label: 'Danish' },
  { code: 'dv',        label: 'Dhivehi' },           { code: 'doi',   label: 'Dogri' },
  { code: 'nl',        label: 'Dutch' },             { code: 'en',    label: 'English' },
  { code: 'eo',        label: 'Esperanto' },         { code: 'et',    label: 'Estonian' },
  { code: 'ee',        label: 'Ewe' },               { code: 'tl',    label: 'Filipino' },
  { code: 'fi',        label: 'Finnish' },           { code: 'fr',    label: 'French' },
  { code: 'fy',        label: 'Frisian' },           { code: 'gl',    label: 'Galician' },
  { code: 'ka',        label: 'Georgian' },          { code: 'de',    label: 'German' },
  { code: 'el',        label: 'Greek' },             { code: 'gn',    label: 'Guarani' },
  { code: 'gu',        label: 'Gujarati' },          { code: 'ht',    label: 'Haitian Creole' },
  { code: 'ha',        label: 'Hausa' },             { code: 'haw',   label: 'Hawaiian' },
  { code: 'iw',        label: 'Hebrew' },            { code: 'hi',    label: 'Hindi' },
  { code: 'hmn',       label: 'Hmong' },             { code: 'hu',    label: 'Hungarian' },
  { code: 'is',        label: 'Icelandic' },         { code: 'ig',    label: 'Igbo' },
  { code: 'ilo',       label: 'Ilocano' },           { code: 'id',    label: 'Indonesian' },
  { code: 'ga',        label: 'Irish' },             { code: 'it',    label: 'Italian' },
  { code: 'ja',        label: 'Japanese' },          { code: 'jw',    label: 'Javanese' },
  { code: 'kn',        label: 'Kannada' },           { code: 'kk',    label: 'Kazakh' },
  { code: 'km',        label: 'Khmer' },             { code: 'rw',    label: 'Kinyarwanda' },
  { code: 'gom',       label: 'Konkani' },           { code: 'ko',    label: 'Korean' },
  { code: 'kri',       label: 'Krio' },              { code: 'ku',    label: 'Kurdish (Kurmanji)' },
  { code: 'ckb',       label: 'Kurdish (Sorani)' },  { code: 'ky',    label: 'Kyrgyz' },
  { code: 'lo',        label: 'Lao' },               { code: 'la',    label: 'Latin' },
  { code: 'lv',        label: 'Latvian' },           { code: 'ln',    label: 'Lingala' },
  { code: 'lt',        label: 'Lithuanian' },        { code: 'lg',    label: 'Luganda' },
  { code: 'lb',        label: 'Luxembourgish' },     { code: 'mk',    label: 'Macedonian' },
  { code: 'mai',       label: 'Maithili' },          { code: 'mg',    label: 'Malagasy' },
  { code: 'ms',        label: 'Malay' },             { code: 'ml',    label: 'Malayalam' },
  { code: 'mt',        label: 'Maltese' },           { code: 'mi',    label: 'Maori' },
  { code: 'mr',        label: 'Marathi' },           { code: 'mni-Mtei', label: 'Meiteilon (Manipuri)' },
  { code: 'lus',       label: 'Mizo' },              { code: 'mn',    label: 'Mongolian' },
  { code: 'my',        label: 'Myanmar' },           { code: 'ne',    label: 'Nepali' },
  { code: 'no',        label: 'Norwegian' },         { code: 'or',    label: 'Odia (Oriya)' },
  { code: 'om',        label: 'Oromo' },             { code: 'ps',    label: 'Pashto' },
  { code: 'fa',        label: 'Persian' },           { code: 'pl',    label: 'Polish' },
  { code: 'pt',        label: 'Portuguese' },        { code: 'pa',    label: 'Punjabi' },
  { code: 'qu',        label: 'Quechua' },           { code: 'ro',    label: 'Romanian' },
  { code: 'ru',        label: 'Russian' },           { code: 'sm',    label: 'Samoan' },
  { code: 'sa',        label: 'Sanskrit' },          { code: 'gd',    label: 'Scots Gaelic' },
  { code: 'nso',       label: 'Sepedi' },            { code: 'sr',    label: 'Serbian' },
  { code: 'st',        label: 'Sesotho' },           { code: 'sn',    label: 'Shona' },
  { code: 'sd',        label: 'Sindhi' },            { code: 'si',    label: 'Sinhala' },
  { code: 'sk',        label: 'Slovak' },            { code: 'sl',    label: 'Slovenian' },
  { code: 'so',        label: 'Somali' },            { code: 'es',    label: 'Spanish' },
  { code: 'su',        label: 'Sundanese' },         { code: 'sw',    label: 'Swahili' },
  { code: 'sv',        label: 'Swedish' },           { code: 'tg',    label: 'Tajik' },
  { code: 'ta',        label: 'Tamil' },             { code: 'tt',    label: 'Tatar' },
  { code: 'te',        label: 'Telugu' },            { code: 'th',    label: 'Thai' },
  { code: 'ti',        label: 'Tigrinya' },          { code: 'ts',    label: 'Tsonga' },
  { code: 'tr',        label: 'Turkish' },           { code: 'tk',    label: 'Turkmen' },
  { code: 'ak',        label: 'Twi' },               { code: 'uk',    label: 'Ukrainian' },
  { code: 'ur',        label: 'Urdu' },              { code: 'ug',    label: 'Uyghur' },
  { code: 'uz',        label: 'Uzbek' },             { code: 'vi',    label: 'Vietnamese' },
  { code: 'cy',        label: 'Welsh' },             { code: 'xh',    label: 'Xhosa' },
  { code: 'yi',        label: 'Yiddish' },           { code: 'yo',    label: 'Yoruba' },
  { code: 'zu',        label: 'Zulu' },
]
const SUBTITLE_LANG_LABEL: Record<string, string> = Object.fromEntries(SUBTITLE_LANGUAGES.map(l => [l.code, l.label]))

const CONSENT_STATEMENTS = [
  'I confirm I am the original owner of the voice in this video, or I hold explicit written permission from the voice rights holder.',
  'I understand that AI voice synthesis creates a digital reproduction of this voice, and I take full legal responsibility for authorised use only.',
  'I agree not to use this feature to impersonate, deceive, or misrepresent any individual without their knowledge and consent.',
  'I acknowledge that misuse of voice cloning technology may violate applicable laws, and ReelSync AI shall bear no liability for such misuse.',
]

type Step = 'upload' | 'configure' | 'processing' | 'done' | 'error'

interface JobStatus {
  job_id: string
  status: string
  output_video_path: string | null
  error_message: string | null
}

// ── Small lock badge used in the subtitle column header ──────────────────────
function LockBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Paid Only
    </span>
  )
}

export default function SyncPage() {
  const router     = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef    = useRef<NodeJS.Timeout | null>(null)

  const [step,           setStep]          = useState<Step>('upload')
  const [dragOver,       setDragOver]      = useState(false)
  const [selectedFile,   setSelectedFile]  = useState<File | null>(null)
  const [title,          setTitle]         = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [projectId,      setProjectId]     = useState('')

  // Separate audio, subtitle, and source language states
  const [audioLanguage,    setAudioLanguage]    = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('dashLang')
      if (saved && LANGUAGES.some(l => l.code === saved)) return saved
    }
    return 'hi'
  })
  const [subtitleLanguage, setSubtitleLanguage] = useState('en')
  const [sourceLanguage,   setSourceLanguage]   = useState('auto')
  const [sceneName,        setSceneName]        = useState('')

  const [jobId,       setJobId]      = useState('')
  const [jobStatus,   setJobStatus]  = useState<JobStatus | null>(null)
  const [videoUrl,    setVideoUrl]   = useState('')
  const [error,       setError]      = useState('')
  const [plan,        setPlan]       = useState<string>('free')

  // Voice consent modal state
  const [showConsent,    setShowConsent]    = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)

  const isFree = plan === 'free'

  useEffect(() => {
    if (!localStorage.getItem('access_token')) { router.replace('/login'); return }
    // Fetch plan — needed to gate the subtitle language selector.
    // Default stays 'free' (restrictive) if the request fails.
    api.get<{ subscription_plan: string }>('/api/auth/me')
      .then(res => setPlan((res.data.subscription_plan || 'free').toLowerCase()))
      .catch(() => {})
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // Subtitle tier gate disabled for testing

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file (MP4 recommended).')
      return
    }
    setSelectedFile(file)
    setTitle(file.name.replace(/\.[^/.]+$/, ''))
    setError('')
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedFile || !title.trim()) {
      setError('Please select a file and enter a title.')
      return
    }
    setError('')
    setUploadProgress(0)

    const form = new FormData()
    form.append('file', selectedFile)
    form.append('title', title.trim())

    try {
      const { data } = await api.post('/api/videos/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      setProjectId(data.project_id)
      setStep('configure')
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.detail || 'Upload failed.') : 'Upload failed. Please try again.')
    }
  }

  // ── Step 2: Show consent modal before processing ────────────────────────────
  const handleProcessClick = () => {
    setConsentChecked(false)
    setShowConsent(true)
  }

  const handleConsentConfirm = () => {
    setShowConsent(false)
    handleProcess()
  }

  // ── Step 2: Process ─────────────────────────────────────────────────────────
  const handleProcess = async () => {
    setError('')
    const finalSubtitleLang = subtitleLanguage
    try {
      const { data } = await api.post(`/api/videos/process/${projectId}`, {
        scene_name:               sceneName.trim() || null,
        target_voice_language:    audioLanguage,
        target_subtitle_language: finalSubtitleLang,
        source_language:          sourceLanguage,
      })
      setJobId(data.job_id)
      setStep('processing')
      startPolling(data.job_id)
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.detail || 'Failed to start processing.') : 'Failed to start processing.')
    }
  }

  // ── Step 3: Poll ────────────────────────────────────────────────────────────
  const startPolling = (jid: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<JobStatus>(`/api/videos/jobs/${jid}`)
        setJobStatus(data)
        if (data.status === 'COMPLETED') {
          clearInterval(pollRef.current!)
          const path     = data.output_video_path ?? ''
          const filename = path.replace(/\\/g, '/').split('/').pop() ?? ''
          const token    = encodeURIComponent(localStorage.getItem('access_token') ?? '')
          setVideoUrl(`http://localhost:8000/downloads/${filename}?token=${token}`)
          setStep('done')
        } else if (data.status === 'FAILED') {
          clearInterval(pollRef.current!)
          setError(data.error_message || 'Dubbing job failed.')
          setStep('error')
        }
      } catch { /* transient network error — keep polling */ }
    }, 3000)
  }

  const resetFlow = () => {
    setStep('upload')
    setSelectedFile(null)
    setTitle('')
    setError('')
    setUploadProgress(0)
    setJobStatus(null)
  }

  // ── Step indicator ──────────────────────────────────────────────────────────
  const stepLabels = ['Upload', 'Configure', 'Processing', 'Done']
  const stepIndex  = { upload: 0, configure: 1, processing: 2, done: 3, error: 2 }[step]

  return (
    <>
      {/* ── Voice consent modal ───────────────────────────────────────────── */}
      {showConsent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Voice Cloning Consent</h2>
                <p className="text-xs text-gray-500 mt-0.5">Required before AI dubbing proceeds</p>
              </div>
            </div>

            <ol className="space-y-3 mb-6">
              {CONSENT_STATEMENTS.map((stmt, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">{stmt}</p>
                </li>
              ))}
            </ol>

            <div
              className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors mb-6 cursor-pointer ${
                consentChecked ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'
              }`}
              onClick={() => setConsentChecked(v => !v)}
            >
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-indigo-600 cursor-pointer"
                onClick={e => e.stopPropagation()}
              />
              <p className="text-xs text-gray-700 leading-relaxed select-none">
                I have read and I accept all of the above voice cloning terms and conditions.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConsent(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!consentChecked}
                onClick={handleConsentConfirm}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold transition-colors"
              >
                Proceed with Dubbing
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Step progress */}
        <div className="flex items-center mb-10">
          {stepLabels.map((s, i) => (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                i < stepIndex  ? 'bg-indigo-600 text-white' :
                i === stepIndex ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' :
                'bg-gray-200 text-gray-500'
              }`}>
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span className={`ml-2 text-xs font-medium hidden sm:block ${i === stepIndex ? 'text-indigo-600' : 'text-gray-400'}`}>
                {s}
              </span>
              {i < stepLabels.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 ${i < stepIndex ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {/* ── STEP 1: Upload ── */}
        {step === 'upload' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Upload Your Video</h2>

            <div
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver        ? 'border-indigo-500 bg-indigo-50' :
                selectedFile    ? 'border-green-400 bg-green-50' :
                'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
              />
              {selectedFile ? (
                <>
                  <div className="text-4xl mb-2">🎬</div>
                  <p className="font-semibold text-gray-700 text-sm">{selectedFile.name}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB — click to change
                  </p>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-3">📁</div>
                  <p className="text-gray-600 font-medium text-sm">Drag & drop your MP4 here</p>
                  <p className="text-gray-400 text-xs mt-1">or click to browse files</p>
                </>
              )}
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-900 bg-white placeholder-gray-400"
                placeholder="My awesome video"
              />
            </div>

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="mt-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                      <span>Uploading file…</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300 bg-indigo-600"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-2xl font-black text-indigo-600 tabular-nums w-14 text-right leading-none">
                    {uploadProgress}%
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || !title.trim() || (uploadProgress > 0 && uploadProgress < 100)}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {uploadProgress > 0 && uploadProgress < 100 ? 'Uploading…' : 'Upload Video'}
            </button>
          </div>
        )}

        {/* ── STEP 2: Configure — dual language selector ── */}
        {step === 'configure' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Configure Dubbing Parameters</h2>
            <p className="text-gray-500 text-sm mb-7">
              Select the audio dubbing language and optionally override the subtitle burn language independently.
            </p>

            {/* ── Scene / clip name ── */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Scene / Clip Name
                <span className="ml-2 text-xs font-normal text-gray-400">(used as output filename)</span>
              </label>
              <input
                type="text"
                value={sceneName}
                onChange={e => setSceneName(e.target.value)}
                maxLength={80}
                placeholder={`e.g. Interval Scene, Opening Fight`}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-900 bg-white placeholder-gray-400"
              />
            </div>

            {/* ── Original language selector (compact, defaults to Auto-detect) ── */}
            <div className="mb-6 p-4 rounded-xl border border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Original Video Language</h3>
                  <p className="text-[11px] text-gray-400">Language spoken in your source video — leave Auto for ElevenLabs to detect</p>
                </div>
              </div>
              <select
                value={sourceLanguage}
                onChange={e => setSourceLanguage(e.target.value)}
                className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="auto">Auto-detect (recommended)</option>
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>

            {/* ── Two-column language selectors ── */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">

              {/* Column 1 — Voice Dubbing Language */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Voice Dubbing Language</h3>
                    <p className="text-[11px] text-gray-400">Audio translation target</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setAudioLanguage(lang.code)}
                      className={`px-3 py-2.5 rounded-xl border-2 text-xs font-medium transition-colors text-left ${
                        audioLanguage === lang.code
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 bg-indigo-50 rounded-lg px-3 py-2 text-xs text-indigo-700">
                  Audio: <strong>{LANG_LABEL[audioLanguage] ?? audioLanguage}</strong>
                </div>
              </div>

              {/* Column 2 — Subtitles Language Override */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isFree ? 'bg-amber-400' : 'bg-purple-600'}`}>
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800">Subtitles Language Override</h3>
                    <p className="text-[11px] text-gray-400">Independent subtitle text language</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                  {SUBTITLE_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setSubtitleLanguage(lang.code)}
                      className={`px-3 py-2.5 rounded-xl border-2 text-xs font-medium transition-colors text-left ${
                        subtitleLanguage === lang.code
                          ? 'border-purple-600 bg-purple-50 text-purple-700'
                          : 'border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-gray-50'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 bg-purple-50 rounded-lg px-3 py-2 text-xs text-purple-700">
                  Subtitles: <strong>{SUBTITLE_LANG_LABEL[subtitleLanguage] ?? subtitleLanguage}</strong>
                  {subtitleLanguage !== audioLanguage && (
                    <span className="ml-1.5 text-purple-500 font-normal">
                      (cross-language mismatch enabled)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Job summary strip ── */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-xs mb-4">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                <span className="text-gray-500">Original:</span>
                <span className="font-semibold text-gray-600">
                  {sourceLanguage === 'auto' ? 'Auto-detect' : (LANG_LABEL[sourceLanguage] ?? sourceLanguage.toUpperCase())}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <span className="text-gray-500">Voice:</span>
                <span className="font-semibold text-indigo-700">{LANG_LABEL[audioLanguage]}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <span className="text-gray-500">Subtitles:</span>
                <span className="font-semibold text-purple-700">
                  {SUBTITLE_LANG_LABEL[subtitleLanguage] ?? subtitleLanguage}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 6v6l4 2" />
                </svg>
                <span className="text-gray-500">Cost:</span>
                <span className="font-semibold text-gray-700">1 credit</span>
              </div>
            </div>

            {/* Legal micro-notice */}
            <p className="text-[11px] text-gray-400 mb-5 leading-relaxed">
              By proceeding you confirm you own the voice rights for this content or hold written permission from the rights holder.
            </p>

            <button
              onClick={handleProcessClick}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Generate Subtitles &amp; Voice Clone
            </button>
          </div>
        )}

        {/* ── STEP 3: Processing ── */}
        {step === 'processing' && (() => {
          const SYNC_MILESTONES = [
            { key: 'PENDING',               pct: 3,   label: 'Queued',    desc: 'Waiting in the render queue…'                },
            { key: 'STARTED',               pct: 5,   label: 'Started',   desc: 'Initializing project…'                       },
            { key: 'EXTRACTED_AUDIO',       pct: 20,  label: 'Extracted', desc: 'Extracting original source audio…'            },
            { key: 'CLONED_AUDIO',          pct: 45,  label: 'Cloned',    desc: 'Cloning speech signatures via ElevenLabs…'    },
            { key: 'DUBBING_COMPLETED',     pct: 65,  label: 'Dubbed',    desc: 'Audio localization complete…'                 },
            { key: 'APPENDING_TO_VIDEO',    pct: 80,  label: 'Merging',   desc: 'Merging audio tracks & subtitles…'            },
            { key: 'RENDERING_IN_PROGRESS', pct: 95,  label: 'Rendering', desc: 'Finalizing composition render pass…'          },
          ]
          const current    = jobStatus?.status ?? 'PENDING'
          const milestone  = SYNC_MILESTONES.find(m => m.key === current) ?? SYNC_MILESTONES[0]
          const currentIdx = SYNC_MILESTONES.findIndex(m => m.key === current)
          const renderPct  = milestone.pct

          return (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Processing Your Video</h2>
                  <p className="text-gray-500 text-xs mt-0.5">ElevenLabs AI dubbing — typically 2–5 minutes</p>
                </div>
              </div>

              {/* Active step callout */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-5">
                <p className="text-xs font-semibold text-indigo-700">{milestone.desc}</p>
                <p className="text-[11px] text-indigo-500 mt-0.5">Step {currentIdx + 1} of {SYNC_MILESTONES.length}</p>
              </div>

              {/* Progress bar + percentage */}
              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${renderPct}%`, background: 'linear-gradient(90deg, #6366f1, #f59e0b)' }}
                  />
                </div>
                <span className="text-2xl font-black text-indigo-600 tabular-nums w-14 text-right leading-none flex-shrink-0">
                  {renderPct}%
                </span>
              </div>

              {/* Milestone checklist */}
              <div className="space-y-2">
                {SYNC_MILESTONES.map((m, i) => {
                  const isDone   = i < currentIdx
                  const isActive = i === currentIdx
                  return (
                    <div key={m.key} className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${isActive ? 'bg-indigo-50' : ''}`}>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        isDone   ? 'bg-emerald-500 text-white' :
                        isActive ? 'bg-indigo-600 text-white animate-pulse' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {isDone ? '✓' : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium ${
                          isActive ? 'text-indigo-700' : isDone ? 'text-gray-400 line-through' : 'text-gray-400'
                        }`}>
                          {m.label}
                        </span>
                        {isActive && (
                          <span className="ml-1.5 text-[10px] text-indigo-500">{m.desc}</span>
                        )}
                      </div>
                      <span className={`text-[10px] font-bold tabular-nums ${isActive ? 'text-indigo-600' : isDone ? 'text-emerald-500' : 'text-gray-300'}`}>
                        {m.pct}%
                      </span>
                    </div>
                  )
                })}
              </div>

              <p className="text-[11px] text-gray-400 mt-5 text-center">Polling every 3 s · Job ID: {jobId.slice(0, 8)}…</p>
            </div>
          )
        })()}

        {/* ── STEP 4: Done ── */}
        {step === 'done' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-600 font-bold text-lg">✓</div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Dub Complete!</h2>
                <p className="text-gray-500 text-sm">Your video is ready to preview and download.</p>
              </div>
            </div>

            <video
              src={videoUrl}
              controls
              className="w-full rounded-xl bg-black shadow-md mb-5"
              style={{ maxHeight: '480px' }}
            />

            <div className="flex gap-3">
              <a
                href={videoUrl}
                download
                className="flex-1 text-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                Download MP4
              </a>
              <button
                onClick={resetFlow}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                Dub Another
              </button>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {step === 'error' && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 text-center">
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-xl font-bold text-red-700 mb-2">Dubbing Failed</h2>
            <p className="text-gray-500 text-sm mb-6">{error || 'An unexpected error occurred during processing.'}</p>
            <button
              onClick={resetFlow}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </main>
    </>
  )
}
