/**
 * FFprobe adapter — turns a file on disk into a fully described MediaFile
 * (spec §4, §51).
 *
 * Everything the rest of the app knows about a source file comes from here:
 * streams, codecs, HDR, colour, chapters, metadata, subtitles and language.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AnyStream,
  AudioStream,
  Chapter,
  GenericStream,
  MediaFile,
  SubtitleStream,
  VideoStream
} from '@shared/models'
import { normalizeCodec } from '@shared/formats'
import { logger } from '../logging/logger'

/* ---------------------- raw ffprobe JSON shapes ---------------------- */

interface RawStream {
  index: number
  codec_name?: string
  codec_long_name?: string
  codec_type?: string
  codec_tag_string?: string
  profile?: string | number
  level?: number
  width?: number
  height?: number
  coded_width?: number
  coded_height?: number
  pix_fmt?: string
  color_space?: string
  color_primaries?: string
  color_transfer?: string
  color_range?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  sample_aspect_ratio?: string
  display_aspect_ratio?: string
  nb_frames?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  sample_fmt?: string
  bits_per_sample?: number
  bits_per_raw_sample?: string
  bit_rate?: string
  duration?: string
  disposition?: Record<string, number>
  tags?: Record<string, string>
  side_data_list?: Array<Record<string, unknown>>
}

interface RawChapter {
  id: number
  start_time?: string
  end_time?: string
  tags?: Record<string, string>
}

interface RawFormat {
  filename?: string
  nb_streams?: number
  format_name?: string
  format_long_name?: string
  duration?: string
  size?: string
  bit_rate?: string
  tags?: Record<string, string>
}

interface RawProbe {
  streams?: RawStream[]
  chapters?: RawChapter[]
  format?: RawFormat
}

/* ----------------------------- helpers ------------------------------ */

function num(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** Parse an ffprobe rational like "30000/1001" into 29.97. */
function parseRate(rate: string | undefined): number | undefined {
  if (!rate || rate === '0/0') return undefined
  const [numerator, denominator] = rate.split('/').map(Number)
  if (!denominator || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return undefined
  const value = numerator / denominator
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value * 1000) / 1000
}

/** Subtitle codecs that carry bitmaps rather than text. */
const BITMAP_SUBTITLES = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'])

function detectHDR(stream: RawStream): {
  isHDR: boolean
  format?: VideoStream['hdrFormat']
} {
  const transfer = stream.color_transfer?.toLowerCase() ?? ''
  const primaries = stream.color_primaries?.toLowerCase() ?? ''
  const sideData = stream.side_data_list ?? []

  const hasDolbyVision = sideData.some((d) =>
    String(d.side_data_type ?? '').toLowerCase().includes('dolby vision')
  )
  if (hasDolbyVision) return { isHDR: true, format: 'Dolby Vision' }

  const hasHdrPlus = sideData.some((d) =>
    String(d.side_data_type ?? '').toLowerCase().includes('hdr dynamic metadata')
  )

  if (transfer === 'smpte2084' || transfer === 'smpte-st-2084') {
    return { isHDR: true, format: hasHdrPlus ? 'HDR10+' : 'HDR10' }
  }
  if (transfer === 'arib-std-b67') return { isHDR: true, format: 'HLG' }
  if (primaries === 'bt2020' && transfer.includes('bt2020')) return { isHDR: true, format: 'PQ' }

  return { isHDR: false }
}

function extractRotation(stream: RawStream): number | undefined {
  const tagRotate = num(stream.tags?.rotate)
  if (tagRotate !== undefined) return tagRotate
  for (const side of stream.side_data_list ?? []) {
    const rot = num(side.rotation as string | number | undefined)
    if (rot !== undefined) return rot
  }
  return undefined
}

function buildStream(raw: RawStream): AnyStream {
  const disposition = raw.disposition ?? {}
  const tags = raw.tags ?? {}
  const base = {
    index: raw.index,
    codec: normalizeCodec(raw.codec_name) || (raw.codec_name ?? 'unknown'),
    codecLongName: raw.codec_long_name,
    codecTag: raw.codec_tag_string,
    language: tags.language ?? tags.LANGUAGE,
    title: tags.title ?? tags.TITLE ?? tags.handler_name,
    isDefault: disposition.default === 1,
    isForced: disposition.forced === 1,
    bitrate: num(raw.bit_rate),
    duration: num(raw.duration),
    disposition,
    tags
  }

  switch (raw.codec_type) {
    case 'video': {
      const hdr = detectHDR(raw)
      const video: VideoStream = {
        ...base,
        kind: 'video',
        width: raw.width ?? raw.coded_width ?? 0,
        height: raw.height ?? raw.coded_height ?? 0,
        fps: parseRate(raw.r_frame_rate),
        avgFps: parseRate(raw.avg_frame_rate),
        pixelFormat: raw.pix_fmt,
        profile: raw.profile !== undefined ? String(raw.profile) : undefined,
        level: raw.level,
        colorSpace: raw.color_space,
        colorPrimaries: raw.color_primaries,
        colorTransfer: raw.color_transfer,
        colorRange: raw.color_range,
        isHDR: hdr.isHDR,
        hdrFormat: hdr.format,
        sampleAspectRatio: raw.sample_aspect_ratio,
        displayAspectRatio: raw.display_aspect_ratio,
        frameCount: num(raw.nb_frames),
        isAttachedPic: disposition.attached_pic === 1,
        rotation: extractRotation(raw)
      }
      return video
    }
    case 'audio': {
      const audio: AudioStream = {
        ...base,
        kind: 'audio',
        sampleRate: num(raw.sample_rate),
        channels: raw.channels,
        channelLayout: raw.channel_layout,
        sampleFormat: raw.sample_fmt,
        bitsPerSample: raw.bits_per_sample || undefined,
        bitsPerRawSample: num(raw.bits_per_raw_sample)
      }
      return audio
    }
    case 'subtitle': {
      const subtitle: SubtitleStream = {
        ...base,
        kind: 'subtitle',
        isBitmap: BITMAP_SUBTITLES.has(raw.codec_name ?? '')
      }
      return subtitle
    }
    default: {
      const generic: GenericStream = {
        ...base,
        kind: raw.codec_type === 'attachment' ? 'attachment' : 'data',
        filename: tags.filename,
        mimeType: tags.mimetype
      }
      return generic
    }
  }
}

/* ------------------------------- API -------------------------------- */

export class MediaProbe {
  constructor(private ffprobePath: string) {}

  setPath(ffprobePath: string): void {
    this.ffprobePath = ffprobePath
  }

  private run(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.ffprobePath,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || error.message))
            return
          }
          resolve(stdout)
        }
      )
    })
  }

  /**
   * Analyse a file. Never throws for media reasons — a failure comes back as
   * a MediaFile with `error` set, so the queue can show it instead of dying.
   */
  async probe(filePath: string, timeoutMs = 60_000): Promise<MediaFile> {
    const parsed = path.parse(filePath)
    const shell: MediaFile = {
      id: randomUUID(),
      path: filePath,
      name: parsed.base,
      directory: parsed.dir,
      extension: parsed.ext.replace(/^\./, '').toLowerCase(),
      size: 0,
      formatName: '',
      duration: 0,
      streams: [],
      chapters: [],
      metadata: {},
      hasVideo: false,
      hasAudio: false,
      hasSubtitles: false,
      probedAt: Date.now()
    }

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        return { ...shell, error: 'Not a file' }
      }
      shell.size = stat.size
    } catch {
      return { ...shell, error: 'File does not exist or is not readable' }
    }

    let raw: RawProbe
    try {
      const stdout = await this.run(
        [
          '-hide_banner',
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          '-show_chapters',
          filePath
        ],
        timeoutMs
      )
      raw = JSON.parse(stdout) as RawProbe
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('probe', `ffprobe failed for ${parsed.base}`, { message })
      return {
        ...shell,
        error: message.split('\n').slice(-3).join(' ').trim() || 'Unrecognised media file'
      }
    }

    const streams = (raw.streams ?? []).map(buildStream)
    const format = raw.format ?? {}

    const chapters: Chapter[] = (raw.chapters ?? []).map((c) => ({
      id: c.id,
      start: num(c.start_time) ?? 0,
      end: num(c.end_time) ?? 0,
      title: c.tags?.title
    }))

    const videoStreams = streams.filter(
      (s): s is VideoStream => s.kind === 'video' && !s.isAttachedPic
    )
    const audioStreams = streams.filter((s): s is AudioStream => s.kind === 'audio')
    const subtitleStreams = streams.filter((s) => s.kind === 'subtitle')

    // Some containers omit format-level duration; fall back to the longest stream.
    let duration = num(format.duration) ?? 0
    if (!duration) {
      duration = streams.reduce((max, s) => Math.max(max, s.duration ?? 0), 0)
    }

    const file: MediaFile = {
      ...shell,
      size: num(format.size) ?? shell.size,
      formatName: format.format_name ?? shell.extension,
      formatLongName: format.format_long_name,
      duration,
      bitrate: num(format.bit_rate),
      streams,
      chapters,
      metadata: format.tags ?? {},
      primaryVideo: videoStreams[0],
      primaryAudio: audioStreams[0],
      hasVideo: videoStreams.length > 0,
      hasAudio: audioStreams.length > 0,
      hasSubtitles: subtitleStreams.length > 0
    }

    if (streams.length === 0) {
      file.error = 'No decodable streams found in this file'
    }

    return file
  }

  /** Probe many files with bounded concurrency so large drops stay responsive. */
  async probeMany(
    paths: string[],
    concurrency = 4,
    onProgress?: (done: number, total: number, file: MediaFile) => void
  ): Promise<MediaFile[]> {
    const results: MediaFile[] = new Array(paths.length)
    let cursor = 0
    let done = 0

    const worker = async (): Promise<void> => {
      while (cursor < paths.length) {
        const index = cursor++
        const file = await this.probe(paths[index])
        results[index] = file
        done++
        onProgress?.(done, paths.length, file)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, paths.length) }, () => worker())
    )
    return results
  }

  /** Raw ffprobe JSON, used by the Media Inspector's "Export JSON". */
  async probeRaw(filePath: string): Promise<unknown> {
    const stdout = await this.run(
      [
        '-hide_banner',
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-show_chapters',
        '-show_programs',
        filePath
      ],
      60_000
    )
    return JSON.parse(stdout)
  }
}
