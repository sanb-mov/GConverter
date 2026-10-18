/**
 * YouTube downloads: URL and time validation, the yt-dlp argument list,
 * output parsing and the error explanations. None of this touches the
 * network — yt-dlp itself is exercised manually.
 */

import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type { YouTubeRequest } from '../src/shared/models'
import {
  formatTimecode,
  isValidSection,
  normalizeYouTubeUrl,
  parseTimecode
} from '../src/shared/youtube'
import {
  buildDownloadArgs,
  buildInfoArgs,
  classifyYtDlpError,
  explainYtDlpError,
  isPostProcessingLine,
  parseFileLine,
  parseInfo,
  parseProgressLine
} from '../src/main/core/youtube/ytdlp'
import { YouTubeDownloader } from '../src/main/core/youtube/downloader'
import { isYouTubeCookie, looksSignedIn, toNetscapeCookies } from '../src/main/core/youtube/cookies'

const context = { ffmpegPath: '/opt/ffmpeg', jsRuntimePath: '/opt/electron' }

function request(overrides: Partial<YouTubeRequest> = {}): YouTubeRequest {
  return {
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'Test',
    duration: 3600,
    mode: 'video',
    quality: 1080,
    videoFormat: 'mp4',
    audioFormat: 'mp3',
    audioBitrate: 0,
    outputFolder: path.join(os.tmpdir(), 'gc-yt'),
    exactCuts: false,
    cookiesBrowser: '',
    ...overrides
  }
}

/** Value that follows `flag` in an argument list. */
function after(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

describe('URL validation', () => {
  it('accepts the usual YouTube link shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/abc',
      'youtube.com/watch?v=dQw4w9WgXcQ',
      'http://www.youtube.com/watch?v=x'
    ]) {
      expect(normalizeYouTubeUrl(url), url).toMatch(/^https:\/\//)
    }
  })

  it('rejects other sites, local files and flag-like input', () => {
    for (const url of [
      '',
      'https://vimeo.com/123',
      'https://youtube.com.evil.example/watch?v=x',
      'https://notyoutube.com/watch',
      'file:///C:/Windows/system.ini',
      '--exec calc.exe',
      '-o x',
      'https://user:pass@youtube.com/watch?v=x',
      'javascript:alert(1)'
    ]) {
      expect(normalizeYouTubeUrl(url), url).toBeNull()
    }
  })
})

describe('timecodes', () => {
  it('parses every accepted form', () => {
    expect(parseTimecode('30:00')).toBe(1800)
    expect(parseTimecode('1:02:03')).toBe(3723)
    expect(parseTimecode('45')).toBe(45)
    expect(parseTimecode('45.5')).toBe(45.5)
    expect(parseTimecode(' 0:05 ')).toBe(5)
  })

  it('rejects malformed values', () => {
    for (const value of ['', 'abc', '1:60', '61:5:00:00', '-5', '1:2:3:4', '10:75']) {
      expect(parseTimecode(value), value).toBeNull()
    }
  })

  it('formats back for display', () => {
    expect(formatTimecode(3723)).toBe('1:02:03')
    expect(formatTimecode(65)).toBe('1:05')
    expect(formatTimecode(0)).toBe('0:00')
  })

  it('checks fragment ranges against the duration', () => {
    expect(isValidSection(1800, 3000, 3600)).toBe(true)
    expect(isValidSection(3000, 1800, 3600)).toBe(false)
    expect(isValidSection(100, 100, 3600)).toBe(false)
    expect(isValidSection(3700, 3800, 3600)).toBe(false)
    expect(isValidSection(0, 3601, 3600)).toBe(true)
    expect(isValidSection(0, 9999, 0)).toBe(true)
  })
})

describe('yt-dlp arguments', () => {
  it('ends with "--" then the URL so the URL can never be read as an option', () => {
    const args = buildDownloadArgs(request(), context)
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abc123'])
    expect(buildInfoArgs('https://youtu.be/x', '', context).slice(-2)).toEqual(['--', 'https://youtu.be/x'])
  })

  it('caps the video height and merges into the chosen container', () => {
    const args = buildDownloadArgs(request({ quality: 720, videoFormat: 'mkv' }), context)
    expect(after(args, '-f')).toBe('bv*+ba/b')
    expect(after(args, '-S')).toBe('res:720')
    expect(after(args, '--merge-output-format')).toBe('mkv')
    expect(args).not.toContain('-x')
  })

  it('prefers H.264 + AAC for MP4 so the file plays everywhere', () => {
    const args = buildDownloadArgs(request({ quality: 0, videoFormat: 'mp4' }), context)
    expect(after(args, '-S')).toBe('vcodec:h264,acodec:m4a')
  })

  it('extracts audio only', () => {
    const args = buildDownloadArgs(request({ mode: 'audio', audioFormat: 'mp3', audioBitrate: 192 }), context)
    expect(after(args, '-f')).toBe('ba/b')
    expect(args).toContain('-x')
    expect(after(args, '--audio-format')).toBe('mp3')
    expect(after(args, '--audio-quality')).toBe('192K')
    expect(args).not.toContain('--merge-output-format')
  })

  it('ignores the bitrate for lossless audio', () => {
    const args = buildDownloadArgs(request({ mode: 'audio', audioFormat: 'flac', audioBitrate: 320 }), context)
    expect(after(args, '--audio-quality')).toBe('0')
  })

  it('downloads only the requested fragment', () => {
    const args = buildDownloadArgs(request({ sectionStart: 1800, sectionEnd: 3000 }), context)
    expect(after(args, '--download-sections')).toBe('*1800-3000')
    expect(args).not.toContain('--force-keyframes-at-cuts')
    // The part is named after its range, with no colons (illegal on Windows).
    expect(after(args, '-o')).toBe('%(title).150B [%(id)s] (30.00-50.00).%(ext)s')
  })

  it('adds exact cuts only when asked', () => {
    const args = buildDownloadArgs(
      request({ sectionStart: 10, sectionEnd: 20.5, exactCuts: true }),
      context
    )
    expect(after(args, '--download-sections')).toBe('*10-20.5')
    expect(args).toContain('--force-keyframes-at-cuts')
  })

  it('points yt-dlp at our FFmpeg, folder, JS runtime and browser', () => {
    const args = buildDownloadArgs(request({ cookiesBrowser: 'firefox' }), context)
    expect(after(args, '--ffmpeg-location')).toBe('/opt/ffmpeg')
    expect(after(args, '-P')).toBe(request().outputFolder)
    expect(after(args, '--js-runtimes')).toBe('node:/opt/electron')
    expect(after(args, '--cookies-from-browser')).toBe('firefox')
    expect(args).toContain('--no-playlist')
  })

  it('leaves cookies out when no browser is chosen', () => {
    expect(buildDownloadArgs(request(), context)).not.toContain('--cookies-from-browser')
  })
})

describe('yt-dlp output parsing', () => {
  it('reads the video info JSON', () => {
    const info = parseInfo(
      JSON.stringify({
        id: 'abc',
        title: 'A video',
        channel: 'Someone',
        duration: 3600,
        thumbnail: 'https://i.ytimg.com/vi/abc/hq.jpg',
        webpage_url: 'https://www.youtube.com/watch?v=abc',
        live_status: 'not_live',
        formats: [
          { height: 1080, vcodec: 'avc1' },
          { height: 720, vcodec: 'vp9' },
          { height: 1080, vcodec: 'vp9' },
          { height: null, vcodec: 'none' },
          { height: 2160, vcodec: 'av01' }
        ]
      }),
      'https://youtu.be/abc'
    )
    expect(info.title).toBe('A video')
    expect(info.duration).toBe(3600)
    expect(info.heights).toEqual([2160, 1080, 720])
    expect(info.isLive).toBe(false)
  })

  it('flags live streams', () => {
    expect(parseInfo(JSON.stringify({ id: 'x', is_live: true }), 'u').isLive).toBe(true)
  })

  it('parses progress lines, with NA fields left undefined', () => {
    expect(parseProgressLine('GCPROG downloading|500|1000|NA|2048|12')).toEqual({
      status: 'downloading',
      downloaded: 500,
      total: 1000,
      speed: 2048,
      eta: 12
    })
    // Falls back to the size estimate when the exact size is unknown.
    expect(parseProgressLine('GCPROG downloading|10|NA|40|NA|NA')?.total).toBe(40)
    expect(parseProgressLine('[download] 50% of 10MiB')).toBeNull()
  })

  it('finds the final file and post-processing steps', () => {
    expect(parseFileLine('GCFILE C:\\Videos\\A video [abc].mp4')).toBe('C:\\Videos\\A video [abc].mp4')
    expect(parseFileLine('[download] Destination: x')).toBeNull()
    expect(isPostProcessingLine('[Merger] Merging formats into "x.mp4"')).toBe(true)
    expect(isPostProcessingLine('[ExtractAudio] Destination: x.mp3')).toBe(true)
    expect(isPostProcessingLine('[download] 10%')).toBe(false)
  })
})

describe('yt-dlp errors', () => {
  const cases: [string, RegExp][] = [
    ['ERROR: [youtube] x: Sign in to confirm you’re not a bot.', /not a robot/],
    ['ERROR: [youtube] x: Private video. Sign in if you have been granted access', /private/],
    ['ERROR: [youtube] x: Sign in to confirm your age', /age/],
    ['ERROR: [youtube] x: Video unavailable', /unavailable/],
    ['ERROR: The uploader has not made this video available in your country', /country/],
    ['ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>', /internet/],
    ['ERROR: [youtube] x: Requested format is not available', /Updating yt-dlp/]
  ]

  for (const [stderr, expected] of cases) {
    it(`explains: ${stderr.slice(0, 50)}`, () => {
      expect(explainYtDlpError(stderr, 'en')).toMatch(expected)
    })
  }

  it('speaks Spanish too', () => {
    expect(explainYtDlpError('ERROR: Private video', 'es')).toBe('Este vídeo es privado.')
  })

  it('passes an unknown error through after a generic lead', () => {
    expect(explainYtDlpError('ERROR: something odd', 'en')).toContain('something odd')
  })
})

describe('robot check / built-in session', () => {
  it('classifies the bot wall so the UI can offer the check', () => {
    expect(classifyYtDlpError('ERROR: [youtube] x: Sign in to confirm you’re not a bot.')).toBe('bot')
    expect(classifyYtDlpError('ERROR: Sign in to confirm your age')).toBe('age')
    expect(classifyYtDlpError('ERROR: whatever')).toBe('generic')
  })

  it('uses the saved cookies file for the built-in window', () => {
    const args = buildDownloadArgs(request({ cookiesBrowser: 'app' }), {
      ...context,
      cookiesFile: '/data/youtube/cookies.txt'
    })
    expect(after(args, '--cookies')).toBe('/data/youtube/cookies.txt')
    expect(args).not.toContain('--cookies-from-browser')
  })

  it('stays anonymous when the built-in window has saved nothing yet', () => {
    const args = buildDownloadArgs(request({ cookiesBrowser: 'app' }), { ...context, cookiesFile: null })
    expect(args).not.toContain('--cookies')
  })

  it('writes only YouTube/Google cookies in Netscape format', () => {
    const text = toNetscapeCookies([
      { name: 'SID', value: 'abc', domain: '.youtube.com', path: '/', secure: true, httpOnly: true, expirationDate: 2000000000.4 },
      { name: 'PREF', value: 'f1=1', domain: 'www.youtube.com', hostOnly: true, path: '/', secure: false },
      { name: 'NID', value: 'x', domain: '.google.com', path: '/', secure: true },
      { name: 'evil', value: 'x', domain: '.example.com', path: '/' },
      { name: 'bad', value: 'a\tb', domain: '.youtube.com', path: '/' }
    ])
    const lines = text.split('\n')
    expect(lines[0]).toBe('# Netscape HTTP Cookie File')
    expect(lines).toContain('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tabc')
    expect(lines).toContain('www.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf1=1')
    expect(text).toContain('\tNID\t')
    expect(text).not.toContain('example.com')
    expect(text).not.toContain('\tbad\t')
  })

  it('recognises a signed-in session', () => {
    expect(looksSignedIn([{ name: 'SAPISID', value: 'x' }])).toBe(true)
    expect(looksSignedIn([{ name: 'VISITOR_INFO1_LIVE', value: 'x' }])).toBe(false)
  })

  it('keeps the window on YouTube and Google only', () => {
    expect(isYouTubeCookie({ name: 'a', value: 'b', domain: '.accounts.google.com' })).toBe(true)
    expect(isYouTubeCookie({ name: 'a', value: 'b', domain: '.notgoogle.com' })).toBe(false)
  })
})

describe('download list', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-yt-'))
  const make = (): YouTubeDownloader =>
    new YouTubeDownloader({
      getYtDlp: () => ({ available: false, path: '', source: 'missing' }),
      getFFmpegPath: () => '/opt/ffmpeg',
      getLang: () => 'en'
    })

  it('refuses invalid requests before anything runs', () => {
    const downloader = make()
    expect(() => downloader.start(request({ url: 'https://vimeo.com/1', outputFolder: folder }))).toThrow()
    expect(() => downloader.start(request({ outputFolder: 'relative/folder' }))).toThrow()
    expect(() =>
      downloader.start(request({ outputFolder: folder, sectionStart: 50, sectionEnd: 10 }))
    ).toThrow()
    expect(() =>
      downloader.start(request({ outputFolder: folder, videoFormat: 'exe' as never }))
    ).toThrow()
    expect(() =>
      downloader.start(request({ outputFolder: folder, cookiesBrowser: 'netscape' as never }))
    ).toThrow()
    expect(downloader.list()).toHaveLength(0)
  })

  it('clamps a fragment end to the video length', () => {
    const downloader = make()
    const download = downloader.start(
      request({ outputFolder: folder, duration: 100, sectionStart: 10, sectionEnd: 100.6 })
    )
    expect(download.request.sectionEnd).toBe(100)
  })

  it('retries with the saved session after the robot check', () => {
    const downloader = make()
    const download = downloader.start(request({ outputFolder: folder }))
    expect(download.status).toBe('failed')
    downloader.retry(download.id, 'app')
    expect(download.request.cookiesBrowser).toBe('app')
    expect(downloader.retry(download.id, 'netscape' as never)).toBe(false)
  })

  it('reports lookup failures as results, keeping the error code', async () => {
    const result = await make().fetchInfo('https://vimeo.com/1', '')
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('fails clearly when yt-dlp is missing, and can be removed', () => {
    const downloader = make()
    const download = downloader.start(request({ outputFolder: folder }))
    expect(download.status).toBe('failed')
    expect(download.error).toMatch(/yt-dlp/)
    expect(downloader.remove(download.id)).toBe(true)
    expect(downloader.list()).toHaveLength(0)
  })
})
