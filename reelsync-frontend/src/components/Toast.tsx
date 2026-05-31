'use client'

/**
 * Lightweight dependency-free toast system.
 *
 * Usage:
 *   1. Wrap your app (or layout) in <ToastProvider>.
 *   2. In any component: import { toast } from '@/components/Toast'
 *      then call toast.success("…") or toast.error("…").
 *
 * No external library required.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// ── types ──────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void
}

// ── context + provider ─────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ show: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counterRef.current
    setItems(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, 4500)
  }, [])

  // Expose `show` on the global singleton so callers outside React can use it
  useEffect(() => {
    _globalShow = show
    return () => { _globalShow = null }
  }, [show])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}

      {/* Fixed toast stack — bottom-right */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
      >
        {items.map(item => (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-sm
              px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium
              animate-in slide-in-from-right-5 fade-in duration-300
              ${item.type === 'success'
                ? 'bg-emerald-950 border-emerald-800 text-emerald-200'
                : item.type === 'error'
                ? 'bg-red-950 border-red-800 text-red-200'
                : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
          >
            {/* Icon */}
            <span className="shrink-0 mt-0.5">
              {item.type === 'success' && (
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {item.type === 'error' && (
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {item.type === 'info' && (
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01" />
                  <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="leading-relaxed">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ── hook ───────────────────────────────────────────────────────────────────

export function useToast() {
  return useContext(ToastContext)
}

// ── module-level singleton (usable outside React render) ───────────────────
// Components that already have the ToastProvider above them can just import
// `toast` directly without needing the hook.

let _globalShow: ((message: string, type?: ToastType) => void) | null = null

export const toast = {
  success: (message: string) => _globalShow?.(message, 'success'),
  error:   (message: string) => _globalShow?.(message, 'error'),
  info:    (message: string) => _globalShow?.(message, 'info'),
}
