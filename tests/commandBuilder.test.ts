import { describe, expect, it } from 'vitest'
import {
  FFmpegCommandBuilder,
  escapeFilterPath,
  formatTime,
  parseArgString,
  quoteForDisplay
} from '../src/main/core/ffmpeg/commandBuilder'

describe('FFmpegCommandBuilder', () => {
  it('produces an argument array, never a shell string', () => {
    const args = FFmpegCommandBuilder.create()
      .overwrite()
      .input('/tmp/in.mkv')
      .map('0:v:0')
      .videoCodec('libx264')
      .crf(18)
      .output('/tmp/out.mp4')
      .build()

    expect(Array.isArray(args)).toBe(true)
    expect(args).toContain('-i')
    expect(args[args.indexOf('-i') + 1]).toBe('/tmp/in.mkv')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '18']))
  })

  it('keeps filenames with spaces and quotes as single argv elements', () => {
    const nasty = `C:\\Videos\\my "great" movie & more; rm -rf.mkv`
    const args = FFmpegCommandBuilder.create().input(nasty).copyAll().output('/tmp/o.mp4').build()

    // The dangerous name must survive as exactly one element.
    expect(args.filter((a) => a === nasty)).toHaveLength(1)
    // And must not have been split on the shell metacharacters.
    expect(args.some((a) => a === 'rm')).toBe(false)
  })

  it('orders global args, input args, maps, stream args and output correctly', () => {
    const args = FFmpegCommandBuilder.create()
      .input('a.mp4', ['-ss', '10'])
      .input('b.srt')
      .map('0:v')
      .map('1:0')
      .videoCodec('copy')
      .subtitleCodec('mov_text')
      .format('mp4')
      .output('out.mp4')
      .build()

    const iFirst = args.indexOf('-i')
    const mapIndex = args.indexOf('-map')
    const codecIndex = args.indexOf('-c:v')

    expect(args.indexOf('-ss')).toBeLessThan(iFirst)
    expect(iFirst).toBeLessThan(mapIndex)
    expect(mapIndex).toBeLessThan(codecIndex)
    expect(codecIndex).toBeLessThan(args.length - 1)
  })

  it('throws rather than emitting an incomplete command', () => {
    expect(() => FFmpegCommandBuilder.create().input('a.mp4').build()).toThrow(/output/i)
    expect(() => FFmpegCommandBuilder.create().output('b.mp4').build()).toThrow(/input/i)
  })

  it('merges movflags into a single + separated argument', () => {
    const args = FFmpegCommandBuilder.create()
      .input('a.mp4')
      .copyAll()
      .movflags('faststart', 'frag_keyframe')
      .output('b.mp4')
      .build()
    expect(args[args.indexOf('-movflags') + 1]).toBe('faststart+frag_keyframe')
  })
})

describe('formatTime', () => {
  it('formats seconds as HH:MM:SS.mmm', () => {
    expect(formatTime(0)).toBe('00:00:00.000')
    expect(formatTime(61.5)).toBe('00:01:01.500')
    expect(formatTime(3661.25)).toBe('01:01:01.250')
  })

  it('never emits a negative timestamp', () => {
    expect(formatTime(-5)).toBe('00:00:00.000')
  })
})

describe('quoteForDisplay', () => {
  it('leaves simple arguments untouched', () => {
    expect(quoteForDisplay('-crf')).toBe('-crf')
    expect(quoteForDisplay('18')).toBe('18')
  })

  it('quotes anything containing whitespace or metacharacters', () => {
    expect(quoteForDisplay('my file.mp4')).toBe('"my file.mp4"')
    expect(quoteForDisplay('a&b')).toBe('"a&b"')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteForDisplay('say "hi"')).toBe('"say \\"hi\\""')
  })
})

describe('escapeFilterPath', () => {
  it('escapes the colon in a Windows drive letter', () => {
    expect(escapeFilterPath('C:\\subs\\a.srt')).toBe('C\\:/subs/a.srt')
  })

  it('escapes quotes and brackets that would break a filter graph', () => {
    expect(escapeFilterPath("/x/it's [1].srt")).toBe("/x/it\\'s \\[1\\].srt")
  })
})

describe('parseArgString', () => {
  it('splits on whitespace', () => {
    expect(parseArgString('-vf scale=1280:-2')).toEqual(['-vf', 'scale=1280:-2'])
  })

  it('honours quoted segments', () => {
    expect(parseArgString('-metadata title="My Movie"')).toEqual([
      '-metadata',
      'title=My Movie'
    ])
  })

  it('returns an empty array for blank input', () => {
    expect(parseArgString('   ')).toEqual([])
  })
})
