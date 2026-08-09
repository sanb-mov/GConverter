/** Dashboard (spec §7, §43). */

import { useMemo } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  Repeat,
  Sparkles,
  Zap
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { Stat } from '../components/ui'
import { useStore } from '../store/useStore'
import { useLanguage, useT } from '../lib/i18n'
import { formatBytes, formatRelativeDate, greetingKey } from '../lib/format'

export function HomePage(): React.JSX.Element {
  const t = useT()
  const lang = useLanguage()
  const history = useStore((s) => s.history)
  const hardware = useStore((s) => s.hardware)
  const jobs = useStore((s) => s.jobs)
  const setPage = useStore((s) => s.setPage)

  const stats = useMemo(() => {
    const completed = history.filter((h) => h.status === 'completed')
    // Only count conversions that actually shrank; growth is not "saved".
    const saved = completed.reduce((sum, h) => sum + Math.max(0, h.inputSize - h.outputSize), 0)
    const losslessCount = completed.filter(
      (h) => h.mode === 'lossless-remux' || h.mode === 'lossless-encode'
    ).length
    return { total: completed.length, saved, losslessCount }
  }, [history])

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'pending')
  const recent = history.slice(0, 5)
  const hwEncoder = hardware?.encoders.find((e) => e.available)

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <div className="page-title">{t(greetingKey())}</div>
          <div className="page-subtitle">{t('home.subtitle')}</div>
        </div>
        {activeJobs.length > 0 && (
          <button className="btn btn-secondary" onClick={() => setPage('queue')}>
            <Repeat size={15} className="spin" />
            {t('home.inProgress', { count: activeJobs.length })}
          </button>
        )}
      </div>

      <Dropzone />

      <div className="stat-grid mt-24">
        <Stat
          icon={<CheckCircle2 size={12} />}
          label={t('home.statConversions')}
          value={stats.total}
          sub={
            stats.losslessCount > 0
              ? t('home.statLossless', { count: stats.losslessCount })
              : t('home.statConversionsSub')
          }
        />
        <Stat
          icon={<HardDrive size={12} />}
          label={t('home.statSaved')}
          value={formatBytes(stats.saved)}
          sub={t('home.statSavedSub')}
        />
        <Stat
          icon={<Cpu size={12} />}
          label={t('home.statHardware')}
          value={
            hardware
              ? hardware.accelerationAvailable
                ? t('home.statHardwareAvailable')
                : t('nav.cpuOnly')
              : '…'
          }
          sub={hwEncoder?.label ?? hardware?.cpuModel.split(' ').slice(0, 3).join(' ')}
        />
        <Stat
          icon={<Zap size={12} />}
          label={t('home.statSystem')}
          value={hardware ? t('common.threads', { count: hardware.cpuThreads }) : '—'}
          sub={hardware ? t('home.statRam', { size: formatBytes(hardware.totalMemory) }) : ''}
        />
      </div>

      {recent.length > 0 && (
        <div className="mt-32">
          <div className="row-between mb-12">
            <div className="section-title" style={{ margin: 0 }}>
              <Clock size={13} />
              {t('home.recent')}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setPage('history')}>
              {t('home.viewAll')}
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="panel">
            {recent.map((entry) => (
              <div className="job-row" key={entry.id} style={{ gridTemplateColumns: '1fr auto' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="job-title">
                    <span className="job-path">{entry.sourceName}</span>
                    <ArrowRight size={13} className="job-arrow" />
                    <span className="job-target">{entry.formatTo}</span>
                  </div>
                  <div className="job-stats">
                    <span>{formatRelativeDate(entry.timestamp, t, lang)}</span>
                    <span>
                      {formatBytes(entry.inputSize)} → {formatBytes(entry.outputSize)}
                    </span>
                    {(entry.mode === 'lossless-remux' || entry.mode === 'lossless-encode') && (
                      <span style={{ color: 'var(--success)' }}>{t('common.lossless')}</span>
                    )}
                  </div>
                </div>
                <div
                  className="text-xs"
                  style={{
                    color:
                      entry.status === 'completed'
                        ? 'var(--success)'
                        : entry.status === 'failed'
                          ? 'var(--danger)'
                          : 'var(--text-muted)'
                  }}
                >
                  {entry.status === 'completed'
                    ? t('common.completed')
                    : entry.status === 'failed'
                      ? t('common.failed')
                      : t('common.cancelled')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length === 0 && (
        <div className="mt-32">
          <div className="section-title">
            <Sparkles size={13} />
            {t('home.quickStart')}
          </div>
          <div className="preset-grid">
            <QuickCard title={t('home.card1Title')} text={t('home.card1Text')} />
            <QuickCard title={t('home.card2Title')} text={t('home.card2Text')} />
            <QuickCard title={t('home.card3Title')} text={t('home.card3Text')} />
          </div>
        </div>
      )}
    </div>
  )
}

function QuickCard({ title, text }: { title: string; text: string }): React.JSX.Element {
  return (
    <div className="card card-pad card-static">
      <div className="preset-name">{title}</div>
      <div className="preset-desc mt-8">{text}</div>
    </div>
  )
}
