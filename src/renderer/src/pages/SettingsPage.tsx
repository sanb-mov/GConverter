/** Settings and the System panel (spec §13, §33). */

import { useState } from 'react'
import {
  Check,
  Cpu,
  FolderOpen,
  HardDrive,
  Monitor,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  Sliders,
  X
} from 'lucide-react'
import type { AppSettings, ThemeName } from '@shared/models'
import { CONTAINERS } from '@shared/formats'
import { Badge, Field, PropTable, Select, Spinner, Toggle } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import { LANGUAGES } from '@shared/i18n'
import { formatBytes } from '../lib/format'

type Tab = 'general' | 'performance' | 'conversion' | 'advanced' | 'system'

export function SettingsPage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const hardware = useStore((s) => s.hardware)
  const setSystem = useStore((s) => s.setSystem)
  const appInfo = useStore((s) => s.appInfo)
  const pushToast = useStore((s) => s.pushToast)

  const [tab, setTab] = useState<Tab>('general')
  const [refreshing, setRefreshing] = useState(false)

  if (!settings) {
    return (
      <div className="page-inner">
        <Spinner size={22} />
      </div>
    )
  }

  const update = (mutate: (draft: AppSettings) => void): void => {
    const next = structuredClone(settings)
    mutate(next)
    setSettings(next)
    void api().settings.set(next)
  }

  const refreshSystem = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const result = await api().system.refresh()
      setSystem(result.ffmpeg, result.hardware)
      pushToast({
        kind: result.ffmpeg.available ? 'success' : 'error',
        title: result.ffmpeg.available
          ? t('settings.redetected')
          : t('settings.redetectFailed'),
        message: result.ffmpeg.available
          ? t('settings.redetectOk', {
              version: result.ffmpeg.version ?? '',
              count: result.hardware.encoders.filter((e) => e.available).length
            })
          : result.ffmpeg.error
      })
    } finally {
      setRefreshing(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: React.JSX.Element }[] = [
    { id: 'general', label: t('settings.tabGeneral'), icon: <Settings2 size={15} /> },
    { id: 'performance', label: t('settings.tabPerformance'), icon: <Cpu size={15} /> },
    { id: 'conversion', label: t('settings.tabConversion'), icon: <Sliders size={15} /> },
    { id: 'advanced', label: t('settings.tabAdvanced'), icon: <Server size={15} /> },
    { id: 'system', label: t('settings.tabSystem'), icon: <Monitor size={15} /> }
  ]

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <div className="page-title">{t('settings.title')}</div>
          <div className="page-subtitle">
            GConverter {appInfo?.version} · Electron {appInfo?.electron}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void api()
              .settings.reset()
              .then((next) => {
                setSettings(next)
                pushToast({ kind: 'success', title: t('settings.restored') })
              })
          }
        >
          <RotateCcw size={14} />
          {t('common.reset')}
        </button>
      </div>

      <div className="row gap-6 mb-20" style={{ flexWrap: 'wrap' }}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`btn btn-sm ${tab === entry.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      {/* ------------------------------ General ---------------------------- */}
      {tab === 'general' && (
        <div className="panel">
          <div className="panel-body col gap-16">
            <div className="field-row">
              <Field label={t('settings.theme')}>
                <Select
                  value={settings.general.theme}
                  onChange={(value) => {
                    update((d) => { d.general.theme = value as ThemeName })
                    document.documentElement.setAttribute('data-theme', value)
                  }}
                  options={[
                    { value: 'dark', label: t('settings.themeDark') },
                    { value: 'midnight', label: t('settings.themeMidnight') },
                    { value: 'light', label: t('settings.themeLight') }
                  ]}
                />
              </Field>

              <Field label={t('settings.language')}>
                <Select
                  value={settings.general.language}
                  onChange={(value) =>
                    update((d) => { d.general.language = value as 'en' | 'es' })
                  }
                  options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                />
              </Field>
            </div>

            <div className="divider" />

            <Toggle
              title={t('settings.useSourceFolder')}
              description={t('settings.useSourceFolderHint')}
              checked={settings.general.useSourceFolder}
              onChange={(value) => update((d) => { d.general.useSourceFolder = value })}
            />

            {!settings.general.useSourceFolder && (
              <Field label={t('settings.defaultOutput')}>
                <div className="row gap-8">
                  <input
                    className="input mono"
                    style={{ fontSize: 12 }}
                    value={settings.general.defaultOutputFolder}
                    readOnly
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      void api()
                        .media.pickFolder()
                        .then((folder) => {
                          if (folder) update((d) => { d.general.defaultOutputFolder = folder })
                        })
                    }
                  >
                    <FolderOpen size={15} />
                    {t('common.browse')}
                  </button>
                </div>
              </Field>
            )}

            <div className="field-row">
              <Field label={t('settings.outputNaming')}>
                <Select
                  value={settings.general.outputNaming}
                  onChange={(value) =>
                    update((d) => {
                      d.general.outputNaming = value as typeof d.general.outputNaming
                    })
                  }
                  options={[
                    { value: 'suffix', label: t('settings.namingSuffix') },
                    { value: 'same', label: t('settings.namingSame') },
                    { value: 'folder', label: t('settings.namingFolder') }
                  ]}
                />
              </Field>

              <Field label={t('settings.suffix')}>
                <input
                  className="input"
                  value={settings.general.outputSuffix}
                  disabled={settings.general.outputNaming !== 'suffix'}
                  onChange={(e) => update((d) => { d.general.outputSuffix = e.target.value })}
                />
              </Field>
            </div>

            <div className="divider" />

            <Toggle
              title={t('settings.notifications')}
              description={t('settings.notificationsHint')}
              checked={settings.general.notifications}
              onChange={(value) => update((d) => { d.general.notifications = value })}
            />

            <Field
              label={t('settings.cleanup', { days: settings.general.autoCleanupDays })}
              hint={t('settings.cleanupHint')}
            >
              <input
                type="range"
                className="range"
                min={0}
                max={30}
                value={settings.general.autoCleanupDays}
                onChange={(e) =>
                  update((d) => { d.general.autoCleanupDays = Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </div>
      )}

      {/* ---------------------------- Performance -------------------------- */}
      {tab === 'performance' && (
        <div className="panel">
          <div className="panel-body col gap-16">
            <Field
              label={t('settings.cpuThreads', {
                value:
                  settings.performance.cpuThreads === 0
                    ? t('common.auto')
                    : settings.performance.cpuThreads
              })}
              hint={t('settings.cpuThreadsHint', { count: hardware?.cpuThreads ?? '?' })}
            >
              <input
                type="range"
                className="range"
                min={0}
                max={hardware?.cpuThreads ?? 16}
                value={settings.performance.cpuThreads}
                onChange={(e) =>
                  update((d) => { d.performance.cpuThreads = Number(e.target.value) })
                }
              />
            </Field>

            <Field
              label={t('settings.concurrent', { value: settings.performance.maxConcurrentJobs })}
              hint={t('settings.concurrentHint')}
            >
              <input
                type="range"
                className="range"
                min={1}
                max={6}
                value={settings.performance.maxConcurrentJobs}
                onChange={(e) =>
                  update((d) => { d.performance.maxConcurrentJobs = Number(e.target.value) })
                }
              />
            </Field>

            <div className="divider" />

            <Toggle
              title={t('settings.hwAccel')}
              description={
                hardware?.accelerationAvailable
                  ? t('settings.hwDetected', {
                      list: hardware.encoders
                        .filter((e) => e.available)
                        .map((e) => e.label)
                        .join(', ')
                    })
                  : t('settings.hwNone')
              }
              disabled={!hardware?.accelerationAvailable}
              checked={settings.performance.hardwareAcceleration}
              onChange={(value) =>
                update((d) => { d.performance.hardwareAcceleration = value })
              }
            />

            <Field label={t('settings.preferredEncoder')}>
              <Select
                value={settings.performance.hardwarePreference}
                disabled={!settings.performance.hardwareAcceleration}
                onChange={(value) =>
                  update((d) => {
                    d.performance.hardwarePreference = value as typeof d.performance.hardwarePreference
                  })
                }
                options={[
                  { value: 'auto', label: t('settings.encoderAuto') },
                  { value: 'cpu', label: t('settings.encoderCpuOnly') },
                  {
                    value: 'nvidia',
                    label: 'NVIDIA NVENC',
                    disabled: !hardware?.encoders.some((e) => e.vendor === 'nvidia' && e.available)
                  },
                  {
                    value: 'amd',
                    label: 'AMD AMF',
                    disabled: !hardware?.encoders.some((e) => e.vendor === 'amd' && e.available)
                  },
                  {
                    value: 'intel',
                    label: 'Intel Quick Sync',
                    disabled: !hardware?.encoders.some((e) => e.vendor === 'intel' && e.available)
                  },
                  {
                    value: 'apple',
                    label: 'Apple VideoToolbox',
                    disabled: !hardware?.encoders.some((e) => e.vendor === 'apple' && e.available)
                  }
                ]}
              />
            </Field>

            <Toggle
              title={t('settings.lowPriority')}
              description={t('settings.lowPriorityHint')}
              checked={settings.performance.lowPriority}
              onChange={(value) => update((d) => { d.performance.lowPriority = value })}
            />
          </div>
        </div>
      )}

      {/* ---------------------------- Conversion --------------------------- */}
      {tab === 'conversion' && (
        <div className="panel">
          <div className="panel-body col gap-16">
            <div className="field-row">
              <Field label={t('settings.defaultVideoFormat')}>
                <Select
                  value={settings.conversion.defaultVideoFormat}
                  onChange={(value) =>
                    update((d) => { d.conversion.defaultVideoFormat = value })
                  }
                  options={CONTAINERS.filter((c) => c.kind === 'video').map((c) => ({
                    value: c.id,
                    label: c.label
                  }))}
                />
              </Field>

              <Field label={t('settings.defaultAudioFormat')}>
                <Select
                  value={settings.conversion.defaultAudioFormat}
                  onChange={(value) =>
                    update((d) => { d.conversion.defaultAudioFormat = value })
                  }
                  options={CONTAINERS.filter((c) => c.kind === 'audio').map((c) => ({
                    value: c.id,
                    label: c.label
                  }))}
                />
              </Field>
            </div>

            <Field label={t('settings.defaultQuality')}>
              <Select
                value={settings.conversion.defaultQuality}
                onChange={(value) =>
                  update((d) => {
                    d.conversion.defaultQuality = value as typeof d.conversion.defaultQuality
                  })
                }
                options={[
                  { value: 'lossless', label: t('editor.qualityLossless') },
                  { value: 'maximum', label: t('editor.qualityMaximum') },
                  { value: 'very-high', label: t('editor.qualityVeryHigh') },
                  { value: 'high', label: t('editor.qualityHigh') },
                  { value: 'balanced', label: t('editor.qualityBalanced') }
                ]}
              />
            </Field>

            <div className="divider" />

            <Toggle
              title={t('settings.preferLossless')}
              description={t('settings.preferLosslessHint')}
              checked={settings.conversion.preferLossless}
              onChange={(value) => update((d) => { d.conversion.preferLossless = value })}
            />
            <Toggle
              title={t('settings.preserveMetadata')}
              checked={settings.conversion.preserveMetadata}
              onChange={(value) => update((d) => { d.conversion.preserveMetadata = value })}
            />
            <Toggle
              title={t('settings.preserveSubtitles')}
              checked={settings.conversion.preserveSubtitles}
              onChange={(value) => update((d) => { d.conversion.preserveSubtitles = value })}
            />
            <Toggle
              title={t('settings.preserveChapters')}
              checked={settings.conversion.preserveChapters}
              onChange={(value) => update((d) => { d.conversion.preserveChapters = value })}
            />

            <Field label={t('settings.overwrite')}>
              <Select
                value={settings.conversion.overwritePolicy}
                onChange={(value) =>
                  update((d) => {
                    d.conversion.overwritePolicy = value as typeof d.conversion.overwritePolicy
                  })
                }
                options={[
                  { value: 'rename', label: t('settings.overwriteRename') },
                  { value: 'overwrite', label: t('settings.overwriteReplace') }
                ]}
              />
            </Field>
          </div>
        </div>
      )}

      {/* ----------------------------- Advanced ---------------------------- */}
      {tab === 'advanced' && (
        <div className="panel">
          <div className="panel-body col gap-16">
            <Field
              label={t('settings.ffmpegPath')}
              hint={t('settings.ffmpegPathHint')}
            >
              <div className="row gap-8">
                <input
                  className="input mono"
                  style={{ fontSize: 12 }}
                  placeholder={ffmpeg?.ffmpegPath ?? 'auto'}
                  value={settings.advanced.ffmpegPath}
                  onChange={(e) => update((d) => { d.advanced.ffmpegPath = e.target.value })}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void api()
                      .system.pickBinary('ffmpeg')
                      .then((path) => {
                        if (path) update((d) => { d.advanced.ffmpegPath = path })
                      })
                  }
                >
                  Browse
                </button>
              </div>
            </Field>

            <Field label={t('settings.ffprobePath')}>
              <div className="row gap-8">
                <input
                  className="input mono"
                  style={{ fontSize: 12 }}
                  placeholder={ffmpeg?.ffprobePath ?? 'auto'}
                  value={settings.advanced.ffprobePath}
                  onChange={(e) => update((d) => { d.advanced.ffprobePath = e.target.value })}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void api()
                      .system.pickBinary('ffprobe')
                      .then((path) => {
                        if (path) update((d) => { d.advanced.ffprobePath = path })
                      })
                  }
                >
                  Browse
                </button>
              </div>
            </Field>

            <button className="btn btn-secondary" onClick={() => void refreshSystem()}>
              {refreshing ? <Spinner size={15} /> : <RefreshCw size={15} />}
              {t('settings.redetect')}
            </button>

            <div className="divider" />

            <Field label={t('settings.logLevel')}>
              <Select
                value={settings.advanced.logLevel}
                onChange={(value) =>
                  update((d) => {
                    d.advanced.logLevel = value as typeof d.advanced.logLevel
                  })
                }
                options={[
                  { value: 'debug', label: t('settings.logDebug') },
                  { value: 'info', label: t('settings.logInfo') },
                  { value: 'warning', label: t('settings.logWarning') },
                  { value: 'error', label: t('settings.logError') }
                ]}
              />
            </Field>

            <Field label={t('settings.keepLogs', { days: settings.advanced.keepLogDays })}>
              <input
                type="range"
                className="range"
                min={1}
                max={90}
                value={settings.advanced.keepLogDays}
                onChange={(e) =>
                  update((d) => { d.advanced.keepLogDays = Number(e.target.value) })
                }
              />
            </Field>

            {appInfo && (
              <>
                <div className="divider" />
                <div className="section-title">{t('settings.appFolders')}</div>
                <PropTable
                  rows={[
                    [t('settings.folderData'), <span className="mono text-xs selectable">{appInfo.directories.root}</span>],
                    [t('settings.folderTemp'), <span className="mono text-xs selectable">{appInfo.directories.temp}</span>],
                    [t('settings.folderLogs'), <span className="mono text-xs selectable">{appInfo.directories.logs}</span>]
                  ]}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void api().shell.openPath(appInfo.directories.root)}
                >
                  <FolderOpen size={14} />
                  {t('settings.openDataFolder')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------ System ----------------------------- */}
      {tab === 'system' && (
        <div className="col gap-16">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Server size={15} />
                {t('settings.engine')}
              </div>
              {ffmpeg?.available ? (
                <Badge tone="success">{t('settings.engineReady')}</Badge>
              ) : (
                <Badge tone="danger">{t('settings.engineNotAvailable')}</Badge>
              )}
            </div>
            <div className="panel-body">
              {ffmpeg ? (
                <PropTable
                  rows={[
                    [t('settings.version'), ffmpeg.version ?? '—'],
                    [
                      t('settings.sourceLabel'),
                      ffmpeg.source === 'bundled'
                        ? t('settings.sourceBundled')
                        : ffmpeg.source === 'system'
                          ? t('settings.sourceSystem')
                          : ffmpeg.source === 'custom'
                            ? t('settings.sourceCustom')
                            : t('settings.sourceMissing')
                    ],
                    ['FFmpeg', <span className="mono text-xs selectable">{ffmpeg.ffmpegPath || '—'}</span>],
                    ['FFprobe', <span className="mono text-xs selectable">{ffmpeg.ffprobePath || '—'}</span>],
                    [t('editor.encoder'), t('settings.encodersCount', { count: ffmpeg.encoders.length })],
                    ['Muxers', t('settings.muxersCount', { count: ffmpeg.muxers.length })],
                    [t('settings.hwApis'), ffmpeg.hwaccels.join(', ') || t('common.none')]
                  ]}
                />
              ) : (
                <Spinner />
              )}
              {ffmpeg?.error && (
                <div className="verdict verdict-encode mt-16">
                  <div>
                    <div className="verdict-title">{t('settings.ffmpegUnavailable')}</div>
                    <div className="verdict-detail">{ffmpeg.error}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Cpu size={15} />
                {t('settings.hardware')}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => void refreshSystem()}>
                {refreshing ? <Spinner size={13} /> : <RefreshCw size={13} />}
                {t('common.reset')}
              </button>
            </div>
            <div className="panel-body">
              {hardware ? (
                <>
                  <PropTable
                    rows={[
                      [t('settings.cpu'), hardware.cpuModel],
                      [t('settings.coresThreads'), `\${hardware.cpuCores} / \${hardware.cpuThreads}`],
                      [
                        t('settings.memory'),
                        t('settings.memoryValue', {
                          total: formatBytes(hardware.totalMemory),
                          free: formatBytes(hardware.freeMemory)
                        })
                      ],
                      [t('settings.platform'), `\${hardware.platform} \${hardware.arch}`],
                      ...hardware.gpus.map(
                        (gpu, i): [string, React.ReactNode] => [
                          `\${t('settings.gpu')} \${hardware.gpus.length > 1 ? i + 1 : ''}`.trim(),
                          <span>
                            {gpu.name}
                            {gpu.vram ? ` · ${formatBytes(gpu.vram)} VRAM` : ''}
                          </span>
                        ]
                      )
                    ]}
                  />

                  <div className="divider" />
                  <div className="section-title">
                    <HardDrive size={13} />
                    {t('settings.hwEncoders')}
                  </div>

                  {hardware.encoders.length === 0 ? (
                    <div className="text-sm text-muted">
                      {t('settings.noHwEncoders')}
                    </div>
                  ) : (
                    hardware.encoders.map((encoder) => (
                      <div className="stream-row" key={encoder.name}>
                        <div
                          className="stream-icon"
                          style={{
                            background: encoder.available
                              ? 'var(--success-soft)'
                              : 'var(--bg-overlay)',
                            color: encoder.available ? 'var(--success)' : 'var(--text-faint)'
                          }}
                        >
                          {encoder.available ? <Check size={14} /> : <X size={14} />}
                        </div>
                        <div className="stream-main">
                          <div className="stream-title">{encoder.label}</div>
                          <div className="stream-detail mono">{encoder.name}</div>
                        </div>
                        <div className="stream-action">
                          {encoder.available ? (
                            <Badge tone="success">{t('settings.verified')}</Badge>
                          ) : encoder.verified ? (
                            <Badge tone="danger">{t('settings.testFailed')}</Badge>
                          ) : (
                            <Badge tone="neutral">{t('settings.noMatchingGpu')}</Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}

                  <div className="field-hint mt-16">
                    {t('settings.verifyNote')}
                  </div>
                </>
              ) : (
                <div className="row gap-10">
                  <Spinner />
                  <span className="text-muted">{t('settings.detecting')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
