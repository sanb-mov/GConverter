/**
 * Conversion queue (spec §14, §15).
 *
 * Owns job lifecycle: creation, ordering, concurrency, progress fan-out,
 * pause/stop/cancel and completion bookkeeping. Emits events the IPC layer
 * forwards to the renderer, so the UI is a pure projection of this state.
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  ConversionJob,
  ConversionPlan,
  ConversionSettings,
  HardwareCapabilities,
  HistoryEntry,
  JobProgress,
  LanguageCode,
  MediaFile,
  ValidationReport
} from '@shared/models'
import { logger } from '../logging/logger'
import { FFmpegConversionEngine } from '../conversion/engine'
import { planConversion } from '../conversion/planner'
import { buildConversionCommand } from '../conversion/commandFactory'
import { resolveOutputPath, validateJob } from '../media/paths'
import { t as translate } from '@shared/i18n'

export interface QueueDependencies {
  engine: FFmpegConversionEngine
  getSettings: () => AppSettings
  getHardware: () => HardwareCapabilities | null
  getAvailableEncoders: () => string[]
  onHistory: (entry: HistoryEntry) => void
}

export type QueueEvent =
  | { type: 'job-added'; job: ConversionJob }
  | { type: 'job-updated'; job: ConversionJob }
  | { type: 'job-progress'; jobId: string; progress: JobProgress }
  | { type: 'job-removed'; jobId: string }
  | { type: 'queue-state'; running: boolean; paused: boolean }

export interface AddJobOptions {
  source: MediaFile
  settings: ConversionSettings
  profileId?: string
  profileName?: string
  outputFolder?: string
  outputPath?: string
  automationRuleId?: string
}

export class QueueManager extends EventEmitter {
  private jobs: ConversionJob[] = []
  private running = false
  private paused = false
  private activeJobIds = new Set<string>()
  /** Output paths claimed by queued jobs, so two jobs never collide. */
  private reservedPaths = new Set<string>()

  constructor(private deps: QueueDependencies) {
    super()
  }

  /** Current UI language, read fresh so a change applies to the next job. */
  private lang(): LanguageCode {
    return this.deps.getSettings().general.language
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return translate(this.lang(), key, params)
  }

  /* ------------------------------ state ------------------------------ */

  getJobs(): ConversionJob[] {
    return this.jobs
  }

  getJob(id: string): ConversionJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  isRunning(): boolean {
    return this.running
  }

  isPaused(): boolean {
    return this.paused
  }

  private emitEvent(event: QueueEvent): void {
    this.emit('event', event)
  }

  private emitState(): void {
    this.emitEvent({ type: 'queue-state', running: this.running, paused: this.paused })
  }

  private updateJob(job: ConversionJob): void {
    this.emitEvent({ type: 'job-updated', job })
  }

  /* ----------------------------- planning ---------------------------- */

  /** Build the plan for a prospective job without adding it to the queue. */
  plan(source: MediaFile, settings: ConversionSettings): ConversionPlan {
    return planConversion(source, settings, {
      hardware: this.deps.getHardware(),
      availableEncoders: this.deps.getAvailableEncoders(),
      lang: this.lang()
    })
  }

  /** Full dry run: plan + resolved output path + validation. */
  async preview(
    source: MediaFile,
    settings: ConversionSettings,
    outputFolder?: string
  ): Promise<{
    plan: ConversionPlan
    outputPath: string
    command: string[]
    validation: ValidationReport
  }> {
    const appSettings = this.deps.getSettings()
    const plan = this.plan(source, settings)
    const outputPath = resolveOutputPath({
      source,
      settings,
      appSettings,
      outputFolder,
      reserved: this.reservedPaths
    })

    let command: string[] = []
    try {
      command = buildConversionCommand(source, settings, plan, outputPath, {
        hardware: this.deps.getHardware(),
        availableEncoders: this.deps.getAvailableEncoders(),
        threads: appSettings.performance.cpuThreads
      }).args
    } catch (err) {
      logger.warn('queue', 'Command preview failed', { err: String(err) })
    }

    const validation = await validateJob({
      source,
      outputPath,
      plan,
      availableEncoders: this.deps.getAvailableEncoders(),
      lang: this.lang()
    })

    return { plan, outputPath, command, validation }
  }

  /* ------------------------------ mutate ----------------------------- */

  add(options: AddJobOptions): ConversionJob {
    const appSettings = this.deps.getSettings()
    const plan = this.plan(options.source, options.settings)

    const outputPath =
      options.outputPath ??
      resolveOutputPath({
        source: options.source,
        settings: options.settings,
        appSettings,
        outputFolder: options.outputFolder,
        reserved: this.reservedPaths
      })

    this.reservedPaths.add(path.resolve(outputPath))

    const job: ConversionJob = {
      id: randomUUID(),
      source: options.source,
      outputPath,
      settings: options.settings,
      profileId: options.profileId,
      profileName: options.profileName,
      status: 'pending',
      progress: { percent: 0, outTime: 0, elapsedMs: 0 },
      plan,
      createdAt: Date.now(),
      automationRuleId: options.automationRuleId
    }

    try {
      job.command = buildConversionCommand(options.source, options.settings, plan, outputPath, {
        hardware: this.deps.getHardware(),
        availableEncoders: this.deps.getAvailableEncoders(),
        threads: appSettings.performance.cpuThreads
      }).args
    } catch (err) {
      logger.warn('queue', 'Could not pre-build command', { err: String(err) })
    }

    this.jobs.push(job)
    this.emitEvent({ type: 'job-added', job })
    logger.info('queue', `Job queued: ${job.source.name} → ${path.basename(outputPath)}`)

    return job
  }

  remove(jobId: string): boolean {
    const index = this.jobs.findIndex((j) => j.id === jobId)
    if (index === -1) return false

    const job = this.jobs[index]
    if (job.status === 'running') this.deps.engine.cancel(jobId)

    this.reservedPaths.delete(path.resolve(job.outputPath))
    this.jobs.splice(index, 1)
    this.emitEvent({ type: 'job-removed', jobId })
    return true
  }

  /** Drop finished jobs, keeping anything still pending or running. */
  clearFinished(): void {
    const keep: ConversionJob[] = []
    for (const job of this.jobs) {
      if (job.status === 'pending' || job.status === 'running' || job.status === 'analyzing') {
        keep.push(job)
      } else {
        this.reservedPaths.delete(path.resolve(job.outputPath))
        this.emitEvent({ type: 'job-removed', jobId: job.id })
      }
    }
    this.jobs = keep
  }

  clearAll(): void {
    this.stop()
    for (const job of this.jobs) {
      this.reservedPaths.delete(path.resolve(job.outputPath))
      this.emitEvent({ type: 'job-removed', jobId: job.id })
    }
    this.jobs = []
  }

  /** Reset a failed or cancelled job so it can run again (spec §30 Retry). */
  retry(jobId: string, settings?: ConversionSettings): boolean {
    const job = this.getJob(jobId)
    if (!job) return false
    if (job.status === 'running' || job.status === 'pending') return false

    if (settings) {
      job.settings = settings
      job.plan = this.plan(job.source, settings)
      try {
        job.command = buildConversionCommand(job.source, settings, job.plan, job.outputPath, {
          hardware: this.deps.getHardware(),
          availableEncoders: this.deps.getAvailableEncoders(),
          threads: this.deps.getSettings().performance.cpuThreads
        }).args
      } catch {
        /* keep the previous command for display */
      }
    }

    job.status = 'pending'
    job.progress = { percent: 0, outTime: 0, elapsedMs: 0 }
    job.error = undefined
    job.result = undefined
    job.startedAt = undefined
    job.finishedAt = undefined
    this.updateJob(job)
    return true
  }

  reorder(jobId: string, newIndex: number): boolean {
    const index = this.jobs.findIndex((j) => j.id === jobId)
    if (index === -1) return false
    const [job] = this.jobs.splice(index, 1)
    this.jobs.splice(Math.max(0, Math.min(newIndex, this.jobs.length)), 0, job)
    return true
  }

  /* ---------------------------- execution ---------------------------- */

  start(): void {
    if (this.running && !this.paused) return
    this.running = true
    this.paused = false
    this.emitState()
    logger.info('queue', 'Queue started')
    void this.pump()
  }

  /** Let running jobs finish, but start no new ones. */
  pause(): void {
    if (!this.running) return
    this.paused = true
    this.emitState()
    logger.info('queue', 'Queue paused')
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.emitState()
    void this.pump()
  }

  /** Stop everything and cancel in-flight jobs. */
  stop(): void {
    this.running = false
    this.paused = false

    for (const jobId of this.activeJobIds) {
      this.deps.engine.cancel(jobId)
    }

    for (const job of this.jobs) {
      if (job.status === 'pending') {
        job.status = 'cancelled'
        this.updateJob(job)
      }
    }

    this.emitState()
    logger.info('queue', 'Queue stopped')
  }

  cancelJob(jobId: string): boolean {
    const job = this.getJob(jobId)
    if (!job) return false

    if (job.status === 'running') {
      return this.deps.engine.cancel(jobId)
    }
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      this.updateJob(job)
      return true
    }
    return false
  }

  /**
   * Dispatch loop. Called whenever capacity may have freed up; it starts as
   * many pending jobs as the concurrency limit allows and returns.
   */
  private async pump(): Promise<void> {
    if (!this.running || this.paused) return

    const limit = Math.max(1, this.deps.getSettings().performance.maxConcurrentJobs)

    while (this.activeJobIds.size < limit) {
      const next = this.jobs.find((j) => j.status === 'pending')
      if (!next) break
      // Mark before awaiting so a concurrent pump() cannot pick it up twice.
      next.status = 'analyzing'
      void this.execute(next)
    }

    if (this.activeJobIds.size === 0 && !this.jobs.some((j) => j.status === 'pending')) {
      this.running = false
      this.emitState()
      logger.info('queue', 'Queue drained')
    }
  }

  private async execute(job: ConversionJob): Promise<void> {
    this.activeJobIds.add(job.id)
    const appSettings = this.deps.getSettings()

    try {
      // Re-plan at execution time: settings or hardware may have changed
      // since the job was queued.
      job.plan = this.plan(job.source, job.settings)

      const validation = await validateJob({
        source: job.source,
        outputPath: job.outputPath,
        plan: job.plan,
        availableEncoders: this.deps.getAvailableEncoders(),
        lang: this.lang()
      })

      if (!validation.ok) {
        const blocking = validation.issues.filter((i) => i.severity === 'error')
        job.status = 'failed'
        job.finishedAt = Date.now()
        job.error = {
          message: blocking[0]?.message ?? this.t('validate.failedGeneric'),
          reason: blocking.map((i) => i.message).join(' '),
          suggestion: blocking.find((i) => i.suggestion)?.suggestion
        }
        this.updateJob(job)
        this.recordHistory(job)
        return
      }

      let built
      try {
        built = buildConversionCommand(job.source, job.settings, job.plan, job.outputPath, {
          hardware: this.deps.getHardware(),
          availableEncoders: this.deps.getAvailableEncoders(),
          threads: appSettings.performance.cpuThreads
        })
      } catch (err) {
        job.status = 'failed'
        job.finishedAt = Date.now()
        job.error = {
          message: this.t('err.buildFailed.message'),
          reason: err instanceof Error ? err.message : String(err),
          suggestion: this.t('err.buildFailed.suggestion')
        }
        this.updateJob(job)
        this.recordHistory(job)
        return
      }

      job.command = built.args
      job.status = 'running'
      job.startedAt = Date.now()
      this.updateJob(job)

      const duration = effectiveDuration(job)

      const result = await this.deps.engine.run(
        {
          jobId: job.id,
          args: built.args,
          durationSeconds: duration,
          outputPath: job.outputPath,
          lowPriority: appSettings.performance.lowPriority,
          lang: this.lang()
        },
        (progress) => {
          job.progress = progress
          this.emitEvent({ type: 'job-progress', jobId: job.id, progress })
        }
      )

      job.finishedAt = Date.now()

      if (result.cancelled) {
        job.status = 'cancelled'
      } else if (result.ok) {
        job.status = 'completed'
        const outputSize = safeSize(job.outputPath)
        job.result = {
          outputPath: job.outputPath,
          outputSize,
          inputSize: job.source.size,
          sizeDeltaPercent:
            job.source.size > 0
              ? Math.round(((outputSize - job.source.size) / job.source.size) * 100)
              : 0,
          durationMs: result.durationMs,
          mode: job.plan?.mode ?? 're-encode',
          averageFps: result.averageFps
        }
        job.progress = { ...job.progress, percent: 100 }
        logger.info('queue', `Completed ${job.source.name}`, {
          mode: job.result.mode,
          inputSize: job.result.inputSize,
          outputSize: job.result.outputSize,
          seconds: Math.round(result.durationMs / 1000)
        })
      } else {
        job.status = 'failed'
        job.error = result.error
      }

      this.updateJob(job)
      this.recordHistory(job)
    } catch (err) {
      // A bug in our own code must not take down the queue.
      job.status = 'failed'
      job.finishedAt = Date.now()
      job.error = {
        message: this.t('err.unexpected.message'),
        reason: err instanceof Error ? err.message : String(err),
        suggestion: this.t('err.unexpected.suggestion')
      }
      logger.error('queue', 'Unhandled job error', { err: String(err) })
      this.updateJob(job)
      this.recordHistory(job)
    } finally {
      this.activeJobIds.delete(job.id)
      void this.pump()
    }
  }

  private recordHistory(job: ConversionJob): void {
    if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') return

    this.deps.onHistory({
      id: job.id,
      sourcePath: job.source.path,
      sourceName: job.source.name,
      outputPath: job.outputPath,
      outputName: path.basename(job.outputPath),
      inputSize: job.source.size,
      outputSize: job.result?.outputSize ?? 0,
      mode: job.plan?.mode ?? 're-encode',
      status: job.status,
      profileName: job.profileName,
      formatFrom: job.source.extension.toUpperCase(),
      formatTo: path.extname(job.outputPath).replace('.', '').toUpperCase(),
      durationMs: (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt),
      timestamp: Date.now(),
      error: job.error?.reason,
      settings: job.settings
    })
  }
}

function effectiveDuration(job: ConversionJob): number {
  const start = job.settings.trim?.start ?? 0
  const end = job.settings.trim?.end ?? job.source.duration
  return Math.max(0.001, Math.min(end, job.source.duration) - start)
}

function safeSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}
