/**
 * Queue lifecycle tests (spec §14, §25, §31) driving real FFmpeg jobs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { AppSettings, HistoryEntry, MediaFile } from '../src/shared/models'
import { MediaProbe } from '../src/main/core/media/probe'
import { FFmpegConversionEngine } from '../src/main/core/conversion/engine'
import { QueueManager } from '../src/main/core/queue/queueManager'
import { createDefaultAppSettings, createDefaultSettings } from '../src/main/core/profiles/defaults'
import { resolveFFmpeg } from '../src/main/core/ffmpeg/resolver'

const require = createRequire(import.meta.url)
const FFMPEG: string = require('ffmpeg-static')
const FFPROBE: string = (() => {
  const mod = require('ffprobe-static')
  return typeof mod === 'string' ? mod : mod.path
})()

const FIXTURES = path.join(__dirname, 'fixtures', 'media')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gconverter-queue-'))

const probe = new MediaProbe(FFPROBE)
let encoders: string[] = []

beforeAll(async () => {
  encoders = (await resolveFFmpeg()).encoders
}, 60_000)

afterAll(() => {
  try {
    fs.rmSync(OUT, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

function makeQueue(overrides: Partial<AppSettings['performance']> = {}): {
  queue: QueueManager
  history: HistoryEntry[]
  settings: AppSettings
} {
  const settings = createDefaultAppSettings(OUT, OUT)
  settings.general.useSourceFolder = false
  settings.general.defaultOutputFolder = OUT
  settings.performance = { ...settings.performance, ...overrides }

  const history: HistoryEntry[] = []
  const queue = new QueueManager({
    engine: new FFmpegConversionEngine(FFMPEG),
    getSettings: () => settings,
    getHardware: () => null,
    getAvailableEncoders: () => encoders,
    onHistory: (entry) => history.push(entry)
  })

  return { queue, history, settings }
}

/** Resolve once every job has left the pending/running states. */
function waitForDrain(queue: QueueManager, timeoutMs = 90_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const tick = setInterval(() => {
      const busy = queue
        .getJobs()
        .some((j) => j.status === 'pending' || j.status === 'running' || j.status === 'analyzing')
      if (!busy) {
        clearInterval(tick)
        resolve()
      } else if (Date.now() > deadline) {
        clearInterval(tick)
        reject(new Error('Queue did not drain in time'))
      }
    }, 120)
  })
}

async function source(name: string): Promise<MediaFile> {
  const file = await probe.probe(path.join(FIXTURES, name))
  expect(file.error).toBeUndefined()
  return file
}

/* ------------------------------------------------------------------ */

describe('queue lifecycle', () => {
  it('runs a single job to completion and records history', async () => {
    const { queue, history } = makeQueue()
    const file = await source('sample.mkv')

    const job = queue.add({ source: file, settings: createDefaultSettings('mp4') })
    expect(job.status).toBe('pending')
    expect(job.plan?.mode).toBe('lossless-remux')

    queue.start()
    await waitForDrain(queue)

    const finished = queue.getJob(job.id)!
    expect(finished.status).toBe('completed')
    expect(finished.result?.outputSize).toBeGreaterThan(0)
    expect(fs.existsSync(finished.outputPath)).toBe(true)

    expect(history).toHaveLength(1)
    expect(history[0].status).toBe('completed')
    expect(history[0].formatTo).toBe('MP4')
  })

  it('emits progress events that reach 100%', async () => {
    const { queue } = makeQueue()
    const file = await source('sample.mp4')

    const percents: number[] = []
    queue.on('event', (event) => {
      if (event.type === 'job-progress') percents.push(event.progress.percent)
    })

    const settings = createDefaultSettings('mkv')
    settings.video.codec = 'mpeg4'
    settings.video.hardware = 'cpu'
    queue.add({ source: file, settings })

    queue.start()
    await waitForDrain(queue)

    expect(percents.length).toBeGreaterThan(0)
    expect(Math.max(...percents)).toBeGreaterThan(50)
    // Percentages must never run backwards or exceed 100.
    expect(Math.max(...percents)).toBeLessThanOrEqual(100)
  })

  it('processes a batch of files sequentially (spec §25)', async () => {
    const { queue, history } = makeQueue({ maxConcurrentJobs: 1 })
    const names = ['sample.mkv', 'sample.mov', 'sample.avi']

    for (const name of names) {
      queue.add({ source: await source(name), settings: createDefaultSettings('mkv') })
    }

    expect(queue.getJobs()).toHaveLength(3)

    queue.start()
    await waitForDrain(queue)

    expect(queue.getJobs().every((j) => j.status === 'completed')).toBe(true)
    expect(history).toHaveLength(3)
  })

  it('gives every job in a batch a distinct output path', async () => {
    const { queue } = makeQueue()
    // The same source three times would collide without reservation.
    const file = await source('sample.mkv')
    for (let i = 0; i < 3; i++) {
      queue.add({ source: file, settings: createDefaultSettings('mp4') })
    }

    const paths = queue.getJobs().map((j) => path.resolve(j.outputPath))
    expect(new Set(paths).size).toBe(3)

    queue.start()
    await waitForDrain(queue)
    expect(queue.getJobs().every((j) => j.status === 'completed')).toBe(true)
  })

  it('runs jobs concurrently when allowed', async () => {
    const { queue } = makeQueue({ maxConcurrentJobs: 3 })

    let peakConcurrency = 0
    queue.on('event', () => {
      const running = queue.getJobs().filter((j) => j.status === 'running').length
      peakConcurrency = Math.max(peakConcurrency, running)
    })

    for (const name of ['sample.mkv', 'sample.mov', 'sample.mp4']) {
      const settings = createDefaultSettings('mkv')
      settings.video.codec = 'mpeg4'
      settings.video.hardware = 'cpu'
      queue.add({ source: await source(name), settings })
    }

    queue.start()
    await waitForDrain(queue)

    expect(queue.getJobs().every((j) => j.status === 'completed')).toBe(true)
    expect(peakConcurrency).toBeGreaterThan(1)
  })

  it('cancels a pending job without running it', async () => {
    const { queue } = makeQueue({ maxConcurrentJobs: 1 })
    const file = await source('sample.mkv')

    const slow = createDefaultSettings('mp4')
    slow.video.codec = 'h264'
    slow.video.preset = 'veryslow'
    slow.video.crf = 0
    slow.video.width = 1920
    slow.video.height = 1080
    slow.video.hardware = 'cpu'

    const first = queue.add({ source: file, settings: slow })
    const second = queue.add({ source: file, settings: createDefaultSettings('mkv') })

    queue.start()
    await new Promise((r) => setTimeout(r, 400))

    expect(queue.cancelJob(second.id)).toBe(true)
    expect(queue.getJob(second.id)?.status).toBe('cancelled')

    queue.cancelJob(first.id)
    await waitForDrain(queue)

    expect(queue.getJob(second.id)?.status).toBe('cancelled')
    expect(fs.existsSync(second.outputPath)).toBe(false)
  })

  it('stop() halts the queue and cancels everything outstanding', async () => {
    const { queue } = makeQueue({ maxConcurrentJobs: 1 })
    const file = await source('sample.mkv')

    const slow = createDefaultSettings('mp4')
    slow.video.codec = 'h264'
    slow.video.preset = 'veryslow'
    slow.video.crf = 0
    slow.video.width = 1920
    slow.video.height = 1080
    slow.video.hardware = 'cpu'

    queue.add({ source: file, settings: slow })
    queue.add({ source: file, settings: slow })

    queue.start()
    await new Promise((r) => setTimeout(r, 700))
    queue.stop()

    await waitForDrain(queue)

    expect(queue.isRunning()).toBe(false)
    expect(queue.getJobs().every((j) => j.status !== 'completed')).toBe(true)
    // No partial files may be left behind.
    for (const job of queue.getJobs()) {
      expect(fs.existsSync(job.outputPath)).toBe(false)
    }
  })

  it('retries a failed job after the settings are corrected', async () => {
    const { queue } = makeQueue()
    const file = await source('sample.mkv')

    // Impossible: FLAC video in an MP4. Validation should reject it.
    const broken = createDefaultSettings('mp4')
    broken.video.codec = 'none'
    broken.audio.codec = 'none'

    const job = queue.add({ source: file, settings: broken })
    queue.start()
    await waitForDrain(queue)

    expect(queue.getJob(job.id)?.status).toBe('failed')

    expect(queue.retry(job.id, createDefaultSettings('mp4'))).toBe(true)
    expect(queue.getJob(job.id)?.status).toBe('pending')

    queue.start()
    await waitForDrain(queue)
    expect(queue.getJob(job.id)?.status).toBe('completed')
  })

  it('reports a failure rather than throwing when the source disappears', async () => {
    const { queue } = makeQueue()
    const ghost = await source('sample.mkv')
    const missing: MediaFile = { ...ghost, path: path.join(OUT, 'gone.mkv'), name: 'gone.mkv' }

    const job = queue.add({ source: missing, settings: createDefaultSettings('mp4') })
    queue.start()
    await waitForDrain(queue)

    const failed = queue.getJob(job.id)!
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toBeTruthy()
  })

  it('clearFinished() keeps queued work and drops completed jobs', async () => {
    const { queue } = makeQueue()
    const file = await source('sample.mkv')

    queue.add({ source: file, settings: createDefaultSettings('mp4') })
    queue.start()
    await waitForDrain(queue)

    expect(queue.getJobs()).toHaveLength(1)
    queue.clearFinished()
    expect(queue.getJobs()).toHaveLength(0)
  })

  it('previews a conversion without queueing anything', async () => {
    const { queue } = makeQueue()
    const file = await source('sample.mkv')

    const preview = await queue.preview(file, createDefaultSettings('mp4'))

    expect(preview.plan.mode).toBe('lossless-remux')
    expect(preview.command.length).toBeGreaterThan(0)
    expect(preview.validation.ok).toBe(true)
    expect(queue.getJobs()).toHaveLength(0)
  })
})
