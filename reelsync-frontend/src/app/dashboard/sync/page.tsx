'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import api from '@/utils/api'

const LANGUAGES = [
  { code: 'hi', label: 'Hindi' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'id', label: 'Indonesian' },
]

type Step = 'upload' | 'configure' | 'processing' | 'done' | 'error'

interface JobStatus {
  job_id: string
  status: string
  output_video_path: string | null
  error_message: string | null
}

export default function SyncPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const [step, setStep] = useState<Step>('upload')
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [projectId, setProjectId] = useState('')
  const [language, setLanguage] = useState('hi')
  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!localStorage.getItem('access_token')) router.replace('/login')
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

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
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Upload failed.')
      } else {
        setError('Upload failed. Please try again.')
      }
    }
  }

  // ── Step 2: Process ─────────────────────────────────────────────────────────
  const handleProcess = async () => {
    setError('')
    try {
      const { data } = await api.post(`/api/videos/process/${projectId}`, {
        target_language: language,
      })
      setJobId(data.job_id)
      setStep('processing')
      startPolling(data.job_id)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Failed to start processing.')
      } else {
        setError('Failed to start processing.')
      }
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
          const path = data.output_video_path ?? ''
          const parts = path.replace(/\\/g, '/').split('/')
          const relPath = parts.slice(-2).join('/')
          setVideoUrl(`http://localhost:8000/downloads/${relPath}`)
          setStep('done')
        } else if (data.status === 'FAILED') {
          clearInterval(pollRef.current!)
          setError(data.error_message || 'Dubbing job failed.')
          setStep('error')
        }
      } catch {
        // transient network error — keep polling
      }
    }, 3000)
  }

  // ── Step indicator ──────────────────────────────────────────────────────────
  const steps = ['Upload', 'Configure', 'Processing', 'Done']
  const stepIndex = { upload: 0, configure: 1, processing: 2, done: 3, error: 2 }[step]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-slate-900 text-white px-6 py-4 flex items-center gap-4 shadow-lg">
        <Link href="/dashboard" className="text-slate-400 hover:text-white text-sm transition-colors">
          ← Dashboard
        </Link>
        <span className="text-indigo-400 font-bold text-lg">New Dub</span>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10">
        {/* Step progress */}
        <div className="flex items-center mb-10">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                i < stepIndex ? 'bg-indigo-600 text-white' :
                i === stepIndex ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' :
                'bg-gray-200 text-gray-500'
              }`}>
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span className={`ml-2 text-xs font-medium hidden sm:block ${i === stepIndex ? 'text-indigo-600' : 'text-gray-400'}`}>
                {s}
              </span>
              {i < steps.length - 1 && (
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

            {/* Dropzone */}
            <div
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-indigo-500 bg-indigo-50' :
                selectedFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
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

            {/* Title */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="My awesome video"
              />
            </div>

            {/* Upload progress */}
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || !title.trim() || (uploadProgress > 0 && uploadProgress < 100)}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {uploadProgress > 0 && uploadProgress < 100 ? `Uploading ${uploadProgress}%...` : 'Upload Video'}
            </button>
          </div>
        )}

        {/* ── STEP 2: Configure ── */}
        {step === 'configure' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Choose Target Language</h2>
            <p className="text-gray-500 text-sm mb-6">
              Your video will be dubbed and captioned in this language.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => setLanguage(lang.code)}
                  className={`px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                    language === lang.code
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-gray-50'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            <div className="bg-indigo-50 rounded-xl px-4 py-3 text-sm text-indigo-700 mb-6">
              Selected: <strong>{LANGUAGES.find(l => l.code === language)?.label}</strong> ({language}) — costs 1 credit
            </div>

            <button
              onClick={handleProcess}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Generate Subtitles &amp; Voice Clone
            </button>
          </div>
        )}

        {/* ── STEP 3: Processing ── */}
        {step === 'processing' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="text-5xl mb-4 animate-pulse">🎙️</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Processing Your Video</h2>
            <p className="text-gray-500 text-sm mb-6">
              ElevenLabs is dubbing your video. This usually takes 2–5 minutes.
            </p>

            {/* Status tracker */}
            <div className="space-y-3 text-left max-w-xs mx-auto">
              {['PENDING', 'PROCESSING', 'COMPLETED'].map((s) => {
                const current = jobStatus?.status ?? 'PENDING'
                const statuses = ['PENDING', 'PROCESSING', 'COMPLETED']
                const currentIdx = statuses.indexOf(current)
                const sIdx = statuses.indexOf(s)
                const isDone = sIdx < currentIdx
                const isActive = s === current
                return (
                  <div key={s} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                      isDone ? 'bg-green-500 text-white' :
                      isActive ? 'bg-indigo-600 text-white animate-pulse' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isDone ? '✓' : ''}
                    </div>
                    <span className={`text-sm ${isActive ? 'text-indigo-600 font-semibold' : isDone ? 'text-gray-400 line-through' : 'text-gray-400'}`}>
                      {s === 'PENDING' ? 'Job queued' : s === 'PROCESSING' ? 'AI dubbing in progress...' : 'Rendering complete'}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-gray-400 mt-6">Checking every 3 seconds · Job ID: {jobId.slice(0, 8)}...</p>
          </div>
        )}

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
              <Link
                href="/dashboard/sync"
                className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm"
                onClick={() => { window.location.href = '/dashboard/sync' }}
              >
                Dub Another
              </Link>
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
              onClick={() => { setStep('upload'); setSelectedFile(null); setTitle(''); setError(''); setUploadProgress(0) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
