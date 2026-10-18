/**
 * yt-dlp integration: binary resolution plus the pure functions that turn a
 * download request into an argument list and yt-dlp's output back into
 * progress and friendly errors. Kept free of process state so every piece
 * is unit-testable.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  LanguageCode,
  YouTubeErrorCode,
  YouTubeRequest,
  YouTubeVideoInfo,
  YtDlpInfo
} from '@shared/models'
import { formatTimecode } from '@shared/youtube'
import { t as translate } from '@shared/i18n'
import { logger } from '../logging/logger'

const EXE = process.platform === 'win32' ? '.exe' : ''
const BINARY = 'yt-dlp' + EXE

/* ------------------------------------------------------------------ */
/* Binary resolution — same order as FFmpeg: custom → bundled → PATH   */
/* ------------------------------------------------------------------ */

function bundledCandidates(): string[] {
  const candidates: string[] = []
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', BINARY))
  // Development: `npm run ytdlp` drops it in the project's bin/ folder.
  candidates.push(path.join(process.cwd(), 'bin', BINARY))
  return candidates
}

function findOnPath(): string | null {
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of (process.env.PATH ?? '').split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir.replace(/"/g, ''), BINARY)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function version(binPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binPath, ['--version'], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim().split('\n')[0] || null)
    })
  })
}

/** Locate a working yt-dlp. Never throws; `available: false` explains why. */
export async function resolveYtDlp(userPath?: string): Promise<YtDlpInfo> {
  const tried: { path: string; source: YtDlpInfo['source'] }[] = []
  if (userPath?.trim()) tried.push({ path: userPath.trim(), source: 'custom' })
  for (const p of bundledCandidates()) tried.push({ path: p, source: 'bundled' })
  const onPath = findOnPath()
  if (onPath) tried.push({ path: onPath, source: 'system' })

  for (const candidate of tried) {
    if (!existsSync(candidate.path)) continue
    const v = await version(candidate.path)
    if (v) {
      logger.info('youtube', `yt-dlp ready (${candidate.source})`, { version: v, path: candidate.path })
      return { available: true, path: candidate.path, version: v, source: candidate.source }
    }
    logger.warn('youtube', 'yt-dlp candidate did not run', { path: candidate.path })
  }

  return {
    available: false,
    path: '',
    source: 'missing',
    error: 'yt-dlp was not found next to the app or on the PATH.'
  }
}

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

export interface ArgContext {
  ffmpegPath: string
  /**
   * A Node-compatible executable for YouTube's JavaScript challenges. In
   * the app this is Electron itself, run with ELECTRON_RUN_AS_NODE=1.
   */
  jsRuntimePath?: string
  /** cookies.txt saved from GConverter's own YouTube window, when it exists. */
  cookiesFile?: string | null
}

/** Options every invocation shares. */
function commonArgs(request: Pick<YouTubeRequest, 'cookiesBrowser'>, context: ArgContext): string[] {
  const args = ['--no-playlist', '--no-warnings', '--color', 'never', '--encoding', 'utf-8']
  if (context.jsRuntimePath) args.push('--js-runtimes', `node:${context.jsRuntimePath}`)
  if (request.cookiesBrowser === 'app') {
    // Nothing saved yet simply means an anonymous request.
    if (context.cookiesFile) args.push('--cookies', context.cookiesFile)
  } else if (request.cookiesBrowser) {
    args.push('--cookies-from-browser', request.cookiesBrowser)
  }
  return args
}

export function buildInfoArgs(
  url: string,
  cookiesBrowser: YouTubeRequest['cookiesBrowser'],
  context: ArgContext
): string[] {
  return ['-J', ...commonArgs({ cookiesBrowser }, context), '--', url]
}

/** Marker lines we ask yt-dlp to print, so parsing never depends on its prose. */
export const PROGRESS_MARK = 'GCPROG'
export const FILE_MARK = 'GCFILE'

export function buildDownloadArgs(request: YouTubeRequest, context: ArgContext): string[] {
  const args = [
    ...commonArgs(request, context),
    '--newline',
    '--windows-filenames',
    '--no-mtime',
    '--ffmpeg-location',
    context.ffmpegPath,
    '--progress-template',
    `download:${PROGRESS_MARK} %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    '--print',
    `after_move:${FILE_MARK} %(filepath)s`,
    // --print implies --simulate unless told otherwise.
    '--no-simulate',
    '-P',
    request.outputFolder,
    '-o',
    outputTemplate(request)
  ]

  if (request.mode === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', request.audioFormat)
    const lossless = request.audioFormat === 'flac' || request.audioFormat === 'wav'
    args.push('--audio-quality', !lossless && request.audioBitrate > 0 ? `${request.audioBitrate}K` : '0')
  } else {
    args.push('-f', 'bv*+ba/b')
    // Sort instead of filter: "res:1080" means the best stream not above
    // 1080p, falling back gracefully when a video has nothing that small.
    const sort: string[] = []
    if (request.quality > 0) sort.push(`res:${request.quality}`)
    if (request.videoFormat === 'mp4') sort.push('vcodec:h264', 'acodec:m4a')
    if (request.videoFormat === 'webm') sort.push('vcodec:vp9', 'acodec:opus')
    if (sort.length) args.push('-S', sort.join(','))
    args.push('--merge-output-format', request.videoFormat, '--remux-video', request.videoFormat)
  }

  if (request.sectionStart !== undefined && request.sectionEnd !== undefined) {
    args.push('--download-sections', `*${trimNumber(request.sectionStart)}-${trimNumber(request.sectionEnd)}`)
    if (request.exactCuts) args.push('--force-keyframes-at-cuts')
  }

  args.push('--', request.url)
  return args
}

/** "%(title)s [id].ext", with the time range appended for partial downloads. */
function outputTemplate(request: YouTubeRequest): string {
  let suffix = ''
  if (request.sectionStart !== undefined && request.sectionEnd !== undefined) {
    // Colons are illegal in Windows filenames; 1:02:03 becomes 1.02.03.
    const a = formatTimecode(request.sectionStart).replace(/:/g, '.')
    const b = formatTimecode(request.sectionEnd).replace(/:/g, '.')
    suffix = ` (${a}-${b})`
  }
  return `%(title).150B [%(id)s]${suffix}.%(ext)s`
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/* ------------------------------------------------------------------ */
/* Output parsing                                                      */
/* ------------------------------------------------------------------ */

interface RawFormat {
  height?: number | null
  vcodec?: string | null
}

interface RawInfo {
  id?: string
  title?: string
  fulltitle?: string
  channel?: string
  uploader?: string
  duration?: number | null
  thumbnail?: string
  webpage_url?: string
  is_live?: boolean
  live_status?: string
  formats?: RawFormat[]
  _type?: string
}

export function parseInfo(json: string, url: string): YouTubeVideoInfo {
  const raw = JSON.parse(json) as RawInfo
  if (raw._type === 'playlist') throw new Error('playlist')

  const heights = [
    ...new Set(
      (raw.formats ?? [])
        .filter((f) => f.vcodec && f.vcodec !== 'none' && typeof f.height === 'number' && f.height > 0)
        .map((f) => f.height as number)
    )
  ].sort((a, b) => b - a)

  return {
    id: raw.id ?? '',
    url: raw.webpage_url ?? url,
    title: raw.title ?? raw.fulltitle ?? raw.id ?? url,
    channel: raw.channel ?? raw.uploader,
    duration: typeof raw.duration === 'number' ? raw.duration : 0,
    thumbnail: raw.thumbnail,
    heights,
    isLive: raw.is_live === true || raw.live_status === 'is_live' || raw.live_status === 'is_upcoming'
  }
}

export interface ProgressLine {
  status: string
  downloaded?: number
  total?: number
  /** Bytes per second. */
  speed?: number
  /** Seconds remaining. */
  eta?: number
}

/** Parse one of our GCPROG lines; anything else returns null. */
export function parseProgressLine(line: string): ProgressLine | null {
  const index = line.indexOf(PROGRESS_MARK + ' ')
  if (index === -1) return null
  const [status, downloaded, total, estimate, speed, eta] = line
    .slice(index + PROGRESS_MARK.length + 1)
    .trim()
    .split('|')
  const num = (v: string | undefined): number | undefined => {
    if (!v || v === 'NA' || v === 'None') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    status: status ?? 'downloading',
    downloaded: num(downloaded),
    total: num(total) ?? num(estimate),
    speed: num(speed),
    eta: num(eta)
  }
}

/** The final path printed after yt-dlp moves the finished file into place. */
export function parseFileLine(line: string): string | null {
  const index = line.indexOf(FILE_MARK + ' ')
  return index === -1 ? null : line.slice(index + FILE_MARK.length + 1).trim() || null
}

/** Lines that mean yt-dlp has moved on from downloading to ffmpeg work. */
export function isPostProcessingLine(line: string): boolean {
  return /^\[(Merger|ExtractAudio|VideoRemuxer|VideoConvertor|FixupM3u8|FixupM4a|FixupStretched|FixupDuplicateMoov|FFmpeg\w*)\]/.test(
    line.trim()
  )
}

/** Which kind of failure yt-dlp reported, so the UI can react to it. */
export function classifyYtDlpError(stderr: string): YouTubeErrorCode {
  const text = stderr.toLowerCase()

  if (text.includes('not a bot')) return 'bot'
  if (
    text.includes('cookie') &&
    (text.includes('could not copy') || text.includes('could not find') || text.includes('failed to decrypt'))
  ) {
    return 'cookies'
  }
  if (text.includes('private video')) return 'private'
  if (text.includes('confirm your age') || text.includes('age-restricted') || text.includes('inappropriate')) {
    return 'age'
  }
  if (text.includes('in your country') || text.includes('geo restrict')) return 'geo'
  if (
    text.includes('video unavailable') ||
    text.includes('has been removed') ||
    text.includes('this video is not available')
  ) {
    return 'unavailable'
  }
  if (
    text.includes('getaddrinfo') ||
    text.includes('timed out') ||
    text.includes('connection') ||
    text.includes('network is unreachable')
  ) {
    return 'network'
  }
  if (
    text.includes('requested format is not available') ||
    text.includes('signature') ||
    text.includes('nsig') ||
    text.includes('http error 403')
  ) {
    return 'outdated'
  }
  return 'generic'
}

/** Turn yt-dlp's stderr into a sentence the user can act on. */
export function explainYtDlpError(stderr: string, lang: LanguageCode): string {
  const t = (key: string): string => translate(lang, key)
  const code = classifyYtDlpError(stderr)
  if (code !== 'generic') return t(`yterr.${code}`)

  const lastError = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR:'))
    .pop()
  return lastError ? `${t('yterr.generic')} ${lastError.replace(/^ERROR:\s*/, '')}` : t('yterr.generic')
}

/** Human speed/ETA for the list rows. */
export function formatSpeed(bytesPerSecond: number | undefined): string | undefined {
  if (!bytesPerSecond || bytesPerSecond <= 0) return undefined
  const mb = bytesPerSecond / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`
}

export function formatEtaSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds < 0) return undefined
  return formatTimecode(seconds)
}
