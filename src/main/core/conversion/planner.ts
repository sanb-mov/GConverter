/**
 * Conversion planner (spec §4, §19, §50, §64).
 *
 * Decides, per stream, whether GConverter can copy it (lossless) or must
 * re-encode it — and produces an honest, human-readable explanation. The
 * app never claims "lossless" unless every stream is genuinely copied or
 * encoded with a mathematically lossless codec.
 */

import type {
  AudioStream,
  ConversionPlan,
  ConversionSettings,
  ConversionMode,
  HardwareCapabilities,
  MediaFile,
  StreamPlan,
  SubtitleStream,
  VideoStream
} from '@shared/models'
import {
  CONTAINER_BY_ID,
  containerAcceptsCodec,
  getCodec,
  isImageTarget,
  normalizeCodec,
  pixelFormatHasAlpha,
  type ContainerDef
} from '@shared/formats'
import { pickHardwareEncoder } from '../hardware/detector'
import { t as translate } from '@shared/i18n'
import type { LanguageCode } from '@shared/models'

/** Text subtitle codec each container expects when converting subtitles. */
const SUBTITLE_TARGET: Record<string, string> = {
  mp4: 'mov_text',
  mov: 'mov_text',
  m4a: 'mov_text',
  mkv: 'srt',
  webm: 'webvtt'
}

export interface PlanContext {
  hardware: HardwareCapabilities | null
  /** Language for every user-facing string in the plan. Defaults to English. */
  lang?: LanguageCode
  /** Encoders the resolved FFmpeg build actually provides. */
  availableEncoders: string[]
}

/** Bind the plan's language once; English when the caller does not care. */
function tr(context: PlanContext): (key: string, params?: Record<string, string | number>) => string {
  const lang = context.lang ?? 'en'
  return (key, params) => translate(lang, key, params)
}

/**
 * Build the plan for converting `source` with `settings`.
 * Pure and synchronous — trivially unit-testable (spec §53).
 */
export function planConversion(
  source: MediaFile,
  settings: ConversionSettings,
  context: PlanContext
): ConversionPlan {
  const container = CONTAINER_BY_ID.get(settings.container.format)
  const streams: StreamPlan[] = []
  const warnings: string[] = []
  const t = tr(context)

  if (!container) {
    return {
      mode: 're-encode',
      headline: t('plan.unknownContainer.headline'),
      detail: t('plan.unknownContainer.detail', { format: settings.container.format }),
      losslessAvailable: false,
      streams: [],
      warnings: [t('plan.unknownContainer.warning', { format: settings.container.format })],
      usesHardware: false
    }
  }

  if (isImageTarget(container, source.isImage)) {
    return planImage(source, settings, container, t)
  }

  const videoStreams = source.streams.filter(
    (s): s is VideoStream => s.kind === 'video' && !s.isAttachedPic
  )
  const audioStreams = source.streams.filter((s): s is AudioStream => s.kind === 'audio')
  const subtitleStreams = source.streams.filter((s): s is SubtitleStream => s.kind === 'subtitle')

  if (source.isImage && videoStreams.length > 0) {
    // A still picture into a video/audio container: technically possible
    // (a one-frame video) but almost never what the user meant.
    warnings.push(
      container.kind === 'audio'
        ? t('warn.imageToAudio', { format: container.label })
        : t('warn.imageToVideo', { format: container.label })
    )
  }

  let usesHardware = false
  let hardwareEncoder: string | undefined

  /* ------------------------------ video ------------------------------ */

  if (settings.video.codec === 'none' || container.videoCodecs.length === 0) {
    for (const stream of videoStreams) {
      streams.push({
        sourceIndex: stream.index,
        kind: 'video',
        action: 'drop',
        reason:
          container.videoCodecs.length === 0
            ? t('reason.audioOnlyContainer', { format: container.label })
            : t('reason.videoRemoved')
      })
    }
  } else {
    for (const [i, stream] of videoStreams.entries()) {
      // Only the first video stream honours full encode settings; extra
      // video streams are copied when the container allows it.
      const isPrimary = i === 0
      const decision = decideVideo(stream, settings, container.id, context, isPrimary)
      if (decision.action === 'encode' && decision.hardwareEncoder) {
        usesHardware = true
        hardwareEncoder = decision.hardwareEncoder
      }
      streams.push(decision.plan)
      if (decision.warning) warnings.push(decision.warning)
    }
  }

  /* ------------------------------ audio ------------------------------ */

  if (settings.audio.codec === 'none' || container.audioCodecs.length === 0) {
    for (const stream of audioStreams) {
      streams.push({
        sourceIndex: stream.index,
        kind: 'audio',
        action: 'drop',
        reason:
          container.audioCodecs.length === 0
            ? t('reason.noAudioSupport', { format: container.label })
            : t('reason.audioRemoved')
      })
    }
  } else {
    for (const stream of audioStreams) {
      const decision = decideAudio(stream, settings, container.id, context)
      streams.push(decision.plan)
      if (decision.warning) warnings.push(decision.warning)
    }
  }

  /* ---------------------------- subtitles ---------------------------- */

  for (const stream of subtitleStreams) {
    const action = settings.subtitles.action

    if (action === 'remove') {
      streams.push({
        sourceIndex: stream.index,
        kind: 'subtitle',
        action: 'drop',
        reason: t('reason.subsRemoved')
      })
      continue
    }

    if (action === 'burn') {
      const burning = settings.subtitles.burnStreamIndex === stream.index
      streams.push({
        sourceIndex: stream.index,
        kind: 'subtitle',
        action: burning ? 'burn' : 'drop',
        reason: burning ? t('reason.burned') : t('reason.notSelectedSub')
      })
      if (burning && stream.isBitmap) {
        warnings.push(t('warn.bitmapOverlay'))
      }
      continue
    }

    // keep
    if (container.subtitleCodecs.length === 0) {
      streams.push({
        sourceIndex: stream.index,
        kind: 'subtitle',
        action: 'drop',
        reason: t('reason.noSubSupport', { format: container.label })
      })
      warnings.push(
        t('warn.subsDropped', { format: container.label, count: subtitleStreams.length })
      )
      continue
    }

    if (containerAcceptsCodec(container, stream.codec, 'subtitle')) {
      streams.push({
        sourceIndex: stream.index,
        kind: 'subtitle',
        action: 'copy',
        reason: t('reason.codecSupported', {
          codec: stream.codec.toUpperCase(),
          format: container.label
        })
      })
      continue
    }

    if (stream.isBitmap) {
      // Bitmap → text is impossible without OCR.
      streams.push({
        sourceIndex: stream.index,
        kind: 'subtitle',
        action: 'drop',
        reason: t('reason.bitmapUnsupported', {
          codec: stream.codec,
          format: container.label
        })
      })
      warnings.push(t('warn.bitmapSubs', { format: container.label }))
      continue
    }

    const target = SUBTITLE_TARGET[container.id] ?? 'srt'
    streams.push({
      sourceIndex: stream.index,
      kind: 'subtitle',
      action: 'encode',
      targetCodec: target,
      reason: t('reason.convertedTo', { codec: target, format: container.label })
    })
  }

  /* ------------------------- container warnings ---------------------- */

  if (settings.container.chapters === 'keep' && source.chapters.length > 0) {
    if (!container.supportsChapters) {
      warnings.push(
        t('warn.chaptersLost', { format: container.label, count: source.chapters.length })
      )
    }
  }

  if (settings.trim && (settings.trim.start || settings.trim.end)) {
    warnings.push(t('warn.trimmed'))
  }

  /* ----------------------------- verdict ----------------------------- */

  const relevant = streams.filter((s) => s.action !== 'drop')
  const encoded = relevant.filter((s) => s.action === 'encode' || s.action === 'burn')
  const copied = relevant.filter((s) => s.action === 'copy')

  const losslessEncodes = encoded.filter((s) => {
    const codec = getCodec(s.targetCodec ?? '')
    return codec?.lossless === true
  })

  let mode: ConversionMode
  let headline: string
  let detail: string

  // Stream kinds are named in the user's language inside the change list.
  const changeList = (): string =>
    encoded.map((s) => `${t(`common.${s.kind}`)} → ${s.targetCodec}`).join(', ')

  if (encoded.length === 0 && copied.length > 0) {
    mode = 'lossless-remux'
    headline = t('plan.remux.headline')
    detail =
      source.formatName.split(',')[0].toLowerCase() === container.id
        ? t('plan.remux.sameContainer')
        : t('plan.remux.detail', { format: container.label })
  } else if (encoded.length > 0 && encoded.length === losslessEncodes.length) {
    mode = 'lossless-encode'
    const names = [...new Set(losslessEncodes.map((s) => s.targetCodec))].join(', ')
    headline = t('plan.losslessEncode.headline')
    detail = t('plan.losslessEncode.detail', { codecs: names })
  } else if (copied.length > 0 && encoded.length > 0) {
    mode = 'mixed'
    headline = t('plan.mixed.headline')
    detail = t('plan.mixed.detail', { count: copied.length, changes: changeList() })
  } else {
    mode = 're-encode'
    headline = t('plan.encode.headline')
    detail = t('plan.encode.detail', { changes: changeList() })
  }

  // Would a pure remux have been possible with different settings?
  const losslessAvailable = canRemux(source, settings.container.format)

  const estimate = estimateOutput(source, settings, streams, mode)

  return {
    mode,
    headline,
    detail,
    losslessAvailable,
    streams,
    warnings,
    usesHardware,
    hardwareEncoder,
    ...estimate
  }
}

/* ------------------------------------------------------------------ */
/* Still images                                                        */
/* ------------------------------------------------------------------ */

/**
 * Plan for writing a single still image. Every image conversion decodes
 * and re-encodes one frame; it is only lossless when the target codec is.
 */
function planImage(
  source: MediaFile,
  settings: ConversionSettings,
  container: ContainerDef,
  t: (key: string, params?: Record<string, string | number>) => string
): ConversionPlan {
  const warnings: string[] = []
  const streams: StreamPlan[] = []
  const picture = source.streams.find(
    (s): s is VideoStream => s.kind === 'video' && !s.isAttachedPic
  ) ?? source.streams.find((s): s is VideoStream => s.kind === 'video')

  if (!picture) {
    return {
      mode: 're-encode',
      headline: t('plan.image.noPicture.headline'),
      detail: t('plan.image.noPicture.detail', { format: container.label }),
      losslessAvailable: false,
      streams: source.streams.map((s) => ({
        sourceIndex: s.index,
        kind: s.kind,
        action: 'drop' as const,
        reason: t('reason.imageNoAudio')
      })),
      warnings: [],
      usesHardware: false
    }
  }

  const target = container.videoCodecs[0] ?? 'png'
  const codec = getCodec(target)
  const image = settings.image
  const lossless = codec?.lossless === true || (target === 'webp' && (image?.quality ?? 0) >= 100)

  streams.push({
    sourceIndex: picture.index,
    kind: 'video',
    action: 'encode',
    targetCodec: target,
    reason: lossless
      ? t('reason.imageLossless', { format: container.label })
      : t('reason.imageLossy', { format: container.label, quality: image?.quality ?? 90 })
  })
  for (const stream of source.streams) {
    if (stream.index === picture.index) continue
    streams.push({
      sourceIndex: stream.index,
      kind: stream.kind,
      action: 'drop',
      reason: t('reason.imageNoAudio')
    })
  }

  if (!source.isImage) warnings.push(t('warn.videoToImage', { format: container.label }))

  if (pixelFormatHasAlpha(picture.pixelFormat) && !container.supportsAlpha) {
    warnings.push(t('warn.alphaFlattened', { format: container.label, color: image?.background ?? '#ffffff' }))
  }

  const width = image?.width ?? picture.width
  const height = image?.height ?? picture.height
  if (container.maxDimension && Math.max(width, height) > container.maxDimension) {
    warnings.push(t('warn.imageDownscaled', { format: container.label, size: container.maxDimension }))
  }

  const sizeChanged =
    (image?.width !== undefined && image.width !== picture.width) ||
    (image?.height !== undefined && image.height !== picture.height)

  const mode: ConversionMode = lossless && !sizeChanged ? 'lossless-encode' : 're-encode'

  return {
    mode,
    headline: mode === 'lossless-encode' ? t('plan.image.lossless.headline') : t('plan.image.lossy.headline'),
    detail: t(mode === 'lossless-encode' ? 'plan.image.lossless.detail' : 'plan.image.lossy.detail', {
      format: container.label
    }),
    losslessAvailable: false,
    streams,
    warnings,
    usesHardware: false,
    ...estimateImage(target, image?.quality ?? 90, width, height)
  }
}

/** Rough bytes-per-pixel per format; good enough to warn about disk space. */
function estimateImage(
  target: string,
  quality: number,
  width: number,
  height: number
): { estimatedSize: number; estimatedSizeRange: [number, number]; estimatedDuration: number } {
  const pixels = Math.max(1, width * height)
  const q = Math.min(100, Math.max(1, quality)) / 100
  const bytesPerPixel: Record<string, number> = {
    mjpeg: 0.08 + 0.5 * q * q,
    webp: q >= 1 ? 1.2 : 0.05 + 0.35 * q * q,
    av1: 0.03 + 0.25 * q * q,
    png: 1.5,
    tiff: 3,
    bmp: 3,
    targa: 3,
    gif: 0.6
  }
  const estimated = Math.round(pixels * (bytesPerPixel[target] ?? 1.5))
  // Image content swings compression a lot: a flat graphic and a noisy
  // photo of the same size can differ tenfold, so give a wide range.
  return {
    estimatedSize: estimated,
    estimatedSizeRange: [Math.round(estimated / 3), Math.round(estimated * 2)],
    estimatedDuration: target === 'av1' ? 3 : 1
  }
}

/* ------------------------------------------------------------------ */
/* Per-stream decisions                                                */
/* ------------------------------------------------------------------ */

interface VideoDecision {
  plan: StreamPlan
  action: 'copy' | 'encode'
  hardwareEncoder?: string
  warning?: string
}

function decideVideo(
  stream: VideoStream,
  settings: ConversionSettings,
  containerId: string,
  context: PlanContext,
  isPrimary: boolean
): VideoDecision {
  const container = CONTAINER_BY_ID.get(containerId)!
  const sourceCodec = normalizeCodec(stream.codec)
  const requested = settings.video.codec
  const t = tr(context)

  // Filters that force a decode/encode cycle.
  const needsScale =
    settings.video.width !== undefined || settings.video.height !== undefined
  const needsFps = settings.video.fps !== undefined && settings.video.fps !== stream.fps
  const needsBurn = settings.subtitles.action === 'burn'
  const forcedFilter = needsScale || needsFps || needsBurn

  const copyBlockers: string[] = []
  if (forcedFilter) {
    if (needsScale) copyBlockers.push(t('reason.blockerScale'))
    if (needsFps) copyBlockers.push(t('reason.blockerFps'))
    if (needsBurn) copyBlockers.push(t('reason.blockerBurn'))
  }

  const containerOk = containerAcceptsCodec(container, sourceCodec, 'video')

  // Explicit copy request.
  if (requested === 'copy') {
    if (!containerOk) {
      // The user asked to copy but the container refuses — fall back to the
      // container's default codec rather than producing a broken file.
      const fallback = container.videoCodecs.find((c) => c !== '*') ?? 'h264'
      const encoder = chooseEncoder(fallback, settings, context)
      return {
        plan: {
          sourceIndex: stream.index,
          kind: 'video',
          action: 'encode',
          targetCodec: fallback,
          reason: t('reason.cannotStore', {
            codec: sourceCodec.toUpperCase(),
            format: container.label,
            target: fallback.toUpperCase()
          })
        },
        action: 'encode',
        hardwareEncoder: encoder?.hardware,
        warning: t('warn.containerRejects', {
          format: container.label,
          codec: sourceCodec.toUpperCase(),
          target: fallback.toUpperCase()
        })
      }
    }
    if (forcedFilter) {
      const target = sourceCodec
      const encoder = chooseEncoder(target, settings, context)
      const reasons = copyBlockers.join(' + ')
      return {
        plan: {
          sourceIndex: stream.index,
          kind: 'video',
          action: 'encode',
          targetCodec: target,
          reason: t('reason.reencodedBecause', { reasons })
        },
        action: 'encode',
        hardwareEncoder: encoder?.hardware,
        warning: t('warn.copyImpossible', { reasons })
      }
    }
    return {
      plan: {
        sourceIndex: stream.index,
        kind: 'video',
        action: 'copy',
        reason: t('reason.copyAccepted', {
          format: container.label,
          codec: sourceCodec.toUpperCase()
        })
      },
      action: 'copy'
    }
  }

  const target = normalizeCodec(requested)

  // Same codec, no filters, container-compatible → copy is safe and lossless.
  if (!forcedFilter && target === sourceCodec && containerOk && isPrimary) {
    return {
      plan: {
        sourceIndex: stream.index,
        kind: 'video',
        action: 'copy',
        reason: t('reason.alreadyCodec', { codec: sourceCodec.toUpperCase() })
      },
      action: 'copy'
    }
  }

  // Secondary video streams are copied when possible.
  if (!isPrimary && containerOk && !forcedFilter) {
    return {
      plan: {
        sourceIndex: stream.index,
        kind: 'video',
        action: 'copy',
        reason: t('reason.extraTrackCopied')
      },
      action: 'copy'
    }
  }

  const encoder = chooseEncoder(target, settings, context)
  let warning: string | undefined

  if (!encoder) {
    warning = t('warn.noEncoder', { codec: target.toUpperCase() })
  }

  if (stream.isHDR && target !== sourceCodec) {
    const codec = getCodec(target)
    const hdrCapable = ['hevc', 'av1', 'vp9'].includes(codec?.id ?? '')
    if (!hdrCapable) {
      warning = t('warn.hdrLost', {
        hdr: stream.hdrFormat ?? 'HDR',
        codec: codec?.label ?? target
      })
    }
  }

  const reasonParts: string[] = []
  if (target !== sourceCodec) {
    reasonParts.push(
      t('reason.codecChange', { from: sourceCodec.toUpperCase(), to: target.toUpperCase() })
    )
  }
  if (copyBlockers.length) reasonParts.push(copyBlockers.join(', '))
  if (!reasonParts.length) reasonParts.push(t('reason.reencodeRequested'))

  return {
    plan: {
      sourceIndex: stream.index,
      kind: 'video',
      action: 'encode',
      targetCodec: target,
      reason: reasonParts.join(' · ')
    },
    action: 'encode',
    hardwareEncoder: encoder?.hardware,
    warning
  }
}

function chooseEncoder(
  codecId: string,
  settings: ConversionSettings,
  context: PlanContext
): { name: string; hardware?: string } | null {
  const codec = getCodec(codecId)
  if (!codec) return null

  const hw = pickHardwareEncoder(context.hardware, codec.id, settings.video.hardware)
  if (hw && context.availableEncoders.includes(hw.name)) {
    return { name: hw.name, hardware: hw.name }
  }

  const cpu = codec.encoders.find(
    (e) => e.vendor === 'cpu' && context.availableEncoders.includes(e.name)
  )
  if (cpu) return { name: cpu.name }

  const any = codec.encoders.find((e) => context.availableEncoders.includes(e.name))
  return any ? { name: any.name, hardware: any.vendor !== 'cpu' ? any.name : undefined } : null
}

interface AudioDecision {
  plan: StreamPlan
  warning?: string
}

function decideAudio(
  stream: AudioStream,
  settings: ConversionSettings,
  containerId: string,
  context: PlanContext
): AudioDecision {
  const container = CONTAINER_BY_ID.get(containerId)!
  const sourceCodec = normalizeCodec(stream.codec)
  const requested = settings.audio.codec
  const t = tr(context)

  const needsResample =
    settings.audio.sampleRate !== undefined && settings.audio.sampleRate !== stream.sampleRate
  const needsRemix =
    settings.audio.channels !== undefined && settings.audio.channels !== stream.channels
  const forced = needsResample || needsRemix

  const containerOk = containerAcceptsCodec(container, sourceCodec, 'audio')

  if (requested === 'copy') {
    if (!containerOk) {
      const fallback = container.audioCodecs.find((c) => c !== '*') ?? 'aac'
      return {
        plan: {
          sourceIndex: stream.index,
          kind: 'audio',
          action: 'encode',
          targetCodec: fallback,
          reason: t('reason.notValidIn', {
            codec: sourceCodec.toUpperCase(),
            format: container.label,
            target: fallback.toUpperCase()
          })
        },
        warning: t('warn.audioNotStorable', {
          format: container.label,
          codec: sourceCodec.toUpperCase(),
          target: fallback.toUpperCase()
        })
      }
    }
    if (forced) {
      return {
        plan: {
          sourceIndex: stream.index,
          kind: 'audio',
          action: 'encode',
          targetCodec: sourceCodec,
          reason: needsResample ? t('reason.resampleNeeded') : t('reason.remixNeeded')
        }
      }
    }
    return {
      plan: {
        sourceIndex: stream.index,
        kind: 'audio',
        action: 'copy',
        reason: t('reason.copyAccepted', {
          format: container.label,
          codec: sourceCodec.toUpperCase()
        })
      }
    }
  }

  const target = normalizeCodec(requested)

  if (!forced && target === sourceCodec && containerOk) {
    return {
      plan: {
        sourceIndex: stream.index,
        kind: 'audio',
        action: 'copy',
        reason: t('reason.alreadyCodec', { codec: sourceCodec.toUpperCase() })
      }
    }
  }

  const codec = getCodec(target)
  let warning: string | undefined

  // Warn about the one genuinely deceptive case: lossy → lossless.
  const sourceIsLossy = getCodec(sourceCodec)?.lossless === false
  if (codec?.lossless && sourceIsLossy) {
    warning = t('warn.lossyToLossless', {
      from: sourceCodec.toUpperCase(),
      to: codec.label
    })
  }

  if (target === 'dts') {
    warning = t('warn.dtsExperimental')
  }

  if (codec && !codec.encoders.some((e) => context.availableEncoders.includes(e.name))) {
    warning = t('warn.noCodecEncoder', { codec: codec.label })
  }

  return {
    plan: {
      sourceIndex: stream.index,
      kind: 'audio',
      action: 'encode',
      targetCodec: target,
      reason: t('reason.codecChange', {
        from: sourceCodec.toUpperCase(),
        to: target.toUpperCase()
      })
    },
    warning
  }
}

/* ------------------------------------------------------------------ */
/* Remux availability (drives the "Lossless available" badge)          */
/* ------------------------------------------------------------------ */

/**
 * True when every stream of `source` could be copied straight into
 * `containerFormat` with no re-encoding at all (spec §50).
 */
export function canRemux(source: MediaFile, containerFormat: string): boolean {
  const container = CONTAINER_BY_ID.get(containerFormat)
  // Writing an image always re-encodes the frame; there is no "remux".
  if (!container || container.kind === 'image' || source.isImage) return false

  const video = source.streams.filter(
    (s): s is VideoStream => s.kind === 'video' && !s.isAttachedPic
  )
  const audio = source.streams.filter((s): s is AudioStream => s.kind === 'audio')

  if (video.length > 0 && container.videoCodecs.length === 0) return false
  if (audio.length > 0 && container.audioCodecs.length === 0) return false
  if (video.length === 0 && audio.length === 0) return false

  for (const stream of video) {
    if (!containerAcceptsCodec(container, stream.codec, 'video')) return false
  }
  for (const stream of audio) {
    if (!containerAcceptsCodec(container, stream.codec, 'audio')) return false
  }
  return true
}

/**
 * List every container the source can be remuxed into losslessly.
 * Used by Smart Convert and by the format picker's "Lossless" badges.
 */
export function losslessTargets(source: MediaFile): string[] {
  return [...CONTAINER_BY_ID.keys()].filter((id) => canRemux(source, id))
}

/* ------------------------------------------------------------------ */
/* Size & time estimation (spec §48)                                   */
/* ------------------------------------------------------------------ */

interface Estimate {
  estimatedSize?: number
  estimatedSizeRange?: [number, number]
  estimatedDuration?: number
}

function estimateOutput(
  source: MediaFile,
  settings: ConversionSettings,
  streams: StreamPlan[],
  mode: ConversionMode
): Estimate {
  const duration = effectiveDuration(source, settings)
  if (duration <= 0) return {}

  if (mode === 'lossless-remux') {
    // Container overhead differs slightly but the payload is identical.
    const scale = duration / (source.duration || duration)
    const size = Math.round(source.size * scale)
    return {
      estimatedSize: size,
      estimatedSizeRange: [Math.round(size * 0.97), Math.round(size * 1.03)],
      estimatedDuration: Math.max(500, (source.size / (150 * 1024 * 1024)) * 1000)
    }
  }

  let bitsPerSecond = 0

  /* --------------------------- video part --------------------------- */
  const videoPlan = streams.find((s) => s.kind === 'video' && s.action !== 'drop')
  const sourceVideo = source.primaryVideo

  if (videoPlan && sourceVideo) {
    if (videoPlan.action === 'copy') {
      bitsPerSecond += sourceVideo.bitrate ?? estimateSourceVideoBitrate(source)
    } else {
      const width = settings.video.width ?? sourceVideo.width
      const height = settings.video.height ?? sourceVideo.height
      const fps = settings.video.fps ?? sourceVideo.fps ?? 30
      const codec = getCodec(videoPlan.targetCodec ?? 'h264')

      if (codec?.lossless) {
        // FFV1/lossless: roughly 40–60% of raw depending on content.
        bitsPerSecond += width * height * fps * 12 * 0.5
      } else if (settings.video.rateControl === 'bitrate' && settings.video.bitrate) {
        bitsPerSecond += settings.video.bitrate * 1000
      } else {
        bitsPerSecond += crfBitrateEstimate(
          width,
          height,
          fps,
          settings.video.crf ?? 20,
          codec?.efficiency ?? 1
        )
      }
    }
  }

  /* --------------------------- audio part --------------------------- */
  for (const plan of streams.filter((s) => s.kind === 'audio' && s.action !== 'drop')) {
    const stream = source.streams.find((s) => s.index === plan.sourceIndex) as
      | AudioStream
      | undefined
    if (plan.action === 'copy') {
      bitsPerSecond += stream?.bitrate ?? 192_000
      continue
    }
    const codec = getCodec(plan.targetCodec ?? 'aac')
    if (codec?.id.startsWith('pcm')) {
      const rate = settings.audio.sampleRate ?? stream?.sampleRate ?? 48_000
      const channels = settings.audio.channels ?? stream?.channels ?? 2
      const depth = settings.audio.bitDepth ?? (codec.id === 'pcm_s24le' ? 24 : 16)
      bitsPerSecond += rate * channels * depth
    } else if (codec?.lossless) {
      // FLAC/ALAC typically land near 55% of PCM.
      const rate = settings.audio.sampleRate ?? stream?.sampleRate ?? 44_100
      const channels = settings.audio.channels ?? stream?.channels ?? 2
      bitsPerSecond += rate * channels * 16 * 0.55
    } else {
      bitsPerSecond += (settings.audio.bitrate ?? 192) * 1000
    }
  }

  if (bitsPerSecond <= 0) return {}

  const size = Math.round((bitsPerSecond / 8) * duration * 1.005)

  // CRF output size is genuinely content-dependent; be honest about that.
  const isVariable =
    videoPlan?.action === 'encode' && settings.video.rateControl !== 'bitrate'
  const range: [number, number] = isVariable
    ? [Math.round(size * 0.6), Math.round(size * 1.5)]
    : [Math.round(size * 0.92), Math.round(size * 1.08)]

  return {
    estimatedSize: size,
    estimatedSizeRange: range,
    estimatedDuration: estimateTime(source, settings, streams, duration)
  }
}

function effectiveDuration(source: MediaFile, settings: ConversionSettings): number {
  const start = settings.trim?.start ?? 0
  const end = settings.trim?.end ?? source.duration
  return Math.max(0, Math.min(end, source.duration) - start)
}

function estimateSourceVideoBitrate(source: MediaFile): number {
  const audioBits = source.streams
    .filter((s): s is AudioStream => s.kind === 'audio')
    .reduce((sum, s) => sum + (s.bitrate ?? 192_000), 0)
  const total = source.bitrate ?? (source.duration > 0 ? (source.size * 8) / source.duration : 0)
  return Math.max(100_000, total - audioBits)
}

/**
 * Empirical CRF→bitrate model. Anchored on x264 at CRF 23, 1080p30 ≈ 4 Mbps,
 * with ~13% bitrate change per CRF step, scaled by resolution, frame rate
 * and codec efficiency.
 */
function crfBitrateEstimate(
  width: number,
  height: number,
  fps: number,
  crf: number,
  efficiency: number
): number {
  const pixels = Math.max(1, width * height)
  const referencePixels = 1920 * 1080
  const base = 4_000_000 * (pixels / referencePixels) * (fps / 30)
  const crfFactor = Math.pow(1.13, 23 - crf)
  return Math.max(50_000, base * crfFactor * efficiency)
}

/** Rough wall-clock estimate; the UI presents it as an approximation. */
function estimateTime(
  source: MediaFile,
  settings: ConversionSettings,
  streams: StreamPlan[],
  duration: number
): number {
  const videoPlan = streams.find((s) => s.kind === 'video' && s.action !== 'drop')
  if (!videoPlan || videoPlan.action === 'copy') {
    return Math.max(500, duration * 20)
  }

  const video = source.primaryVideo
  const width = settings.video.width ?? video?.width ?? 1920
  const height = settings.video.height ?? video?.height ?? 1080
  const pixelScale = (width * height) / (1920 * 1080)

  // Speed multipliers relative to real time at 1080p.
  const codecSpeed: Record<string, number> = {
    h264: 3.5,
    hevc: 1.2,
    av1: 0.35,
    vp9: 0.6,
    vp8: 2.5,
    prores: 2.5,
    dnxhd: 3,
    ffv1: 1.5,
    mpeg4: 8,
    mpeg2video: 8,
    theora: 3,
    gif: 2
  }
  let speed = codecSpeed[videoPlan.targetCodec ?? 'h264'] ?? 2

  const presetPenalty: Record<string, number> = {
    ultrafast: 4,
    superfast: 3,
    veryfast: 2.2,
    faster: 1.6,
    fast: 1.25,
    medium: 1,
    slow: 0.6,
    slower: 0.35,
    veryslow: 0.2,
    placebo: 0.05
  }
  speed *= presetPenalty[settings.video.preset ?? 'medium'] ?? 1

  // Hardware encoders are typically several times faster than CPU.
  if (settings.video.hardware !== 'cpu') speed *= 3

  const realTimeFactor = speed / Math.max(0.05, pixelScale)
  return Math.max(1000, (duration / realTimeFactor) * 1000)
}
