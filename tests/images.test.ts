/**
 * Still-image conversion: planning, command shape, and real round trips
 * through the bundled FFmpeg for every image format the app offers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { MediaFile, VideoStream } from '../src/shared/models'
import { CONTAINERS, isImageTarget, pixelFormatHasAlpha } from '../src/shared/formats'
import { MediaProbe, detectImage } from '../src/main/core/media/probe'
import { FFmpegConversionEngine } from '../src/main/core/conversion/engine'
import { planConversion } from '../src/main/core/conversion/planner'
import {
  buildConversionCommand,
  imageOutputSize
} from '../src/main/core/conversion/commandFactory'
import { applyProfileCaps, smartConvert } from '../src/main/core/conversion/smart'
import { IMAGE_PRESETS, createDefaultAppSettings } from '../src/main/core/profiles/defaults'
import { resolveFFmpeg } from '../src/main/core/ffmpeg/resolver'

const require = createRequire(import.meta.url)
const FFMPEG: string = require('ffmpeg-static')
const FFPROBE: string = (() => {
  const mod = require('ffprobe-static')
  return typeof mod === 'string' ? mod : mod.path
})()

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gconverter-images-'))
const probe = new MediaProbe(FFPROBE, FFMPEG)
const engine = new FFmpegConversionEngine(FFMPEG)
const appSettings = createDefaultAppSettings(OUT, OUT)

let availableEncoders: string[] = []

/** 320×200 half-transparent red PNG: exercises alpha handling. */
const SOURCE_PNG = path.join(OUT, 'source.png')

beforeAll(async () => {
  const info = await resolveFFmpeg()
  availableEncoders = info.encoders
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red@0.5:s=320x200,format=rgba',
    '-frames:v', '1', SOURCE_PNG
  ])
}, 120_000)

afterAll(() => {
  fs.rmSync(OUT, { recursive: true, force: true })
})

async function convertImage(
  source: MediaFile,
  format: string,
  outName: string,
  tweak?: (s: ReturnType<typeof smartConvert>) => void
): Promise<{ output: MediaFile; args: string[]; plan: ReturnType<typeof planConversion> }> {
  const settings = smartConvert(source, format, { hardware: null, availableEncoders, settings: appSettings })
  tweak?.(settings)
  const plan = planConversion(source, settings, { hardware: null, availableEncoders })
  const outputPath = path.join(OUT, outName)
  const built = buildConversionCommand(source, settings, plan, outputPath, {
    hardware: null,
    availableEncoders,
    threads: 0
  })
  const result = await engine.run(
    { jobId: `img-${outName}`, args: built.args, durationSeconds: 1, outputPath },
    () => {}
  )
  if (!result.ok) throw new Error(`${format} failed: ${result.error?.reason}\n${result.stderr}`)
  const output = await probe.probe(outputPath)
  return { output, args: built.args, plan }
}

/* ------------------------------------------------------------------ */

describe('image detection', () => {
  it('marks a PNG as an image', async () => {
    const file = await probe.probe(SOURCE_PNG)
    expect(file.error).toBeUndefined()
    expect(file.isImage).toBe(true)
    expect(file.primaryVideo?.width).toBe(320)
    expect(pixelFormatHasAlpha(file.primaryVideo?.pixelFormat)).toBe(true)
  })

  it('does not treat a GIF with many frames as an image', () => {
    const video = { kind: 'video', frameCount: 30 } as VideoStream
    const gif = {
      extension: 'gif',
      hasVideo: true,
      hasAudio: false,
      duration: 3,
      primaryVideo: video
    } as MediaFile
    expect(detectImage(gif)).toBe(false)
    expect(detectImage({ ...gif, duration: 0.1, primaryVideo: { ...video, frameCount: 1 } })).toBe(true)
  })
})

describe('image sizing', () => {
  const picture = { width: 4000, height: 3000 }

  it('keeps the size when nothing is asked', () => {
    expect(imageOutputSize(picture, {})).toEqual({ width: 4000, height: 3000 })
  })

  it('follows the aspect ratio from a single side', () => {
    expect(imageOutputSize(picture, { width: 800 })).toEqual({ width: 800, height: 600 })
    expect(imageOutputSize(picture, { height: 300 })).toEqual({ width: 400, height: 300 })
  })

  it('fits inside a box without distorting', () => {
    expect(imageOutputSize(picture, { width: 1000, height: 1000 })).toEqual({ width: 1000, height: 750 })
  })

  it('respects a format limit such as ICO', () => {
    expect(imageOutputSize(picture, {}, 256)).toEqual({ width: 256, height: 192 })
  })
})

describe('image plans', () => {
  it('only offers image formats through the image path', () => {
    const images = CONTAINERS.filter((c) => isImageTarget(c))
    expect(images.map((c) => c.id)).toEqual(['jpg', 'png', 'webp', 'avif', 'bmp', 'tiff', 'ico', 'tga'])
  })

  it('warns that JPG flattens transparency', async () => {
    const source = await probe.probe(SOURCE_PNG)
    const settings = smartConvert(source, 'jpg', { hardware: null, availableEncoders, settings: appSettings })
    const plan = planConversion(source, settings, { hardware: null, availableEncoders })
    expect(plan.mode).toBe('re-encode')
    expect(plan.warnings.join(' ')).toMatch(/transparen/i)
  })

  it('calls PNG → TIFF lossless', async () => {
    const source = await probe.probe(SOURCE_PNG)
    const settings = smartConvert(source, 'tiff', { hardware: null, availableEncoders, settings: appSettings })
    const plan = planConversion(source, settings, { hardware: null, availableEncoders })
    expect(plan.mode).toBe('lossless-encode')
  })
})

describe('image presets', () => {
  const picture = (width: number, height: number): MediaFile =>
    ({
      hasVideo: true,
      hasAudio: false,
      isImage: true,
      extension: 'png',
      primaryVideo: { width, height } as VideoStream
    }) as MediaFile

  it('shrink large pictures into the preset box', () => {
    const preset = IMAGE_PRESETS.find((p) => p.id === 'image-thumbnail')!
    const settings = applyProfileCaps(preset, picture(4000, 3000))
    expect(settings.image).toMatchObject({ width: 512, height: 384, quality: 80, stripMetadata: true })
    expect(settings.container.format).toBe('jpg')
  })

  it('never enlarge a small picture', () => {
    const preset = IMAGE_PRESETS.find((p) => p.id === 'image-web')!
    const settings = applyProfileCaps(preset, picture(800, 600))
    expect(settings.image?.width).toBeUndefined()
    expect(settings.image?.height).toBeUndefined()
  })

  it('every image preset writes an image format', () => {
    for (const preset of IMAGE_PRESETS) {
      expect(isImageTarget(CONTAINERS.find((c) => c.id === preset.settings.container.format))).toBe(true)
      expect(preset.category).toBe('image')
    }
  })
})

describe('real image conversions', () => {
  const formats: [string, string, string][] = [
    ['jpg', 'out.jpg', 'mjpeg'],
    ['png', 'out.png', 'png'],
    ['webp', 'out.webp', 'webp'],
    ['avif', 'out.avif', 'av1'],
    ['bmp', 'out.bmp', 'bmp'],
    ['tiff', 'out.tiff', 'tiff'],
    ['tga', 'out.tga', 'targa'],
    ['gif', 'out.gif', 'gif']
  ]

  for (const [format, name, codec] of formats) {
    it(`PNG → ${format.toUpperCase()}`, async () => {
      const source = await probe.probe(SOURCE_PNG)
      const { output, args } = await convertImage(source, format, name)
      expect(output.error).toBeUndefined()
      expect(output.primaryVideo?.codec).toBe(codec)
      expect(output.primaryVideo?.width).toBe(320)
      expect(output.primaryVideo?.height).toBe(200)
      expect(args).toContain('-frames:v')
    }, 60_000)
  }

  it('flattens alpha onto the chosen background for JPG', async () => {
    const source = await probe.probe(SOURCE_PNG)
    const { output, args } = await convertImage(source, 'jpg', 'flat.jpg', (s) => {
      s.image!.background = '#0000ff'
    })
    expect(args.join(' ')).toContain('color=c=0x0000ff')
    expect(pixelFormatHasAlpha(output.primaryVideo?.pixelFormat)).toBe(false)
  }, 60_000)

  it('resizes when asked', async () => {
    const source = await probe.probe(SOURCE_PNG)
    const { output } = await convertImage(source, 'webp', 'small.webp', (s) => {
      s.image!.width = 160
    })
    expect(output.primaryVideo?.width).toBe(160)
    expect(output.primaryVideo?.height).toBe(100)
  }, 60_000)

  it('writes a valid ICO, shrinking to the format limit', async () => {
    const big = path.join(OUT, 'big.png')
    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=s=600x400', '-frames:v', '1', big
    ])
    const source = await probe.probe(big)
    const { output } = await convertImage(source, 'ico', 'icon.ico')
    expect(output.primaryVideo?.width).toBe(256)
  }, 60_000)

  it('reads an AVIF back even though the bundled ffprobe cannot', async () => {
    const avif = await probe.probe(path.join(OUT, 'out.avif'))
    expect(avif.error).toBeUndefined()
    expect(avif.isImage).toBe(true)
    expect(avif.primaryVideo?.width).toBe(320)

    const { output } = await convertImage(avif, 'png', 'from-avif.png')
    expect(output.primaryVideo?.codec).toBe('png')
  }, 60_000)

  it('keeps a "%" in the filename literal', async () => {
    const source = await probe.probe(SOURCE_PNG)
    const { output } = await convertImage(source, 'jpg', '100% done.jpg')
    expect(output.error).toBeUndefined()
    expect(fs.existsSync(path.join(OUT, '100% done.jpg'))).toBe(true)
  }, 60_000)

  it('grabs a frame from a video at the chosen time', async () => {
    const clip = path.join(OUT, 'clip.mp4')
    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=3', '-pix_fmt', 'yuv420p', clip
    ])
    const source = await probe.probe(clip)
    expect(source.isImage).toBe(false)
    const { output, args, plan } = await convertImage(source, 'png', 'frame.png', (s) => {
      s.trim = { start: 1.5 }
    })
    expect(args.slice(0, args.indexOf('-i'))).toContain('-ss')
    expect(plan.warnings.join(' ')).toMatch(/frame/i)
    expect(output.primaryVideo?.width).toBe(640)
  }, 60_000)
})
