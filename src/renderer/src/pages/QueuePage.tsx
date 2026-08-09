/** Conversion queue with live progress (spec §14, §16, §30). */

import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eraser,
  FolderOpen,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type { ConversionJob } from '@shared/models'
import { Badge, EmptyState, Modal, Progress, Spinner } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import {
  basename,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed
} from '../lib/format'

export function QueuePage(): React.JSX.Element {
  const t = useT()
  const jobs = useStore((s) => s.jobs)
  const running = useStore((s) => s.queueRunning)
  const paused = useStore((s) => s.queuePaused)
  const setPage = useStore((s) => s.setPage)
  const [errorJob, setErrorJob] = useState<ConversionJob | null>(null)

  const pending = jobs.filter((j) => j.status === 'pending').length
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'analyzing').length
  const done = jobs.filter((j) => j.status === 'completed').length
  const failed = jobs.filter((j) => j.status === 'failed').length

  if (jobs.length === 0) {
    return (
      <div className="page-inner">
        <div className="page-header">
          <div>
            <div className="page-title">{t('nav.queue')}</div>
            <div className="page-subtitle">{t('queue.emptySubtitle')}</div>
          </div>
        </div>
        <EmptyState
          icon={<ListVideo size={40} />}
          title={t('queue.emptyTitle')}
          text={t('queue.emptyText')}
          action={
            <button className="btn btn-primary" onClick={() => setPage('convert')}>
              {t('queue.goToConvert')}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('queue.title')}</div>
          <div className="page-subtitle">
            {active > 0
              ? t('queue.converting', { count: active })
              : running
                ? t('queue.starting')
                : t('queue.idle')}
            {pending > 0 && ` · ${t('queue.waitingCount', { count: pending })}`}
            {done > 0 && ` · ${t('queue.completedCount', { count: done })}`}
            {failed > 0 && ` · ${t('queue.failedCount', { count: failed })}`}
          </div>
        </div>

        <div className="row gap-8">
          {running && !paused ? (
            <button className="btn btn-secondary" onClick={() => void api().queue.pause()}>
              <Pause size={15} />
              {t('common.pause')}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void (paused ? api().queue.resume() : api().queue.start())}
              disabled={pending === 0 && active === 0}
            >
              <Play size={15} />
              {paused ? t('common.resume') : t('common.start')}
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => void api().queue.stop()}
            disabled={!running && active === 0}
          >
            <Square size={14} />
            {t('common.stop')}
          </button>

          <button className="btn btn-ghost" onClick={() => void api().queue.clearFinished()}>
            <Eraser size={15} />
            {t('queue.clearFinished')}
          </button>
        </div>
      </div>

      {paused && (
        <div className="verdict verdict-mixed mb-16">
          <AlertTriangle size={18} style={{ color: 'var(--info)' }} />
          <div>
            <div className="verdict-title">{t('queue.pausedTitle')}</div>
            <div className="verdict-detail">{t('queue.pausedText')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        {jobs.map((job, index) => (
          <JobRow key={job.id} job={job} index={index + 1} onShowError={() => setErrorJob(job)} />
        ))}
      </div>

      {errorJob && (
        <ErrorModal job={errorJob} onClose={() => setErrorJob(null)} />
      )}
    </div>
  )
}

function JobRow({
  job,
  index,
  onShowError
}: {
  job: ConversionJob
  index: number
  onShowError: () => void
}): React.JSX.Element {
  const t = useT()
  const isActive = job.status === 'running' || job.status === 'analyzing'
  const progress = job.progress

  const statusBadge = (): React.JSX.Element => {
    switch (job.status) {
      case 'completed':
        return <Badge tone="success"><CheckCircle2 size={11} /> {t('common.completed')}</Badge>
      case 'failed':
        return <Badge tone="danger">{t('common.failed')}</Badge>
      case 'cancelled':
        return <Badge tone="neutral">{t('common.cancelled')}</Badge>
      case 'running':
        return <Badge tone="accent">{formatPercent(progress.percent)}</Badge>
      case 'analyzing':
        return <Badge tone="info">{t('queue.preparing')}</Badge>
      default:
        return <Badge tone="neutral">{t('common.waiting')}</Badge>
    }
  }

  return (
    <div className="job-row">
      <div className="job-index">{String(index).padStart(2, '0')}</div>

      <div style={{ minWidth: 0 }}>
        <div className="job-title">
          <span className="job-path">{job.source.name}</span>
          <ArrowRight size={13} className="job-arrow" />
          <span className="job-target">{basename(job.outputPath)}</span>
          {job.plan &&
            (job.plan.mode === 'lossless-remux' || job.plan.mode === 'lossless-encode') && (
              <Badge tone="success">{t('common.lossless')}</Badge>
            )}
          {job.profileName && <Badge tone="neutral">{job.profileName}</Badge>}
        </div>

        {isActive && (
          <div className="mt-8">
            <Progress percent={progress.percent} animated />
            <div className="job-stats">
              <span>{formatPercent(progress.percent)}</span>
              {progress.etaMs !== undefined && <span>{t('queue.remaining', { time: formatEta(progress.etaMs) })}</span>}
              {progress.fps !== undefined && <span>{progress.fps.toFixed(1)} fps</span>}
              {progress.speed !== undefined && <span>{formatSpeed(progress.speed)}</span>}
              {progress.totalSize !== undefined && <span>{formatBytes(progress.totalSize)}</span>}
              {progress.estimatedFinalSize !== undefined && (
                <span className="text-faint">{t('queue.finalSize', { size: formatBytes(progress.estimatedFinalSize) })}</span>
              )}
            </div>
          </div>
        )}

        {job.status === 'completed' && job.result && (
          <div className="job-stats">
            <span>
              {formatBytes(job.result.inputSize)} → {formatBytes(job.result.outputSize)}
            </span>
            <span
              style={{
                color: job.result.sizeDeltaPercent <= 0 ? 'var(--success)' : 'var(--warning)'
              }}
            >
              {job.result.sizeDeltaPercent > 0 ? '+' : ''}
              {job.result.sizeDeltaPercent}%
            </span>
            <span>{formatEta(job.result.durationMs)}</span>
            {job.result.averageFps && <span>{t('queue.fpsAvg', { fps: job.result.averageFps.toFixed(1) })}</span>}
          </div>
        )}

        {job.status === 'failed' && job.error && (
          <div className="job-stats" style={{ color: 'var(--danger)' }}>
            <span>{job.error.message}</span>
          </div>
        )}

        {job.status === 'pending' && job.plan?.estimatedDuration && (
          <div className="job-stats">
            <span>{t('queue.estimated', { time: formatEta(job.plan.estimatedDuration) })}</span>
            {job.plan.estimatedSize && <span>~{formatBytes(job.plan.estimatedSize)}</span>}
          </div>
        )}
      </div>

      <div className="job-actions">
        {statusBadge()}

        {job.status === 'completed' && (
          <>
            <button
              className="btn-icon"
              title={t('common.openFile')}
              onClick={() => void api().shell.openPath(job.outputPath)}
            >
              <Play size={15} />
            </button>
            <button
              className="btn-icon"
              title={t('common.showInFolder')}
              onClick={() => void api().shell.revealPath(job.outputPath)}
            >
              <FolderOpen size={15} />
            </button>
          </>
        )}

        {job.status === 'failed' && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={onShowError}>
              {t('common.details')}
            </button>
            <button
              className="btn-icon"
              title={t('common.retry')}
              onClick={() => void api().queue.retry(job.id)}
            >
              <RotateCcw size={15} />
            </button>
          </>
        )}

        {(job.status === 'running' || job.status === 'pending' || job.status === 'analyzing') && (
          <button
            className="btn-icon"
            title={t('common.cancel')}
            onClick={() => void api().queue.cancelJob(job.id)}
          >
            <X size={16} />
          </button>
        )}

        {(job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled') && (
          <button
            className="btn-icon"
            title={t('common.remove')}
            onClick={() => void api().queue.remove(job.id)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

function ErrorModal({
  job,
  onClose
}: {
  job: ConversionJob
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const setPage = useStore((s) => s.setPage)
  const pushToast = useStore((s) => s.pushToast)

  return (
    <Modal
      title={t('queue.failedTitle')}
      onClose={onClose}
      large
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={() => {
              onClose()
              setPage('logs')
            }}
          >
            {t('queue.viewLog')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              void api().shell.copyText(
                [
                  `File: ${job.source.path}`,
                  `Output: ${job.outputPath}`,
                  `Reason: ${job.error?.reason}`,
                  '',
                  job.error?.stderrTail ?? ''
                ].join('\n')
              )
              pushToast({ kind: 'success', title: t('queue.detailsCopied') })
            }}
          >
            {t('queue.copyDetails')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void api().queue.retry(job.id)
              onClose()
            }}
          >
            <RotateCcw size={15} />
            {t('common.retry')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div>
          <div className="section-title">{t('editor.file')}</div>
          <div className="text-sm mono selectable">{job.source.path}</div>
        </div>

        <div className="verdict verdict-encode">
          <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
          <div>
            <div className="verdict-title">{job.error?.message}</div>
            <div className="verdict-detail">{job.error?.reason}</div>
          </div>
        </div>

        {job.error?.suggestion && (
          <div>
            <div className="section-title">{t('queue.suggestedFix')}</div>
            <div className="text-sm">{job.error.suggestion}</div>
          </div>
        )}

        {job.error?.stderrTail && (
          <div>
            <div className="section-title">{t('queue.ffmpegOutput')}</div>
            <div className="code">{job.error.stderrTail}</div>
          </div>
        )}

        {job.command && (
          <div>
            <div className="section-title">{t('queue.commandLabel')}</div>
            <div className="code">{job.command.join(' ')}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}
