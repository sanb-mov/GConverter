/**
 * YouTube download list. Separate from the conversion queue on purpose: a
 * download has no MediaFile source and its own lifecycle, so it keeps its
 * own small queue and emits its own events.
 */

import { EventEmitter } from 'node:events'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  LanguageCode,
  YouTubeDownload,
  YouTubeInfoResult,
  YouTubeRequest,
  YtDlpInfo
} from '@shared/models'
import { isValidSection, normalizeYouTubeUrl } from '@shared/youtube'
import { t as translate } from '@shared/i18n'
import { logger } from '../logging/logger'
import {
  buildDownloadArgs,
  buildInfoArgs,
  classifyYtDlpError,
  explainYtDlpError,
  formatEtaSeconds,
  formatSpeed,
  isPostProcessingLine,
  parseFileLine,
  parseInfo,
  parseProgressLine,
  type ArgContext
} from './ytdlp'

export type YouTubeEvent =
  | { type: 'added'; download: YouTubeDownload }
  | { type: 'updated'; download: YouTubeDownload }
  | { type: 'removed'; id: string }

export interface DownloaderDeps {
  getYtDlp: () => YtDlpInfo
  getFFmpegPath: () => string
  getLang: () => LanguageCode
  /** Node-compatible runtime for YouTube's JS challenges (Electron itself). */
  jsRuntimePath?: string
  /** cookies.txt from the built-in YouTube window, or null when there is none. */
  getCookiesFile?: () => string | null
  maxConcurrent?: number
}

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm']
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav']
const BROWSERS = ['', 'app', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium', 'safari']
const STDERR_LIMIT = 16 * 1024

interface Active {
  child: ChildProcessWithoutNullStreams
  cancelled: boolean
  /** Files yt-dlp announced, so a cancel can remove every partial piece. */
  destinations: Set<string>
}

export class YouTubeDownloader extends EventEmitter {
  private downloads: YouTubeDownload[] = []
  private active = new Map<string, Active>()

  constructor(private deps: DownloaderDeps) {
    super()
  }

  private t(key: string): string {
    return translate(this.deps.getLang(), key)
  }

  private context(): ArgContext {
    return {
      ffmpegPath: this.deps.getFFmpegPath(),
      jsRuntimePath: this.deps.jsRuntimePath,
      cookiesFile: this.deps.getCookiesFile?.() ?? null
    }
  }

  /** Environment that lets Electron act as the Node runtime yt-dlp asks for. */
  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    }
  }

  private requireBinary(): string {
    const info = this.deps.getYtDlp()
    if (!info.available) throw new Error(this.t('yt.missingText'))
    return info.path
  }

  list(): YouTubeDownload[] {
    return this.downloads
  }

  private emitUpdate(download: YouTubeDownload): void {
    this.emit('event', { type: 'updated', download } satisfies YouTubeEvent)
  }

  /* ------------------------------ info ------------------------------- */

  /**
   * Look a video up. Failures come back as a result (not a throw) so the
   * error code survives the IPC boundary and the UI can offer the robot check.
   */
  async fetchInfo(input: string, cookiesBrowser: YouTubeRequest['cookiesBrowser']): Promise<YouTubeInfoResult> {
    const url = normalizeYouTubeUrl(input)
    if (!url) return { ok: false, code: 'invalid', error: this.t('yt.invalidUrl') }
    if (!BROWSERS.includes(cookiesBrowser)) return { ok: false, code: 'invalid', error: 'Unsupported browser' }

    let binary: string
    try {
      binary = this.requireBinary()
    } catch (err) {
      return { ok: false, code: 'generic', error: err instanceof Error ? err.message : String(err) }
    }

    const outcome = await new Promise<{ stdout: string } | { stderr: string }>((resolve) => {
      execFile(
        binary,
        buildInfoArgs(url, cookiesBrowser, this.context()),
        { timeout: 90_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: this.env() },
        (err, out, stderr) => {
          if (err) {
            logger.warn('youtube', 'Info lookup failed', { url, stderr: String(stderr).slice(-2000) })
            resolve({ stderr: String(stderr || err.message) })
            return
          }
          resolve({ stdout: out })
        }
      )
    })

    if ('stderr' in outcome) {
      return {
        ok: false,
        code: classifyYtDlpError(outcome.stderr),
        error: explainYtDlpError(outcome.stderr, this.deps.getLang())
      }
    }

    try {
      return { ok: true, info: parseInfo(outcome.stdout, url) }
    } catch {
      return { ok: false, code: 'generic', error: this.t('yterr.generic') }
    }
  }

  /* ------------------------------ queue ------------------------------ */

  start(input: YouTubeRequest): YouTubeDownload {
    const request = this.validate(input)
    fs.mkdirSync(request.outputFolder, { recursive: true })

    const download: YouTubeDownload = {
      id: randomUUID(),
      request,
      status: 'queued',
      percent: 0,
      createdAt: Date.now()
    }
    this.downloads.unshift(download)
    this.emit('event', { type: 'added', download } satisfies YouTubeEvent)
    logger.info('youtube', `Download queued: ${request.title ?? request.url}`, {
      mode: request.mode,
      section: request.sectionStart !== undefined ? [request.sectionStart, request.sectionEnd] : undefined
    })
    this.pump()
    return download
  }

  /** Re-check everything the renderer sent; it is untrusted input. */
  private validate(input: YouTubeRequest): YouTubeRequest {
    const url = normalizeYouTubeUrl(input.url)
    if (!url) throw new Error(this.t('yt.invalidUrl'))
    if (input.mode !== 'video' && input.mode !== 'audio') throw new Error('Invalid mode')
    if (!VIDEO_FORMATS.includes(input.videoFormat)) throw new Error('Invalid video format')
    if (!AUDIO_FORMATS.includes(input.audioFormat)) throw new Error('Invalid audio format')
    if (!BROWSERS.includes(input.cookiesBrowser)) throw new Error('Unsupported browser')
    if (!input.outputFolder || !path.isAbsolute(input.outputFolder)) {
      throw new Error('Choose an output folder')
    }

    const quality = Math.round(Number(input.quality) || 0)
    const audioBitrate = Math.round(Number(input.audioBitrate) || 0)
    if (quality < 0 || quality > 4320) throw new Error('Invalid quality')
    if (audioBitrate < 0 || audioBitrate > 512) throw new Error('Invalid bitrate')

    const request: YouTubeRequest = {
      ...input,
      url,
      quality,
      audioBitrate,
      outputFolder: path.resolve(input.outputFolder),
      sectionStart: undefined,
      sectionEnd: undefined
    }

    if (input.sectionStart !== undefined || input.sectionEnd !== undefined) {
      const start = Number(input.sectionStart)
      const duration = Number(input.duration) || 0
      let end = Number(input.sectionEnd)
      if (!isValidSection(start, end, duration)) throw new Error(this.t('yt.timeInvalid'))
      if (duration > 0) end = Math.min(end, duration)
      request.sectionStart = start
      request.sectionEnd = end
    }

    return request
  }

  private pump(): void {
    const limit = Math.max(1, this.deps.maxConcurrent ?? 2)
    // Oldest first: the list is shown newest-first, so walk it backwards.
    for (let i = this.downloads.length - 1; i >= 0 && this.active.size < limit; i--) {
      const download = this.downloads[i]
      if (download.status === 'queued' && !this.active.has(download.id)) this.run(download)
    }
  }

  private run(download: YouTubeDownload): void {
    let binary: string
    try {
      binary = this.requireBinary()
    } catch (err) {
      this.fail(download, err instanceof Error ? err.message : String(err))
      return
    }

    const args = buildDownloadArgs(download.request, this.context())
    logger.debug('youtube', `Starting download ${download.id}`, { args })

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(binary, args, { windowsHide: true, shell: false, env: this.env() })
    } catch (err) {
      this.fail(download, String(err))
      return
    }

    const entry: Active = { child, cancelled: false, destinations: new Set() }
    this.active.set(download.id, entry)
    download.status = 'downloading'
    this.emitUpdate(download)

    // Video mode downloads a video stream and an audio stream one after the other.
    const expectedParts = download.request.mode === 'video' ? 2 : 1
    let finishedParts = 0
    let finalPath: string | undefined
    let stderr = ''
    let lastEmit = 0

    const onLine = (line: string): void => {
      const file = parseFileLine(line)
      if (file) {
        finalPath = file
        return
      }

      const destination = /\[download\] Destination: (.+)$/.exec(line)?.[1] ??
        /Merging formats into "(.+)"$/.exec(line)?.[1]
      if (destination) entry.destinations.add(destination.trim())

      const progress = parseProgressLine(line)
      if (progress) {
        if (progress.status === 'finished') {
          finishedParts = Math.min(expectedParts, finishedParts + 1)
        }
        const fraction =
          progress.status === 'finished'
            ? 0
            : progress.total && progress.downloaded !== undefined
              ? Math.min(1, progress.downloaded / progress.total)
              : 0
        download.percent = Math.min(99, ((finishedParts + fraction) / expectedParts) * 100)
        download.speed = formatSpeed(progress.speed)
        download.eta = formatEtaSeconds(progress.eta)
        // Throttle: yt-dlp can print dozens of lines a second.
        const now = Date.now()
        if (now - lastEmit > 250) {
          lastEmit = now
          this.emitUpdate(download)
        }
        return
      }

      if (isPostProcessingLine(line) && download.status !== 'processing') {
        download.status = 'processing'
        download.speed = undefined
        download.eta = undefined
        this.emitUpdate(download)
      }
    }

    let buffer = ''
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    })

    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT)
    })

    const finish = (code: number | null, spawnError?: Error): void => {
      if (!this.active.has(download.id)) return
      if (buffer) onLine(buffer)
      this.active.delete(download.id)
      download.finishedAt = Date.now()
      download.speed = undefined
      download.eta = undefined

      if (entry.cancelled) {
        download.status = 'cancelled'
        this.removePartials(entry.destinations)
        logger.info('youtube', `Download ${download.id} cancelled; partial files removed`)
      } else if (spawnError) {
        download.status = 'failed'
        download.error = spawnError.message
      } else if (code === 0 && finalPath && fs.existsSync(finalPath)) {
        download.status = 'completed'
        download.percent = 100
        download.outputPath = finalPath
        logger.info('youtube', `Download finished: ${path.basename(finalPath)}`)
      } else {
        download.status = 'failed'
        download.errorCode = code === 0 ? 'generic' : classifyYtDlpError(stderr)
        download.error =
          code === 0 ? this.t('yterr.noOutput') : explainYtDlpError(stderr, this.deps.getLang())
        logger.error('youtube', `Download ${download.id} failed (exit ${code})`, {
          stderr: stderr.slice(-2000)
        })
        this.removePartials(entry.destinations)
      }

      this.emitUpdate(download)
      this.pump()
    }

    child.on('error', (err) => finish(null, err))
    child.on('close', (code) => finish(code))
  }

  private fail(download: YouTubeDownload, message: string): void {
    download.status = 'failed'
    download.error = message
    download.finishedAt = Date.now()
    this.emitUpdate(download)
  }

  /**
   * Delete everything a stopped download left behind: the announced files
   * plus their .part / .ytdl / fragment siblings. Matching on the full
   * announced basename (which contains the video id) keeps it narrow.
   */
  private removePartials(destinations: Set<string>): void {
    for (const destination of destinations) {
      const dir = path.dirname(destination)
      const base = path.basename(destination)
      let entries: string[] = []
      try {
        entries = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        if (name !== base && !name.startsWith(base + '.') && !name.startsWith(base + '-')) continue
        try {
          fs.rmSync(path.join(dir, name), { force: true })
        } catch (err) {
          logger.warn('youtube', 'Could not remove partial download', { name, err: String(err) })
        }
      }
    }
  }

  cancel(id: string): boolean {
    const entry = this.active.get(id)
    if (entry) {
      entry.cancelled = true
      this.kill(entry.child)
      return true
    }
    const download = this.downloads.find((d) => d.id === id)
    if (download?.status === 'queued') {
      download.status = 'cancelled'
      download.finishedAt = Date.now()
      this.emitUpdate(download)
      return true
    }
    return false
  }

  /**
   * yt-dlp's Windows build is a self-extracting launcher that runs the real
   * process — and ffmpeg — as children, so the whole tree must go.
   */
  private kill(child: ChildProcessWithoutNullStreams): void {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
      } else {
        child.kill('SIGINT')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 3000)
      }
    } catch {
      /* already gone */
    }
  }

  /** Run a failed or cancelled download again, optionally with other cookies. */
  retry(id: string, cookiesBrowser?: YouTubeRequest['cookiesBrowser']): boolean {
    const download = this.downloads.find((d) => d.id === id)
    if (!download || (download.status !== 'failed' && download.status !== 'cancelled')) return false
    if (cookiesBrowser !== undefined) {
      if (!BROWSERS.includes(cookiesBrowser)) return false
      download.request = { ...download.request, cookiesBrowser }
    }
    download.status = 'queued'
    download.percent = 0
    download.error = undefined
    download.errorCode = undefined
    download.finishedAt = undefined
    this.emitUpdate(download)
    this.pump()
    return true
  }

  remove(id: string): boolean {
    const index = this.downloads.findIndex((d) => d.id === id)
    if (index === -1) return false
    if (this.active.has(id)) this.cancel(id)
    this.downloads.splice(index, 1)
    this.emit('event', { type: 'removed', id } satisfies YouTubeEvent)
    return true
  }

  clearFinished(): void {
    for (const download of [...this.downloads]) {
      if (download.status === 'queued' || this.active.has(download.id)) continue
      this.remove(download.id)
    }
  }

  cancelAll(): void {
    for (const [id] of this.active) this.cancel(id)
  }
}
