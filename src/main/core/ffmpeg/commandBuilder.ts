/**
 * FFmpegCommandBuilder (spec §38, §39).
 *
 * Builds FFmpeg invocations as **argument arrays**. Nothing is ever
 * concatenated into a shell string, so filenames containing spaces, quotes,
 * semicolons or non-ASCII characters are inherently safe — the OS passes
 * each element to the process verbatim.
 *
 * `toDisplayString()` exists only to show the user what will run and to let
 * them copy it (spec §28); it is never fed back into a shell by the app.
 */

export type FFmpegArg = string | number

export class FFmpegCommandBuilder {
  private globalArgs: string[] = []
  private inputArgs: string[][] = []
  private inputs: string[] = []
  private streamArgs: string[] = []
  private filterComplexParts: string[] = []
  private mapArgs: string[] = []
  private metadataArgs: string[] = []
  private outputArgs: string[] = []
  private outputPath = ''
  private progressArgs: string[] = []

  /* ----------------------------- global ---------------------------- */

  /** Standard flags GConverter always uses: quiet banner, machine progress. */
  static create(): FFmpegCommandBuilder {
    return new FFmpegCommandBuilder()
      .global('-hide_banner')
      .global('-loglevel', 'error')
      .global('-nostdin')
  }

  global(...args: FFmpegArg[]): this {
    this.globalArgs.push(...args.map(String))
    return this
  }

  /** Overwrite output without prompting. */
  overwrite(enabled = true): this {
    this.globalArgs.push(enabled ? '-y' : '-n')
    return this
  }

  /** Emit key=value progress on stdout so we can parse it reliably. */
  progressToStdout(): this {
    this.progressArgs = ['-progress', 'pipe:1', '-stats_period', '0.5']
    return this
  }

  /* ----------------------------- inputs ---------------------------- */

  /**
   * Add an input. `preArgs` are placed *before* `-i` (seek, hwaccel, format).
   * Stays fluent; read `inputCount` to derive the index for `map()`.
   */
  input(file: string, preArgs: FFmpegArg[] = []): this {
    this.inputArgs.push(preArgs.map(String))
    this.inputs.push(file)
    return this
  }

  /** Number of inputs added so far. The last input's index is this minus one. */
  get inputCount(): number {
    return this.inputs.length
  }

  /** Accurate seek: placed before -i so FFmpeg can fast-seek. */
  seekInput(seconds: number): this {
    const last = this.inputArgs[this.inputArgs.length - 1]
    if (last) last.push('-ss', formatTime(seconds))
    return this
  }

  /* ------------------------------ maps ----------------------------- */

  /**
   * Map a stream. `spec` may be an input index ("0"), a stream selector
   * ("0:v:0") or an optional selector ("0:s?").
   */
  map(spec: string): this {
    this.mapArgs.push('-map', spec)
    return this
  }

  /** Map the labelled output of a filter_complex chain. */
  mapFilterLabel(label: string): this {
    this.mapArgs.push('-map', `[${label}]`)
    return this
  }

  /* ---------------------------- stream opts ------------------------- */

  /** Per-stream option, e.g. `streamOption('c:v', 'libx264')`. */
  streamOption(key: string, ...values: FFmpegArg[]): this {
    this.streamArgs.push(key.startsWith('-') ? key : `-${key}`, ...values.map(String))
    return this
  }

  videoCodec(codec: string, streamIndex?: number): this {
    const key = streamIndex === undefined ? '-c:v' : `-c:v:${streamIndex}`
    this.streamArgs.push(key, codec)
    return this
  }

  audioCodec(codec: string, streamIndex?: number): this {
    const key = streamIndex === undefined ? '-c:a' : `-c:a:${streamIndex}`
    this.streamArgs.push(key, codec)
    return this
  }

  subtitleCodec(codec: string): this {
    this.streamArgs.push('-c:s', codec)
    return this
  }

  /** Copy every stream without re-encoding (the remux fast path, spec §50). */
  copyAll(): this {
    this.streamArgs.push('-c', 'copy')
    return this
  }

  crf(value: number): this {
    this.streamArgs.push('-crf', String(value))
    return this
  }

  /** Quality flag varies by encoder family (crf / cq / qp / global_quality). */
  quality(flag: 'crf' | 'cq' | 'qp' | 'global_quality' | 'qscale', value: number): this {
    switch (flag) {
      case 'qscale':
        this.streamArgs.push('-q:v', String(value))
        break
      case 'global_quality':
        this.streamArgs.push('-global_quality', String(value))
        break
      default:
        this.streamArgs.push(`-${flag}`, String(value))
    }
    return this
  }

  videoBitrate(kbps: number): this {
    this.streamArgs.push('-b:v', `${Math.round(kbps)}k`)
    return this
  }

  maxrate(kbps: number): this {
    this.streamArgs.push('-maxrate', `${Math.round(kbps)}k`)
    return this
  }

  bufsize(kbps: number): this {
    this.streamArgs.push('-bufsize', `${Math.round(kbps)}k`)
    return this
  }

  audioBitrate(kbps: number): this {
    this.streamArgs.push('-b:a', `${Math.round(kbps)}k`)
    return this
  }

  preset(value: string): this {
    this.streamArgs.push('-preset', value)
    return this
  }

  tune(value: string): this {
    this.streamArgs.push('-tune', value)
    return this
  }

  profile(value: string, kind: 'v' | 'a' = 'v'): this {
    this.streamArgs.push(`-profile:${kind}`, value)
    return this
  }

  level(value: string): this {
    this.streamArgs.push('-level', value)
    return this
  }

  pixelFormat(value: string): this {
    this.streamArgs.push('-pix_fmt', value)
    return this
  }

  fps(value: number): this {
    this.streamArgs.push('-r', String(value))
    return this
  }

  gop(value: number): this {
    this.streamArgs.push('-g', String(value))
    return this
  }

  bFrames(value: number): this {
    this.streamArgs.push('-bf', String(value))
    return this
  }

  refFrames(value: number): this {
    this.streamArgs.push('-refs', String(value))
    return this
  }

  sampleRate(value: number): this {
    this.streamArgs.push('-ar', String(value))
    return this
  }

  channels(value: number): this {
    this.streamArgs.push('-ac', String(value))
    return this
  }

  sampleFormat(value: string): this {
    this.streamArgs.push('-sample_fmt', value)
    return this
  }

  threads(count: number): this {
    this.streamArgs.push('-threads', String(count))
    return this
  }

  /* ----------------------------- filters ---------------------------- */

  /** Append a filter_complex chain fragment (already fully formed). */
  filterComplex(chain: string): this {
    this.filterComplexParts.push(chain)
    return this
  }

  /** Simple video filter chain via -vf (mutually exclusive with -filter_complex). */
  videoFilter(chain: string): this {
    this.streamArgs.push('-vf', chain)
    return this
  }

  audioFilter(chain: string): this {
    this.streamArgs.push('-af', chain)
    return this
  }

  /* ---------------------------- metadata ---------------------------- */

  /** Copy metadata from an input, or strip it with `-1`. */
  mapMetadata(source: number | '-1'): this {
    this.metadataArgs.push('-map_metadata', String(source))
    return this
  }

  mapChapters(source: number | '-1'): this {
    this.metadataArgs.push('-map_chapters', String(source))
    return this
  }

  metadata(key: string, value: string): this {
    // Values are passed as a single argv element, so `=` inside the value is safe.
    this.metadataArgs.push('-metadata', `${key}=${value}`)
    return this
  }

  /* ----------------------------- output ----------------------------- */

  movflags(...flags: string[]): this {
    if (flags.length) this.outputArgs.push('-movflags', flags.join('+'))
    return this
  }

  /** Trim by output duration (applies after decoding, so it is frame-accurate). */
  duration(seconds: number): this {
    this.outputArgs.push('-t', formatTime(seconds))
    return this
  }

  outputOption(...args: FFmpegArg[]): this {
    this.outputArgs.push(...args.map(String))
    return this
  }

  format(muxer: string): this {
    this.outputArgs.push('-f', muxer)
    return this
  }

  output(file: string): this {
    this.outputPath = file
    return this
  }

  /* ---------------------------- generation --------------------------- */

  /** Produce the final argv array (excluding the ffmpeg executable itself). */
  build(): string[] {
    if (!this.outputPath) {
      throw new Error('FFmpegCommandBuilder: output path was never set')
    }
    if (this.inputs.length === 0) {
      throw new Error('FFmpegCommandBuilder: at least one input is required')
    }

    const args: string[] = [...this.globalArgs, ...this.progressArgs]

    for (let i = 0; i < this.inputs.length; i++) {
      args.push(...this.inputArgs[i], '-i', this.inputs[i])
    }

    if (this.filterComplexParts.length) {
      args.push('-filter_complex', this.filterComplexParts.join(';'))
    }

    args.push(...this.mapArgs, ...this.streamArgs, ...this.metadataArgs, ...this.outputArgs)
    args.push(this.outputPath)

    return args
  }

  /**
   * Human-readable command for the preview panel and the "Copy command"
   * button (spec §28). Quoting here is for *display and manual reuse only*.
   */
  toDisplayString(executable = 'ffmpeg'): string {
    return [executable, ...this.build()].map(quoteForDisplay).join(' ')
  }
}

/** Quote an argument so a human can paste the command into their own shell. */
export function quoteForDisplay(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"'`$&|<>();*?\\[\]{}!#~]/.test(arg)) return arg
  // Double quotes work in both PowerShell/cmd and POSIX shells for these cases.
  return `"${arg.replace(/(["$`\\])/g, '\\$1')}"`
}

/** Seconds → HH:MM:SS.mmm, the unambiguous form FFmpeg always accepts. */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`
}

function pad(n: number): string {
  return String(Math.floor(n)).padStart(2, '0')
}

/**
 * Escape a path for use *inside* a filter graph argument (subtitles=...).
 * Filter syntax has its own escaping layer on top of argv: backslashes,
 * colons and quotes must be escaped or the graph fails to parse.
 */
export function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
}

/**
 * Split a user-supplied extra-arguments string into an argv array,
 * honouring quotes. Used for the "custom arguments" advanced field —
 * the result is still passed as an array, never through a shell.
 */
export function parseArgString(input: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let has = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      has = true
      continue
    }
    if (/\s/.test(ch)) {
      if (has || current) out.push(current)
      current = ''
      has = false
      continue
    }
    current += ch
  }
  if (has || current) out.push(current)
  return out.filter((a) => a.length > 0 || has)
}
