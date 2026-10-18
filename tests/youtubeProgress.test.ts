/**
 * Real yt-dlp runs against a local, deliberately slow HTTP server, checking
 * that the download list reports progress *while* downloading rather than
 * jumping from 0 % to done. Skipped when bin/yt-dlp has not been fetched
 * (npm run ytdlp).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { YouTubeDownload, YouTubeRequest } from '../src/shared/models'
import { YouTubeDownloader } from '../src/main/core/youtube/downloader'
import { parseFFmpegStatus, parseFormatCount } from '../src/main/core/youtube/ytdlp'

const require = createRequire(import.meta.url)
const FFMPEG: string = require('ffmpeg-static')
const YTDLP = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const hasYtDlp = fs.existsSync(YTDLP)

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ytprog-'))
const CLIP = path.join(DIR, 'clip.mp4')
let server: http.Server
let baseUrl = ''

beforeAll(async () => {
  if (!hasYtDlp) return
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=s=1280x720:d=20',
    '-f', 'lavfi', '-i', 'sine=d=20',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-c:a', 'aac', '-shortest',
    '-movflags', '+faststart',
    CLIP
  ])

  // ~2 MB/s with Range support, so both a full download and ffmpeg seeking
  // for a fragment take long enough to report progress along the way.
  server = http.createServer((req, res) => {
    const data = fs.readFileSync(CLIP)
    let start = 0
    let end = data.length - 1
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
    if (range) {
      start = Number(range[1])
      end = range[2] ? Number(range[2]) : end
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Accept-Ranges': 'bytes'
      })
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length, 'Accept-Ranges': 'bytes' })
    }
    let i = start
    const timer = setInterval(() => {
      if (i > end || res.destroyed) {
        clearInterval(timer)
        res.end()
        return
      }
      res.write(data.subarray(i, Math.min(end + 1, i + 96 * 1024)))
      i += 96 * 1024
    }, 50)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(() => {
  server?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

function run(overrides: Partial<YouTubeRequest>): Promise<{ final: YouTubeDownload; percents: number[] }> {
  const downloader = new YouTubeDownloader({
    getYtDlp: () => ({ available: true, path: YTDLP, source: 'bundled' }),
    getFFmpegPath: () => FFMPEG,
    getLang: () => 'en',
    // Let the test reach its local server; production only accepts YouTube.
    normalizeUrl: (input) => (input.startsWith(baseUrl) ? input : null)
  })

  const percents: number[] = []
  return new Promise((resolve) => {
    downloader.on('event', (event) => {
      if (event.type !== 'updated') return
      const { download } = event
      if (download.status === 'downloading') percents.push(download.percent)
      if (['completed', 'failed', 'cancelled'].includes(download.status)) {
        resolve({ final: download, percents })
      }
    })
    downloader.start({
      url: `${baseUrl}/clip.mp4`,
      title: 'clip',
      duration: 20,
      mode: 'video',
      quality: 0,
      videoFormat: 'mp4',
      audioFormat: 'mp3',
      audioBitrate: 0,
      outputFolder: path.join(DIR, 'out'),
      exactCuts: false,
      cookiesBrowser: '',
      ...overrides
    })
  })
}

describe('yt-dlp output helpers', () => {
  it('counts the formats a download will fetch', () => {
    expect(parseFormatCount('[info] abc: Downloading 1 format(s): 137+140')).toBe(2)
    expect(parseFormatCount('[info] abc: Downloading 1 format(s): 18')).toBe(1)
    expect(parseFormatCount('[download] Destination: x')).toBeNull()
  })

  it('reads ffmpeg status lines used for fragments', () => {
    expect(parseFFmpegStatus('size=  1024kB time=00:01:05.40 bitrate= 128.2kbits/s speed=2.13x')).toEqual({
      time: 65.4,
      speed: 2.13
    })
    expect(parseFFmpegStatus('size=       0kB time=N/A bitrate=N/A')).toBeNull()
  })
})

describe.skipIf(!hasYtDlp)('download progress with real yt-dlp', () => {
  it('reports progress during a full download', async () => {
    const { final, percents } = await run({})
    expect(final.status, final.error).toBe('completed')
    expect(fs.existsSync(final.outputPath!)).toBe(true)
    expect(final.percent).toBe(100)
    // The bug: everything stayed at 0 % until the file appeared.
    const between = percents.filter((p) => p > 0 && p < 100)
    expect(between.length, `percents seen: ${percents.join(', ')}`).toBeGreaterThan(1)
    expect(Math.max(...between)).toBeGreaterThan(30)
  }, 120_000)

  it('reports progress while downloading only a fragment', async () => {
    const { final, percents } = await run({ sectionStart: 2, sectionEnd: 18 })
    expect(final.status, final.error).toBe('completed')
    expect(fs.existsSync(final.outputPath!)).toBe(true)
    const between = percents.filter((p) => p > 0 && p < 100)
    expect(between.length, `percents seen: ${percents.join(', ')}`).toBeGreaterThan(0)
  }, 120_000)
})
