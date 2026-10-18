import { useEffect } from 'react'
import { CheckCircle2, Info, X, AlertTriangle, HelpCircle } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { ConvertPage } from './pages/ConvertPage'
import { YouTubePage } from './pages/YouTubePage'
import { QueuePage } from './pages/QueuePage'
import { PresetsPage } from './pages/PresetsPage'
import { InspectorPage } from './pages/InspectorPage'
import { AutomationPage } from './pages/AutomationPage'
import { HistoryPage } from './pages/HistoryPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'
import { HelpPage } from './pages/HelpPage'
import { api, useStore, type PageId } from './store/useStore'
import { useT } from './lib/i18n'
import { t as translate } from '@shared/i18n'

export default function App(): React.JSX.Element {
  const page = useStore((s) => s.page)
  const isDragging = useStore((s) => s.isDragging)
  const setDragging = useStore((s) => s.setDragging)

  /* --------------------------- initial load --------------------------- */
  useEffect(() => {
    const store = useStore.getState()

    void api().settings.get().then((settings) => {
      store.setSettings(settings)
      document.documentElement.setAttribute('data-theme', settings.general.theme)
    })
    void api().profiles.list().then(store.setProfiles)
    void api().history.list().then(store.setHistory)
    void api().automation.list().then(store.setAutomationRules)
    void api().logs.list(500).then(store.setLogs)
    void api().app.info().then(store.setAppInfo)

    void api().system.ffmpeg().then((ffmpeg) => {
      store.setSystem(ffmpeg, null)
      if (!ffmpeg.available) {
        store.pushToast({
          kind: 'error',
          title: 'FFmpeg is not available',
          message: ffmpeg.error,
          actions: [{ label: 'Open settings', onClick: () => store.setPage('settings') }]
        })
      }
    })
    void api().system.hardware().then((hardware) => store.setSystem(null, hardware))

    void api().queue.list().then(({ jobs, running, paused }) => {
      store.setQueue(jobs, running, paused)
    })

    const offQueue = api().queue.onEvent((event) => {
      useStore.getState().applyQueueEvent(event)

      if (event.type === 'job-updated') {
        const { job } = event
        if (job.status === 'completed') {
          void api().history.list().then(useStore.getState().setHistory)
          useStore.getState().pushToast({
            kind: 'success',
            title: 'Conversion completed',
            message: job.outputPath.split(/[\\/]/).pop(),
            actions: [
              { label: 'Open', onClick: () => void api().shell.openPath(job.outputPath) },
              {
                label: 'Show in folder',
                onClick: () => void api().shell.revealPath(job.outputPath)
              }
            ]
          })
        } else if (job.status === 'failed') {
          void api().history.list().then(useStore.getState().setHistory)
          useStore.getState().pushToast({
            kind: 'error',
            title: `Failed: ${job.source.name}`,
            message: job.error?.reason,
            actions: [
              { label: 'View queue', onClick: () => useStore.getState().setPage('queue') }
            ]
          })
        }
      }
    })

    void api().youtube.list().then(store.setDownloads)

    // Each download reports its own end once; toast on the transition only.
    const offYouTube = api().youtube.onEvent((event) => {
      const state = useStore.getState()
      const before =
        event.type === 'updated' ? state.downloads.find((d) => d.id === event.download.id) : undefined
      state.applyYouTubeEvent(event)
      if (event.type !== 'updated' || !before || before.status === event.download.status) return

      const { download } = event
      const t = (key: string): string => translate(state.settings?.general.language ?? 'en', key)
      if (download.status === 'completed' && download.outputPath) {
        const output = download.outputPath
        state.pushToast({
          kind: 'success',
          title: t('yt.completedToast'),
          message: output.split(/[\\/]/).pop(),
          actions: [
            { label: t('yt.open'), onClick: () => void api().shell.openPath(output) },
            { label: t('yt.showInFolder'), onClick: () => void api().shell.revealPath(output) }
          ]
        })
      } else if (download.status === 'failed') {
        const code = download.errorCode
        if (code === 'bot' || code === 'age') {
          // Ask for the check right away; the YouTube page shows the dialog.
          const request = { code, url: download.request.url, downloadId: download.id }
          state.setYouTubeVerify(request)
          if (state.page !== 'youtube') {
            state.pushToast({
              kind: 'error',
              title: t('yt.verifyTitle'),
              message: download.error,
              actions: [
                {
                  label: t('yt.verifyAction'),
                  onClick: () => {
                    useStore.getState().setYouTubeVerify(request)
                    useStore.getState().setPage('youtube')
                  }
                }
              ]
            })
          }
          return
        }
        state.pushToast({
          kind: 'error',
          title: t('yt.failedToast'),
          message: download.error,
          actions: [{ label: t('yt.downloads'), onClick: () => useStore.getState().setPage('youtube') }]
        })
      }
    })

    const offLog = api().logs.onRecord((record) => useStore.getState().appendLog(record))

    const offSystem = api().system.onRefresh(({ ffmpeg, hardware }) => {
      useStore.getState().setSystem(ffmpeg, hardware)
    })

    // Hooks used by the automated UI smoke test to drive the app headlessly.
    ;(window as unknown as { __gc?: unknown }).__gc = {
      setPage: (p: PageId) => useStore.getState().setPage(p),
      loadFiles: async (paths: string[]) => {
        const files = await api().media.probeFiles(paths)
        useStore.getState().addFiles(files)
      },
      openHelp: (section: string) => useStore.getState().openHelp(section),
      setLanguage: (code: 'en' | 'es') => {
        const current = useStore.getState().settings
        if (!current) return
        const next = structuredClone(current)
        next.general.language = code
        useStore.getState().setSettings(next)
      },
      convertAll: async (format: string) => {
        for (const file of useStore.getState().files.filter((f) => !f.error)) {
          const settings = await api().conversion.smartSettings(file, format)
          await api().queue.add(file, settings)
        }
        await api().queue.start()
      }
    }

    return () => {
      offQueue()
      offYouTube()
      offLog()
      offSystem()
    }
  }, [])

  /* ------------------- window-wide drag & drop guard ------------------- */
  useEffect(() => {
    let depth = 0

    const onDragEnter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      // Prevent Chromium from navigating away when a file is dropped outside
      // an explicit drop target — that would blank the whole app.
      e.preventDefault()
      depth = 0
      setDragging(false)

      const target = e.target as HTMLElement | null
      if (target?.closest('.dropzone')) return

      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((file) => window.gconverterDrop.getPathForFile(file))
        .filter(Boolean)
      if (paths.length === 0) return

      void api()
        .media.resolveDropped(paths)
        .then((files) => {
          if (files.length === 0) return
          useStore.getState().addFiles(files)
          useStore.getState().setPage('convert')
        })
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [setDragging])

  return (
    <div className={`app${isDragging ? ' dragging' : ''}`}>
      <Sidebar />
      <main className="main">
        <div className="page">
          {page === 'home' && <HomePage />}
          {page === 'convert' && <ConvertPage />}
          {page === 'youtube' && <YouTubePage />}
          {page === 'queue' && <QueuePage />}
          {page === 'presets' && <PresetsPage />}
          {page === 'inspector' && <InspectorPage />}
          {page === 'automation' && <AutomationPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'logs' && <LogsPage />}
          {page === 'settings' && <SettingsPage />}
          {page === 'help' && <HelpPage />}
        </div>
      </main>
      <HelpButton />
      <ToastStack />
    </div>
  )
}

/**
 * Always-available help affordance. Pressing it (or F1) opens the manual at
 * the article matching the page you are currently on.
 */
function HelpButton(): React.JSX.Element | null {
  const page = useStore((s) => s.page)
  const openHelp = useStore((s) => s.openHelp)
  const t = useT()

  /** Which help article explains the page the user is currently looking at. */
  const articleFor = (current: PageId): string => {
    const map: Partial<Record<PageId, string>> = {
      home: 'home',
      convert: 'convert',
      youtube: 'youtube',
      queue: 'queue',
      presets: 'presets',
      inspector: 'inspector',
      automation: 'automation',
      history: 'history',
      logs: 'logs',
      settings: 'settings'
    }
    return map[current] ?? 'concepts'
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F1') return
      e.preventDefault()
      const state = useStore.getState()
      state.openHelp(articleFor(state.page))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (page === 'help') return null

  return (
    <button
      className="help-fab"
      onClick={() => openHelp(articleFor(page))}
      title={`${t('help.openHelp')} (F1)`}
      aria-label={t('help.openHelp')}
    >
      <HelpCircle size={19} />
    </button>
  )
}

function ToastStack(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <div style={{ marginTop: 1, flexShrink: 0 }}>
            {toast.kind === 'success' ? (
              <CheckCircle2 size={17} style={{ color: 'var(--success)' }} />
            ) : toast.kind === 'error' ? (
              <AlertTriangle size={17} style={{ color: 'var(--danger)' }} />
            ) : (
              <Info size={17} style={{ color: 'var(--info)' }} />
            )}
          </div>

          <div className="flex-1">
            <div className="toast-title">{toast.title}</div>
            {toast.message && <div className="toast-msg">{toast.message}</div>}
            {toast.actions && (
              <div className="toast-actions">
                {toast.actions.map((action, i) => (
                  <button
                    key={i}
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      action.onClick()
                      dismiss(toast.id)
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="btn-icon" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
