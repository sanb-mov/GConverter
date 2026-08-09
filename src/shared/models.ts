/**
 * GConverter — Core domain models (spec §36).
 *
 * These types are shared by the main process, the preload bridge and the
 * renderer. They deliberately contain no behaviour so they can cross the
 * IPC boundary as plain structured-cloneable objects.
 */

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export type StreamKind = 'video' | 'audio' | 'subtitle' | 'attachment' | 'data'

export interface MediaStreamBase {
  index: number
  kind: StreamKind
  codec: string
  codecLongName?: string
  codecTag?: string
  language?: string
  title?: string
  isDefault: boolean
  isForced: boolean
  bitrate?: number
  duration?: number
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

export interface VideoStream extends MediaStreamBase {
  kind: 'video'
  width: number
  height: number
  fps?: number
  avgFps?: number
  pixelFormat?: string
  profile?: string
  level?: number
  colorSpace?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorRange?: string
  isHDR: boolean
  hdrFormat?: 'HDR10' | 'HDR10+' | 'HLG' | 'Dolby Vision' | 'PQ'
  sampleAspectRatio?: string
  displayAspectRatio?: string
  frameCount?: number
  /** True when the stream is an embedded cover/poster image rather than motion video. */
  isAttachedPic: boolean
  rotation?: number
}

export interface AudioStream extends MediaStreamBase {
  kind: 'audio'
  sampleRate?: number
  channels?: number
  channelLayout?: string
  sampleFormat?: string
  bitsPerSample?: number
  bitsPerRawSample?: number
}

export interface SubtitleStream extends MediaStreamBase {
  kind: 'subtitle'
  /** Bitmap subtitles (PGS/VobSub) cannot be converted to text formats. */
  isBitmap: boolean
}

export interface GenericStream extends MediaStreamBase {
  kind: 'attachment' | 'data'
  filename?: string
  mimeType?: string
}

export type AnyStream = VideoStream | AudioStream | SubtitleStream | GenericStream

export interface Chapter {
  id: number
  start: number
  end: number
  title?: string
}

export interface MediaFile {
  id: string
  path: string
  name: string
  directory: string
  extension: string
  size: number
  /** Container format short name reported by ffprobe, e.g. "matroska,webm". */
  formatName: string
  formatLongName?: string
  duration: number
  bitrate?: number
  streams: AnyStream[]
  chapters: Chapter[]
  metadata: Record<string, string>
  /** Convenience accessors resolved at probe time. */
  primaryVideo?: VideoStream
  primaryAudio?: AudioStream
  hasVideo: boolean
  hasAudio: boolean
  hasSubtitles: boolean
  probedAt: number
  /** Set when probing failed; the file is then unusable as a source. */
  error?: string
}

/* ------------------------------------------------------------------ */
/* Conversion settings                                                 */
/* ------------------------------------------------------------------ */

export type QualityMode =
  | 'lossless'
  | 'maximum'
  | 'very-high'
  | 'high'
  | 'balanced'
  | 'custom'

export type RateControl = 'crf' | 'bitrate' | 'constrained' | 'lossless'

export type HardwareVendor = 'none' | 'nvidia' | 'amd' | 'intel' | 'apple'
export type HardwarePreference = 'auto' | 'cpu' | 'nvidia' | 'amd' | 'intel' | 'apple'

export interface VideoSettings {
  /** 'copy' means stream copy (remux). 'none' strips video entirely. */
  codec: string | 'copy' | 'none'
  rateControl: RateControl
  crf?: number
  bitrate?: number
  maxBitrate?: number
  bufSize?: number
  preset?: string
  tune?: string
  profile?: string
  level?: string
  pixelFormat?: string
  /** null / undefined means "keep original". */
  width?: number
  height?: number
  /** Preserve aspect ratio when only one dimension is given. */
  scaleMode?: 'fit' | 'fill' | 'stretch'
  fps?: number
  gop?: number
  bFrames?: number
  refFrames?: number
  colorSpace?: string
  colorRange?: string
  /** Force 10-bit output where the encoder supports it. */
  tenBit?: boolean
  hardware: HardwarePreference
  /** Extra raw ffmpeg args appended to the video stream options. */
  extraArgs?: string[]
}

export interface AudioSettings {
  codec: string | 'copy' | 'none'
  bitrate?: number
  sampleRate?: number
  channels?: number
  bitDepth?: number
  vbr?: boolean
  /** Codec-specific quality scale (-q:a for libmp3lame / libvorbis). */
  qualityLevel?: number
  compressionLevel?: number
  extraArgs?: string[]
}

export type SubtitleAction = 'keep' | 'remove' | 'burn' | 'extract'
export type MetadataAction = 'keep' | 'remove' | 'custom'
export type ChapterAction = 'keep' | 'remove'

export interface SubtitleSettings {
  action: SubtitleAction
  /** Codec to use when keeping subtitles; 'copy' when compatible. */
  codec?: string | 'copy'
  /** Stream index to burn in, when action === 'burn'. */
  burnStreamIndex?: number
  /** External subtitle file to burn or mux in. */
  externalPath?: string
}

export interface MetadataSettings {
  action: MetadataAction
  fields?: Partial<Record<MetadataField, string>>
}

export type MetadataField =
  | 'title'
  | 'artist'
  | 'album'
  | 'album_artist'
  | 'genre'
  | 'date'
  | 'track'
  | 'comment'
  | 'encoder'
  | 'description'

export interface ContainerSettings {
  /** Output container extension, e.g. "mp4", "mkv". */
  format: string
  faststart: boolean
  fragmentedMp4: boolean
  chapters: ChapterAction
  attachments: boolean
}

export interface TrimSettings {
  start?: number
  end?: number
}

export interface ConversionSettings {
  container: ContainerSettings
  video: VideoSettings
  audio: AudioSettings
  subtitles: SubtitleSettings
  metadata: MetadataSettings
  trim?: TrimSettings
  quality: QualityMode
  /** Threads hint for ffmpeg; 0 = auto. */
  threads?: number
  /** Raw user-supplied additional args, parsed as a list. */
  customArgs?: string[]
}

/* ------------------------------------------------------------------ */
/* Profiles / presets                                                  */
/* ------------------------------------------------------------------ */

export type ProfileCategory = 'video' | 'audio' | 'custom'

export interface ConversionProfile {
  id: string
  name: string
  description?: string
  category: ProfileCategory
  /** Built-in profiles cannot be deleted or edited in place. */
  builtIn: boolean
  icon?: string
  settings: ConversionSettings
  /** Optional cap applied only when the source exceeds it (never upscales). */
  maxWidth?: number
  maxHeight?: number
  maxFps?: number
  createdAt?: number
}

/* ------------------------------------------------------------------ */
/* Conversion plan / analysis (spec §4, §50, §64)                      */
/* ------------------------------------------------------------------ */

export type ConversionMode = 'lossless-remux' | 'lossless-encode' | 're-encode' | 'mixed'

export interface StreamPlan {
  sourceIndex: number
  kind: StreamKind
  action: 'copy' | 'encode' | 'drop' | 'burn'
  targetCodec?: string
  reason: string
}

export interface ConversionPlan {
  mode: ConversionMode
  /** Human-readable headline, e.g. "Lossless — container changed only". */
  headline: string
  detail: string
  losslessAvailable: boolean
  streams: StreamPlan[]
  warnings: string[]
  estimatedSize?: number
  estimatedSizeRange?: [number, number]
  estimatedDuration?: number
  usesHardware: boolean
  hardwareEncoder?: string
}

/* ------------------------------------------------------------------ */
/* Jobs & queue                                                        */
/* ------------------------------------------------------------------ */

export type JobStatus =
  | 'pending'
  | 'analyzing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface JobProgress {
  percent: number
  /** Output timestamp reached, in seconds. */
  outTime: number
  fps?: number
  speed?: number
  bitrate?: number
  /** Bytes written so far. */
  totalSize?: number
  frame?: number
  elapsedMs: number
  etaMs?: number
  estimatedFinalSize?: number
}

export interface ConversionJob {
  id: string
  source: MediaFile
  outputPath: string
  settings: ConversionSettings
  profileId?: string
  profileName?: string
  status: JobStatus
  progress: JobProgress
  plan?: ConversionPlan
  command?: string[]
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: ConversionError
  result?: ConversionResult
  /** Set for jobs created by a watch-folder rule. */
  automationRuleId?: string
}

export interface ConversionError {
  message: string
  reason: string
  suggestion?: string
  exitCode?: number
  stderrTail?: string
}

export interface ConversionResult {
  outputPath: string
  outputSize: number
  inputSize: number
  /** Negative = smaller output. */
  sizeDeltaPercent: number
  durationMs: number
  mode: ConversionMode
  averageFps?: number
}

/* ------------------------------------------------------------------ */
/* Hardware (spec §12, §13)                                            */
/* ------------------------------------------------------------------ */

export interface HardwareEncoder {
  /** ffmpeg encoder name, e.g. "h264_nvenc". */
  name: string
  vendor: HardwareVendor
  codec: string
  label: string
  available: boolean
  /** Verified by actually running a tiny test encode. */
  verified: boolean
}

export interface GpuInfo {
  name: string
  vendor: HardwareVendor
  vram?: number
  driver?: string
}

export interface HardwareCapabilities {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemory: number
  freeMemory: number
  platform: string
  arch: string
  gpus: GpuInfo[]
  encoders: HardwareEncoder[]
  accelerationAvailable: boolean
  preferredVendor: HardwareVendor
  detectedAt: number
}

/* ------------------------------------------------------------------ */
/* FFmpeg environment                                                  */
/* ------------------------------------------------------------------ */

export type FFmpegSource = 'bundled' | 'system' | 'custom' | 'missing'

export interface FFmpegInfo {
  available: boolean
  source: FFmpegSource
  ffmpegPath: string
  ffprobePath: string
  version?: string
  buildConfig?: string[]
  encoders: string[]
  decoders: string[]
  muxers: string[]
  hwaccels: string[]
  error?: string
}

/* ------------------------------------------------------------------ */
/* History (spec §44)                                                  */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: string
  sourcePath: string
  sourceName: string
  outputPath: string
  outputName: string
  inputSize: number
  outputSize: number
  mode: ConversionMode
  status: 'completed' | 'failed' | 'cancelled'
  profileName?: string
  formatFrom: string
  formatTo: string
  durationMs: number
  timestamp: number
  error?: string
  settings?: ConversionSettings
}

/* ------------------------------------------------------------------ */
/* Automation (spec §26, §27)                                          */
/* ------------------------------------------------------------------ */

export type PostAction = 'nothing' | 'move' | 'delete' | 'trash'

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  watchFolder: string
  outputFolder: string
  recursive: boolean
  /** Lowercase extensions without dot; empty = all supported media. */
  extensions: string[]
  profileId: string
  /** What to do with the source file once conversion succeeds. */
  sourceAction: PostAction
  sourceMoveFolder?: string
  createdAt: number
  stats: { processed: number; failed: number; lastRunAt?: number }
}

/* ------------------------------------------------------------------ */
/* Settings (spec §33)                                                 */
/* ------------------------------------------------------------------ */

export type ThemeName = 'dark' | 'midnight' | 'light'
export type LanguageCode = 'en' | 'es'
export type OutputNaming = 'suffix' | 'same' | 'folder'

export interface AppSettings {
  general: {
    language: LanguageCode
    theme: ThemeName
    defaultOutputFolder: string
    /** When true, output goes next to the source file. */
    useSourceFolder: boolean
    outputNaming: OutputNaming
    outputSuffix: string
    notifications: boolean
    autoCleanupDays: number
    confirmOnQuit: boolean
  }
  performance: {
    /** 0 = auto */
    cpuThreads: number
    maxConcurrentJobs: number
    hardwareAcceleration: boolean
    hardwarePreference: HardwarePreference
    lowPriority: boolean
  }
  conversion: {
    defaultVideoFormat: string
    defaultAudioFormat: string
    defaultQuality: QualityMode
    preserveMetadata: boolean
    preserveSubtitles: boolean
    preserveChapters: boolean
    preferLossless: boolean
    overwritePolicy: 'ask' | 'overwrite' | 'rename'
  }
  advanced: {
    ffmpegPath: string
    ffprobePath: string
    tempDirectory: string
    logLevel: 'debug' | 'info' | 'warning' | 'error'
    keepLogDays: number
  }
}

/* ------------------------------------------------------------------ */
/* Logging (spec §29, §55)                                             */
/* ------------------------------------------------------------------ */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface LogRecord {
  timestamp: number
  level: LogLevel
  scope: string
  message: string
  data?: unknown
}

/* ------------------------------------------------------------------ */
/* Validation (spec §47)                                               */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  suggestion?: string
}

export interface ValidationReport {
  ok: boolean
  issues: ValidationIssue[]
}
