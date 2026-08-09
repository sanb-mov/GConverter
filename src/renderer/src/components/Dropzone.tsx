import { useCallback, useState } from 'react'
import { FolderOpen, Plus, UploadCloud } from 'lucide-react'
import type { MediaFile } from '@shared/models'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import { Spinner } from './ui'

/**
 * The primary entry point for files (spec §5).
 * Accepts dropped files and folders, a file picker, and a folder picker.
 */
export function Dropzone({ compact }: { compact?: boolean }): React.JSX.Element {
  const t = useT()
  const [over, setOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const addFiles = useStore((s) => s.addFiles)
  const pushToast = useStore((s) => s.pushToast)
  const setPage = useStore((s) => s.setPage)

  const ingest = useCallback(
    async (task: Promise<MediaFile[]>) => {
      setLoading(true)
      try {
        const files = await task
        if (files.length === 0) return

        const broken = files.filter((f) => f.error)
        const good = files.filter((f) => !f.error)

        addFiles(files)
        if (good.length > 0) setPage('convert')

        if (broken.length > 0) {
          pushToast({
            kind: 'error',
            title: t('drop.errorTitle', { count: broken.length }),
            message: broken
              .slice(0, 3)
              .map((f) => `${f.name}: ${f.error}`)
              .join('\n')
          })
        }
      } catch (err) {
        pushToast({
          kind: 'error',
          title: t('drop.addFailed'),
          message: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setLoading(false)
      }
    },
    [addFiles, pushToast, setPage, t]
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setOver(false)

      // Electron 32+ : File.path is gone, the preload bridge resolves paths.
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.gconverterDrop.getPathForFile(file))
        .filter(Boolean)

      if (paths.length === 0) return
      void ingest(api().media.resolveDropped(paths))
    },
    [ingest]
  )

  return (
    <div
      className={`dropzone${over ? ' active' : ''}`}
      style={compact ? { padding: '30px 24px' } : undefined}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => void ingest(api().media.pickFiles())}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void ingest(api().media.pickFiles())
      }}
    >
      <div className="dropzone-icon" style={compact ? { width: 46, height: 46 } : undefined}>
        {loading ? <Spinner size={26} /> : <UploadCloud size={compact ? 22 : 28} />}
      </div>

      <div className="dropzone-title">{loading ? t('drop.titleLoading') : t('drop.title')}</div>
      <div className="dropzone-hint">{loading ? t('drop.hintLoading') : t('drop.hint')}</div>

      {!compact && (
        <div className="row gap-10 mt-20" style={{ justifyContent: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation()
              void ingest(api().media.pickFiles())
            }}
          >
            <Plus size={16} />
            {t('drop.addFiles')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={(e) => {
              e.stopPropagation()
              void (async () => {
                const folder = await api().media.pickFolder()
                if (folder) await ingest(api().media.scanFolder(folder, true))
              })()
            }}
          >
            <FolderOpen size={16} />
            {t('drop.addFolder')}
          </button>
        </div>
      )}

      {!compact && (
        <div className="dropzone-formats">{t('drop.formats')}</div>
      )}
    </div>
  )
}
