/** Conversion history (spec §44). */

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  FolderOpen,
  History as HistoryIcon,
  Play,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { Badge, EmptyState } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useLanguage, useT } from '../lib/i18n'
import { formatBytes, formatEta, formatRelativeDate } from '../lib/format'

export function HistoryPage(): React.JSX.Element {
  const t = useT()
  const lang = useLanguage()
  const history = useStore((s) => s.history)
  const setHistory = useStore((s) => s.setHistory)
  const addFiles = useStore((s) => s.addFiles)
  const setFileSettings = useStore((s) => s.setFileSettings)
  const setPage = useStore((s) => s.setPage)
  const pushToast = useStore((s) => s.pushToast)

  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all')

  const visible = useMemo(
    () => history.filter((h) => filter === 'all' || h.status === filter),
    [history, filter]
  )

  const totals = useMemo(() => {
    const completed = history.filter((h) => h.status === 'completed')
    return {
      count: completed.length,
      saved: completed.reduce((sum, h) => sum + Math.max(0, h.inputSize - h.outputSize), 0)
    }
  }, [history])

  /** Load the source again with the same settings so it can be re-run. */
  const reconvert = async (entry: (typeof history)[number]): Promise<void> => {
    const [file] = await api().media.probeFiles([entry.sourcePath])
    if (!file || file.error) {
      pushToast({
        kind: 'error',
        title: t('history.sourceUnavailable'),
        message: file?.error ?? t('history.sourceMissing')
      })
      return
    }
    addFiles([file])
    if (entry.settings) setFileSettings(file.id, entry.settings)
    useStore.getState().selectFile(file.id)
    setPage('convert')
  }

  if (history.length === 0) {
    return (
      <div className="page-inner">
        <div className="page-header">
          <div>
            <div className="page-title">{t('history.title')}</div>
            <div className="page-subtitle">{t('history.emptySubtitle')}</div>
          </div>
        </div>
        <EmptyState
          icon={<HistoryIcon size={40} />}
          title={t('history.emptyTitle')}
          text={t('history.emptyText')}
        />
      </div>
    )
  }

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('history.title')}</div>
          <div className="page-subtitle">
            {t('history.summary', { count: totals.count, size: formatBytes(totals.saved) })}
          </div>
        </div>
        <div className="row gap-8">
          {(['all', 'completed', 'failed'] as const).map((key) => (
            <button
              key={key}
              className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(key)}
            >
              {key === 'all' ? t('common.all') : key === 'completed' ? t('common.completed') : t('common.failed')}
            </button>
          ))}
          <button
            className="btn btn-sm btn-danger"
            onClick={() => void api().history.clear().then(setHistory)}
          >
            <Trash2 size={14} />
            {t('common.clear')}
          </button>
        </div>
      </div>

      <div className="panel">
        {visible.map((entry) => (
          <div className="job-row" key={entry.id}>
            <div className="job-index">
              <Badge
                tone={
                  entry.status === 'completed'
                    ? 'success'
                    : entry.status === 'failed'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {entry.formatTo}
              </Badge>
            </div>

            <div style={{ minWidth: 0 }}>
              <div className="job-title">
                <span className="job-path">{entry.sourceName}</span>
                <ArrowRight size={13} className="job-arrow" />
                <span className="job-target">{entry.outputName}</span>
                {(entry.mode === 'lossless-remux' || entry.mode === 'lossless-encode') && (
                  <Badge tone="success">{t('common.lossless')}</Badge>
                )}
                {entry.profileName && <Badge tone="neutral">{entry.profileName}</Badge>}
              </div>
              <div className="job-stats">
                <span>{formatRelativeDate(entry.timestamp, t, lang)}</span>
                {entry.status === 'completed' && (
                  <>
                    <span>
                      {formatBytes(entry.inputSize)} → {formatBytes(entry.outputSize)}
                    </span>
                    <span
                      style={{
                        color:
                          entry.outputSize <= entry.inputSize
                            ? 'var(--success)'
                            : 'var(--warning)'
                      }}
                    >
                      {entry.inputSize > 0
                        ? `${entry.outputSize > entry.inputSize ? '+' : ''}${Math.round(
                            ((entry.outputSize - entry.inputSize) / entry.inputSize) * 100
                          )}%`
                        : '—'}
                    </span>
                    <span>{formatEta(entry.durationMs)}</span>
                  </>
                )}
                {entry.status === 'failed' && (
                  <span style={{ color: 'var(--danger)' }}>{entry.error}</span>
                )}
              </div>
            </div>

            <div className="job-actions">
              {entry.status === 'completed' && (
                <>
                  <button
                    className="btn-icon"
                    title={t('common.openFile')}
                    onClick={() => void api().shell.openPath(entry.outputPath)}
                  >
                    <Play size={15} />
                  </button>
                  <button
                    className="btn-icon"
                    title={t('common.showInFolder')}
                    onClick={() => void api().shell.revealPath(entry.outputPath)}
                  >
                    <FolderOpen size={15} />
                  </button>
                </>
              )}
              <button
                className="btn-icon"
                title={t('history.convertAgain')}
                onClick={() => void reconvert(entry)}
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="btn-icon"
                title={t('history.removeEntry')}
                onClick={() => void api().history.remove(entry.id).then(setHistory)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
