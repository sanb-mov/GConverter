/**
 * Generates small synthetic media files used by the test suite and for
 * manual verification. Everything is produced by FFmpeg itself, so the
 * repository carries no binary fixtures.
 *
 *   node tests/fixtures/generate.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'media')
mkdirSync(outDir, { recursive: true })

/** A 3-second colour-bar clip with a 440 Hz tone. */
const VIDEO_IN = [
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3'
]

const jobs = [
  {
    name: 'sample.mp4',
    args: [...VIDEO_IN, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest']
  },
  {
    name: 'sample.mkv',
    args: [...VIDEO_IN, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest']
  },
  {
    name: 'sample.mov',
    args: [...VIDEO_IN, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest']
  },
  {
    name: 'sample.avi',
    args: [...VIDEO_IN, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame',
           '-b:a', '128k', '-shortest']
  },
  {
    name: 'sample-hevc.mkv',
    args: [...VIDEO_IN, '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30',
           '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-b:a', '192k', '-shortest',
           '-tag:v', 'hvc1']
  },
  {
    name: 'sample-noaudio.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
           '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p']
  },
  {
    name: 'sample.wav',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3',
           '-c:a', 'pcm_s16le']
  },
  {
    name: 'sample.flac',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=523:sample_rate=44100:duration=3',
           '-c:a', 'flac']
  },
  {
    name: 'sample.mp3',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=3',
           '-c:a', 'libmp3lame', '-b:a', '192k']
  },
  {
    // A file whose name exercises quoting: spaces, quotes, ampersands, unicode.
    name: "tricky name & 'quoted' #1 ñ.mp4",
    args: [...VIDEO_IN, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']
  }
]

let made = 0
for (const job of jobs) {
  const target = path.join(outDir, job.name)
  if (existsSync(target) && !process.argv.includes('--force')) {
    console.log(`skip   ${job.name}`)
    continue
  }
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...job.args, target], {
      stdio: 'inherit'
    })
    console.log(`create ${job.name}`)
    made++
  } catch (err) {
    console.error(`FAILED ${job.name}: ${err.message}`)
  }
}

/* A separate MKV carrying embedded SRT subtitles and chapters. */
const subPath = path.join(outDir, 'subs.srt')
const withSubs = path.join(outDir, 'sample-subs.mkv')
if (!existsSync(withSubs) || process.argv.includes('--force')) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    subPath,
    '1\n00:00:00,000 --> 00:00:01,500\nGConverter test subtitle\n\n' +
      '2\n00:00:01,500 --> 00:00:03,000\nSecond line\n',
    'utf-8'
  )
  const chapters = path.join(outDir, 'chapters.txt')
  writeFileSync(
    chapters,
    ';FFMETADATA1\ntitle=GConverter Test\n\n' +
      '[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Opening\n\n' +
      '[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Closing\n',
    'utf-8'
  )
  try {
    execFileSync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y',
       '-i', path.join(outDir, 'sample.mkv'),
       '-i', subPath,
       '-i', chapters,
       '-map_metadata', '2', '-map_chapters', '2',
       '-map', '0', '-map', '1',
       '-c', 'copy', '-c:s', 'srt', withSubs],
      { stdio: 'inherit' }
    )
    console.log('create sample-subs.mkv')
    made++
  } catch (err) {
    console.error(`FAILED sample-subs.mkv: ${err.message}`)
  }
}

console.log(`\n${made} fixture(s) generated in ${outDir}`)
