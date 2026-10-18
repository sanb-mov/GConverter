/**
 * Default conversion settings and the built-in preset library (spec §10).
 *
 * Design rule (spec §49): a preset never silently degrades the source.
 * Resolution and frame-rate caps are expressed as `maxWidth`/`maxHeight`/
 * `maxFps`, which are applied only when the source *exceeds* them, and the
 * UI always states when a preset will change those properties.
 */

import path from 'node:path'
import type {
  AppSettings,
  AudioSettings,
  ContainerSettings,
  ConversionProfile,
  ConversionSettings,
  ImageSettings,
  MetadataSettings,
  QualityMode,
  SubtitleSettings,
  VideoSettings
} from '@shared/models'

export function createDefaultSettings(
  format = 'mp4',
  quality: QualityMode = 'high'
): ConversionSettings {
  return {
    container: {
      format,
      faststart: true,
      fragmentedMp4: false,
      chapters: 'keep',
      attachments: true
    },
    video: {
      codec: 'copy',
      rateControl: 'crf',
      hardware: 'auto',
      scaleMode: 'fit'
    },
    audio: {
      codec: 'copy'
    },
    subtitles: { action: 'keep' },
    metadata: { action: 'keep' },
    quality,
    threads: 0
  }
}

/** Sensible still-image defaults: visually transparent quality, nothing resized. */
export function createDefaultImageSettings(format: string): ImageSettings {
  const quality: Record<string, number> = { jpg: 90, webp: 85, avif: 70 }
  return {
    quality: quality[format] ?? 100,
    background: '#ffffff',
    stripMetadata: false
  }
}

/**
 * Shape accepted by the `preset` helper: every section is optional and
 * shallow-merged over the defaults, so a definition only states what it
 * actually changes.
 */
interface PresetInput {
  container: Partial<ContainerSettings> & { format: string }
  video?: Partial<VideoSettings>
  audio?: Partial<AudioSettings>
  subtitles?: Partial<SubtitleSettings>
  metadata?: Partial<MetadataSettings>
  quality?: QualityMode
  threads?: number
}

/** Helper that keeps preset definitions readable. */
function preset(
  id: string,
  name: string,
  category: 'video' | 'audio',
  description: string,
  icon: string,
  input: PresetInput,
  caps?: { maxWidth?: number; maxHeight?: number; maxFps?: number }
): ConversionProfile {
  const base = createDefaultSettings(input.container.format)
  const settings: ConversionSettings = {
    ...base,
    container: { ...base.container, ...input.container },
    video: { ...base.video, ...input.video },
    audio: { ...base.audio, ...input.audio },
    subtitles: { ...base.subtitles, ...input.subtitles },
    metadata: { ...base.metadata, ...input.metadata },
    quality: input.quality ?? base.quality,
    threads: input.threads ?? base.threads
  }

  return { id, name, description, category, builtIn: true, icon, ...caps, settings }
}

/* ------------------------------------------------------------------ */
/* Video presets                                                       */
/* ------------------------------------------------------------------ */

export const VIDEO_PRESETS: ConversionProfile[] = [
  preset(
    'original-quality',
    'preset.original-quality.name',
    'video',
    'preset.original-quality.desc',
    'shield',
    {
      container: { format: 'mp4' },
      video: { codec: 'copy', rateControl: 'crf', hardware: 'auto' },
      audio: { codec: 'copy' },
      quality: 'lossless'
    }
  ),
  preset(
    'maximum-quality',
    'preset.maximum-quality.name',
    'video',
    'preset.maximum-quality.desc',
    'gem',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 16,
        preset: 'slow',
        hardware: 'auto',
        pixelFormat: 'yuv420p'
      },
      audio: { codec: 'aac', bitrate: 320 },
      quality: 'maximum'
    }
  ),
  preset(
    'hevc-high',
    'preset.hevc-high.name',
    'video',
    'preset.hevc-high.desc',
    'zap',
    {
      container: { format: 'mp4' },
      video: { codec: 'hevc', rateControl: 'crf', crf: 20, preset: 'slow', hardware: 'auto' },
      audio: { codec: 'aac', bitrate: 256 },
      quality: 'very-high'
    }
  ),
  preset(
    'youtube',
    'preset.youtube.name',
    'video',
    'preset.youtube.desc',
    'youtube',
    {
      container: { format: 'mp4', faststart: true, fragmentedMp4: false, chapters: 'keep', attachments: false },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 17,
        preset: 'slow',
        profile: 'high',
        pixelFormat: 'yuv420p',
        gop: 60,
        bFrames: 2,
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 384, sampleRate: 48000 },
      quality: 'maximum'
    }
  ),
  preset(
    'youtube-4k',
    'preset.youtube-4k.name',
    'video',
    'preset.youtube-4k.desc',
    'monitor',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 16,
        preset: 'slow',
        profile: 'high',
        pixelFormat: 'yuv420p',
        gop: 60,
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 384, sampleRate: 48000 },
      quality: 'maximum'
    },
    { maxWidth: 3840, maxHeight: 2160 }
  ),
  preset(
    'youtube-1080p',
    'preset.youtube-1080p.name',
    'video',
    'preset.youtube-1080p.desc',
    'monitor',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 18,
        preset: 'slow',
        profile: 'high',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 320, sampleRate: 48000 },
      quality: 'very-high'
    },
    { maxWidth: 1920, maxHeight: 1080 }
  ),
  preset(
    'instagram',
    'preset.instagram.name',
    'video',
    'preset.instagram.desc',
    'instagram',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 20,
        preset: 'medium',
        profile: 'high',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 192, sampleRate: 48000, channels: 2 },
      subtitles: { action: 'remove' },
      quality: 'high'
    },
    { maxWidth: 1080, maxHeight: 1920, maxFps: 60 }
  ),
  preset(
    'tiktok',
    'preset.tiktok.name',
    'video',
    'preset.tiktok.desc',
    'smartphone',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 21,
        preset: 'medium',
        profile: 'high',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 192, sampleRate: 44100, channels: 2 },
      subtitles: { action: 'remove' },
      quality: 'high'
    },
    { maxWidth: 1080, maxHeight: 1920, maxFps: 60 }
  ),
  preset(
    'x-twitter',
    'preset.x-twitter.name',
    'video',
    'preset.x-twitter.desc',
    'twitter',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'constrained',
        bitrate: 8000,
        maxBitrate: 20000,
        bufSize: 16000,
        crf: 21,
        preset: 'medium',
        profile: 'high',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 128, sampleRate: 44100, channels: 2 },
      subtitles: { action: 'remove' },
      quality: 'high'
    },
    { maxWidth: 1920, maxHeight: 1080, maxFps: 60 }
  ),
  preset(
    'discord',
    'preset.discord.name',
    'video',
    'preset.discord.desc',
    'message-circle',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 26,
        preset: 'medium',
        profile: 'high',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 128, channels: 2 },
      subtitles: { action: 'remove' },
      quality: 'balanced'
    },
    { maxWidth: 1280, maxHeight: 720 }
  ),
  preset(
    'whatsapp',
    'preset.whatsapp.name',
    'video',
    'preset.whatsapp.desc',
    'message-square',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 28,
        preset: 'medium',
        profile: 'baseline',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 96, sampleRate: 44100, channels: 2 },
      subtitles: { action: 'remove' },
      quality: 'balanced'
    },
    { maxWidth: 1280, maxHeight: 720, maxFps: 30 }
  ),
  preset(
    'web',
    'preset.web.name',
    'video',
    'preset.web.desc',
    'globe',
    {
      container: { format: 'mp4', faststart: true, fragmentedMp4: false, chapters: 'keep', attachments: false },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 23,
        preset: 'medium',
        profile: 'high',
        pixelFormat: 'yuv420p',
        gop: 48,
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 160 },
      quality: 'high'
    }
  ),
  preset(
    'webm-vp9',
    'preset.webm-vp9.name',
    'video',
    'preset.webm-vp9.desc',
    'globe',
    {
      container: { format: 'webm' },
      video: { codec: 'vp9', rateControl: 'crf', crf: 30, hardware: 'auto' },
      audio: { codec: 'opus', bitrate: 128 },
      quality: 'high'
    }
  ),
  preset(
    'mobile',
    'preset.mobile.name',
    'video',
    'preset.mobile.desc',
    'smartphone',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'crf',
        crf: 26,
        preset: 'medium',
        profile: 'main',
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 128, channels: 2 },
      quality: 'balanced'
    },
    { maxWidth: 1280, maxHeight: 720 }
  ),
  preset(
    'archive',
    'preset.archive.name',
    'video',
    'preset.archive.desc',
    'archive',
    {
      container: { format: 'mkv' },
      video: { codec: 'ffv1', rateControl: 'lossless', hardware: 'cpu' },
      audio: { codec: 'flac', compressionLevel: 8 },
      quality: 'lossless'
    }
  ),
  preset(
    'editing',
    'preset.editing.name',
    'video',
    'preset.editing.desc',
    'scissors',
    {
      container: { format: 'mov' },
      video: {
        codec: 'prores',
        rateControl: 'crf',
        profile: 'hq',
        pixelFormat: 'yuv422p10le',
        hardware: 'cpu'
      },
      audio: { codec: 'pcm_s24le' },
      quality: 'maximum'
    }
  ),
  preset(
    'streaming',
    'preset.streaming.name',
    'video',
    'preset.streaming.desc',
    'radio',
    {
      container: { format: 'mp4' },
      video: {
        codec: 'h264',
        rateControl: 'constrained',
        bitrate: 6000,
        maxBitrate: 6000,
        bufSize: 12000,
        preset: 'veryfast',
        profile: 'high',
        gop: 60,
        bFrames: 2,
        pixelFormat: 'yuv420p',
        hardware: 'auto'
      },
      audio: { codec: 'aac', bitrate: 160, sampleRate: 48000, channels: 2 },
      quality: 'high'
    }
  ),
  preset(
    'gif',
    'preset.gif.name',
    'video',
    'preset.gif.desc',
    'image',
    {
      container: { format: 'gif' },
      video: { codec: 'gif', rateControl: 'crf', fps: 15, hardware: 'cpu' },
      audio: { codec: 'none' },
      subtitles: { action: 'remove' },
      quality: 'high'
    },
    { maxWidth: 640 }
  )
]

/* ------------------------------------------------------------------ */
/* Audio presets                                                       */
/* ------------------------------------------------------------------ */

export const AUDIO_PRESETS: ConversionProfile[] = [
  preset(
    'audio-original',
    'preset.audio-original.name',
    'audio',
    'preset.audio-original.desc',
    'shield',
    {
      container: { format: 'm4a' },
      video: { codec: 'none' },
      audio: { codec: 'copy' },
      quality: 'lossless'
    }
  ),
  preset(
    'mp3-320',
    'preset.mp3-320.name',
    'audio',
    'preset.mp3-320.desc',
    'music',
    {
      container: { format: 'mp3' },
      video: { codec: 'none' },
      audio: { codec: 'mp3', bitrate: 320 },
      quality: 'maximum'
    }
  ),
  preset(
    'mp3-256',
    'preset.mp3-256.name',
    'audio',
    'preset.mp3-256.desc',
    'music',
    {
      container: { format: 'mp3' },
      video: { codec: 'none' },
      audio: { codec: 'mp3', bitrate: 256 },
      quality: 'very-high'
    }
  ),
  preset(
    'mp3-v0',
    'preset.mp3-v0.name',
    'audio',
    'preset.mp3-v0.desc',
    'music',
    {
      container: { format: 'mp3' },
      video: { codec: 'none' },
      audio: { codec: 'mp3', vbr: true, qualityLevel: 0 },
      quality: 'maximum'
    }
  ),
  preset(
    'aac-256',
    'preset.aac-256.name',
    'audio',
    'preset.aac-256.desc',
    'music',
    {
      container: { format: 'm4a' },
      video: { codec: 'none' },
      audio: { codec: 'aac', bitrate: 256 },
      quality: 'very-high'
    }
  ),
  preset(
    'flac',
    'preset.flac.name',
    'audio',
    'preset.flac.desc',
    'gem',
    {
      container: { format: 'flac' },
      video: { codec: 'none' },
      audio: { codec: 'flac', compressionLevel: 8 },
      quality: 'lossless'
    }
  ),
  preset(
    'alac',
    'preset.alac.name',
    'audio',
    'preset.alac.desc',
    'gem',
    {
      container: { format: 'm4a' },
      video: { codec: 'none' },
      audio: { codec: 'alac' },
      quality: 'lossless'
    }
  ),
  preset(
    'wav',
    'preset.wav.name',
    'audio',
    'preset.wav.desc',
    'activity',
    {
      container: { format: 'wav' },
      video: { codec: 'none' },
      audio: { codec: 'pcm_s24le', bitDepth: 24 },
      quality: 'lossless'
    }
  ),
  preset(
    'opus',
    'preset.opus.name',
    'audio',
    'preset.opus.desc',
    'zap',
    {
      container: { format: 'opus' },
      video: { codec: 'none' },
      audio: { codec: 'opus', bitrate: 128, sampleRate: 48000 },
      quality: 'very-high'
    }
  ),
  preset(
    'podcast',
    'preset.podcast.name',
    'audio',
    'preset.podcast.desc',
    'mic',
    {
      container: { format: 'm4a' },
      video: { codec: 'none' },
      audio: { codec: 'aac', bitrate: 96, sampleRate: 44100, channels: 1 },
      quality: 'high'
    }
  ),
  preset(
    'voice',
    'preset.voice.name',
    'audio',
    'preset.voice.desc',
    'mic',
    {
      container: { format: 'opus' },
      video: { codec: 'none' },
      audio: { codec: 'opus', bitrate: 32, sampleRate: 48000, channels: 1 },
      quality: 'balanced'
    }
  ),
  preset(
    'music',
    'preset.music.name',
    'audio',
    'preset.music.desc',
    'music',
    {
      container: { format: 'm4a' },
      video: { codec: 'none' },
      audio: { codec: 'aac', bitrate: 256, sampleRate: 48000, channels: 2 },
      quality: 'very-high'
    }
  )
]

/* ------------------------------------------------------------------ */
/* Image presets                                                       */
/* ------------------------------------------------------------------ */

/**
 * An image preset: one still-image format plus quality and options. Size
 * limits use the same never-upscale caps as video presets.
 */
function imagePreset(
  id: string,
  format: string,
  codec: string,
  icon: string,
  image: Partial<ImageSettings>,
  caps?: { maxWidth?: number; maxHeight?: number }
): ConversionProfile {
  const settings = createDefaultSettings(format, 'high')
  settings.video = { ...settings.video, codec, hardware: 'cpu' }
  settings.audio = { codec: 'none' }
  settings.subtitles = { action: 'remove' }
  settings.container = { ...settings.container, faststart: false, chapters: 'remove', attachments: false }
  settings.image = { ...createDefaultImageSettings(format), ...image }
  settings.metadata = { action: settings.image.stripMetadata ? 'remove' : 'keep' }
  return {
    id,
    name: `preset.${id}.name`,
    description: `preset.${id}.desc`,
    category: 'image',
    builtIn: true,
    icon,
    ...caps,
    settings
  }
}

export const IMAGE_PRESETS: ConversionProfile[] = [
  imagePreset('image-web', 'jpg', 'mjpeg', 'globe', { quality: 85, stripMetadata: true }, {
    maxWidth: 2560,
    maxHeight: 2560
  }),
  imagePreset('image-png', 'png', 'png', 'gem', {}),
  imagePreset('image-webp', 'webp', 'webp', 'zap', { quality: 80 }, { maxWidth: 1920, maxHeight: 1920 }),
  imagePreset('image-avif', 'avif', 'av1', 'archive', { quality: 60 }),
  imagePreset('image-thumbnail', 'jpg', 'mjpeg', 'image', { quality: 80, stripMetadata: true }, {
    maxWidth: 512,
    maxHeight: 512
  }),
  imagePreset('image-icon', 'ico', 'png', 'shield', {})
]

export const BUILT_IN_PRESETS = [...VIDEO_PRESETS, ...AUDIO_PRESETS, ...IMAGE_PRESETS]

/* ------------------------------------------------------------------ */
/* Application settings defaults                                       */
/* ------------------------------------------------------------------ */

export function createDefaultAppSettings(defaultOutputFolder: string, tempDir: string): AppSettings {
  return {
    general: {
      language: 'en',
      theme: 'dark',
      defaultOutputFolder,
      useSourceFolder: true,
      outputNaming: 'suffix',
      outputSuffix: '_converted',
      notifications: true,
      autoCleanupDays: 7,
      confirmOnQuit: true
    },
    performance: {
      cpuThreads: 0,
      maxConcurrentJobs: 1,
      hardwareAcceleration: true,
      hardwarePreference: 'auto',
      lowPriority: false
    },
    conversion: {
      defaultVideoFormat: 'mp4',
      defaultAudioFormat: 'mp3',
      defaultQuality: 'high',
      preserveMetadata: true,
      preserveSubtitles: true,
      preserveChapters: true,
      preferLossless: true,
      overwritePolicy: 'rename'
    },
    youtube: {
      downloadFolder: path.join(defaultOutputFolder, 'YouTube'),
      mode: 'video',
      quality: 1080,
      videoFormat: 'mp4',
      audioFormat: 'mp3',
      cookiesBrowser: ''
    },
    advanced: {
      ffmpegPath: '',
      ffprobePath: '',
      ytdlpPath: '',
      tempDirectory: tempDir,
      logLevel: 'info',
      keepLogDays: 7
    }
  }
}
