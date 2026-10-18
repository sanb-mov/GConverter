import {
  Home,
  Repeat,
  ListVideo,
  Sparkles,
  Search,
  Zap,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Terminal,
  Cpu,
  HelpCircle,
  MonitorPlay
} from 'lucide-react'
import { Logo } from './Logo'
import { useStore, type PageId } from '../store/useStore'
import { useT } from '../lib/i18n'

interface NavEntry {
  id: PageId
  labelKey: string
  icon: React.JSX.Element
  sectionKey?: string
}

const NAV: NavEntry[] = [
  { id: 'home', labelKey: 'nav.home', icon: <Home size={17} /> },
  { id: 'convert', labelKey: 'nav.convert', icon: <Repeat size={17} /> },
  { id: 'youtube', labelKey: 'nav.youtube', icon: <MonitorPlay size={17} /> },
  { id: 'queue', labelKey: 'nav.queue', icon: <ListVideo size={17} /> },
  {
    id: 'presets',
    labelKey: 'nav.presets',
    icon: <Sparkles size={17} />,
    sectionKey: 'nav.sectionLibrary'
  },
  { id: 'inspector', labelKey: 'nav.inspector', icon: <Search size={17} /> },
  { id: 'automation', labelKey: 'nav.automation', icon: <Zap size={17} /> },
  {
    id: 'history',
    labelKey: 'nav.history',
    icon: <HistoryIcon size={17} />,
    sectionKey: 'nav.sectionActivity'
  },
  { id: 'logs', labelKey: 'nav.logs', icon: <Terminal size={17} /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <SettingsIcon size={17} /> },
  { id: 'help', labelKey: 'nav.help', icon: <HelpCircle size={17} /> }
]

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const jobs = useStore((s) => s.jobs)
  const files = useStore((s) => s.files)
  const downloads = useStore((s) => s.downloads)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const hardware = useStore((s) => s.hardware)

  const activeJobs = jobs.filter(
    (j) => j.status === 'pending' || j.status === 'running' || j.status === 'analyzing'
  ).length

  const activeDownloads = downloads.filter(
    (d) => d.status === 'queued' || d.status === 'downloading' || d.status === 'processing'
  ).length

  const badgeFor = (id: PageId): number => {
    if (id === 'queue') return activeJobs
    if (id === 'youtube') return activeDownloads
    if (id === 'convert') return files.length
    return 0
  }

  const engineState = !ffmpeg ? 'pending' : ffmpeg.available ? 'ok' : 'error'

  const hwLabel = hardware?.accelerationAvailable
    ? (hardware.encoders.find((e) => e.available)?.label.split(' ')[0] ?? 'GPU')
    : t('nav.cpuOnly')

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={32} />
        <div className="brand-text">
          <div className="brand-name">GConverter</div>
          <div className="brand-tagline">{t('nav.tagline')}</div>
        </div>
      </div>

      <nav className="col gap-2">
        {NAV.map((entry) => (
          <div key={entry.id}>
            {entry.sectionKey && <div className="nav-section">{t(entry.sectionKey)}</div>}
            <button
              className={`nav-item${page === entry.id ? ' active' : ''}`}
              onClick={() => setPage(entry.id)}
            >
              {entry.icon}
              <span>{t(entry.labelKey)}</span>
              {badgeFor(entry.id) > 0 && (
                <span className={`nav-badge${entry.id === 'convert' ? ' muted' : ''}`}>
                  {badgeFor(entry.id)}
                </span>
              )}
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="engine-chip" onClick={() => setPage('settings')}>
          <span
            className={`engine-dot${engineState === 'error' ? ' error' : engineState === 'pending' ? ' pending' : ''}`}
          />
          <span className="flex-1" style={{ minWidth: 0 }}>
            <span className="engine-label" style={{ display: 'block' }}>
              {engineState === 'ok'
                ? t('nav.engineReady')
                : engineState === 'pending'
                  ? t('nav.engineStarting')
                  : t('nav.engineMissing')}
            </span>
            <span className="engine-sub truncate" style={{ display: 'block' }}>
              {ffmpeg?.available
                ? `FFmpeg ${ffmpeg.version?.split('-')[0] ?? ''}`
                : t('nav.engineFix')}
            </span>
          </span>
          <Cpu size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        </button>
        {hardware && (
          <div
            className="text-xs text-faint"
            style={{ padding: '7px 10px 0', display: 'flex', justifyContent: 'space-between' }}
          >
            <span>{hwLabel}</span>
            <span>{t('common.threads', { count: hardware.cpuThreads })}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
