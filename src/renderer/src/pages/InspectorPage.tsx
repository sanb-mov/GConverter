/** Media Inspector — a standalone deep-analysis tool (spec §51). */

import { useState } from 'react'
import {
  Copy,
  FileJson,
  FileText,
  Film,
  Music,
  Paperclip,
  Search,
  Subtitles
} from 'lucide-react'
import type { AudioStream, MediaFile, SubtitleStream, VideoStream } from '@shared/models'
import { Badge, EmptyState, PropTable, Spinner } from '../components/ui'
import { Player } from '../components/Player'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import {
  formatBitrate,
  formatBytes,
  formatChannels,
  formatDuration,
  formatFps,
  formatResolution,
  formatSampleRate,
  resolutionName
} from '../lib/format'

export function InspectorPage(): React.JSX.Element {
  const t = useT()
  const files = useStore((s) => s.files)
  const pushToast = useStore((s) => s.pushToast)
  const addFiles = useStore((s) => s.addFiles)

  const [target, setTarget] = useState<MediaFile | null>(files[0] ?? null)
  const [over, setOver] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    setLoading(true)
    try {
      const probed = await api().media.resolveDropped(paths)
      if (probed[0]) {
        setTarget(probed[0])
        addFiles(probed)
      }
    } finally {
      setLoading(false)
    }
  }

  const exportAs = async (kind: 'json' | 'txt'): Promise<void> => {
    if (!target) return
    const contents =
      kind === 'json'
        ? JSON.stringify(await api().media.probeRaw(target.path), null, 2)
        : toPlainText(target)
    const saved = await api().shell.saveTextFile(
      `${target.name.replace(/\.[^.]+$/, '')}-info.${kind}`,
      contents
    )
    if (saved) pushToast({ kind: 'success', title: t('inspector.exported'), message: saved })
  }

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('inspector.title')}</div>
          <div className="page-subtitle">{t('inspector.subtitle')}</div>
        </div>
        {target && (
          <div className="row gap-8">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void api().shell.copyText(toPlainText(target))
                pushToast({ kind: 'success', title: t('inspector.copied') })
              }}
            >
              <Copy size={14} />
              {t('common.copy')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => void exportAs('json')}>
              <FileJson size={14} />
              {t('inspector.exportJson')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => void exportAs('txt')}>
              <FileText size={14} />
              {t('inspector.exportTxt')}
            </button>
          </div>
        )}
      </div>

      <div
        className={`dropzone${over ? ' active' : ''}`}
        style={{ padding: '22px' }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const paths = Array.from(e.dataTransfer.files)
            .map((f) => window.gconverterDrop.getPathForFile(f))
            .filter(Boolean)
          void load(paths)
        }}
        onClick={() => void api().media.pickFiles().then((f) => {
          if (f[0]) {
            setTarget(f[0])
            addFiles(f)
          }
        })}
      >
        <div className="row gap-12" style={{ justifyContent: 'center' }}>
          {loading ? <Spinner size={18} /> : <Search size={18} style={{ color: 'var(--accent)' }} />}
          <span className="text-sm">
            {loading ? t('inspector.analysing') : t('inspector.dropHere')}
          </span>
        </div>
      </div>

      {files.length > 1 && (
        <div className="row gap-8 mt-16" style={{ flexWrap: 'wrap' }}>
          {files.map((file) => (
            <button
              key={file.id}
              className={`btn btn-sm ${target?.id === file.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTarget(file)}
            >
              {file.name}
            </button>
          ))}
        </div>
      )}

      {!target ? (
        <div className="mt-24">
          <EmptyState
            icon={<Search size={40} />}
            title={t('inspector.noFile')}
            text={t('inspector.noFileText')}
          />
        </div>
      ) : (
        <InspectorReport file={target} />
      )}
    </div>
  )
}

function InspectorReport({ file }: { file: MediaFile }): React.JSX.Element {
  const t = useT()
  const video = file.streams.filter((s): s is VideoStream => s.kind === 'video')
  const audio = file.streams.filter((s): s is AudioStream => s.kind === 'audio')
  const subtitles = file.streams.filter((s): s is SubtitleStream => s.kind === 'subtitle')
  const others = file.streams.filter((s) => s.kind === 'attachment' || s.kind === 'data')

  if (file.error) {
    return (
      <div className="verdict verdict-encode mt-20">
        <div>
          <div className="verdict-title">{t('inspector.analyseFailed')}</div>
          <div className="verdict-detail">{file.error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="split mt-20">
      <div className="col gap-16">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">{t('inspector.container')}</div>
            <Badge tone="neutral">{file.extension.toUpperCase()}</Badge>
          </div>
          <div className="panel-body">
            <PropTable
              rows={[
                [t('inspector.fFile'), <span className="mono selectable">{file.name}</span>],
                [t('inspector.fLocation'), <span className="mono selectable text-xs">{file.directory}</span>],
                [t('inspector.fFormat'), file.formatLongName ?? file.formatName],
                [t('inspector.fFormatName'), <span className="mono">{file.formatName}</span>],
                [t('inspector.fSize'), formatBytes(file.size)],
                [t('inspector.fDuration'), `${formatDuration(file.duration)}  (${file.duration.toFixed(3)} s)`],
                [t('inspector.fBitrate'), formatBitrate(file.bitrate)],
                [t('inspector.fStreams'), String(file.streams.length)],
                [t('inspector.fChapters'), String(file.chapters.length)]
              ]}
            />
          </div>
        </div>

        {video.map((stream) => (
          <StreamPanel
            key={stream.index}
            icon={<Film size={15} />}
            title={t('inspector.streamVideo', { index: stream.index })}
            badge={stream.isHDR ? (stream.hdrFormat ?? 'HDR') : undefined}
            rows={[
              [t('inspector.fCodec'), `${stream.codecLongName ?? stream.codec} (${stream.codec})`],
              [t('inspector.fProfile'), [stream.profile, stream.level ? `Level ${stream.level / 10}` : null].filter(Boolean).join(' · ') || '—'],
              [
                t('inspector.fResolution'),
                `${formatResolution(stream.width, stream.height)}${resolutionName(stream.width, stream.height) ? `  ·  ${resolutionName(stream.width, stream.height)}` : ''}`
              ],
              [t('inspector.fFrameRate'), `${formatFps(stream.fps)}${stream.avgFps && Math.abs(stream.avgFps - (stream.fps ?? 0)) > 0.01 ? `  (avg ${formatFps(stream.avgFps)})` : ''}`],
              [t('inspector.fAspect'), stream.displayAspectRatio ?? '—'],
              [t('inspector.fPixelFormat'), stream.pixelFormat ?? '—'],
              [t('inspector.fBitrate'), formatBitrate(stream.bitrate)],
              [t('inspector.fFrames'), stream.frameCount ? stream.frameCount.toLocaleString() : '—'],
              [t('inspector.fColorSpace'), stream.colorSpace ?? '—'],
              [t('inspector.fColorPrimaries'), stream.colorPrimaries ?? '—'],
              [t('inspector.fTransfer'), stream.colorTransfer ?? '—'],
              [t('inspector.fColorRange'), stream.colorRange ?? '—'],
              [t('inspector.fHdr'), stream.isHDR ? (stream.hdrFormat ?? t('common.yes')) : t('common.no')],
              [t('inspector.fRotation'), stream.rotation !== undefined ? `${stream.rotation}°` : '—'],
              [t('inspector.fLanguage'), stream.language ?? '—'],
              [t('inspector.fDefault'), stream.isDefault ? t('common.yes') : t('common.no')]
            ]}
          />
        ))}

        {audio.map((stream) => (
          <StreamPanel
            key={stream.index}
            icon={<Music size={15} />}
            title={t('inspector.streamAudio', { index: stream.index })}
            rows={[
              [t('inspector.fCodec'), `${stream.codecLongName ?? stream.codec} (${stream.codec})`],
              [t('inspector.fSampleRate'), formatSampleRate(stream.sampleRate)],
              [t('inspector.fChannels'), `${formatChannels(stream.channels, stream.channelLayout)}${stream.channels ? ` (${stream.channels})` : ''}`],
              [t('inspector.fSampleFormat'), stream.sampleFormat ?? '—'],
              [
                t('inspector.fBitDepth'),
                stream.bitsPerRawSample || stream.bitsPerSample
                  ? `${stream.bitsPerRawSample ?? stream.bitsPerSample}-bit`
                  : '—'
              ],
              [t('inspector.fBitrate'), formatBitrate(stream.bitrate)],
              [t('inspector.fLanguage'), stream.language ?? '—'],
              [t('inspector.fTitle'), stream.title ?? '—'],
              [t('inspector.fDefault'), stream.isDefault ? t('common.yes') : t('common.no')]
            ]}
          />
        ))}

        {subtitles.length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Subtitles size={15} />
                {t('editor.subtitles')}
              </div>
              <span className="text-xs text-faint">{subtitles.length}</span>
            </div>
            <div className="panel-body">
              {subtitles.map((stream) => (
                <div className="stream-row" key={stream.index}>
                  <div className="stream-icon subtitle">
                    <Subtitles size={14} />
                  </div>
                  <div className="stream-main">
                    <div className="stream-title">
                      Stream #{stream.index} · {stream.codec}
                      {stream.isBitmap && <Badge tone="warning">{t('inspector.bitmap')}</Badge>}
                      {stream.isForced && <Badge tone="info">{t('inspector.forced')}</Badge>}
                      {stream.isDefault && <Badge tone="neutral">{t('inspector.default')}</Badge>}
                    </div>
                    <div className="stream-detail">
                      {[stream.language ?? t('common.unknownLanguage'), stream.title]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {others.length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Paperclip size={15} />
                {t('inspector.attachments')}
              </div>
            </div>
            <div className="panel-body">
              {others.map((stream) => (
                <div className="stream-row" key={stream.index}>
                  <div className={`stream-icon ${stream.kind}`}>
                    <Paperclip size={14} />
                  </div>
                  <div className="stream-main">
                    <div className="stream-title">
                      Stream #{stream.index} · {stream.codec}
                    </div>
                    <div className="stream-detail">
                      {(stream as { filename?: string }).filename ?? stream.kind}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="col gap-16">
        {!file.error && <Player file={file} />}

        {Object.keys(file.metadata).length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('editor.metadata')}</div>
            </div>
            <div className="panel-body">
              <PropTable
                rows={Object.entries(file.metadata).map(([key, value]) => [
                  key,
                  <span className="selectable">{value}</span>
                ])}
              />
            </div>
          </div>
        )}

        {file.chapters.length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">{t('inspector.fChapters')}</div>
              <span className="text-xs text-faint">{file.chapters.length}</span>
            </div>
            <div className="panel-body">
              <PropTable
                rows={file.chapters.map((chapter) => [
                  formatDuration(chapter.start),
                  chapter.title ?? `Chapter ${chapter.id + 1}`
                ])}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StreamPanel({
  icon,
  title,
  badge,
  rows
}: {
  icon: React.JSX.Element
  title: string
  badge?: string
  rows: [string, React.ReactNode][]
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          {icon}
          {title}
        </div>
        {badge && <Badge tone="accent">{badge}</Badge>}
      </div>
      <div className="panel-body">
        <PropTable rows={rows} />
      </div>
    </div>
  )
}

/** Plain-text report used by "Copy information" and "Export TXT". */
function toPlainText(file: MediaFile): string {
  const lines: string[] = []
  lines.push('GConverter — Media Information')
  lines.push('='.repeat(60))
  lines.push(`File:      ${file.name}`)
  lines.push(`Path:      ${file.path}`)
  lines.push(`Format:    ${file.formatLongName ?? file.formatName}`)
  lines.push(`Size:      ${formatBytes(file.size)}`)
  lines.push(`Duration:  ${formatDuration(file.duration)} (${file.duration.toFixed(3)}s)`)
  lines.push(`Bitrate:   ${formatBitrate(file.bitrate)}`)
  lines.push('')

  for (const stream of file.streams) {
    lines.push('-'.repeat(60))
    lines.push(`Stream #${stream.index} — ${stream.kind.toUpperCase()}`)
    lines.push(`  Codec:    ${stream.codecLongName ?? stream.codec} (${stream.codec})`)
    if (stream.language) lines.push(`  Language: ${stream.language}`)

    if (stream.kind === 'video') {
      const v = stream as VideoStream
      lines.push(`  Size:     ${formatResolution(v.width, v.height)}`)
      lines.push(`  FPS:      ${formatFps(v.fps)}`)
      lines.push(`  Pixel:    ${v.pixelFormat ?? '—'}`)
      lines.push(`  Colour:   ${[v.colorSpace, v.colorPrimaries, v.colorTransfer].filter(Boolean).join(' / ') || '—'}`)
      lines.push(`  HDR:      ${v.isHDR ? (v.hdrFormat ?? 'Yes') : 'No'}`)
      lines.push(`  Bitrate:  ${formatBitrate(v.bitrate)}`)
    }
    if (stream.kind === 'audio') {
      const a = stream as AudioStream
      lines.push(`  Rate:     ${formatSampleRate(a.sampleRate)}`)
      lines.push(`  Channels: ${formatChannels(a.channels, a.channelLayout)}`)
      lines.push(`  Format:   ${a.sampleFormat ?? '—'}`)
      lines.push(`  Bitrate:  ${formatBitrate(a.bitrate)}`)
    }
  }

  if (file.chapters.length) {
    lines.push('')
    lines.push('-'.repeat(60))
    lines.push('Chapters')
    for (const chapter of file.chapters) {
      lines.push(`  ${formatDuration(chapter.start)}  ${chapter.title ?? ''}`)
    }
  }

  if (Object.keys(file.metadata).length) {
    lines.push('')
    lines.push('-'.repeat(60))
    lines.push('Metadata')
    for (const [key, value] of Object.entries(file.metadata)) {
      lines.push(`  ${key.padEnd(16)} ${value}`)
    }
  }

  return lines.join('\n')
}
