import { describe, expect, it } from 'vitest'
import type { AudioStream, MediaFile, SubtitleStream, VideoStream } from '../src/shared/models'
import { canRemux, losslessTargets, planConversion } from '../src/main/core/conversion/planner'
import { createDefaultSettings } from '../src/main/core/profiles/defaults'

/* ------------------------------- helpers ------------------------------- */

const ALL_ENCODERS = [
  'libx264', 'libx265', 'libsvtav1', 'libvpx', 'libvpx-vp9', 'mpeg4', 'mpeg2video',
  'prores_ks', 'ffv1', 'libtheora', 'gif', 'aac', 'libmp3lame', 'libopus',
  'libvorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'ac3', 'eac3',
  'h264_nvenc', 'hevc_nvenc'
]

const context = { hardware: null, availableEncoders: ALL_ENCODERS }

function videoStream(overrides: Partial<VideoStream> = {}): VideoStream {
  return {
    index: 0,
    kind: 'video',
    codec: 'h264',
    isDefault: true,
    isForced: false,
    width: 1920,
    height: 1080,
    fps: 25,
    pixelFormat: 'yuv420p',
    isHDR: false,
    isAttachedPic: false,
    ...overrides
  }
}

function audioStream(overrides: Partial<AudioStream> = {}): AudioStream {
  return {
    index: 1,
    kind: 'audio',
    codec: 'aac',
    isDefault: true,
    isForced: false,
    sampleRate: 48000,
    channels: 2,
    ...overrides
  }
}

function subtitleStream(overrides: Partial<SubtitleStream> = {}): SubtitleStream {
  return {
    index: 2,
    kind: 'subtitle',
    codec: 'subrip',
    isDefault: false,
    isForced: false,
    isBitmap: false,
    ...overrides
  }
}

function mediaFile(streams: MediaFile['streams'], overrides: Partial<MediaFile> = {}): MediaFile {
  const video = streams.find((s): s is VideoStream => s.kind === 'video')
  const audio = streams.find((s): s is AudioStream => s.kind === 'audio')
  return {
    id: 'test',
    path: '/tmp/test.mkv',
    name: 'test.mkv',
    directory: '/tmp',
    extension: 'mkv',
    size: 100_000_000,
    formatName: 'matroska,webm',
    duration: 600,
    bitrate: 1_333_333,
    streams,
    chapters: [],
    metadata: {},
    primaryVideo: video,
    primaryAudio: audio,
    hasVideo: !!video,
    hasAudio: !!audio,
    hasSubtitles: streams.some((s) => s.kind === 'subtitle'),
    probedAt: Date.now(),
    ...overrides
  }
}

/* -------------------------------- tests -------------------------------- */

describe('remux detection (spec §50)', () => {
  it('detects H.264 + AAC as remuxable from MKV to MP4', () => {
    const file = mediaFile([videoStream(), audioStream()])
    expect(canRemux(file, 'mp4')).toBe(true)
  })

  it('rejects a remux when the container cannot hold the codec', () => {
    // VP9 + Opus cannot go into AVI.
    const file = mediaFile([videoStream({ codec: 'vp9' }), audioStream({ codec: 'opus' })])
    expect(canRemux(file, 'avi')).toBe(false)
  })

  it('accepts anything into MKV', () => {
    const file = mediaFile([videoStream({ codec: 'prores' }), audioStream({ codec: 'dts' })])
    expect(canRemux(file, 'mkv')).toBe(true)
  })

  it('rejects video into an audio-only container', () => {
    const file = mediaFile([videoStream(), audioStream()])
    expect(canRemux(file, 'mp3')).toBe(false)
  })

  it('lists every lossless target for a file', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const targets = losslessTargets(file)
    expect(targets).toContain('mp4')
    expect(targets).toContain('mkv')
    expect(targets).toContain('mov')
    expect(targets).not.toContain('webm')
  })
})

describe('planConversion', () => {
  it('reports a lossless remux when only the container changes', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mp4')
    const plan = planConversion(file, settings, context)

    expect(plan.mode).toBe('lossless-remux')
    expect(plan.headline).toMatch(/lossless/i)
    expect(plan.streams.every((s) => s.action === 'copy')).toBe(true)
  })

  it('never claims lossless when the video codec changes', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'hevc'
    const plan = planConversion(file, settings, context)

    expect(plan.mode).not.toBe('lossless-remux')
    expect(plan.headline).not.toMatch(/^lossless/i)
    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('encode')
  })

  it('treats FFV1 + FLAC as a lossless encode, not a lossy one', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mkv')
    settings.video.codec = 'ffv1'
    settings.audio.codec = 'flac'
    const plan = planConversion(file, settings, context)

    expect(plan.mode).toBe('lossless-encode')
    expect(plan.headline).toMatch(/lossless/i)
  })

  it('reports "mixed" when video is copied but audio is re-encoded', () => {
    const file = mediaFile([videoStream(), audioStream({ codec: 'dts' })])
    const settings = createDefaultSettings('mp4')
    const plan = planConversion(file, settings, context)

    expect(plan.mode).toBe('mixed')
    const audioPlan = plan.streams.find((s) => s.kind === 'audio')
    expect(audioPlan?.action).toBe('encode')
    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('copy')
  })

  it('forces a re-encode when the resolution changes', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mp4')
    settings.video.width = 1280
    settings.video.height = 720
    const plan = planConversion(file, settings, context)

    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('encode')
    expect(plan.mode).not.toBe('lossless-remux')
  })

  it('forces a re-encode when the frame rate changes', () => {
    const file = mediaFile([videoStream({ fps: 60 }), audioStream()])
    const settings = createDefaultSettings('mp4')
    settings.video.fps = 30
    const plan = planConversion(file, settings, context)

    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('encode')
  })

  it('drops subtitles and warns when the container cannot store them', () => {
    const file = mediaFile([videoStream(), audioStream(), subtitleStream()])
    const settings = createDefaultSettings('avi')
    settings.video.codec = 'mpeg4'
    const plan = planConversion(file, settings, context)

    const sub = plan.streams.find((s) => s.kind === 'subtitle')
    expect(sub?.action).toBe('drop')
    expect(plan.warnings.join(' ')).toMatch(/subtitle/i)
  })

  it('cannot convert bitmap subtitles to a text format', () => {
    const file = mediaFile([
      videoStream(),
      audioStream(),
      subtitleStream({ codec: 'hdmv_pgs_subtitle', isBitmap: true })
    ])
    const settings = createDefaultSettings('mp4')
    const plan = planConversion(file, settings, context)

    const sub = plan.streams.find((s) => s.kind === 'subtitle')
    expect(sub?.action).toBe('drop')
    expect(plan.warnings.join(' ')).toMatch(/image-based|bitmap/i)
  })

  it('converts text subtitles to mov_text for MP4', () => {
    const file = mediaFile([videoStream(), audioStream(), subtitleStream()])
    const settings = createDefaultSettings('mp4')
    const plan = planConversion(file, settings, context)

    const sub = plan.streams.find((s) => s.kind === 'subtitle')
    expect(sub?.action).toBe('encode')
    expect(sub?.targetCodec).toBe('mov_text')
  })

  it('falls back to a valid codec instead of producing an unplayable file', () => {
    // Asking to "copy" ProRes into WebM is impossible.
    const file = mediaFile([videoStream({ codec: 'prores' }), audioStream()])
    const settings = createDefaultSettings('webm')
    const plan = planConversion(file, settings, context)

    const videoPlan = plan.streams.find((s) => s.kind === 'video')
    expect(videoPlan?.action).toBe('encode')
    expect(['vp8', 'vp9', 'av1']).toContain(videoPlan?.targetCodec)
  })

  it('warns when re-encoding HDR into a codec that cannot carry it', () => {
    const file = mediaFile([
      videoStream({ codec: 'hevc', isHDR: true, hdrFormat: 'HDR10', colorTransfer: 'smpte2084' }),
      audioStream()
    ])
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'h264'
    const plan = planConversion(file, settings, context)

    expect(plan.warnings.join(' ')).toMatch(/HDR/i)
  })

  it('preserves HDR silently when the stream is copied', () => {
    // Copying is bit-exact, so HDR survives and no warning is warranted.
    const file = mediaFile([
      videoStream({ codec: 'hevc', isHDR: true, hdrFormat: 'HDR10' }),
      audioStream()
    ])
    const plan = planConversion(file, createDefaultSettings('mp4'), context)

    expect(plan.mode).toBe('lossless-remux')
    expect(plan.warnings.join(' ')).not.toMatch(/HDR/i)
  })

  it('warns that lossy → lossless audio does not restore quality', () => {
    const file = mediaFile([videoStream(), audioStream({ codec: 'mp3' })])
    const settings = createDefaultSettings('mkv')
    settings.audio.codec = 'flac'
    const plan = planConversion(file, settings, context)

    expect(plan.warnings.join(' ')).toMatch(/cannot restore/i)
  })

  it('drops video when the target is an audio container', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mp3')
    settings.video.codec = 'none'
    settings.audio.codec = 'mp3'
    const plan = planConversion(file, settings, context)

    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('drop')
  })

  it('estimates a remux output at roughly the source size', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const plan = planConversion(file, createDefaultSettings('mp4'), context)

    expect(plan.estimatedSize).toBeGreaterThan(file.size * 0.9)
    expect(plan.estimatedSize).toBeLessThan(file.size * 1.1)
  })

  it('gives a wider size range for CRF encoding than for remuxing', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'hevc'
    settings.video.crf = 22
    const plan = planConversion(file, settings, context)

    expect(plan.estimatedSizeRange).toBeDefined()
    const [low, high] = plan.estimatedSizeRange!
    expect(high / low).toBeGreaterThan(1.5)
  })

  it('handles an unknown container without throwing', () => {
    const file = mediaFile([videoStream(), audioStream()])
    const settings = createDefaultSettings('not-a-format')
    const plan = planConversion(file, settings, context)

    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(plan.losslessAvailable).toBe(false)
  })
})
