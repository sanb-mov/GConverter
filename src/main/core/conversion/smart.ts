/**
 * Smart Convert (spec §19).
 *
 * The user picks only a target format; GConverter derives everything else
 * from the source. The governing rule is spec §49: never silently degrade.
 * Resolution, frame rate and bit depth are preserved unless the target
 * genuinely cannot represent them.
 */

import type {
  AppSettings,
  ConversionProfile,
  ConversionSettings,
  HardwareCapabilities,
  MediaFile,
  QualityMode
} from '@shared/models'
import { CONTAINER_BY_ID, getCodec, normalizeCodec } from '@shared/formats'
import { canRemux } from './planner'
import { createDefaultSettings } from '../profiles/defaults'

export interface SmartContext {
  hardware: HardwareCapabilities | null
  availableEncoders: string[]
  settings: AppSettings
}

/**
 * Derive the best settings for converting `source` into `targetFormat`.
 *
 * Order of preference:
 *  1. Pure remux — instant and bit-exact.
 *  2. Copy whichever streams the container accepts, re-encode only the rest.
 *  3. Full re-encode at high quality using the best available encoder.
 */
export function smartConvert(
  source: MediaFile,
  targetFormat: string,
  context: SmartContext
): ConversionSettings {
  const container = CONTAINER_BY_ID.get(targetFormat)
  const quality: QualityMode = context.settings.conversion.defaultQuality
  const settings = createDefaultSettings(targetFormat, quality)

  if (!container) return settings

  settings.container.faststart = container.supportsFaststart
  settings.container.chapters = context.settings.conversion.preserveChapters ? 'keep' : 'remove'
  settings.container.attachments = container.supportsAttachments
  settings.subtitles.action = context.settings.conversion.preserveSubtitles ? 'keep' : 'remove'
  settings.metadata.action = context.settings.conversion.preserveMetadata ? 'keep' : 'remove'
  settings.video.hardware = context.settings.performance.hardwareAcceleration
    ? context.settings.performance.hardwarePreference
    : 'cpu'

  /* ------------------------- audio-only target ------------------------ */

  if (container.kind === 'audio') {
    settings.video.codec = 'none'
    settings.audio.codec = chooseAudioCodec(source, container.id, context)
    applyAudioDefaults(settings, source, container.id, quality)
    return settings
  }

  /* --------------------------- best case: remux ----------------------- */

  if (context.settings.conversion.preferLossless && canRemux(source, targetFormat)) {
    settings.video.codec = 'copy'
    settings.audio.codec = 'copy'
    settings.quality = 'lossless'
    return settings
  }

  /* -------------------------- per-stream choice ----------------------- */

  const sourceVideo = source.primaryVideo
  const sourceAudio = source.primaryAudio

  if (!sourceVideo) {
    settings.video.codec = 'none'
  } else {
    const sourceCodec = normalizeCodec(sourceVideo.codec)
    const videoOk =
      container.videoCodecs.includes('*') || container.videoCodecs.includes(sourceCodec)

    if (videoOk) {
      settings.video.codec = 'copy'
    } else {
      settings.video.codec = chooseVideoCodec(container.id, sourceVideo.isHDR, context)
      applyVideoDefaults(settings, source, quality, context)
    }
  }

  if (!sourceAudio) {
    settings.audio.codec = 'none'
  } else {
    const sourceCodec = normalizeCodec(sourceAudio.codec)
    const audioOk =
      container.audioCodecs.includes('*') || container.audioCodecs.includes(sourceCodec)
    settings.audio.codec = audioOk ? 'copy' : chooseAudioCodec(source, container.id, context)
    if (!audioOk) applyAudioDefaults(settings, source, container.id, quality)
  }

  return settings
}

/** Pick the best video codec a container supports, respecting HDR. */
function chooseVideoCodec(
  containerId: string,
  isHDR: boolean,
  context: SmartContext
): string {
  const container = CONTAINER_BY_ID.get(containerId)!

  // Preference order per container: quality/compatibility balance first.
  const preferences: Record<string, string[]> = {
    mp4: isHDR ? ['hevc', 'av1', 'h264'] : ['h264', 'hevc', 'av1'],
    mkv: isHDR ? ['hevc', 'av1', 'h264'] : ['h264', 'hevc', 'av1'],
    mov: ['h264', 'hevc', 'prores'],
    webm: ['vp9', 'av1', 'vp8'],
    avi: ['mpeg4', 'h264'],
    mpegts: ['h264', 'hevc', 'mpeg2video'],
    mpeg: ['mpeg2video', 'mpeg1video'],
    flv: ['h264'],
    wmv: ['wmv2'],
    ogv: ['theora'],
    '3gp': ['h264', 'mpeg4'],
    gif: ['gif']
  }

  const wanted = preferences[containerId] ?? ['h264']
  for (const codecId of wanted) {
    if (!container.videoCodecs.includes('*') && !container.videoCodecs.includes(codecId)) continue
    const codec = getCodec(codecId)
    if (!codec) continue
    const hasEncoder = codec.encoders.some((e) => context.availableEncoders.includes(e.name))
    if (hasEncoder) return codecId
  }
  return 'h264'
}

function chooseAudioCodec(
  source: MediaFile,
  containerId: string,
  context: SmartContext
): string {
  const container = CONTAINER_BY_ID.get(containerId)!
  const sourceCodec = normalizeCodec(source.primaryAudio?.codec ?? '')
  const sourceIsLossless = getCodec(sourceCodec)?.lossless === true

  // A lossless source stays lossless when the container allows it — going
  // lossless → lossy without being asked would violate spec §49.
  const preferences: Record<string, string[]> = sourceIsLossless
    ? {
        mp4: ['alac', 'flac', 'aac'],
        mkv: ['flac', 'alac', 'aac'],
        mov: ['alac', 'pcm_s24le', 'aac'],
        m4a: ['alac', 'aac'],
        flac: ['flac'],
        wav: ['pcm_s24le'],
        aiff: ['pcm_s16be'],
        ogg: ['flac', 'opus', 'vorbis'],
        webm: ['opus', 'vorbis'],
        opus: ['opus'],
        mp3: ['mp3'],
        aac: ['aac'],
        wma: ['wmav2'],
        ac3: ['ac3'],
        dts: ['dts'],
        avi: ['pcm_s16le', 'mp3'],
        mpegts: ['ac3', 'aac'],
        mpeg: ['mp2', 'mp3'],
        flv: ['aac'],
        wmv: ['wmav2'],
        ogv: ['flac', 'vorbis'],
        '3gp': ['aac']
      }
    : {
        mp4: ['aac'],
        mkv: ['aac', 'opus'],
        mov: ['aac'],
        m4a: ['aac'],
        flac: ['flac'],
        wav: ['pcm_s16le'],
        aiff: ['pcm_s16be'],
        ogg: ['vorbis', 'opus'],
        webm: ['opus', 'vorbis'],
        opus: ['opus'],
        mp3: ['mp3'],
        aac: ['aac'],
        wma: ['wmav2'],
        ac3: ['ac3'],
        dts: ['dts'],
        avi: ['mp3'],
        mpegts: ['aac', 'ac3'],
        mpeg: ['mp2', 'mp3'],
        flv: ['aac'],
        wmv: ['wmav2'],
        ogv: ['vorbis'],
        '3gp': ['aac']
      }

  const wanted = preferences[containerId] ?? ['aac']
  for (const codecId of wanted) {
    if (!container.audioCodecs.includes('*') && !container.audioCodecs.includes(codecId)) continue
    const codec = getCodec(codecId)
    if (codec?.encoders.some((e) => context.availableEncoders.includes(e.name))) return codecId
  }
  return container.audioCodecs.find((c) => c !== '*') ?? 'aac'
}

function applyVideoDefaults(
  settings: ConversionSettings,
  source: MediaFile,
  quality: QualityMode,
  context: SmartContext
): void {
  const codec = getCodec(settings.video.codec as string)
  if (!codec) return

  const video = source.primaryVideo
  settings.video.rateControl = codec.lossless ? 'lossless' : 'crf'

  // Preserve bit depth: an HDR or 10-bit source stays 10-bit.
  if (video?.pixelFormat?.includes('10') || video?.isHDR) {
    settings.video.tenBit = true
  }

  // Preset choice trades encode time for efficiency, never quality target.
  const encoder = codec.encoders.find((e) => context.availableEncoders.includes(e.name))
  if (encoder?.presets?.length) {
    settings.video.preset = encoder.presets.includes('medium') ? 'medium' : encoder.presets[0]
  }

  // Long 4K sources with a slow codec would take hours on CPU; prefer GPU.
  const pixels = (video?.width ?? 0) * (video?.height ?? 0)
  if (pixels >= 3840 * 2160 && context.hardware?.accelerationAvailable) {
    settings.video.hardware = context.settings.performance.hardwarePreference
  }

  settings.quality = quality
}

function applyAudioDefaults(
  settings: ConversionSettings,
  source: MediaFile,
  containerId: string,
  quality: QualityMode
): void {
  const codec = getCodec(settings.audio.codec as string)
  if (!codec) return

  const audio = source.primaryAudio
  const channels = audio?.channels ?? 2

  if (codec.lossless) {
    // Keep the original bit depth and sample rate for lossless targets.
    const depth = audio?.bitsPerRawSample ?? audio?.bitsPerSample
    if (depth && depth >= 24) settings.audio.bitDepth = 24
    if (codec.id === 'flac') settings.audio.compressionLevel = 8
    return
  }

  const perChannel: Record<QualityMode, number> = {
    lossless: 160,
    maximum: 160,
    'very-high': 128,
    high: 112,
    balanced: 80,
    custom: 112
  }

  // Opus is far more efficient than AAC/MP3 — asking for 320 kbps wastes space.
  const efficiencyFactor = codec.id === 'opus' ? 0.6 : codec.id === 'mp3' ? 1.15 : 1

  let bitrate = Math.round(perChannel[quality] * Math.max(1, Math.min(channels, 8)) * efficiencyFactor)

  // Never exceed what the codec can usefully deliver.
  const caps: Record<string, number> = { mp3: 320, opus: 510, aac: 512, vorbis: 500, ac3: 640 }
  bitrate = Math.min(bitrate, caps[codec.id] ?? 512)

  settings.audio.bitrate = bitrate

  // Never upsample; only clamp when the codec requires it.
  if (codec.id === 'opus') settings.audio.sampleRate = 48000
}

/**
 * Apply a preset's resolution/frame-rate caps to a specific source.
 * Caps only ever reduce; a 720p source run through a 1080p preset is
 * left at 720p (spec §49).
 */
export function applyProfileCaps(
  profile: ConversionProfile,
  source: MediaFile
): ConversionSettings {
  const settings: ConversionSettings = structuredClone(profile.settings)
  const video = source.primaryVideo
  if (!video || !video.width || !video.height) return settings

  const { maxWidth, maxHeight, maxFps } = profile

  if (maxWidth || maxHeight) {
    // Respect orientation: a vertical video capped at "1080x1920" should be
    // compared against the larger of the two limits on its long edge.
    const isPortrait = video.height > video.width
    const limitLong = Math.max(maxWidth ?? Infinity, maxHeight ?? Infinity)
    const limitShort = Math.min(maxWidth ?? Infinity, maxHeight ?? Infinity)

    const longEdge = isPortrait ? video.height : video.width
    const shortEdge = isPortrait ? video.width : video.height

    const scale = Math.min(1, limitLong / longEdge, limitShort / shortEdge)

    if (scale < 1) {
      const targetW = evenDown(Math.round(video.width * scale))
      const targetH = evenDown(Math.round(video.height * scale))
      settings.video.width = targetW
      settings.video.height = targetH
      settings.video.scaleMode = 'fit'
      // Downscaling forces a re-encode; a copy request would be meaningless.
      if (settings.video.codec === 'copy') settings.video.codec = 'h264'
    }
  }

  if (maxFps && video.fps && video.fps > maxFps + 0.01) {
    settings.video.fps = maxFps
    if (settings.video.codec === 'copy') settings.video.codec = 'h264'
  }

  return settings
}

/** Codecs require even dimensions; round down so we never invent pixels. */
function evenDown(value: number): number {
  return value % 2 === 0 ? value : value - 1
}

/**
 * Describe, in one sentence, what a preset will do to this particular file.
 * Shown under the preset so nothing is a surprise (spec §49, §64).
 */
export function describeProfileEffect(
  profile: ConversionProfile,
  source: MediaFile
): string[] {
  const notes: string[] = []
  const video = source.primaryVideo
  const applied = applyProfileCaps(profile, source)

  if (video && applied.video.width && applied.video.width !== video.width) {
    notes.push(
      `Resolution reduced from ${video.width}×${video.height} to ${applied.video.width}×${applied.video.height}`
    )
  }
  if (video && applied.video.fps && video.fps && applied.video.fps < video.fps) {
    notes.push(`Frame rate reduced from ${video.fps} to ${applied.video.fps} fps`)
  }
  if (applied.subtitles.action === 'remove' && source.hasSubtitles) {
    notes.push('Subtitle tracks removed')
  }
  if (applied.audio.codec === 'none' && source.hasAudio) {
    notes.push('Audio removed')
  }
  if (applied.video.codec === 'none' && source.hasVideo) {
    notes.push('Video removed — audio only')
  }
  return notes
}
