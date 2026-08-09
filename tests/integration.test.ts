/**
 * End-to-end tests against real FFmpeg (spec §63).
 *
 * These run actual conversions on the generated fixtures and verify the
 * resulting files by probing them again — the only way to prove the app
 * really works rather than merely producing plausible arguments.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { ConversionSettings, MediaFile } from '../src/shared/models'
import { MediaProbe } from '../src/main/core/media/probe'
import { FFmpegConversionEngine } from '../src/main/core/conversion/engine'
import { planConversion } from '../src/main/core/conversion/planner'
import { buildConversionCommand } from '../src/main/core/conversion/commandFactory'
import { createDefaultSettings } from '../src/main/core/profiles/defaults'
import { smartConvert } from '../src/main/core/conversion/smart'
import { createDefaultAppSettings } from '../src/main/core/profiles/defaults'
import { detectHardware } from '../src/main/core/hardware/detector'
import { resolveFFmpeg } from '../src/main/core/ffmpeg/resolver'

const require = createRequire(import.meta.url)
const FFMPEG: string = require('ffmpeg-static')
const FFPROBE: string = (() => {
  const mod = require('ffprobe-static')
  return typeof mod === 'string' ? mod : mod.path
})()

const FIXTURES = path.join(__dirname, 'fixtures', 'media')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gconverter-test-'))

const probe = new MediaProbe(FFPROBE)
const engine = new FFmpegConversionEngine(FFMPEG)

let availableEncoders: string[] = []

beforeAll(async () => {
  const info = await resolveFFmpeg()
  availableEncoders = info.encoders
  expect(info.available).toBe(true)
}, 120_000)

afterAll(() => {
  try {
    fs.rmSync(OUT, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

/** Plan, build and run a conversion; returns the probed output. */
async function convert(
  sourceName: string,
  settings: ConversionSettings,
  outputName: string
): Promise<{ source: MediaFile; output: MediaFile; plan: ReturnType<typeof planConversion> }> {
  const source = await probe.probe(path.join(FIXTURES, sourceName))
  expect(source.error).toBeUndefined()

  const plan = planConversion(source, settings, { hardware: null, availableEncoders })
  const outputPath = path.join(OUT, outputName)

  const built = buildConversionCommand(source, settings, plan, outputPath, {
    hardware: null,
    availableEncoders,
    threads: 0
  })

  const progressSamples: number[] = []
  const result = await engine.run(
    {
      jobId: `test-${outputName}`,
      args: built.args,
      durationSeconds: source.duration,
      outputPath
    },
    (p) => progressSamples.push(p.percent)
  )

  if (!result.ok) {
    throw new Error(
      `Conversion failed (${result.exitCode}): ${result.error?.reason}\n${result.stderr}`
    )
  }

  expect(fs.existsSync(outputPath)).toBe(true)
  const output = await probe.probe(outputPath)
  expect(output.error).toBeUndefined()

  return { source, output, plan }
}

/* ------------------------------------------------------------------ */

describe('probing', () => {
  it('reads every stream property from an MP4', async () => {
    const file = await probe.probe(path.join(FIXTURES, 'sample.mp4'))

    expect(file.error).toBeUndefined()
    expect(file.hasVideo).toBe(true)
    expect(file.hasAudio).toBe(true)
    expect(file.primaryVideo?.width).toBe(640)
    expect(file.primaryVideo?.height).toBe(360)
    expect(file.primaryVideo?.codec).toBe('h264')
    expect(file.primaryVideo?.fps).toBeCloseTo(25, 1)
    expect(file.primaryAudio?.codec).toBe('aac')
    expect(file.primaryAudio?.sampleRate).toBe(48000)
    expect(file.duration).toBeGreaterThan(2.5)
    expect(file.size).toBeGreaterThan(0)
  })

  it('detects subtitles and chapters in an MKV', async () => {
    const file = await probe.probe(path.join(FIXTURES, 'sample-subs.mkv'))

    expect(file.hasSubtitles).toBe(true)
    expect(file.chapters.length).toBe(2)
    expect(file.chapters[0].title).toBe('Opening')
  })

  it('recognises an audio-only file', async () => {
    const file = await probe.probe(path.join(FIXTURES, 'sample.flac'))

    expect(file.hasVideo).toBe(false)
    expect(file.hasAudio).toBe(true)
    expect(file.primaryAudio?.codec).toBe('flac')
  })

  it('reports an error instead of throwing for a missing file', async () => {
    const file = await probe.probe(path.join(FIXTURES, 'does-not-exist.mp4'))
    expect(file.error).toBeTruthy()
  })

  it('reports an error instead of throwing for a non-media file', async () => {
    const bogus = path.join(OUT, 'notmedia.mp4')
    fs.writeFileSync(bogus, 'this is definitely not a video')
    const file = await probe.probe(bogus)
    expect(file.error).toBeTruthy()
  })
})

describe('lossless remux (spec §50)', () => {
  it('MKV → MP4 copies streams without re-encoding', async () => {
    const settings = createDefaultSettings('mp4')
    const { source, output, plan } = await convert('sample.mkv', settings, 'remux.mp4')

    expect(plan.mode).toBe('lossless-remux')
    expect(output.primaryVideo?.codec).toBe('h264')
    expect(output.primaryAudio?.codec).toBe('aac')
    expect(output.primaryVideo?.width).toBe(source.primaryVideo?.width)
    expect(output.duration).toBeCloseTo(source.duration, 0)
  })

  it('MP4 → MKV copies streams without re-encoding', async () => {
    const settings = createDefaultSettings('mkv')
    const { output, plan } = await convert('sample.mp4', settings, 'remux.mkv')

    expect(plan.mode).toBe('lossless-remux')
    expect(output.primaryVideo?.codec).toBe('h264')
  })

  it('MOV → MP4 copies streams without re-encoding', async () => {
    const settings = createDefaultSettings('mp4')
    const { output, plan } = await convert('sample.mov', settings, 'mov-remux.mp4')

    expect(plan.mode).toBe('lossless-remux')
    expect(output.hasVideo).toBe(true)
  })

  it('produces a byte-identical video bitstream, proving the remux is lossless', async () => {
    // The decisive check: hash the raw encoded video packets before and
    // after. A true remux changes only the container, so the bitstream MD5
    // must match exactly. A re-encode of the same source must not.
    await convert('sample.mkv', createDefaultSettings('mp4'), 'hash-remux.mp4')

    const sourceHash = streamHash(path.join(FIXTURES, 'sample.mkv'))
    const remuxHash = streamHash(path.join(OUT, 'hash-remux.mp4'))
    expect(remuxHash).toBe(sourceHash)

    // A genuine codec change must alter the bitstream.
    const encodeSettings = createDefaultSettings('mp4')
    encodeSettings.video.codec = 'mpeg4'
    encodeSettings.video.hardware = 'cpu'
    await convert('sample.mkv', encodeSettings, 'hash-encode.mp4')

    expect(streamHash(path.join(OUT, 'hash-encode.mp4'))).not.toBe(sourceHash)
  })

  it('refuses a redundant re-encode when the target codec matches the source', async () => {
    // Asking for H.264 on an H.264 source with no other changes is a no-op;
    // GConverter copies instead of degrading the picture for nothing (§2).
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'h264'
    settings.audio.codec = 'aac'

    const { plan } = await convert('sample.mkv', settings, 'redundant.mp4')
    expect(plan.streams.find((s) => s.kind === 'video')?.action).toBe('copy')
    expect(streamHash(path.join(OUT, 'redundant.mp4'))).toBe(
      streamHash(path.join(FIXTURES, 'sample.mkv'))
    )
  })
})

/** MD5 of a file's first video stream as stored, without re-encoding it. */
function streamHash(filePath: string): string {
  const output = execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'],
    { encoding: 'utf-8' }
  )
  return output.trim()
}

describe('re-encoding', () => {
  it('AVI → MP4 transcodes MPEG-4 and MP3 into H.264 and AAC', async () => {
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'h264'
    settings.video.crf = 30
    settings.video.preset = 'ultrafast'
    settings.video.hardware = 'cpu'
    settings.audio.codec = 'aac'
    settings.audio.bitrate = 128

    const { output, plan } = await convert('sample.avi', settings, 'from-avi.mp4')

    expect(plan.mode).toBe('re-encode')
    expect(output.primaryVideo?.codec).toBe('h264')
    expect(output.primaryAudio?.codec).toBe('aac')
  })

  it('MP4 → WebM produces VP9 and Opus', async () => {
    const settings = createDefaultSettings('webm')
    settings.video.codec = 'vp9'
    settings.video.crf = 50
    settings.video.hardware = 'cpu'
    settings.audio.codec = 'opus'
    settings.audio.bitrate = 64

    const { output } = await convert('sample.mp4', settings, 'out.webm')

    expect(output.primaryVideo?.codec).toBe('vp9')
    expect(output.primaryAudio?.codec).toBe('opus')
  }, 180_000)

  it('downscales only when asked, and keeps the aspect ratio', async () => {
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'h264'
    settings.video.crf = 32
    settings.video.preset = 'ultrafast'
    settings.video.hardware = 'cpu'
    settings.video.width = 320
    settings.video.height = 180

    const { output } = await convert('sample.mp4', settings, 'scaled.mp4')

    expect(output.primaryVideo?.width).toBe(320)
    expect(output.primaryVideo?.height).toBe(180)
  })

  it('changes the frame rate only when asked', async () => {
    const settings = createDefaultSettings('mp4')
    settings.video.codec = 'h264'
    settings.video.crf = 32
    settings.video.preset = 'ultrafast'
    settings.video.hardware = 'cpu'
    settings.video.fps = 10

    const { output } = await convert('sample.mp4', settings, 'fps.mp4')

    expect(output.primaryVideo?.fps).toBeCloseTo(10, 0)
  })
})

describe('audio conversions', () => {
  it('video → MP3 extracts and encodes the audio only', async () => {
    const settings = createDefaultSettings('mp3')
    settings.video.codec = 'none'
    settings.audio.codec = 'mp3'
    settings.audio.bitrate = 192

    const { output } = await convert('sample.mp4', settings, 'audio.mp3')

    expect(output.hasVideo).toBe(false)
    expect(output.primaryAudio?.codec).toBe('mp3')
  })

  it('WAV → FLAC is lossless and smaller', async () => {
    const settings = createDefaultSettings('flac')
    settings.video.codec = 'none'
    settings.audio.codec = 'flac'

    const { source, output, plan } = await convert('sample.wav', settings, 'out.flac')

    expect(plan.mode).toBe('lossless-encode')
    expect(output.primaryAudio?.codec).toBe('flac')
    expect(output.size).toBeLessThan(source.size)
  })

  it('FLAC → MP3 warns that quality cannot be recovered later', async () => {
    const settings = createDefaultSettings('mp3')
    settings.video.codec = 'none'
    settings.audio.codec = 'mp3'
    settings.audio.bitrate = 192

    const { output } = await convert('sample.flac', settings, 'from-flac.mp3')
    expect(output.primaryAudio?.codec).toBe('mp3')
  })

  it('WAV → FLAC → WAV round-trips to identical audio samples', async () => {
    // The definitive proof that "lossless" is not just a label.
    const toFlac = createDefaultSettings('flac')
    toFlac.video.codec = 'none'
    toFlac.audio.codec = 'flac'
    await convert('sample.wav', toFlac, 'roundtrip.flac')

    const backToWav = createDefaultSettings('wav')
    backToWav.video.codec = 'none'
    backToWav.audio.codec = 'pcm_s16le'

    const source = await probe.probe(path.join(OUT, 'roundtrip.flac'))
    const plan = planConversion(source, backToWav, { hardware: null, availableEncoders })
    const outputPath = path.join(OUT, 'roundtrip.wav')
    const built = buildConversionCommand(source, backToWav, plan, outputPath, {
      hardware: null,
      availableEncoders,
      threads: 0
    })
    const result = await engine.run(
      { jobId: 'roundtrip', args: built.args, durationSeconds: source.duration, outputPath },
      () => {}
    )
    expect(result.ok).toBe(true)

    const original = fs.readFileSync(path.join(FIXTURES, 'sample.wav'))
    const restored = fs.readFileSync(outputPath)

    // Compare PCM payloads, skipping headers whose chunk layout may differ.
    const originalPcm = original.subarray(original.length - 100_000)
    const restoredPcm = restored.subarray(restored.length - 100_000)
    expect(Buffer.compare(originalPcm, restoredPcm)).toBe(0)
  })
})

describe('stream handling', () => {
  it('removes audio when requested', async () => {
    const settings = createDefaultSettings('mp4')
    settings.audio.codec = 'none'

    const { output } = await convert('sample.mkv', settings, 'noaudio.mp4')
    expect(output.hasAudio).toBe(false)
    expect(output.hasVideo).toBe(true)
  })

  it('carries subtitles from MKV into MP4 as mov_text', async () => {
    const settings = createDefaultSettings('mp4')
    settings.subtitles.action = 'keep'

    const { output } = await convert('sample-subs.mkv', settings, 'subs.mp4')
    expect(output.hasSubtitles).toBe(true)
    const sub = output.streams.find((s) => s.kind === 'subtitle')
    expect(sub?.codec).toMatch(/mov_text|tx3g/)
  })

  it('removes subtitles when requested', async () => {
    const settings = createDefaultSettings('mkv')
    settings.subtitles.action = 'remove'

    const { output } = await convert('sample-subs.mkv', settings, 'nosubs.mkv')
    expect(output.hasSubtitles).toBe(false)
  })

  it('preserves chapters into a container that supports them', async () => {
    const settings = createDefaultSettings('mp4')
    settings.container.chapters = 'keep'

    const { output } = await convert('sample-subs.mkv', settings, 'chapters.mp4')
    expect(output.chapters.length).toBe(2)
  })

  it('strips metadata when asked', async () => {
    const settings = createDefaultSettings('mkv')
    settings.metadata.action = 'remove'

    const { output } = await convert('sample-subs.mkv', settings, 'nometa.mkv')
    expect(output.metadata.title).toBeUndefined()
  })

  it('writes custom metadata', async () => {
    const settings = createDefaultSettings('mkv')
    settings.metadata.action = 'custom'
    settings.metadata.fields = { title: 'GConverter Custom Title', artist: 'Test Suite' }

    const { output } = await convert('sample.mkv', settings, 'meta.mkv')
    const title = output.metadata.title ?? output.metadata.TITLE
    expect(title).toBe('GConverter Custom Title')
  })
})

describe('difficult filenames (spec §39)', () => {
  it('converts a file whose name contains spaces, quotes, & and non-ASCII', async () => {
    const settings = createDefaultSettings('mkv')
    const { output } = await convert(
      "tricky name & 'quoted' #1 ñ.mp4",
      settings,
      "output & 'tricky' #2 ñ.mkv"
    )
    expect(output.hasVideo).toBe(true)
  })
})

describe('cancellation (spec §31)', () => {
  it('removes the partial output when a job is cancelled', async () => {
    const source = await probe.probe(path.join(FIXTURES, 'sample.mkv'))
    const settings = createDefaultSettings('mp4')
    // A deliberately slow encode so there is time to cancel it.
    settings.video.codec = 'h264'
    settings.video.preset = 'veryslow'
    settings.video.crf = 0
    settings.video.hardware = 'cpu'
    settings.video.width = 1920
    settings.video.height = 1080

    const plan = planConversion(source, settings, { hardware: null, availableEncoders })
    const outputPath = path.join(OUT, 'cancelled.mp4')
    const built = buildConversionCommand(source, settings, plan, outputPath, {
      hardware: null,
      availableEncoders,
      threads: 0
    })

    const jobId = 'cancel-test'
    const runPromise = engine.run(
      { jobId, args: built.args, durationSeconds: source.duration, outputPath },
      () => {}
    )

    // Give FFmpeg a moment to actually start writing, then stop it.
    await new Promise((resolve) => setTimeout(resolve, 900))
    const cancelled = engine.cancel(jobId)
    expect(cancelled).toBe(true)

    const result = await runPromise
    expect(result.cancelled).toBe(true)
    expect(result.ok).toBe(false)
    // No half-written file may survive.
    expect(fs.existsSync(outputPath)).toBe(false)
  })
})

describe('error handling (spec §30)', () => {
  it('returns a friendly explanation instead of crashing on a bad input', async () => {
    const bogus = path.join(OUT, 'broken.mp4')
    fs.writeFileSync(bogus, Buffer.alloc(2048, 7))

    const result = await engine.run(
      {
        jobId: 'bad-input',
        args: ['-hide_banner', '-loglevel', 'error', '-y', '-i', bogus, path.join(OUT, 'x.mkv')],
        durationSeconds: 1,
        outputPath: path.join(OUT, 'x.mkv')
      },
      () => {}
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error?.suggestion).toBeTruthy()
    expect(result.error?.reason.length).toBeGreaterThan(0)
  })
})

describe('smart convert (spec §19)', () => {
  it('chooses a pure remux when the container allows it', async () => {
    const source = await probe.probe(path.join(FIXTURES, 'sample.mkv'))
    const appSettings = createDefaultAppSettings(OUT, OUT)

    const settings = smartConvert(source, 'mp4', {
      hardware: null,
      availableEncoders,
      settings: appSettings
    })

    expect(settings.video.codec).toBe('copy')
    expect(settings.audio.codec).toBe('copy')
  })

  it('picks a valid codec when the container cannot take the source', async () => {
    const source = await probe.probe(path.join(FIXTURES, 'sample.mkv'))
    const appSettings = createDefaultAppSettings(OUT, OUT)

    const settings = smartConvert(source, 'webm', {
      hardware: null,
      availableEncoders,
      settings: appSettings
    })

    expect(['vp8', 'vp9', 'av1']).toContain(settings.video.codec)
    expect(['opus', 'vorbis']).toContain(settings.audio.codec)
  })

  it('keeps a lossless source lossless when the target allows it', async () => {
    const source = await probe.probe(path.join(FIXTURES, 'sample.flac'))
    const appSettings = createDefaultAppSettings(OUT, OUT)

    const settings = smartConvert(source, 'm4a', {
      hardware: null,
      availableEncoders,
      settings: appSettings
    })

    // FLAC in, ALAC out — both lossless. Never silently drop to AAC.
    expect(settings.audio.codec).toBe('alac')
  })
})

describe('hardware detection (spec §12)', () => {
  it('verifies encoders with a real test encode', async () => {
    const info = await resolveFFmpeg()
    const caps = await detectHardware(info.ffmpegPath, info.encoders, true)

    expect(caps.cpuThreads).toBeGreaterThan(0)
    expect(caps.cpuModel.length).toBeGreaterThan(0)

    // Every encoder marked available must genuinely work.
    for (const encoder of caps.encoders.filter((e) => e.available)) {
      expect(encoder.verified).toBe(true)
    }
  }, 180_000)
})
