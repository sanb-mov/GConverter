/**
 * The conversion editor (spec §9, §11, §18, §28, §64).
 *
 * Left: what the source *is*. Right: what the output *will be*, with an
 * honest verdict banner and an Advanced panel that exposes the full
 * encoder vocabulary without cluttering the default view.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Cpu,
  Film,
  Gauge,
  Info,
  Music,
  Settings2,
  Subtitles,
  Tag,
  Terminal,
  TriangleAlert
} from 'lucide-react'
import type { ConversionSettings, MediaFile, QualityMode } from '@shared/models'
import {
  AUDIO_CODECS,
  CONTAINERS,
  VIDEO_CODECS,
  getCodec,
  qualityToValue
} from '@shared/formats'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'
import {
  formatBytes,
  formatChannels,
  formatDuration,
  formatEta,
  formatFps,
  formatResolution,
  formatSampleRate
} from '../lib/format'
import { Badge, Disclosure, Field, Select, Spinner, Toggle } from './ui'

const QUALITY_KEYS: { value: QualityMode; key: string }[] = [
  { value: 'lossless', key: 'editor.qualityLossless' },
  { value: 'maximum', key: 'editor.qualityMaximum' },
  { value: 'very-high', key: 'editor.qualityVeryHigh' },
  { value: 'high', key: 'editor.qualityHigh' },
  { value: 'balanced', key: 'editor.qualityBalanced' },
  { value: 'custom', key: 'editor.qualityCustom' }
]

const RESOLUTION_PRESETS = [
  { value: 'original', label: 'common.original' },
  { value: '3840x2160', label: '4K — 3840 × 2160' },
  { value: '2560x1440', label: '1440p — 2560 × 1440' },
  { value: '1920x1080', label: '1080p — 1920 × 1080' },
  { value: '1280x720', label: '720p — 1280 × 720' },
  { value: '854x480', label: '480p — 854 × 480' },
  { value: 'custom', label: 'common.customEllipsis' }
]

const FPS_PRESETS = ['original', '60', '50', '30', '25', '24', '23.976', '15']

export function ConversionEditor({ file }: { file: MediaFile }): React.JSX.Element {
  const t = useT()
  const settingsByFile = useStore((s) => s.settingsByFile)
  const setFileSettings = useStore((s) => s.setFileSettings)
  const preview = useStore((s) => s.preview)
  const previewLoading = useStore((s) => s.previewLoading)
  const setPreview = useStore((s) => s.setPreview)
  const setPreviewLoading = useStore((s) => s.setPreviewLoading)
  const hardware = useStore((s) => s.hardware)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const pushToast = useStore((s) => s.pushToast)

  const settings = settingsByFile[file.id]
  const [showCommand, setShowCommand] = useState(false)
  const [losslessTargets, setLosslessTargets] = useState<string[]>([])

  /* Initialise settings for a newly selected file using Smart Convert. */
  useEffect(() => {
    if (settings) return
    let cancelled = false
    void (async () => {
      const target = file.hasVideo ? 'mp4' : 'mp3'
      const smart = await api().conversion.smartSettings(file, target)
      if (!cancelled) setFileSettings(file.id, smart)
    })()
    return () => {
      cancelled = true
    }
  }, [file, settings, setFileSettings])

  /* Which containers can hold this file untouched (drives the badges). */
  useEffect(() => {
    let cancelled = false
    void api().conversion.losslessTargets(file).then((targets) => {
      if (!cancelled) setLosslessTargets(targets)
    })
    return () => {
      cancelled = true
    }
  }, [file])

  /* Recompute the plan whenever settings change; debounced so dragging a
     slider does not spawn a probe per frame. */
  useEffect(() => {
    if (!settings) return
    let cancelled = false
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      void api()
        .conversion.preview(file, settings)
        .then((result) => {
          if (!cancelled) setPreview(result)
        })
        .catch((err) => {
          if (!cancelled) {
            pushToast({
              kind: 'error',
              title: t('editor.planFailed'),
              message: String(err)
            })
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [file, settings, setPreview, setPreviewLoading, pushToast, t])

  const update = (mutate: (draft: ConversionSettings) => void): void => {
    if (!settings) return
    const next = structuredClone(settings)
    mutate(next)
    setFileSettings(file.id, next)
  }

  const container = useMemo(
    () => CONTAINERS.find((c) => c.id === settings?.container.format),
    [settings?.container.format]
  )

  const availableEncoders = ffmpeg?.encoders ?? []

  /** Only offer codecs this container accepts *and* this build can encode. */
  const videoCodecOptions = useMemo(() => {
    if (!container) return []
    const options = [
      { value: 'copy', label: t('editor.codecCopy') },
      { value: 'none', label: t('editor.codecNoVideo') }
    ]
    for (const codec of VIDEO_CODECS) {
      const allowed =
        container.videoCodecs.includes('*') || container.videoCodecs.includes(codec.id)
      if (!allowed) continue
      const hasEncoder = codec.encoders.some((e) => availableEncoders.includes(e.name))
      if (!hasEncoder) continue
      options.push({ value: codec.id, label: codec.label })
    }
    return options
  }, [container, availableEncoders, t])

  const audioCodecOptions = useMemo(() => {
    if (!container) return []
    const options = [
      { value: 'copy', label: t('editor.codecCopy') },
      { value: 'none', label: t('editor.codecNoAudio') }
    ]
    for (const codec of AUDIO_CODECS) {
      const allowed =
        container.audioCodecs.includes('*') || container.audioCodecs.includes(codec.id)
      if (!allowed) continue
      const hasEncoder = codec.encoders.some((e) => availableEncoders.includes(e.name))
      if (!hasEncoder) continue
      options.push({ value: codec.id, label: codec.label })
    }
    return options
  }, [container, availableEncoders, t])

  if (!settings) {
    return (
      <div className="panel">
        <div className="panel-body row gap-10">
          <Spinner /> <span className="text-muted">{t('editor.preparing')}</span>
        </div>
      </div>
    )
  }

  const video = file.primaryVideo
  const audio = file.primaryAudio
  const videoCodecDef = getCodec(settings.video.codec as string)
  const encoderDef = videoCodecDef?.encoders.find((e) => availableEncoders.includes(e.name))
  const isEncodingVideo = settings.video.codec !== 'copy' && settings.video.codec !== 'none'

  const resolutionValue =
    settings.video.width && settings.video.height
      ? RESOLUTION_PRESETS.some((p) => p.value === `${settings.video.width}x${settings.video.height}`)
        ? `${settings.video.width}x${settings.video.height}`
        : 'custom'
      : 'original'

  return (
    <div className="col gap-16">
      {/* ------------------------------ Verdict ---------------------------- */}
      <VerdictBanner loading={previewLoading} />

      {/* ------------------------------ Source ----------------------------- */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Info size={15} />
            {t('editor.source')}
          </div>
          <span className="text-xs text-faint mono">{file.formatName.split(',')[0].toUpperCase()}</span>
        </div>
        <div className="panel-body">
          <div className="row gap-16" style={{ flexWrap: 'wrap' }}>
            {video && (
              <SourceBlock
                icon={<Film size={14} />}
                tone="video"
                title={video.codec.toUpperCase()}
                lines={[
                  formatResolution(video.width, video.height),
                  formatFps(video.fps),
                  video.pixelFormat ?? '',
                  video.isHDR ? (video.hdrFormat ?? 'HDR') : ''
                ]}
              />
            )}
            {audio && (
              <SourceBlock
                icon={<Music size={14} />}
                tone="audio"
                title={audio.codec.toUpperCase()}
                lines={[
                  formatSampleRate(audio.sampleRate),
                  formatChannels(audio.channels, audio.channelLayout),
                  audio.bitrate ? `${Math.round(audio.bitrate / 1000)} kbps` : ''
                ]}
              />
            )}
            <SourceBlock
              icon={<Gauge size={14} />}
              tone="neutral"
              title={formatDuration(file.duration)}
              lines={[
                formatBytes(file.size),
                file.hasSubtitles
                  ? t('editor.subtitleTracks', {
                      count: file.streams.filter((s) => s.kind === 'subtitle').length
                    })
                  : t('editor.noSubtitles'),
                file.chapters.length > 0 ? t('editor.chapters', { count: file.chapters.length }) : ''
              ]}
            />
          </div>
        </div>
      </div>

      {/* ------------------------------ Output ----------------------------- */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <ArrowRight size={15} />
            {t('editor.output')}
          </div>
          {preview?.plan.usesHardware && (
            <Badge tone="accent">
              <Cpu size={11} />
              {preview.plan.hardwareEncoder}
            </Badge>
          )}
        </div>

        <div className="panel-body col gap-16">
          <div className="field-row">
            <Field
              label={t('editor.format')}
              hint={container ? t(`container.${container.id}.desc`) : undefined}
            >
              <Select
                value={settings.container.format}
                onChange={(value) => {
                  void (async () => {
                    // Re-derive everything: a new container changes what is possible.
                    const smart = await api().conversion.smartSettings(file, value)
                    setFileSettings(file.id, smart)
                  })()
                }}
                options={CONTAINERS.map((c) => ({
                  value: c.id,
                  label: losslessTargets.includes(c.id)
                    ? `${c.label}  ·  ${t('editor.losslessAvailable')}`
                    : c.label,
                  group: c.kind === 'video' ? t('common.video') : t('common.audio')
                }))}
              />
            </Field>

            <Field
              label={t('editor.quality')}
              hint={
                settings.quality === 'lossless'
                  ? t('editor.qualityHintLossless')
                  : t('editor.qualityHint')
              }
            >
              <Select
                value={settings.quality}
                disabled={!isEncodingVideo && settings.audio.codec === 'copy'}
                onChange={(value) =>
                  update((draft) => {
                    draft.quality = value as QualityMode
                    // Re-derive CRF from the new quality tier.
                    if (encoderDef && draft.video.rateControl === 'crf') {
                      draft.video.crf = qualityToValue(value as QualityMode, encoderDef)
                    }
                  })
                }
                options={QUALITY_KEYS.map((q) => ({ value: q.value, label: t(q.key) }))}
              />
            </Field>
          </div>

          {container && container.videoCodecs.length > 0 && file.hasVideo && (
            <div className="field-row">
              <Field label={t('editor.videoCodec')}>
                <Select
                  value={String(settings.video.codec)}
                  onChange={(value) =>
                    update((draft) => {
                      draft.video.codec = value
                      const codec = getCodec(value)
                      const enc = codec?.encoders.find((e) => availableEncoders.includes(e.name))
                      draft.video.rateControl = codec?.lossless ? 'lossless' : 'crf'
                      draft.video.crf = enc ? qualityToValue(draft.quality, enc) : undefined
                      draft.video.preset = enc?.presets?.includes('medium') ? 'medium' : undefined
                    })
                  }
                  options={videoCodecOptions}
                />
              </Field>

              <Field label={t('editor.audioCodec')}>
                <Select
                  value={String(settings.audio.codec)}
                  onChange={(value) =>
                    update((draft) => {
                      draft.audio.codec = value
                      const codec = getCodec(value)
                      if (codec && !codec.lossless) {
                        draft.audio.bitrate ??= 192
                      } else {
                        draft.audio.bitrate = undefined
                      }
                    })
                  }
                  options={audioCodecOptions}
                />
              </Field>
            </div>
          )}

          {(!file.hasVideo || container?.kind === 'audio') && (
            <Field label={t('editor.audioCodec')}>
              <Select
                value={String(settings.audio.codec)}
                onChange={(value) =>
                  update((draft) => {
                    draft.audio.codec = value
                  })
                }
                options={audioCodecOptions}
              />
            </Field>
          )}

          {file.hasVideo && container && container.videoCodecs.length > 0 && (
            <div className="field-row">
              <Field
                label={t('editor.resolution')}
                hint={
                  resolutionValue === 'original'
                    ? t('editor.resolutionHintOriginal')
                    : t('editor.resolutionHintScaled')
                }
              >
                <Select
                  value={resolutionValue}
                  onChange={(value) =>
                    update((draft) => {
                      if (value === 'original' || value === 'custom') {
                        draft.video.width = undefined
                        draft.video.height = undefined
                      } else {
                        const [w, h] = value.split('x').map(Number)
                        draft.video.width = w
                        draft.video.height = h
                        if (draft.video.codec === 'copy') draft.video.codec = 'h264'
                      }
                    })
                  }
                  options={RESOLUTION_PRESETS.filter((preset) => {
                    if (preset.value === 'original' || preset.value === 'custom') return true
                    // Never offer an upscale (spec §49).
                    const [w] = preset.value.split('x').map(Number)
                    return !video || w <= video.width
                  }).map((p) => ({
                    value: p.value,
                    label: p.value === 'original' || p.value === 'custom' ? t(p.label) : p.label
                  }))}
                />
              </Field>

              <Field
                label={t('editor.frameRate')}
                hint={
                  settings.video.fps ? t('editor.fpsHintChanged') : t('editor.fpsHintOriginal')
                }
              >
                <Select
                  value={settings.video.fps ? String(settings.video.fps) : 'original'}
                  onChange={(value) =>
                    update((draft) => {
                      if (value === 'original') {
                        draft.video.fps = undefined
                      } else {
                        draft.video.fps = Number(value)
                        if (draft.video.codec === 'copy') draft.video.codec = 'h264'
                      }
                    })
                  }
                  options={FPS_PRESETS.filter(
                    (fps) => fps === 'original' || !video?.fps || Number(fps) <= video.fps + 0.01
                  ).map((fps) => ({
                    value: fps,
                    label: fps === 'original' ? t('common.original') : `\${fps} fps`
                  }))}
                />
              </Field>
            </div>
          )}

          <div className="field-row">
            {file.hasSubtitles && (
              <Field label={t('editor.subtitles')}>
                <Select
                  value={settings.subtitles.action}
                  onChange={(value) =>
                    update((draft) => {
                      draft.subtitles.action = value as typeof draft.subtitles.action
                      if (value === 'burn') {
                        draft.subtitles.burnStreamIndex ??= file.streams.find(
                          (s) => s.kind === 'subtitle'
                        )?.index
                      }
                    })
                  }
                  options={[
                    { value: 'keep', label: t('editor.subsKeep') },
                    { value: 'remove', label: t('editor.subsRemove') },
                    { value: 'burn', label: t('editor.subsBurn') }
                  ]}
                />
              </Field>
            )}

            <Field label={t('editor.metadata')}>
              <Select
                value={settings.metadata.action}
                onChange={(value) =>
                  update((draft) => {
                    draft.metadata.action = value as typeof draft.metadata.action
                  })
                }
                options={[
                  { value: 'keep', label: t('editor.metaKeep') },
                  { value: 'remove', label: t('editor.metaRemove') },
                  { value: 'custom', label: t('editor.metaEdit') }
                ]}
              />
            </Field>
          </div>

          {settings.metadata.action === 'custom' && (
            <MetadataEditor settings={settings} onUpdate={update} />
          )}
        </div>

        {/* ---------------------------- Advanced --------------------------- */}
        <Disclosure title={t('editor.advVideo')} icon={<Film size={13} />}>
          {isEncodingVideo && encoderDef ? (
            <>
              <div className="field-row">
                <Field label={t('editor.encoder')}>
                  <Select
                    value={settings.video.hardware}
                    onChange={(value) =>
                      update((draft) => {
                        draft.video.hardware = value as typeof draft.video.hardware
                      })
                    }
                    options={[
                      { value: 'auto', label: t('editor.encoderAuto') },
                      { value: 'cpu', label: t('editor.encoderCpu') },
                      {
                        value: 'nvidia',
                        label: 'NVIDIA NVENC',
                        disabled: !hardware?.encoders.some(
                          (e) => e.vendor === 'nvidia' && e.available
                        )
                      },
                      {
                        value: 'amd',
                        label: 'AMD AMF',
                        disabled: !hardware?.encoders.some((e) => e.vendor === 'amd' && e.available)
                      },
                      {
                        value: 'intel',
                        label: 'Intel Quick Sync',
                        disabled: !hardware?.encoders.some(
                          (e) => e.vendor === 'intel' && e.available
                        )
                      },
                      {
                        value: 'apple',
                        label: 'Apple VideoToolbox',
                        disabled: !hardware?.encoders.some(
                          (e) => e.vendor === 'apple' && e.available
                        )
                      }
                    ]}
                  />
                </Field>

                <Field label={t('editor.rateControl')}>
                  <Select
                    value={settings.video.rateControl}
                    onChange={(value) =>
                      update((draft) => {
                        draft.video.rateControl = value as typeof draft.video.rateControl
                        if (value === 'bitrate' || value === 'constrained') {
                          draft.video.bitrate ??= 8000
                        }
                      })
                    }
                    options={[
                      { value: 'crf', label: t('editor.rcCrf') },
                      { value: 'bitrate', label: t('editor.rcBitrate') },
                      { value: 'constrained', label: t('editor.rcConstrained') },
                      {
                        value: 'lossless',
                        label: t('editor.rcLossless'),
                        disabled: !videoCodecDef?.losslessCapable
                      }
                    ]}
                  />
                </Field>
              </div>

              {settings.video.rateControl === 'crf' && encoderDef.qualityRange && (
                <Field
                  label={`${encoderDef.qualityFlag?.toUpperCase() ?? 'Quality'} — ${settings.video.crf ?? qualityToValue(settings.quality, encoderDef)}`}
                  hint={t('editor.crfHint')}
                >
                  <input
                    type="range"
                    className="range"
                    min={encoderDef.qualityRange[0]}
                    max={encoderDef.qualityRange[1]}
                    value={settings.video.crf ?? qualityToValue(settings.quality, encoderDef)}
                    onChange={(e) =>
                      update((draft) => {
                        draft.video.crf = Number(e.target.value)
                        draft.quality = 'custom'
                      })
                    }
                  />
                </Field>
              )}

              {(settings.video.rateControl === 'bitrate' ||
                settings.video.rateControl === 'constrained') && (
                <div className="field-row-3">
                  <Field label={t('editor.bitrateKbps')}>
                    <input
                      className="input"
                      type="number"
                      min={100}
                      value={settings.video.bitrate ?? 8000}
                      onChange={(e) =>
                        update((draft) => {
                          draft.video.bitrate = Number(e.target.value)
                        })
                      }
                    />
                  </Field>
                  <Field label={t('editor.maxBitrate')}>
                    <input
                      className="input"
                      type="number"
                      value={settings.video.maxBitrate ?? ''}
                      placeholder="auto"
                      onChange={(e) =>
                        update((draft) => {
                          draft.video.maxBitrate = e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </Field>
                  <Field label={t('editor.bufferSize')}>
                    <input
                      className="input"
                      type="number"
                      value={settings.video.bufSize ?? ''}
                      placeholder="auto"
                      onChange={(e) =>
                        update((draft) => {
                          draft.video.bufSize = e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </Field>
                </div>
              )}

              <div className="field-row">
                {encoderDef.presets && (
                  <Field label={t('editor.preset')} hint={t('editor.presetHint')}>
                    <Select
                      value={settings.video.preset ?? 'medium'}
                      onChange={(value) =>
                        update((draft) => {
                          draft.video.preset = value
                        })
                      }
                      options={encoderDef.presets.map((p) => ({ value: p, label: p }))}
                    />
                  </Field>
                )}

                {encoderDef.profiles && (
                  <Field label={t('editor.profile')}>
                    <Select
                      value={settings.video.profile ?? ''}
                      onChange={(value) =>
                        update((draft) => {
                          draft.video.profile = value || undefined
                        })
                      }
                      options={[
                        { value: '', label: t('common.auto') },
                        ...encoderDef.profiles.map((p) => ({ value: p, label: p }))
                      ]}
                    />
                  </Field>
                )}
              </div>

              <div className="field-row-3">
                <Field label={t('editor.gop')}>
                  <input
                    className="input"
                    type="number"
                    placeholder="auto"
                    value={settings.video.gop ?? ''}
                    onChange={(e) =>
                      update((draft) => {
                        draft.video.gop = e.target.value ? Number(e.target.value) : undefined
                      })
                    }
                  />
                </Field>
                <Field label={t('editor.bFrames')}>
                  <input
                    className="input"
                    type="number"
                    placeholder="auto"
                    value={settings.video.bFrames ?? ''}
                    onChange={(e) =>
                      update((draft) => {
                        draft.video.bFrames = e.target.value ? Number(e.target.value) : undefined
                      })
                    }
                  />
                </Field>
                <Field label={t('editor.refFrames')}>
                  <input
                    className="input"
                    type="number"
                    placeholder="auto"
                    value={settings.video.refFrames ?? ''}
                    onChange={(e) =>
                      update((draft) => {
                        draft.video.refFrames = e.target.value ? Number(e.target.value) : undefined
                      })
                    }
                  />
                </Field>
              </div>

              <div className="field-row">
                <Field label={t('editor.pixelFormat')}>
                  <Select
                    value={settings.video.pixelFormat ?? ''}
                    onChange={(value) =>
                      update((draft) => {
                        draft.video.pixelFormat = value || undefined
                      })
                    }
                    options={[
                      { value: '', label: t('editor.pixelAuto') },
                      ...(encoderDef.pixelFormats ?? []).map((p) => ({ value: p, label: p }))
                    ]}
                  />
                </Field>
                <Field label={t('editor.level')}>
                  <input
                    className="input"
                    placeholder="auto"
                    value={settings.video.level ?? ''}
                    onChange={(e) =>
                      update((draft) => {
                        draft.video.level = e.target.value || undefined
                      })
                    }
                  />
                </Field>
              </div>

              {encoderDef.supportsTenBit && (
                <Toggle
                  title={t('editor.tenBit')}
                  description={t('editor.tenBitHint')}
                  checked={settings.video.tenBit ?? false}
                  onChange={(value) =>
                    update((draft) => {
                      draft.video.tenBit = value
                    })
                  }
                />
              )}
            </>
          ) : (
            <div className="text-sm text-muted">
              {t('editor.advVideoDisabled')}
            </div>
          )}
        </Disclosure>

        <Disclosure title={t('editor.advAudio')} icon={<Music size={13} />}>
          {settings.audio.codec !== 'copy' && settings.audio.codec !== 'none' ? (
            <>
              <div className="field-row">
                <Field label={t('editor.bitrateKbps')}>
                  <input
                    className="input"
                    type="number"
                    placeholder={getCodec(settings.audio.codec as string)?.lossless ? 'n/a' : '192'}
                    disabled={getCodec(settings.audio.codec as string)?.lossless}
                    value={settings.audio.bitrate ?? ''}
                    onChange={(e) =>
                      update((draft) => {
                        draft.audio.bitrate = e.target.value ? Number(e.target.value) : undefined
                      })
                    }
                  />
                </Field>
                <Field label={t('editor.sampleRate')}>
                  <Select
                    value={settings.audio.sampleRate ? String(settings.audio.sampleRate) : ''}
                    onChange={(value) =>
                      update((draft) => {
                        draft.audio.sampleRate = value ? Number(value) : undefined
                      })
                    }
                    options={[
                      { value: '', label: t('common.original') },
                      { value: '48000', label: '48 kHz' },
                      { value: '44100', label: '44.1 kHz' },
                      { value: '32000', label: '32 kHz' },
                      { value: '22050', label: '22.05 kHz' },
                      { value: '16000', label: '16 kHz' }
                    ]}
                  />
                </Field>
              </div>

              <div className="field-row">
                <Field label={t('editor.channels')}>
                  <Select
                    value={settings.audio.channels ? String(settings.audio.channels) : ''}
                    onChange={(value) =>
                      update((draft) => {
                        draft.audio.channels = value ? Number(value) : undefined
                      })
                    }
                    options={[
                      { value: '', label: t('common.original') },
                      { value: '1', label: t('common.mono') },
                      { value: '2', label: t('common.stereo') },
                      { value: '6', label: t('common.surround51') },
                      { value: '8', label: t('common.surround71') }
                    ]}
                  />
                </Field>
                <Field label={t('editor.bitDepth')}>
                  <Select
                    value={settings.audio.bitDepth ? String(settings.audio.bitDepth) : ''}
                    onChange={(value) =>
                      update((draft) => {
                        draft.audio.bitDepth = value ? Number(value) : undefined
                      })
                    }
                    options={[
                      { value: '', label: t('common.original') },
                      { value: '16', label: t('editor.bitDepthN', { n: 16 }) },
                      { value: '24', label: t('editor.bitDepthN', { n: 24 }) },
                      { value: '32', label: t('editor.bitDepthN', { n: 32 }) }
                    ]}
                  />
                </Field>
              </div>

              {getCodec(settings.audio.codec as string)?.id === 'flac' && (
                <Field
                  label={t('editor.compressionLevel', { value: settings.audio.compressionLevel ?? 8 })}
                  hint={t('editor.compressionHint')}
                >
                  <input
                    type="range"
                    className="range"
                    min={0}
                    max={12}
                    value={settings.audio.compressionLevel ?? 8}
                    onChange={(e) =>
                      update((draft) => {
                        draft.audio.compressionLevel = Number(e.target.value)
                      })
                    }
                  />
                </Field>
              )}

              {['mp3', 'vorbis'].includes(getCodec(settings.audio.codec as string)?.id ?? '') && (
                <Toggle
                  title={t('editor.vbr')}
                  description={t('editor.vbrHint')}
                  checked={settings.audio.vbr ?? false}
                  onChange={(value) =>
                    update((draft) => {
                      draft.audio.vbr = value
                    })
                  }
                />
              )}
            </>
          ) : (
            <div className="text-sm text-muted">
              {t('editor.advAudioDisabled')}
            </div>
          )}
        </Disclosure>

        <Disclosure title={t('editor.advContainer')} icon={<Settings2 size={13} />}>
          {container?.supportsFaststart && (
            <Toggle
              title={t('editor.faststart')}
              description={t('editor.faststartHint')}
              checked={settings.container.faststart}
              onChange={(value) =>
                update((draft) => {
                  draft.container.faststart = value
                })
              }
            />
          )}
          {container?.supportsFaststart && (
            <Toggle
              title={t('editor.fragmented')}
              description={t('editor.fragmentedHint')}
              checked={settings.container.fragmentedMp4}
              onChange={(value) =>
                update((draft) => {
                  draft.container.fragmentedMp4 = value
                })
              }
            />
          )}
          <Toggle
            title={t('editor.keepChapters')}
            description={
              container?.supportsChapters
                ? t('editor.keepChaptersCount', { count: file.chapters.length })
                : t('editor.keepChaptersUnsupported', { format: container?.label ?? '' })
            }
            disabled={!container?.supportsChapters}
            checked={settings.container.chapters === 'keep'}
            onChange={(value) =>
              update((draft) => {
                draft.container.chapters = value ? 'keep' : 'remove'
              })
            }
          />
          <Toggle
            title={t('editor.keepAttachments')}
            description={t('editor.keepAttachmentsHint')}
            disabled={!container?.supportsAttachments}
            checked={settings.container.attachments}
            onChange={(value) =>
              update((draft) => {
                draft.container.attachments = value
              })
            }
          />
          <Field label={t('editor.threads')} hint={t('editor.threadsHint')}>
            <input
              className="input"
              type="number"
              min={0}
              max={64}
              value={settings.threads ?? 0}
              onChange={(e) =>
                update((draft) => {
                  draft.threads = Number(e.target.value)
                })
              }
            />
          </Field>
        </Disclosure>
      </div>

      {/* ---------------------------- Comparison --------------------------- */}
      {preview && <ComparisonPanel file={file} />}

      {/* ------------------------- Command preview ------------------------- */}
      <div className="panel">
        <button
          className="disclosure-head"
          style={{ borderTop: 'none' }}
          onClick={() => setShowCommand(!showCommand)}
        >
          <Terminal size={14} />
          <span>{t('editor.command')}</span>
          <span className="flex-1" />
          {showCommand && preview && (
            <span
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation()
                void api().shell.copyText(preview.commandString)
                pushToast({ kind: 'success', title: t('editor.commandCopied') })
              }}
            >
              <Copy size={13} />
              {t('common.copy')}
            </span>
          )}
        </button>
        {showCommand && (
          <div style={{ padding: '0 18px 18px' }}>
            <div className="code">
              {preview?.commandString ?? t('editor.commandBuilding')}
            </div>
            <div className="field-hint mt-8">
              {t('editor.commandHint')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function SourceBlock({
  icon,
  tone,
  title,
  lines
}: {
  icon: React.JSX.Element
  tone: 'video' | 'audio' | 'neutral'
  title: string
  lines: string[]
}): React.JSX.Element {
  const t = useT()
  const color =
    tone === 'video' ? 'var(--video-hue)' : tone === 'audio' ? 'var(--audio-hue)' : 'var(--text-muted)'
  return (
    <div style={{ minWidth: 150 }}>
      <div className="row gap-6" style={{ color, fontSize: 11, fontWeight: 650, letterSpacing: '0.06em' }}>
        {icon}
        <span style={{ textTransform: 'uppercase' }}>
          {tone === 'neutral' ? t('editor.file') : tone === 'video' ? t('common.video') : t('common.audio')}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6, letterSpacing: '-0.01em' }}>
        {title}
      </div>
      <div className="col gap-2 mt-8">
        {lines.filter(Boolean).map((line, i) => (
          <div key={i} className="text-xs text-muted mono">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}

function VerdictBanner({ loading }: { loading: boolean }): React.JSX.Element | null {
  const t = useT()
  const preview = useStore((s) => s.preview)

  if (!preview) {
    return (
      <div className="verdict verdict-mixed">
        <Spinner size={18} />
        <div>
          <div className="verdict-title">{t('editor.analysing')}</div>
        </div>
      </div>
    )
  }

  const { plan } = preview
  const lossless = plan.mode === 'lossless-remux' || plan.mode === 'lossless-encode'
  const tone = lossless ? 'lossless' : plan.mode === 'mixed' ? 'mixed' : 'encode'

  return (
    <div className={`verdict verdict-${tone}`} style={loading ? { opacity: 0.65 } : undefined}>
      <div className="verdict-icon">
        {lossless ? (
          <CheckCircle2 size={19} style={{ color: 'var(--success)' }} />
        ) : plan.mode === 'mixed' ? (
          <Info size={19} style={{ color: 'var(--info)' }} />
        ) : (
          <TriangleAlert size={19} style={{ color: 'var(--warning)' }} />
        )}
      </div>
      <div className="flex-1">
        <div className="verdict-title">{plan.headline}</div>
        <div className="verdict-detail">{plan.detail}</div>

        {plan.warnings.length > 0 && (
          <ul
            className="col gap-4 mt-8"
            style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-muted)' }}
          >
            {plan.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        )}

        {preview.validation.issues.some((i) => i.severity === 'error') && (
          <div className="mt-8">
            {preview.validation.issues
              .filter((i) => i.severity === 'error')
              .map((issue, i) => (
                <div key={i} className="row gap-6" style={{ color: 'var(--danger)', fontSize: 12 }}>
                  <TriangleAlert size={13} />
                  <span>{issue.message}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ComparisonPanel({ file }: { file: MediaFile }): React.JSX.Element | null {
  const t = useT()
  const preview = useStore((s) => s.preview)
  if (!preview) return null

  const { plan } = preview
  const video = file.primaryVideo
  const settings = useStore.getState().settingsByFile[file.id]

  const targetCodec =
    plan.streams.find((s) => s.kind === 'video' && s.action !== 'drop')?.targetCodec ??
    video?.codec

  const outWidth = settings?.video.width ?? video?.width
  const outHeight = settings?.video.height ?? video?.height

  const estimated = plan.estimatedSize
  const delta =
    estimated && file.size > 0 ? Math.round(((estimated - file.size) / file.size) * 100) : null

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <Gauge size={15} />
          {t('editor.estimated')}
        </div>
        <span className="text-xs text-faint">{t('editor.estimatedHint')}</span>
      </div>
      <div className="panel-body">
        <div className="compare">
          <div className="compare-side">
            <div className="compare-label">{t('editor.compareSource')}</div>
            <div className="compare-lines">
              {video && <div className="compare-primary">{formatResolution(video.width, video.height)}</div>}
              {video && <div>{video.codec.toUpperCase()}</div>}
              <div>{formatBytes(file.size)}</div>
            </div>
          </div>

          <div className="compare-arrow">
            <ArrowRight size={17} />
          </div>

          <div className="compare-side">
            <div className="compare-label">{t('editor.compareOutput')}</div>
            <div className="compare-lines">
              {outWidth && <div className="compare-primary">{formatResolution(outWidth, outHeight)}</div>}
              {targetCodec && <div>{String(targetCodec).toUpperCase()}</div>}
              <div>
                {plan.estimatedSizeRange
                  ? `${formatBytes(plan.estimatedSizeRange[0])} – ${formatBytes(plan.estimatedSizeRange[1])}`
                  : formatBytes(estimated)}
              </div>
            </div>
          </div>
        </div>

        <div className="row gap-16 mt-16" style={{ flexWrap: 'wrap' }}>
          {delta !== null && (
            <div>
              <div className="stat-label">{t('editor.sizeChange')}</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 650,
                  marginTop: 4,
                  color: delta <= 0 ? 'var(--success)' : 'var(--warning)'
                }}
              >
                {delta > 0 ? '+' : ''}
                {delta}%
              </div>
            </div>
          )}
          <div>
            <div className="stat-label">{t('editor.estimatedTime')}</div>
            <div style={{ fontSize: 19, fontWeight: 650, marginTop: 4 }}>
              {plan.estimatedDuration ? `~${formatEta(plan.estimatedDuration)}` : '—'}
            </div>
          </div>
          <div>
            <div className="stat-label">{t('editor.quality')}</div>
            <div style={{ fontSize: 19, fontWeight: 650, marginTop: 4 }}>
              {plan.mode === 'lossless-remux' || plan.mode === 'lossless-encode'
                ? t('editor.qualityIdentical')
                : plan.mode === 'mixed'
                  ? t('editor.qualityNearIdentical')
                  : t('editor.qualityPreserved')}
            </div>
          </div>
        </div>

        <div className="divider" />

        <div className="section-title" style={{ marginBottom: 6 }}>
          {t('editor.streamPlan')}
        </div>
        {plan.streams.map((stream, i) => (
          <div className="stream-row" key={i}>
            <div className={`stream-icon ${stream.kind}`}>
              {stream.kind === 'video' ? (
                <Film size={14} />
              ) : stream.kind === 'audio' ? (
                <Music size={14} />
              ) : stream.kind === 'subtitle' ? (
                <Subtitles size={14} />
              ) : (
                <Tag size={14} />
              )}
            </div>
            <div className="stream-main">
              <div className="stream-title">
                {t('editor.stream', { index: stream.sourceIndex })}
                {stream.action === 'copy' && <Badge tone="success">{t('editor.actionCopy')}</Badge>}
                {stream.action === 'encode' && (
                  <Badge tone="warning">
                    {t('editor.actionEncode', { codec: stream.targetCodec ?? '' })}
                  </Badge>
                )}
                {stream.action === 'drop' && <Badge tone="danger">{t('editor.actionDrop')}</Badge>}
                {stream.action === 'burn' && <Badge tone="info">{t('editor.actionBurn')}</Badge>}
              </div>
              <div className="stream-detail">{stream.reason}</div>
            </div>
          </div>
        ))}

        <div className="divider" />
        <div className="text-xs text-faint">
          {t('editor.outputPath')} <span className="mono selectable">{preview.outputPath}</span>
        </div>
      </div>
    </div>
  )
}

function MetadataEditor({
  settings,
  onUpdate
}: {
  settings: ConversionSettings
  onUpdate: (mutate: (draft: ConversionSettings) => void) => void
}): React.JSX.Element {
  const t = useT()
  const fields: { key: string; label: string }[] = [
    { key: 'title', label: t('editor.metaTitle') },
    { key: 'artist', label: t('editor.metaArtist') },
    { key: 'album', label: t('editor.metaAlbum') },
    { key: 'genre', label: t('editor.metaGenre') },
    { key: 'date', label: t('editor.metaYear') },
    { key: 'comment', label: t('editor.metaComment') }
  ]

  return (
    <div className="card card-pad card-static">
      <div className="section-title">{t('editor.metadata')}</div>
      <div className="field-row">
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <input
              className="input"
              value={
                (settings.metadata.fields as Record<string, string> | undefined)?.[field.key] ?? ''
              }
              onChange={(e) =>
                onUpdate((draft) => {
                  draft.metadata.fields ??= {}
                  ;(draft.metadata.fields as Record<string, string>)[field.key] = e.target.value
                })
              }
            />
          </Field>
        ))}
      </div>
    </div>
  )
}
