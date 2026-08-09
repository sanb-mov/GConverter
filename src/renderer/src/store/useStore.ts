/**
 * Renderer state.
 *
 * The main process is the source of truth for jobs, settings, presets and
 * history; this store mirrors that state and forwards intent back over IPC.
 */

import { create } from 'zustand'
import type {
  AppSettings,
  AutomationRule,
  ConversionJob,
  ConversionProfile,
  ConversionSettings,
  FFmpegInfo,
  HardwareCapabilities,
  HistoryEntry,
  LogRecord,
  MediaFile
} from '@shared/models'
import type { AppInfo, PreviewResult, QueueEventPayload } from '@shared/ipc'

export type PageId =
  | 'home'
  | 'convert'
  | 'queue'
  | 'presets'
  | 'inspector'
  | 'automation'
  | 'history'
  | 'logs'
  | 'settings'
  | 'help'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  title: string
  message?: string
  actions?: { label: string; onClick: () => void }[]
}

interface State {
  /* navigation */
  page: PageId
  setPage: (page: PageId) => void
  /** Help article to open; lets the help button be context-aware. */
  helpSection: string | null
  openHelp: (section?: string) => void

  /* files being worked on */
  files: MediaFile[]
  selectedFileId: string | null
  addFiles: (files: MediaFile[]) => void
  removeFile: (id: string) => void
  clearFiles: () => void
  selectFile: (id: string | null) => void

  /* per-file conversion settings, keyed by MediaFile.id */
  settingsByFile: Record<string, ConversionSettings>
  setFileSettings: (fileId: string, settings: ConversionSettings) => void

  /* live preview of the selected file's plan */
  preview: PreviewResult | null
  previewLoading: boolean
  setPreview: (preview: PreviewResult | null) => void
  setPreviewLoading: (loading: boolean) => void

  /* queue */
  jobs: ConversionJob[]
  queueRunning: boolean
  queuePaused: boolean
  setQueue: (jobs: ConversionJob[], running: boolean, paused: boolean) => void
  applyQueueEvent: (event: QueueEventPayload) => void

  /* reference data */
  profiles: ConversionProfile[]
  setProfiles: (profiles: ConversionProfile[]) => void
  settings: AppSettings | null
  setSettings: (settings: AppSettings) => void
  ffmpeg: FFmpegInfo | null
  hardware: HardwareCapabilities | null
  setSystem: (ffmpeg: FFmpegInfo | null, hardware: HardwareCapabilities | null) => void
  appInfo: AppInfo | null
  setAppInfo: (info: AppInfo) => void

  history: HistoryEntry[]
  setHistory: (entries: HistoryEntry[]) => void

  automationRules: AutomationRule[]
  setAutomationRules: (rules: AutomationRule[]) => void

  logs: LogRecord[]
  setLogs: (records: LogRecord[]) => void
  appendLog: (record: LogRecord) => void

  /* transient UI */
  toasts: Toast[]
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void

  isDragging: boolean
  setDragging: (dragging: boolean) => void

  busy: string | null
  setBusy: (label: string | null) => void
}

export const useStore = create<State>((set, get) => ({
  page: 'home',
  setPage: (page) => set({ page }),

  helpSection: null,
  openHelp: (section) => set({ page: 'help', helpSection: section ?? null }),

  files: [],
  selectedFileId: null,

  addFiles: (incoming) =>
    set((state) => {
      // Adding the same path twice is almost always accidental.
      const existingPaths = new Set(state.files.map((f) => f.path))
      const fresh = incoming.filter((f) => !existingPaths.has(f.path))
      const files = [...state.files, ...fresh]
      return {
        files,
        selectedFileId: state.selectedFileId ?? fresh.find((f) => !f.error)?.id ?? null
      }
    }),

  removeFile: (id) =>
    set((state) => {
      const files = state.files.filter((f) => f.id !== id)
      const settingsByFile = { ...state.settingsByFile }
      delete settingsByFile[id]
      return {
        files,
        settingsByFile,
        selectedFileId:
          state.selectedFileId === id ? (files.find((f) => !f.error)?.id ?? null) : state.selectedFileId,
        preview: state.selectedFileId === id ? null : state.preview
      }
    }),

  clearFiles: () => set({ files: [], selectedFileId: null, settingsByFile: {}, preview: null }),

  selectFile: (id) => set({ selectedFileId: id, preview: null }),

  settingsByFile: {},
  setFileSettings: (fileId, settings) =>
    set((state) => ({ settingsByFile: { ...state.settingsByFile, [fileId]: settings } })),

  preview: null,
  previewLoading: false,
  setPreview: (preview) => set({ preview }),
  setPreviewLoading: (previewLoading) => set({ previewLoading }),

  jobs: [],
  queueRunning: false,
  queuePaused: false,
  setQueue: (jobs, running, paused) =>
    set({ jobs, queueRunning: running, queuePaused: paused }),

  applyQueueEvent: (event) => {
    switch (event.type) {
      case 'job-added':
        set((state) => ({ jobs: [...state.jobs, event.job] }))
        break
      case 'job-updated':
        set((state) => ({
          jobs: state.jobs.map((j) => (j.id === event.job.id ? event.job : j))
        }))
        break
      case 'job-progress':
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === event.jobId ? { ...j, progress: event.progress } : j
          )
        }))
        break
      case 'job-removed':
        set((state) => ({ jobs: state.jobs.filter((j) => j.id !== event.jobId) }))
        break
      case 'queue-state':
        set({ queueRunning: event.running, queuePaused: event.paused })
        break
    }
  },

  profiles: [],
  setProfiles: (profiles) => set({ profiles }),

  settings: null,
  setSettings: (settings) => set({ settings }),

  ffmpeg: null,
  hardware: null,
  setSystem: (ffmpeg, hardware) =>
    set((state) => ({
      ffmpeg: ffmpeg ?? state.ffmpeg,
      hardware: hardware ?? state.hardware
    })),

  appInfo: null,
  setAppInfo: (appInfo) => set({ appInfo }),

  history: [],
  setHistory: (history) => set({ history }),

  automationRules: [],
  setAutomationRules: (automationRules) => set({ automationRules }),

  logs: [],
  setLogs: (logs) => set({ logs }),
  appendLog: (record) =>
    set((state) => {
      const logs = [...state.logs, record]
      // Keep the panel responsive on long sessions.
      if (logs.length > 3000) logs.splice(0, logs.length - 3000)
      return { logs }
    }),

  toasts: [],
  pushToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => {
      const toasts = [...state.toasts, { ...toast, id }]
      // A batch finishing would otherwise bury the UI under notifications.
      // Keep the newest few and drop older non-error ones first.
      const MAX_VISIBLE = 3
      while (toasts.length > MAX_VISIBLE) {
        const oldestNonError = toasts.findIndex((t) => t.kind !== 'error')
        toasts.splice(oldestNonError === -1 ? 0 : oldestNonError, 1)
      }
      return { toasts }
    })
    // Errors stay until dismissed; successes fade on their own.
    if (toast.kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 5200)
    }
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  isDragging: false,
  setDragging: (isDragging) => set({ isDragging }),

  busy: null,
  setBusy: (busy) => set({ busy })
}))

/** Typed accessor for the preload bridge. */
export const api = (): Window['gconverter'] => window.gconverter
