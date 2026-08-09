/**
 * Conversion engine (spec §37).
 *
 * `ConversionEngine` is the abstraction the rest of the app talks to;
 * `FFmpegConversionEngine` is the implementation. Swapping in another
 * backend later requires no changes above this layer.
 *
 * Key behaviours:
 *  - FFmpeg runs as a separate process, so the UI never blocks (spec §54).
 *  - Progress is parsed from `-progress pipe:1`, which is stable and
 *    machine-readable, rather than scraped from the human stderr output.
 *  - Cancellation terminates the process and removes the partial file so no
 *    corrupt output or temp junk is ever left behind (spec §31).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ConversionError, JobProgress } from '@shared/models'
import { logger } from '../logging/logger'
import { explainFFmpegError } from './errorMapper'
import { t as translate } from '@shared/i18n'
import type { LanguageCode } from '@shared/models'

export interface RunOptions {
  jobId: string
  args: string[]
  /** Total output duration in seconds, used to compute percentage. */
  durationSeconds: number
  outputPath: string
  /** Run the encoder at below-normal priority. */
  lowPriority?: boolean
  /** Language for user-facing error text. */
  lang?: LanguageCode
}

export interface RunResult {
  ok: boolean
  cancelled: boolean
  exitCode: number | null
  error?: ConversionError
  stderr: string
  durationMs: number
  averageFps?: number
}

export interface ConversionEngine {
  run(options: RunOptions, onProgress: (p: JobProgress) => void): Promise<RunResult>
  cancel(jobId: string): boolean
  pause(jobId: string): boolean
  resume(jobId: string): boolean
  isRunning(jobId: string): boolean
  cancelAll(): void
}

interface ActiveProcess {
  child: ChildProcessWithoutNullStreams
  outputPath: string
  cancelled: boolean
  paused: boolean
  startedAt: number
}

/** Keep the tail of stderr for diagnostics without unbounded memory growth. */
const STDERR_LIMIT = 32 * 1024

export class FFmpegConversionEngine extends EventEmitter implements ConversionEngine {
  private active = new Map<string, ActiveProcess>()

  constructor(private ffmpegPath: string) {
    super()
  }

  setFFmpegPath(ffmpegPath: string): void {
    this.ffmpegPath = ffmpegPath
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId)
  }

  run(options: RunOptions, onProgress: (p: JobProgress) => void): Promise<RunResult> {
    const { jobId, args, durationSeconds, outputPath } = options
    const lang: LanguageCode = options.lang ?? 'en'
    const t = (key: string): string => translate(lang, key)

    return new Promise<RunResult>((resolve) => {
      const startedAt = Date.now()

      // Ensure the destination folder exists before FFmpeg complains about it.
      try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      } catch (err) {
        resolve({
          ok: false,
          cancelled: false,
          exitCode: null,
          stderr: '',
          durationMs: 0,
          error: {
            message: t('err.outputFolder.message'),
            reason: String(err),
            suggestion: t('err.outputFolder.suggestion')
          }
        })
        return
      }

      logger.debug('engine', `Starting job ${jobId}`, { args })

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(this.ffmpegPath, args, {
          windowsHide: true,
          // No shell: arguments are passed to the process verbatim (spec §39).
          shell: false
        })
      } catch (err) {
        resolve({
          ok: false,
          cancelled: false,
          exitCode: null,
          stderr: '',
          durationMs: Date.now() - startedAt,
          error: {
            message: t('err.startFailed.message'),
            reason: String(err),
            suggestion: t('err.startFailed.suggestion')
          }
        })
        return
      }

      const entry: ActiveProcess = {
        child,
        outputPath,
        cancelled: false,
        paused: false,
        startedAt
      }
      this.active.set(jobId, entry)

      if (options.lowPriority) this.applyLowPriority(child.pid)

      let stderrTail = ''
      let stdoutBuffer = ''
      let lastFrame = 0
      let lastProgress: JobProgress = {
        percent: 0,
        outTime: 0,
        elapsedMs: 0
      }

      /* ------------------------- progress parsing ------------------------- */

      child.stdout.setEncoding('utf-8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        // -progress emits blocks terminated by a "progress=" line.
        const blocks = stdoutBuffer.split(/progress=\w+\r?\n/)
        stdoutBuffer = blocks.pop() ?? ''

        for (const block of blocks) {
          const fields = parseProgressBlock(block)
          if (!fields) continue

          const outTime = fields.outTimeUs / 1_000_000
          const elapsedMs = Date.now() - startedAt
          const percent =
            durationSeconds > 0
              ? Math.min(99.9, Math.max(0, (outTime / durationSeconds) * 100))
              : 0

          const speed = fields.speed
          let etaMs: number | undefined
          if (speed && speed > 0 && durationSeconds > 0) {
            etaMs = Math.max(0, ((durationSeconds - outTime) / speed) * 1000)
          }

          let estimatedFinalSize: number | undefined
          if (fields.totalSize && outTime > 0.5 && durationSeconds > 0) {
            estimatedFinalSize = Math.round((fields.totalSize / outTime) * durationSeconds)
          }

          if (fields.frame) lastFrame = fields.frame

          lastProgress = {
            percent,
            outTime,
            fps: fields.fps,
            speed,
            bitrate: fields.bitrate,
            totalSize: fields.totalSize,
            frame: fields.frame,
            elapsedMs,
            etaMs,
            estimatedFinalSize
          }
          onProgress(lastProgress)
        }
      })

      child.stderr.setEncoding('utf-8')
      child.stderr.on('data', (chunk: string) => {
        stderrTail += chunk
        if (stderrTail.length > STDERR_LIMIT) {
          stderrTail = stderrTail.slice(-STDERR_LIMIT)
        }
      })

      /* ------------------------------ exit ------------------------------- */

      const finish = (code: number | null, spawnError?: Error): void => {
        const record = this.active.get(jobId)
        this.active.delete(jobId)
        const durationMs = Date.now() - startedAt
        const cancelled = record?.cancelled ?? false

        if (cancelled) {
          this.removePartialOutput(outputPath)
          logger.info('engine', `Job ${jobId} cancelled; partial output removed`)
          resolve({
            ok: false,
            cancelled: true,
            exitCode: code,
            stderr: stderrTail,
            durationMs
          })
          return
        }

        if (spawnError) {
          resolve({
            ok: false,
            cancelled: false,
            exitCode: code,
            stderr: stderrTail,
            durationMs,
            error: {
              message: t('err.startFailed.message'),
              reason: spawnError.message,
              suggestion: t('err.startFailed.suggestion')
            }
          })
          return
        }

        if (code === 0) {
          // Trust but verify: a zero exit with no output file is still a failure.
          if (!fs.existsSync(outputPath)) {
            resolve({
              ok: false,
              cancelled: false,
              exitCode: code,
              stderr: stderrTail,
              durationMs,
              error: {
                message: t('err.noOutput.message'),
                reason: t('err.noOutput.reason'),
                suggestion: t('err.noOutput.suggestion'),
                stderrTail: stderrTail.slice(-2000)
              }
            })
            return
          }

          const averageFps =
            lastFrame > 0 && durationMs > 0 ? lastFrame / (durationMs / 1000) : undefined

          onProgress({ ...lastProgress, percent: 100, elapsedMs: durationMs, etaMs: 0 })
          resolve({
            ok: true,
            cancelled: false,
            exitCode: 0,
            stderr: stderrTail,
            durationMs,
            averageFps
          })
          return
        }

        this.removePartialOutput(outputPath)
        const error = explainFFmpegError(stderrTail, code, lang)
        logger.error('engine', `Job ${jobId} failed (exit ${code})`, { reason: error.reason })
        resolve({
          ok: false,
          cancelled: false,
          exitCode: code,
          stderr: stderrTail,
          durationMs,
          error
        })
      }

      child.on('error', (err) => finish(null, err))
      child.on('close', (code) => finish(code))
    })
  }

  /**
   * Stop a job. FFmpeg is asked to quit gracefully first so it can finalise
   * cleanly; if it ignores that, it is killed after a short grace period.
   */
  cancel(jobId: string): boolean {
    const entry = this.active.get(jobId)
    if (!entry) return false

    entry.cancelled = true

    // A paused (suspended) process cannot react to a signal — resume first.
    if (entry.paused) this.resume(jobId)

    try {
      if (process.platform === 'win32') {
        // Windows has no SIGINT for child processes; terminate the tree.
        entry.child.kill()
        setTimeout(() => {
          if (this.active.has(jobId)) this.forceKill(entry.child.pid)
        }, 2000)
      } else {
        entry.child.kill('SIGINT')
        setTimeout(() => {
          if (this.active.has(jobId)) entry.child.kill('SIGKILL')
        }, 3000)
      }
    } catch (err) {
      logger.warn('engine', `Cancel failed for ${jobId}`, { err: String(err) })
      return false
    }
    return true
  }

  pause(jobId: string): boolean {
    const entry = this.active.get(jobId)
    if (!entry || entry.paused || !entry.child.pid) return false

    try {
      if (process.platform === 'win32') {
        // No POSIX job control on Windows; suspension needs a native helper,
        // so the queue instead lets the current job finish and holds the rest.
        return false
      }
      process.kill(entry.child.pid, 'SIGSTOP')
      entry.paused = true
      return true
    } catch (err) {
      logger.warn('engine', `Pause failed for ${jobId}`, { err: String(err) })
      return false
    }
  }

  resume(jobId: string): boolean {
    const entry = this.active.get(jobId)
    if (!entry || !entry.paused || !entry.child.pid) return false
    try {
      process.kill(entry.child.pid, 'SIGCONT')
      entry.paused = false
      return true
    } catch {
      return false
    }
  }

  cancelAll(): void {
    for (const jobId of [...this.active.keys()]) this.cancel(jobId)
  }

  /** Delete a partially written output so no corrupt file survives (spec §31). */
  private removePartialOutput(outputPath: string): void {
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath)
      }
    } catch (err) {
      logger.warn('engine', 'Could not remove partial output', {
        outputPath,
        err: String(err)
      })
    }
  }

  private forceKill(pid: number | undefined): void {
    if (!pid) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true })
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      /* process already gone */
    }
  }

  /** Keep the machine usable while encoding (spec §15). */
  private applyLowPriority(pid: number | undefined): void {
    if (!pid) return
    try {
      if (process.platform === 'win32') {
        spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PriorityClass = 'BelowNormal'`
          ],
          { windowsHide: true, stdio: 'ignore' }
        )
      } else {
        spawn('renice', ['-n', '10', '-p', String(pid)], { stdio: 'ignore' })
      }
    } catch {
      /* best effort only */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Progress parsing                                                    */
/* ------------------------------------------------------------------ */

export interface ProgressFields {
  outTimeUs: number
  fps?: number
  speed?: number
  bitrate?: number
  totalSize?: number
  frame?: number
}

/** Parse one `-progress pipe:1` block into numeric fields. */
export function parseProgressBlock(block: string): ProgressFields | null {
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }

  if (Object.keys(fields).length === 0) return null

  // out_time_us is authoritative; out_time_ms is misnamed (also microseconds)
  // in several FFmpeg releases, so prefer the explicit field and fall back to
  // parsing the formatted timestamp.
  let outTimeUs = Number(fields.out_time_us)
  if (!Number.isFinite(outTimeUs) || outTimeUs < 0) {
    outTimeUs = Number(fields.out_time_ms)
  }
  if (!Number.isFinite(outTimeUs) || outTimeUs < 0) {
    outTimeUs = parseTimestamp(fields.out_time) * 1_000_000
  }
  if (!Number.isFinite(outTimeUs) || outTimeUs < 0) outTimeUs = 0

  const speedRaw = fields.speed?.replace('x', '').trim()
  const speed = speedRaw && speedRaw !== 'N/A' ? Number(speedRaw) : undefined

  const bitrateRaw = fields.bitrate?.replace(/kbits\/s/i, '').trim()
  const bitrate = bitrateRaw && bitrateRaw !== 'N/A' ? Number(bitrateRaw) : undefined

  const fpsRaw = fields.fps
  const fps = fpsRaw && fpsRaw !== 'N/A' ? Number(fpsRaw) : undefined

  const sizeRaw = fields.total_size
  const totalSize = sizeRaw && sizeRaw !== 'N/A' ? Number(sizeRaw) : undefined

  const frameRaw = fields.frame
  const frame = frameRaw && frameRaw !== 'N/A' ? Number(frameRaw) : undefined

  return {
    outTimeUs,
    fps: Number.isFinite(fps!) ? fps : undefined,
    speed: Number.isFinite(speed!) ? speed : undefined,
    bitrate: Number.isFinite(bitrate!) ? bitrate : undefined,
    totalSize: Number.isFinite(totalSize!) ? totalSize : undefined,
    frame: Number.isFinite(frame!) ? frame : undefined
  }
}

/** "01:23:45.67" → seconds. */
export function parseTimestamp(value: string | undefined): number {
  if (!value || value === 'N/A') return 0
  const parts = value.split(':').map(Number)
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return 0
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}
