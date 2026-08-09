/**
 * FFmpeg binary resolution (spec §34).
 *
 * Resolution order:
 *   1. Explicit user-configured path (Settings → Advanced)
 *   2. Binary bundled with the application
 *   3. Binary found on the system PATH
 *
 * The resolver never throws: if nothing is found it returns an FFmpegInfo
 * with `available: false` so the UI can guide the user instead of crashing.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FFmpegInfo, FFmpegSource } from '@shared/models'
import { logger } from '../logging/logger'

const execFileAsync = promisify(execFile)

const EXE = process.platform === 'win32' ? '.exe' : ''

/** Where electron-builder places unpacked binaries in a packaged build. */
function resourceCandidates(binary: 'ffmpeg' | 'ffprobe'): string[] {
  const name = binary + EXE
  const candidates: string[] = []

  // Packaged: resources/bin/ffmpeg.exe
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', name))
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', name))
  }

  // Development: resolve through the npm packages that ship the binaries.
  try {
    if (binary === 'ffmpeg') {
      // ffmpeg-static exports the absolute path as its default export.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const p = require('ffmpeg-static')
      if (typeof p === 'string' && p) candidates.push(p)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('ffprobe-static')
      const p = typeof mod === 'string' ? mod : mod?.path
      if (typeof p === 'string' && p) candidates.push(p)
    }
  } catch {
    // Package not installed — fall through to the other candidates.
  }

  // Project-local bin/ folder, useful for manual drops.
  candidates.push(path.join(process.cwd(), 'bin', name))

  return candidates
}

/** Look for `binary` on the PATH without invoking a shell. */
async function findOnPath(binary: string): Promise<string | null> {
  const name = binary + EXE
  const pathVar = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir.replace(/"/g, ''), name)
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* unreadable PATH entry — skip */
    }
  }
  return null
}

async function verify(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ['-version'], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
    const first = stdout.split('\n')[0]?.trim()
    return first || null
  } catch {
    return null
  }
}

interface ResolvedBinary {
  path: string
  source: FFmpegSource
  versionLine: string
}

async function resolveBinary(
  binary: 'ffmpeg' | 'ffprobe',
  userPath?: string
): Promise<ResolvedBinary | null> {
  // 1. User-configured path.
  if (userPath && userPath.trim()) {
    const trimmed = userPath.trim()
    if (existsSync(trimmed)) {
      const version = await verify(trimmed)
      if (version) return { path: trimmed, source: 'custom', versionLine: version }
      logger.warn('ffmpeg', `Custom ${binary} path is not a working binary`, { path: trimmed })
    } else {
      logger.warn('ffmpeg', `Custom ${binary} path does not exist`, { path: trimmed })
    }
  }

  // 2. Bundled binaries.
  for (const candidate of resourceCandidates(binary)) {
    // In a packaged app the asar path needs rewriting to the unpacked copy.
    const real = candidate.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
    if (!existsSync(real)) continue
    const version = await verify(real)
    if (version) return { path: real, source: 'bundled', versionLine: version }
  }

  // 3. System PATH.
  const onPath = await findOnPath(binary)
  if (onPath) {
    const version = await verify(onPath)
    if (version) return { path: onPath, source: 'system', versionLine: version }
  }

  return null
}

/** Parse `ffmpeg -encoders` style output into a list of names. */
function parseCapabilityList(stdout: string): string[] {
  const names: string[] = []
  const lines = stdout.split('\n')
  let started = false
  for (const line of lines) {
    if (!started) {
      if (/^\s*-+\s*$/.test(line)) started = true
      continue
    }
    // Format: " V....D name    Description"
    const match = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

function parseMuxers(stdout: string): string[] {
  const names: string[] = []
  let started = false
  for (const line of stdout.split('\n')) {
    if (!started) {
      if (/^\s*-+\s*$/.test(line)) started = true
      continue
    }
    const match = /^\s*[ E][ D]\s+(\S+)/.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

function parseHwaccels(stdout: string): string[] {
  return stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Hardware'))
}

async function safeList(
  binPath: string,
  args: string[],
  parser: (out: string) => string[]
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(binPath, args, {
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    return parser(stdout)
  } catch (err) {
    logger.debug('ffmpeg', `Capability query failed: ${args.join(' ')}`, { err: String(err) })
    return []
  }
}

let cached: FFmpegInfo | null = null

/**
 * Discover FFmpeg and FFprobe and query their capabilities.
 * The result is cached; pass `force` after the user changes the paths.
 */
export async function resolveFFmpeg(
  userFFmpegPath?: string,
  userFFprobePath?: string,
  force = false
): Promise<FFmpegInfo> {
  if (cached && !force) return cached

  const ffmpeg = await resolveBinary('ffmpeg', userFFmpegPath)
  const ffprobe = await resolveBinary('ffprobe', userFFprobePath)

  if (!ffmpeg || !ffprobe) {
    const missing = [!ffmpeg && 'ffmpeg', !ffprobe && 'ffprobe'].filter(Boolean).join(' and ')
    const info: FFmpegInfo = {
      available: false,
      source: 'missing',
      ffmpegPath: ffmpeg?.path ?? '',
      ffprobePath: ffprobe?.path ?? '',
      encoders: [],
      decoders: [],
      muxers: [],
      hwaccels: [],
      error:
        `Could not locate ${missing}. Install FFmpeg and add it to your PATH, ` +
        `or set an explicit path in Settings → Advanced.`
    }
    cached = info
    logger.error('ffmpeg', info.error!)
    return info
  }

  const [encoders, decoders, muxers, hwaccels] = await Promise.all([
    safeList(ffmpeg.path, ['-hide_banner', '-encoders'], parseCapabilityList),
    safeList(ffmpeg.path, ['-hide_banner', '-decoders'], parseCapabilityList),
    safeList(ffmpeg.path, ['-hide_banner', '-muxers'], parseMuxers),
    safeList(ffmpeg.path, ['-hide_banner', '-hwaccels'], parseHwaccels)
  ])

  const versionMatch = /ffmpeg version (\S+)/i.exec(ffmpeg.versionLine)

  const info: FFmpegInfo = {
    available: true,
    source: ffmpeg.source,
    ffmpegPath: ffmpeg.path,
    ffprobePath: ffprobe.path,
    version: versionMatch?.[1] ?? ffmpeg.versionLine,
    encoders,
    decoders,
    muxers,
    hwaccels
  }

  cached = info
  logger.info('ffmpeg', `FFmpeg ready (${info.source})`, {
    version: info.version,
    path: info.ffmpegPath,
    encoders: encoders.length,
    hwaccels
  })
  return info
}

export function getCachedFFmpeg(): FFmpegInfo | null {
  return cached
}

export function clearFFmpegCache(): void {
  cached = null
}

/** Platform info used by the System panel (spec §13). */
export function platformSummary(): { platform: string; arch: string; release: string } {
  return { platform: process.platform, arch: process.arch, release: os.release() }
}
