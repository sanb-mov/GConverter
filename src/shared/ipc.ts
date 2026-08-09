/**
 * IPC contract shared by the main process and the renderer.
 *
 * Channel names live here so both sides cannot drift apart, and the
 * `GConverterApi` interface is what the preload script exposes on
 * `window.gconverter`.
 */

import type {
  AppSettings,
  AutomationRule,
  ConversionJob,
  ConversionPlan,
  ConversionProfile,
  ConversionSettings,
  FFmpegInfo,
  HardwareCapabilities,
  HistoryEntry,
  JobProgress,
  LogRecord,
  MediaFile,
  ValidationReport
} from './models'

export const IPC = {
  /* media */
  probeFiles: 'media:probe-files',
  probeRaw: 'media:probe-raw',
  pickFiles: 'media:pick-files',
  pickFolder: 'media:pick-folder',
  scanFolder: 'media:scan-folder',
  resolveDropped: 'media:resolve-dropped',

  /* conversion */
  preview: 'conversion:preview',
  smartSettings: 'conversion:smart-settings',
  profileSettings: 'conversion:profile-settings',
  losslessTargets: 'conversion:lossless-targets',

  /* queue */
  queueAdd: 'queue:add',
  queueList: 'queue:list',
  queueRemove: 'queue:remove',
  queueRetry: 'queue:retry',
  queueCancelJob: 'queue:cancel-job',
  queueStart: 'queue:start',
  queuePause: 'queue:pause',
  queueResume: 'queue:resume',
  queueStop: 'queue:stop',
  queueClear: 'queue:clear',
  queueClearFinished: 'queue:clear-finished',
  queueReorder: 'queue:reorder',
  queueEvent: 'queue:event',

  /* profiles */
  profilesList: 'profiles:list',
  profileSave: 'profiles:save',
  profileDelete: 'profiles:delete',
  profileEffect: 'profiles:effect',

  /* system */
  ffmpegInfo: 'system:ffmpeg-info',
  hardware: 'system:hardware',
  systemRefresh: 'system:refresh',
  pickBinary: 'system:pick-binary',

  /* settings */
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  /* history */
  historyList: 'history:list',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',

  /* automation */
  automationList: 'automation:list',
  automationSave: 'automation:save',
  automationDelete: 'automation:delete',
  automationScan: 'automation:scan',

  /* logs */
  logsList: 'logs:list',
  logsClear: 'logs:clear',
  logsExport: 'logs:export',
  logRecord: 'logs:record',

  /* shell */
  openPath: 'shell:open-path',
  revealPath: 'shell:reveal-path',
  openExternal: 'shell:open-external',
  copyText: 'shell:copy-text',
  saveTextFile: 'shell:save-text',
  fileUrl: 'shell:file-url',

  /* app */
  appInfo: 'app:info',
  appReady: 'app:ready-state'
} as const

export interface ProbeProgress {
  done: number
  total: number
}

export interface PreviewResult {
  plan: ConversionPlan
  outputPath: string
  command: string[]
  commandString: string
  validation: ValidationReport
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  node: string
  directories: {
    root: string
    temp: string
    cache: string
    logs: string
    output: string
  }
}

export type QueueEventPayload =
  | { type: 'job-added'; job: ConversionJob }
  | { type: 'job-updated'; job: ConversionJob }
  | { type: 'job-progress'; jobId: string; progress: JobProgress }
  | { type: 'job-removed'; jobId: string }
  | { type: 'queue-state'; running: boolean; paused: boolean }

export interface GConverterApi {
  media: {
    probeFiles(paths: string[]): Promise<MediaFile[]>
    probeRaw(filePath: string): Promise<unknown>
    pickFiles(): Promise<MediaFile[]>
    pickFolder(): Promise<string | null>
    scanFolder(folder: string, recursive: boolean): Promise<MediaFile[]>
    resolveDropped(paths: string[]): Promise<MediaFile[]>
  }
  conversion: {
    preview(
      source: MediaFile,
      settings: ConversionSettings,
      outputFolder?: string
    ): Promise<PreviewResult>
    smartSettings(source: MediaFile, targetFormat: string): Promise<ConversionSettings>
    profileSettings(source: MediaFile, profileId: string): Promise<ConversionSettings>
    losslessTargets(source: MediaFile): Promise<string[]>
  }
  queue: {
    add(
      source: MediaFile,
      settings: ConversionSettings,
      options?: { profileId?: string; profileName?: string; outputFolder?: string }
    ): Promise<ConversionJob>
    list(): Promise<{ jobs: ConversionJob[]; running: boolean; paused: boolean }>
    remove(jobId: string): Promise<boolean>
    retry(jobId: string, settings?: ConversionSettings): Promise<boolean>
    cancelJob(jobId: string): Promise<boolean>
    start(): Promise<void>
    pause(): Promise<void>
    resume(): Promise<void>
    stop(): Promise<void>
    clear(): Promise<void>
    clearFinished(): Promise<void>
    reorder(jobId: string, index: number): Promise<boolean>
    onEvent(handler: (event: QueueEventPayload) => void): () => void
  }
  profiles: {
    list(): Promise<ConversionProfile[]>
    save(profile: ConversionProfile): Promise<ConversionProfile[]>
    remove(profileId: string): Promise<ConversionProfile[]>
    effect(source: MediaFile, profileId: string): Promise<string[]>
  }
  system: {
    ffmpeg(): Promise<FFmpegInfo>
    hardware(): Promise<HardwareCapabilities>
    refresh(): Promise<{ ffmpeg: FFmpegInfo; hardware: HardwareCapabilities }>
    pickBinary(kind: 'ffmpeg' | 'ffprobe'): Promise<string | null>
    /** Fires when the main process re-detects FFmpeg or hardware. */
    onRefresh(
      handler: (payload: { ffmpeg: FFmpegInfo; hardware: HardwareCapabilities }) => void
    ): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(settings: AppSettings): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  history: {
    list(): Promise<HistoryEntry[]>
    remove(id: string): Promise<HistoryEntry[]>
    clear(): Promise<HistoryEntry[]>
  }
  automation: {
    list(): Promise<AutomationRule[]>
    save(rule: AutomationRule): Promise<AutomationRule[]>
    remove(id: string): Promise<AutomationRule[]>
    scan(id: string): Promise<number>
  }
  logs: {
    list(limit?: number): Promise<LogRecord[]>
    clear(): Promise<void>
    export(): Promise<string | null>
    onRecord(handler: (record: LogRecord) => void): () => void
  }
  shell: {
    openPath(target: string): Promise<string>
    revealPath(target: string): Promise<void>
    /** Opens an https:// link in the user's default browser. */
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
    saveTextFile(defaultName: string, contents: string): Promise<string | null>
    fileUrl(target: string): Promise<string>
  }
  app: {
    info(): Promise<AppInfo>
  }
}
