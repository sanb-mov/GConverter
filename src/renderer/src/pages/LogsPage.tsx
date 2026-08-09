/** Session log viewer (spec §29, §55). */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eraser, Terminal } from 'lucide-react'
import type { LogLevel } from '@shared/models'
import { EmptyState } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import { formatTimestamp } from '../lib/format'

const LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error']

export function LogsPage(): React.JSX.Element {
  const t = useT()
  const logs = useStore((s) => s.logs)
  const setLogs = useStore((s) => s.setLogs)
  const pushToast = useStore((s) => s.pushToast)

  const [minLevel, setMinLevel] = useState<LogLevel>('info')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const threshold = LEVELS.indexOf(minLevel)
    const needle = query.trim().toLowerCase()
    return logs.filter((record) => {
      if (LEVELS.indexOf(record.level) < threshold) return false
      if (!needle) return true
      return (
        record.message.toLowerCase().includes(needle) ||
        record.scope.toLowerCase().includes(needle)
      )
    })
  }, [logs, minLevel, query])

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: 'end' })
  }, [visible.length, follow])

  return (
    <div className="page-inner wide" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <div>
          <div className="page-title">{t('logs.title')}</div>
          <div className="page-subtitle">
            {t('logs.subtitle', { count: logs.length })}
          </div>
        </div>
        <div className="row gap-8">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              void api()
                .logs.export()
                .then((saved) => {
                  if (saved) pushToast({ kind: 'success', title: t('logs.exported'), message: saved })
                })
            }
          >
            <Download size={14} />
            {t('logs.export')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void api().logs.clear()
              setLogs([])
            }}
          >
            <Eraser size={14} />
            {t('common.clear')}
          </button>
        </div>
      </div>

      <div className="row gap-10 mb-16">
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder={t('logs.filter')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented">
          {LEVELS.map((level) => (
            <button
              key={level}
              className={`segmented-item${minLevel === level ? ' active' : ''}`}
              onClick={() => setMinLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <label className="row gap-6 text-sm text-muted" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          {t('logs.follow')}
        </label>
      </div>

      <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Terminal size={40} />}
            title={t('logs.emptyTitle')}
            text={t('logs.emptyText')}
          />
        ) : (
          <div className="log-list">
            {visible.map((record, index) => (
              <div className="log-line" key={`${record.timestamp}-${index}`}>
                <span className="log-time">{formatTimestamp(record.timestamp)}</span>
                <span className={`log-level ${record.level}`}>{record.level}</span>
                <span className="log-scope">{record.scope}</span>
                <span className="log-msg">
                  {record.message}
                  {record.data !== undefined && (
                    <span className="text-faint">
                      {' '}
                      {typeof record.data === 'string'
                        ? record.data
                        : JSON.stringify(record.data)}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  )
}
