/**
 * Turns a (source, settings, plan) triple into a concrete FFmpeg command.
 *
 * This is the only place that knows FFmpeg's flag vocabulary. The planner
 * decides *what* should happen; this module expresses *how* to ask FFmpeg
 * for it.
 */

import type {
  AudioStream,
  ConversionPlan,
  ConversionSettings,
  HardwareCapabilities,
  MediaFile,
  VideoStream
} from '@shared/models'
import { CONTAINER_BY_ID, getCodec, qualityToValue } from '@shared/formats'
import { pickHardwareEncoder } from '../hardware/detector'
import { FFmpegCommandBuilder, escapeFilterPath } from '../ffmpeg/commandBuilder'

export interface BuildContext {
  hardware: HardwareCapabilities | null
  availableEncoders: string[]
  threads: number
}

export interface BuiltCommand {
  builder: FFmpegCommandBuilder
  args: string[]
  /** Encoder actually selected for video, for display and logging. */
  videoEncoder?: string
  audioEncoder?: string
}

export function buildConversionCommand(
  source: MediaFile,
  settings: ConversionSettings,
  plan: ConversionPlan,
  outputPath: string,
  context: BuildContext
): BuiltCommand {
  const container = CONTAINER_BY_ID.get(settings.container.format)
  if (!container) throw new Error(`Unknown output container: ${settings.container.format}`)

  const builder = FFmpegCommandBuilder.create().overwrite(true).progressToStdout()

  /* ---------------------------- input side --------------------------- */

  const inputPre: string[] = []

  // Fast-seek before -i is dramatically quicker for trims.
  if (settings.trim?.start) {
    inputPre.push('-ss', String(settings.trim.start))
  }

  // Hardware-accelerated *decoding* only helps when we also encode on the
  // same device; enabling it for stream copy just adds risk.
  const videoPlan = plan.streams.find((s) => s.kind === 'video' && s.action === 'encode')
  if (videoPlan && plan.usesHardware && settings.video.hardware !== 'cpu') {
    const vendor = plan.hardwareEncoder ?? ''
    if (vendor.includes('nvenc')) inputPre.push('-hwaccel', 'cuda')
    else if (vendor.includes('qsv')) inputPre.push('-hwaccel', 'qsv')
    else if (vendor.includes('videotoolbox')) inputPre.push('-hwaccel', 'videotoolbox')
    else if (vendor.includes('amf') && process.platform === 'win32') {
      inputPre.push('-hwaccel', 'd3d11va')
    }
  }

  builder.input(source.path, inputPre)

  // A separate subtitle file to mux in (not burn).
  let externalSubtitleInput = -1
  if (
    settings.subtitles.externalPath &&
    settings.subtitles.action === 'keep' &&
    container.subtitleCodecs.length > 0
  ) {
    builder.input(settings.subtitles.externalPath)
    externalSubtitleInput = builder.inputCount - 1
  }

  if (settings.trim?.end !== undefined) {
    const start = settings.trim.start ?? 0
    builder.duration(Math.max(0, settings.trim.end - start))
  }

  /* ------------------------------- maps ------------------------------ */

  const burnPlan = plan.streams.find((s) => s.action === 'burn')
  const videoFilters: string[] = []

  const keptVideo = plan.streams.filter((s) => s.kind === 'video' && s.action !== 'drop')
  const keptAudio = plan.streams.filter((s) => s.kind === 'audio' && s.action !== 'drop')
  const keptSubs = plan.streams.filter((s) => s.kind === 'subtitle' && s.action === 'copy')
  const encodedSubs = plan.streams.filter((s) => s.kind === 'subtitle' && s.action === 'encode')

  for (const stream of keptVideo) builder.map(`0:${stream.sourceIndex}`)
  for (const stream of keptAudio) builder.map(`0:${stream.sourceIndex}`)
  for (const stream of [...keptSubs, ...encodedSubs]) builder.map(`0:${stream.sourceIndex}`)

  if (externalSubtitleInput >= 0) builder.map(`${externalSubtitleInput}:0`)

  if (settings.container.attachments && container.supportsAttachments) {
    const attachments = source.streams.filter((s) => s.kind === 'attachment')
    for (const stream of attachments) builder.map(`0:${stream.index}`)
    if (attachments.length) builder.streamOption('c:t', 'copy')
  }

  /* ------------------------------ video ------------------------------ */

  let videoEncoder: string | undefined

  if (keptVideo.length === 0) {
    builder.streamOption('vn')
  } else {
    const encodePlans = keptVideo.filter((s) => s.action === 'encode')
    const copyPlans = keptVideo.filter((s) => s.action === 'copy')

    if (encodePlans.length === 0) {
      builder.videoCodec('copy')
    } else {
      // Extra video tracks that are copied while the primary is encoded.
      if (copyPlans.length > 0) {
        for (let i = 0; i < keptVideo.length; i++) {
          if (keptVideo[i].action === 'copy') builder.videoCodec('copy', i)
        }
      }

      const target = encodePlans[0].targetCodec ?? 'h264'
      const codec = getCodec(target)
      const sourceVideo = source.primaryVideo

      const hw = pickHardwareEncoder(context.hardware, target, settings.video.hardware)
      const useHw = hw && context.availableEncoders.includes(hw.name)
      const encoderDef =
        (useHw ? codec?.encoders.find((e) => e.name === hw!.name) : undefined) ??
        codec?.encoders.find(
          (e) => e.vendor === 'cpu' && context.availableEncoders.includes(e.name)
        ) ??
        codec?.encoders.find((e) => context.availableEncoders.includes(e.name)) ??
        codec?.encoders[0]

      if (!encoderDef) {
        throw new Error(`No usable encoder found for ${target}`)
      }

      videoEncoder = encoderDef.name
      builder.videoCodec(encoderDef.name, copyPlans.length > 0 ? keptVideo.findIndex((s) => s.action === 'encode') : undefined)

      /* --------------------- rate control & quality -------------------- */

      const isLosslessCodec = codec?.lossless === true

      if (isLosslessCodec) {
        // FFV1 etc. — no quality flag; tune for compression instead.
        if (encoderDef.name === 'ffv1') {
          builder.streamOption('level', '3')
          builder.streamOption('coder', '1')
          builder.streamOption('context', '1')
          builder.streamOption('g', '1')
          builder.streamOption('slices', '24')
          builder.streamOption('slicecrc', '1')
        }
      } else if (settings.video.rateControl === 'lossless') {
        // Lossless mode inside a lossy codec (x264/x265 -qp 0).
        if (encoderDef.name === 'libx264' || encoderDef.name === 'libx265') {
          builder.streamOption('x' + (encoderDef.name === 'libx264' ? '264' : '265') + '-params', 'lossless=1')
        } else if (encoderDef.qualityFlag) {
          builder.quality(encoderDef.qualityFlag, encoderDef.qualityRange?.[0] ?? 0)
        }
      } else if (settings.video.rateControl === 'bitrate' && settings.video.bitrate) {
        builder.videoBitrate(settings.video.bitrate)
        if (settings.video.maxBitrate) builder.maxrate(settings.video.maxBitrate)
        if (settings.video.bufSize) builder.bufsize(settings.video.bufSize)
      } else if (settings.video.rateControl === 'constrained' && settings.video.bitrate) {
        builder.videoBitrate(settings.video.bitrate)
        builder.maxrate(settings.video.maxBitrate ?? settings.video.bitrate * 1.5)
        builder.bufsize(settings.video.bufSize ?? settings.video.bitrate * 2)
        if (encoderDef.qualityFlag === 'crf' && settings.video.crf !== undefined) {
          builder.crf(settings.video.crf)
        }
      } else if (encoderDef.qualityFlag) {
        const value =
          settings.video.crf ?? qualityToValue(settings.quality, encoderDef)
        builder.quality(encoderDef.qualityFlag, value)

        // NVENC/QSV need an explicit VBR mode for CQ/global_quality to apply.
        if (encoderDef.qualityFlag === 'cq') {
          builder.streamOption('rc', 'vbr')
          builder.streamOption('b:v', '0')
        } else if (encoderDef.qualityFlag === 'global_quality') {
          builder.streamOption('look_ahead', '1')
        } else if (encoderDef.qualityFlag === 'qp' && encoderDef.vendor === 'amd') {
          builder.streamOption('rc', 'cqp')
          builder.streamOption('qp_i', String(value))
          builder.streamOption('qp_p', String(value))
        }
      }

      /* ------------------------ encoder tuning ------------------------ */

      if (settings.video.preset && encoderDef.presets?.includes(settings.video.preset)) {
        builder.preset(settings.video.preset)
      }
      if (settings.video.tune) builder.tune(settings.video.tune)
      if (settings.video.profile) builder.profile(settings.video.profile, 'v')
      if (settings.video.level) builder.level(settings.video.level)
      if (settings.video.gop) builder.gop(settings.video.gop)
      if (settings.video.bFrames !== undefined) builder.bFrames(settings.video.bFrames)
      if (settings.video.refFrames !== undefined) builder.refFrames(settings.video.refFrames)

      /* -------------------------- pixel format ------------------------ */

      let pixelFormat = settings.video.pixelFormat
      if (!pixelFormat && settings.video.tenBit) {
        pixelFormat = encoderDef.vendor === 'cpu' ? 'yuv420p10le' : 'p010le'
      }
      if (!pixelFormat && sourceVideo?.pixelFormat && encoderDef.pixelFormats) {
        // Keep the source format when the encoder supports it; otherwise let
        // FFmpeg pick, rather than silently forcing 8-bit on HDR content.
        if (encoderDef.pixelFormats.includes(sourceVideo.pixelFormat)) {
          pixelFormat = sourceVideo.pixelFormat
        } else if (sourceVideo.isHDR && encoderDef.supportsTenBit) {
          pixelFormat = encoderDef.vendor === 'cpu' ? 'yuv420p10le' : 'p010le'
        }
      }
      // MP4 + H.264 in some players requires yuv420p; only force it when the
      // source is an exotic format the container will not carry.
      if (pixelFormat) builder.pixelFormat(pixelFormat)

      /* ----------------------- colour preservation -------------------- */

      if (sourceVideo?.isHDR) {
        if (sourceVideo.colorPrimaries) {
          builder.streamOption('color_primaries', sourceVideo.colorPrimaries)
        }
        if (sourceVideo.colorTransfer) {
          builder.streamOption('color_trc', sourceVideo.colorTransfer)
        }
        if (sourceVideo.colorSpace) {
          builder.streamOption('colorspace', sourceVideo.colorSpace)
        }
      }
      if (settings.video.colorSpace) builder.streamOption('colorspace', settings.video.colorSpace)
      if (settings.video.colorRange) builder.streamOption('color_range', settings.video.colorRange)

      /* ---------------------------- filters --------------------------- */

      const scaleFilter = buildScaleFilter(settings, sourceVideo)
      if (scaleFilter) videoFilters.push(scaleFilter)

      if (settings.video.fps) builder.fps(settings.video.fps)

      if (target === 'gif') {
        // A shared palette is what separates an acceptable GIF from a terrible one.
        videoFilters.push('split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3')
      }
    }
  }

  /* ------------------------- burned subtitles ------------------------ */

  if (burnPlan) {
    const path = settings.subtitles.externalPath ?? source.path
    const escaped = escapeFilterPath(path)
    if (settings.subtitles.externalPath) {
      videoFilters.push(`subtitles='${escaped}'`)
    } else {
      // Index is relative to subtitle streams, not absolute stream index.
      const subtitleStreams = source.streams.filter((s) => s.kind === 'subtitle')
      const relative = Math.max(
        0,
        subtitleStreams.findIndex((s) => s.index === burnPlan.sourceIndex)
      )
      videoFilters.push(`subtitles='${escaped}':si=${relative}`)
    }
  }

  if (videoFilters.length) {
    builder.videoFilter(videoFilters.join(','))
  }

  /* ------------------------------ audio ------------------------------ */

  let audioEncoder: string | undefined

  if (keptAudio.length === 0) {
    builder.streamOption('an')
  } else {
    const encodePlans = keptAudio.filter((s) => s.action === 'encode')

    if (encodePlans.length === 0) {
      builder.audioCodec('copy')
    } else {
      const target = encodePlans[0].targetCodec ?? 'aac'
      const codec = getCodec(target)
      const encoderDef =
        codec?.encoders.find((e) => context.availableEncoders.includes(e.name)) ??
        codec?.encoders[0]

      if (!encoderDef) throw new Error(`No usable encoder found for ${target}`)
      audioEncoder = encoderDef.name

      // Mixed copy/encode across multiple audio tracks.
      if (encodePlans.length !== keptAudio.length) {
        for (let i = 0; i < keptAudio.length; i++) {
          builder.audioCodec(keptAudio[i].action === 'copy' ? 'copy' : encoderDef.name, i)
        }
      } else {
        builder.audioCodec(encoderDef.name)
      }

      const sourceAudio = source.primaryAudio

      if (codec?.lossless) {
        // Lossless audio: bit depth matters, bitrate does not.
        const depth = settings.audio.bitDepth
        if (codec.id === 'flac') {
          builder.streamOption(
            'compression_level',
            String(settings.audio.compressionLevel ?? 8)
          )
          if (depth === 24) builder.sampleFormat('s32')
          else if (depth === 16) builder.sampleFormat('s16')
        } else if (codec.id.startsWith('pcm')) {
          // Encoder name already encodes the depth (pcm_s24le etc.).
        } else if (codec.id === 'alac') {
          if (depth === 24) builder.sampleFormat('s32p')
        }
      } else if (settings.audio.vbr && encoderDef.qualityFlag === 'qscale') {
        builder.streamOption('q:a', String(settings.audio.qualityLevel ?? encoderDef.defaultQuality ?? 2))
      } else if (settings.audio.bitrate) {
        builder.audioBitrate(settings.audio.bitrate)
      }

      if (settings.audio.sampleRate) builder.sampleRate(settings.audio.sampleRate)
      if (settings.audio.channels) builder.channels(settings.audio.channels)

      // Opus only accepts a fixed set of rates; 48 kHz is the safe universal choice.
      if (codec?.id === 'opus' && !settings.audio.sampleRate) {
        const rate = sourceAudio?.sampleRate ?? 48_000
        if (![8000, 12000, 16000, 24000, 48000].includes(rate)) builder.sampleRate(48_000)
      }

      if (settings.audio.extraArgs?.length) {
        builder.streamOption(settings.audio.extraArgs[0], ...settings.audio.extraArgs.slice(1))
      }
    }
  }

  /* ---------------------------- subtitles ---------------------------- */

  if (keptSubs.length > 0 && encodedSubs.length === 0 && externalSubtitleInput < 0) {
    builder.subtitleCodec('copy')
  } else if (encodedSubs.length > 0 || externalSubtitleInput >= 0) {
    const target = encodedSubs[0]?.targetCodec ?? (container.id === 'mp4' ? 'mov_text' : 'srt')
    builder.subtitleCodec(target)
  }

  /* ---------------------------- metadata ----------------------------- */

  if (settings.metadata.action === 'remove') {
    builder.mapMetadata('-1')
  } else {
    builder.mapMetadata(0)
    if (settings.metadata.action === 'custom' && settings.metadata.fields) {
      for (const [key, value] of Object.entries(settings.metadata.fields)) {
        if (value !== undefined) builder.metadata(key, value)
      }
    }
  }

  if (settings.container.chapters === 'remove' || !container.supportsChapters) {
    builder.mapChapters('-1')
  } else {
    builder.mapChapters(0)
  }

  builder.metadata('encoder', 'GConverter')

  /* ---------------------------- container ---------------------------- */

  const movflags: string[] = []
  if (container.supportsFaststart && settings.container.faststart) movflags.push('faststart')
  if (settings.container.fragmentedMp4) movflags.push('frag_keyframe', 'empty_moov')
  if (movflags.length) builder.movflags(...movflags)

  if (container.muxer) builder.format(container.muxer)

  // MPEG-TS/AVI need a global header tweak when copying certain codecs.
  if (container.id === 'mpegts') builder.outputOption('-mpegts_copyts', '1')

  /* ----------------------------- threads ----------------------------- */

  if (context.threads > 0) builder.threads(context.threads)

  if (settings.customArgs?.length) {
    builder.outputOption(...settings.customArgs)
  }

  builder.output(outputPath)

  return { builder, args: builder.build(), videoEncoder, audioEncoder }
}

/**
 * Build a scale filter. GConverter never upscales implicitly and always
 * keeps the aspect ratio unless the user explicitly picks 'stretch'
 * (spec §49).
 */
function buildScaleFilter(
  settings: ConversionSettings,
  source: VideoStream | undefined
): string | null {
  const { width, height, scaleMode = 'fit' } = settings.video
  if (width === undefined && height === undefined) return null

  // -2 keeps the dimension divisible by 2, which every codec requires.
  if (width !== undefined && height === undefined) return `scale=${width}:-2:flags=lanczos`
  if (height !== undefined && width === undefined) return `scale=-2:${height}:flags=lanczos`

  if (scaleMode === 'stretch') return `scale=${width}:${height}:flags=lanczos`
  if (scaleMode === 'fill') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`
  }
  // fit: letterbox rather than crop, so no picture is ever lost.
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
}

/**
 * Command for extracting a single audio stream (spec §20), copying the
 * codec when the target container accepts it.
 */
export function buildExtractAudioCommand(
  source: MediaFile,
  audioStream: AudioStream,
  targetFormat: string,
  outputPath: string,
  bitrate?: number
): BuiltCommand {
  const container = CONTAINER_BY_ID.get(targetFormat)
  if (!container) throw new Error(`Unknown audio container: ${targetFormat}`)

  const builder = FFmpegCommandBuilder.create().overwrite(true).progressToStdout()
  builder.input(source.path)
  builder.map(`0:${audioStream.index}`)
  builder.streamOption('vn')

  const canCopy = container.audioCodecs.includes(audioStream.codec)
  if (canCopy) {
    builder.audioCodec('copy')
  } else {
    const target = container.audioCodecs[0]
    const codec = getCodec(target)
    const encoder = codec?.encoders[0]?.name ?? target
    builder.audioCodec(encoder)
    if (!codec?.lossless && bitrate) builder.audioBitrate(bitrate)
  }

  builder.mapMetadata(0)
  if (container.muxer) builder.format(container.muxer)
  builder.output(outputPath)

  return { builder, args: builder.build() }
}
