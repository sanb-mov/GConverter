/**
 * GConverter — main process entry point.
 *
 * Wires the core services together and exposes them to the renderer through
 * a narrow, validated IPC surface. The renderer has no Node access at all:
 * contextIsolation is on, nodeIntegration is off, and every privileged
 * operation goes through an explicit handler here.
 */

import { app, BrowserWindow, dialog, ipcMain, shell, clipboard, Notification } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import type {
  AppSettings,
  AutomationRule,
  ConversionProfile,
  ConversionSettings,
  FFmpegInfo,
  HardwareCapabilities,
  HistoryEntry,
  MediaFile,
  YouTubeCookiesBrowser,
  YouTubeRequest,
  YtDlpInfo
} from '@shared/models'
import { IPC, type AppInfo, type PreviewResult } from '@shared/ipc'
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from '@shared/formats'

import { logger } from './core/logging/logger'
import { JsonStore } from './core/storage/jsonStore'
import { resolveFFmpeg, clearFFmpegCache } from './core/ffmpeg/resolver'
import { MediaProbe } from './core/media/probe'
import { detectHardware, getCachedHardware } from './core/hardware/detector'
import { FFmpegConversionEngine } from './core/conversion/engine'
import { QueueManager } from './core/queue/queueManager'
import { AutomationService, applySourceAction } from './core/automation/watcher'
import { BUILT_IN_PRESETS, createDefaultAppSettings } from './core/profiles/defaults'
import { smartConvert, applyProfileCaps, describeProfileEffect } from './core/conversion/smart'
import { losslessTargets } from './core/conversion/planner'
import { quoteForDisplay } from './core/ffmpeg/commandBuilder'
import {
  ensureDirectories,
  cleanupTempFiles,
  type AppDirectories
} from './core/media/paths'
import { resolveYtDlp } from './core/youtube/ytdlp'
import { YouTubeDownloader } from './core/youtube/downloader'
import { YouTubeAuth } from './core/youtube/auth'
import { t as translate } from '@shared/i18n'

/* ------------------------------------------------------------------ */
/* Application state                                                   */
/* ------------------------------------------------------------------ */

let mainWindow: BrowserWindow | null = null
let directories: AppDirectories
let settingsStore: JsonStore<AppSettings>
let historyStore: JsonStore<{ entries: HistoryEntry[] }>
let profileStore: JsonStore<{ profiles: ConversionProfile[] }>
let automationStore: JsonStore<{ rules: AutomationRule[] }>

let ffmpegInfo: FFmpegInfo
let hardware: HardwareCapabilities | null = null
/** In-flight detection, shared so startup and the renderer never probe twice. */
let hardwarePromise: Promise<HardwareCapabilities> | null = null
let probe: MediaProbe
let engine: FFmpegConversionEngine
let queue: QueueManager
let automation: AutomationService
let ytdlpInfo: YtDlpInfo = { available: false, path: '', source: 'missing' }
let youtube: YouTubeDownloader
let youtubeAuth: YouTubeAuth

const getSettings = (): AppSettings => settingsStore.get()
const getEncoders = (): string[] => ffmpegInfo?.encoders ?? []

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0B0D12',
    title: 'GConverter',
    icon: resolveIcon(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Local media files must be readable by the built-in preview player.
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // QA hook: GCONVERTER_CAPTURE=<file> renders the window to a PNG and
    // exits. Used by the UI smoke test; inert in normal use.
    if (process.env.GCONVERTER_CAPTURE) void captureAndExit(process.env.GCONVERTER_CAPTURE)
  })

  // External links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void mainWindow.loadURL(devServer)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Render the window to a PNG then quit. Optionally navigates the UI first
 * via `GCONVERTER_CAPTURE_PAGE`, so every screen can be smoke-tested.
 */
async function captureAndExit(target: string): Promise<void> {
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const lang = process.env.GCONVERTER_CAPTURE_LANG
    if (lang && mainWindow) {
      settingsStore.update((draft) => {
        draft.general.language = lang as AppSettings['general']['language']
      })
      await mainWindow.webContents.executeJavaScript(
        `window.__gc.setLanguage(${JSON.stringify(lang)})`
      )
      await new Promise((resolve) => setTimeout(resolve, 600))
    }

    const files = process.env.GCONVERTER_CAPTURE_FILES
    if (files && mainWindow) {
      await mainWindow.webContents.executeJavaScript(
        `window.__gc.loadFiles(${JSON.stringify(files.split('|'))})`
      )
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }

    const convertTo = process.env.GCONVERTER_CAPTURE_CONVERT
    if (convertTo && mainWindow) {
      await mainWindow.webContents.executeJavaScript(
        `window.__gc.convertAll(${JSON.stringify(convertTo)})`
      )
    }

    const page = process.env.GCONVERTER_CAPTURE_PAGE
    if (page && mainWindow) {
      const section = process.env.GCONVERTER_CAPTURE_SECTION
      await mainWindow.webContents.executeJavaScript(
        section
          ? `window.__gc.openHelp(${JSON.stringify(section)})`
          : `window.__gc.setPage(${JSON.stringify(page)})`
      )
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }

    const image = await mainWindow!.webContents.capturePage()
    await fsp.writeFile(target, image.toPNG())
    logger.info('app', `Captured window to ${target}`)
  } catch (err) {
    logger.error('app', 'Capture failed', { err: String(err) })
  } finally {
    app.exit(0)
  }
}

function resolveIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.resourcesPath ?? '', 'icon.png')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

async function bootstrap(): Promise<void> {
  directories = ensureDirectories(app.getPath('userData'))

  const defaults = createDefaultAppSettings(directories.output, directories.temp)
  settingsStore = new JsonStore<AppSettings>(
    path.join(directories.root, 'settings.json'),
    defaults
  )

  logger.init(directories.logs, settingsStore.get().advanced.logLevel)
  logger.info('app', `GConverter ${app.getVersion()} starting`, {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron
  })

  historyStore = new JsonStore<{ entries: HistoryEntry[] }>(
    path.join(directories.root, 'history.json'),
    { entries: [] }
  )
  profileStore = new JsonStore<{ profiles: ConversionProfile[] }>(
    path.join(directories.root, 'profiles.json'),
    { profiles: [] }
  )
  automationStore = new JsonStore<{ rules: AutomationRule[] }>(
    path.join(directories.root, 'automation.json'),
    { rules: [] }
  )

  const advanced = settingsStore.get().advanced
  ffmpegInfo = await resolveFFmpeg(advanced.ffmpegPath, advanced.ffprobePath)

  probe = new MediaProbe(ffmpegInfo.ffprobePath, ffmpegInfo.ffmpegPath)
  engine = new FFmpegConversionEngine(ffmpegInfo.ffmpegPath)

  ytdlpInfo = await resolveYtDlp(advanced.ytdlpPath)
  youtubeAuth = new YouTubeAuth(
    path.join(directories.root, 'youtube', 'cookies.txt'),
    () => mainWindow,
    () => translate(getSettings().general.language, 'yt.verifyWindowTitle')
  )
  youtube = new YouTubeDownloader({
    getYtDlp: () => ytdlpInfo,
    getFFmpegPath: () => ffmpegInfo.ffmpegPath,
    getLang: () => getSettings().general.language,
    // Electron doubles as the Node runtime YouTube's JS challenges need.
    jsRuntimePath: process.execPath,
    getCookiesFile: () => youtubeAuth.cookiesFile()
  })
  youtube.on('event', (event) => send(IPC.youtubeEvent, event))

  queue = new QueueManager({
    engine,
    getSettings,
    getHardware: () => hardware,
    getAvailableEncoders: getEncoders,
    onHistory: (entry) => {
      historyStore.update((draft) => {
        draft.entries.unshift(entry)
        // Keep history bounded so the file cannot grow without limit.
        if (draft.entries.length > 500) draft.entries.length = 500
      })
    }
  })

  queue.on('event', (event) => {
    send(IPC.queueEvent, event)

    if (event.type === 'job-updated' && event.job.status === 'completed') {
      void onJobCompleted(event.job.id)
    }
  })

  automation = new AutomationService({
    probe: (filePath) => probe.probe(filePath),
    enqueue: (file, rule) => {
      const profile = findProfile(rule.profileId)
      if (!profile) {
        logger.warn('automation', `Rule "${rule.name}" references a missing preset`)
        return null
      }
      const settings = applyProfileCaps(profile, file)
      return queue.add({
        source: file,
        settings,
        profileId: profile.id,
        profileName: profile.name,
        outputFolder: rule.outputFolder,
        automationRuleId: rule.id
      })
    },
    onRuleUpdated: (rule) => {
      automationStore.update((draft) => {
        const index = draft.rules.findIndex((r) => r.id === rule.id)
        if (index >= 0) draft.rules[index] = rule
      })
    },
    ensureQueueRunning: () => queue.start()
  })

  // Hardware detection runs real test encodes, so keep it off the critical
  // path — but only ever run it once, however many callers ask for it.
  hardwarePromise = detectHardware(ffmpegInfo.ffmpegPath, ffmpegInfo.encoders)
  void hardwarePromise
    .then((caps) => {
      hardware = caps
      send(IPC.systemRefresh, { ffmpeg: ffmpegInfo, hardware: caps })
    })
    .catch((err) => logger.error('hardware', 'Detection failed', { err: String(err) }))

  automation.sync(automationStore.get().rules)

  // Housekeeping (spec §32).
  void cleanupTempFiles(directories, settingsStore.get().general.autoCleanupDays).then((n) => {
    if (n > 0) logger.info('app', `Cleaned ${n} stale temporary item(s)`)
  })
  logger.cleanup(directories.logs, settingsStore.get().advanced.keepLogDays)

  registerIpc()
}

async function onJobCompleted(jobId: string): Promise<void> {
  const job = queue.getJob(jobId)
  if (!job) return

  if (job.automationRuleId) {
    const rule = automationStore.get().rules.find((r) => r.id === job.automationRuleId)
    if (rule) await applySourceAction(rule, job.source.path)
  }

  if (getSettings().general.notifications && Notification.isSupported()) {
    const notification = new Notification({
      title: 'Conversion completed',
      body: path.basename(job.outputPath),
      silent: false
    })
    notification.on('click', () => {
      shell.showItemInFolder(job.outputPath)
    })
    notification.show()
  }
}

function findProfile(id: string): ConversionProfile | undefined {
  return (
    BUILT_IN_PRESETS.find((p) => p.id === id) ??
    profileStore.get().profiles.find((p) => p.id === id)
  )
}

function allProfiles(): ConversionProfile[] {
  return [...BUILT_IN_PRESETS, ...profileStore.get().profiles]
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Recursively collect media files from a folder (spec §25). */
async function collectMediaPaths(
  folder: string,
  recursive: boolean,
  depth = 0
): Promise<string[]> {
  const found: string[] = []
  if (depth > 10) return found

  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true })
  } catch (err) {
    logger.warn('media', `Cannot read folder ${folder}`, { err: String(err) })
    return found
  }

  for (const entry of entries) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (recursive) found.push(...(await collectMediaPaths(full, recursive, depth + 1)))
      continue
    }
    const ext = path.extname(entry.name).replace('.', '').toLowerCase()
    if (MEDIA_EXTENSIONS.includes(ext)) found.push(full)
  }

  return found
}

/** Expand any dropped folders into the media files they contain. */
async function expandDroppedPaths(paths: string[]): Promise<string[]> {
  const files: string[] = []
  for (const target of paths) {
    try {
      const stat = await fsp.stat(target)
      if (stat.isDirectory()) {
        files.push(...(await collectMediaPaths(target, true)))
      } else {
        files.push(target)
      }
    } catch {
      /* dropped item vanished */
    }
  }
  return files
}

async function probeAll(paths: string[]): Promise<MediaFile[]> {
  if (paths.length === 0) return []
  const concurrency = Math.min(6, Math.max(2, Math.floor((hardware?.cpuThreads ?? 4) / 2)))
  return probe.probeMany(paths, concurrency)
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

/** Wrap a handler so an unexpected throw is logged, not swallowed silently. */
function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as never[]))
    } catch (err) {
      logger.error('ipc', `Handler ${channel} threw`, { err: String(err) })
      throw err
    }
  })
}

function registerIpc(): void {
  /* ------------------------------ media ----------------------------- */

  handle(IPC.probeFiles, (paths: string[]) => probeAll(paths))

  handle(IPC.probeRaw, (filePath: string) => probe.probeRaw(filePath))

  handle(IPC.resolveDropped, async (paths: string[]) => {
    const expanded = await expandDroppedPaths(paths)
    return probeAll(expanded)
  })

  handle(IPC.pickFiles, async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add media files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media files', extensions: MEDIA_EXTENSIONS },
        { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'ts', 'wmv', 'flv'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'] },
        { name: 'Images', extensions: IMAGE_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return probeAll(result.filePaths)
  })

  handle(IPC.pickFolder, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(IPC.scanFolder, async (folder: string, recursive: boolean) => {
    const paths = await collectMediaPaths(folder, recursive)
    return probeAll(paths)
  })

  /* --------------------------- conversion --------------------------- */

  handle(
    IPC.preview,
    async (
      source: MediaFile,
      settings: ConversionSettings,
      outputFolder?: string
    ): Promise<PreviewResult> => {
      const result = await queue.preview(source, settings, outputFolder)
      return {
        ...result,
        commandString: [ffmpegInfo.ffmpegPath, ...result.command]
          .map(quoteForDisplay)
          .join(' ')
      }
    }
  )

  handle(IPC.smartSettings, (source: MediaFile, targetFormat: string) =>
    smartConvert(source, targetFormat, {
      hardware,
      availableEncoders: getEncoders(),
      settings: getSettings()
    })
  )

  handle(IPC.profileSettings, (source: MediaFile, profileId: string) => {
    const profile = findProfile(profileId)
    if (!profile) throw new Error(`Unknown preset: ${profileId}`)
    return applyProfileCaps(profile, source)
  })

  handle(IPC.losslessTargets, (source: MediaFile) => losslessTargets(source))

  /* ------------------------------ queue ----------------------------- */

  handle(
    IPC.queueAdd,
    (
      source: MediaFile,
      settings: ConversionSettings,
      options?: { profileId?: string; profileName?: string; outputFolder?: string }
    ) => queue.add({ source, settings, ...options })
  )

  handle(IPC.queueList, () => ({
    jobs: queue.getJobs(),
    running: queue.isRunning(),
    paused: queue.isPaused()
  }))

  handle(IPC.queueRemove, (jobId: string) => queue.remove(jobId))
  handle(IPC.queueRetry, (jobId: string, settings?: ConversionSettings) => {
    const ok = queue.retry(jobId, settings)
    if (ok) queue.start()
    return ok
  })
  handle(IPC.queueCancelJob, (jobId: string) => queue.cancelJob(jobId))
  handle(IPC.queueStart, () => queue.start())
  handle(IPC.queuePause, () => queue.pause())
  handle(IPC.queueResume, () => queue.resume())
  handle(IPC.queueStop, () => queue.stop())
  handle(IPC.queueClear, () => queue.clearAll())
  handle(IPC.queueClearFinished, () => queue.clearFinished())
  handle(IPC.queueReorder, (jobId: string, index: number) => queue.reorder(jobId, index))

  /* ---------------------------- profiles ---------------------------- */

  handle(IPC.profilesList, () => allProfiles())

  handle(IPC.profileSave, (profile: ConversionProfile) => {
    profileStore.update((draft) => {
      const index = draft.profiles.findIndex((p) => p.id === profile.id)
      const stored: ConversionProfile = { ...profile, builtIn: false, category: 'custom' }
      if (index >= 0) draft.profiles[index] = stored
      else draft.profiles.push(stored)
    })
    profileStore.flush()
    return allProfiles()
  })

  handle(IPC.profileDelete, (profileId: string) => {
    profileStore.update((draft) => {
      draft.profiles = draft.profiles.filter((p) => p.id !== profileId)
    })
    profileStore.flush()
    return allProfiles()
  })

  handle(IPC.profileEffect, (source: MediaFile, profileId: string) => {
    const profile = findProfile(profileId)
    return profile ? describeProfileEffect(profile, source) : []
  })

  /* ----------------------------- system ----------------------------- */

  handle(IPC.ffmpegInfo, () => ffmpegInfo)

  handle(IPC.hardware, async () => {
    if (hardware) return hardware
    hardwarePromise ??= detectHardware(ffmpegInfo.ffmpegPath, ffmpegInfo.encoders)
    hardware = await hardwarePromise
    return hardware
  })

  handle(IPC.systemRefresh, async () => {
    const advanced = getSettings().advanced
    clearFFmpegCache()
    ffmpegInfo = await resolveFFmpeg(advanced.ffmpegPath, advanced.ffprobePath, true)
    probe.setPath(ffmpegInfo.ffprobePath, ffmpegInfo.ffmpegPath)
    engine.setFFmpegPath(ffmpegInfo.ffmpegPath)
    ytdlpInfo = await resolveYtDlp(advanced.ytdlpPath)
    hardwarePromise = detectHardware(ffmpegInfo.ffmpegPath, ffmpegInfo.encoders, true)
    hardware = await hardwarePromise
    return { ffmpeg: ffmpegInfo, hardware }
  })

  handle(IPC.pickBinary, async (kind: 'ffmpeg' | 'ffprobe' | 'yt-dlp') => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select the ${kind} executable`,
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executable', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  /* ---------------------------- settings ---------------------------- */

  handle(IPC.settingsGet, () => getSettings())

  handle(IPC.settingsSet, async (next: AppSettings) => {
    const previous = getSettings()
    settingsStore.set(next)
    settingsStore.flush()

    logger.setLevel(next.advanced.logLevel)

    const pathsChanged =
      previous.advanced.ffmpegPath !== next.advanced.ffmpegPath ||
      previous.advanced.ffprobePath !== next.advanced.ffprobePath

    if (previous.advanced.ytdlpPath !== next.advanced.ytdlpPath) {
      ytdlpInfo = await resolveYtDlp(next.advanced.ytdlpPath)
    }

    if (pathsChanged) {
      clearFFmpegCache()
      ffmpegInfo = await resolveFFmpeg(next.advanced.ffmpegPath, next.advanced.ffprobePath, true)
      probe.setPath(ffmpegInfo.ffprobePath, ffmpegInfo.ffmpegPath)
      engine.setFFmpegPath(ffmpegInfo.ffmpegPath)
      hardwarePromise = detectHardware(ffmpegInfo.ffmpegPath, ffmpegInfo.encoders, true)
      hardware = await hardwarePromise
      send(IPC.systemRefresh, { ffmpeg: ffmpegInfo, hardware })
    }

    return next
  })

  handle(IPC.settingsReset, () => {
    const defaults = createDefaultAppSettings(directories.output, directories.temp)
    settingsStore.set(defaults)
    settingsStore.flush()
    return defaults
  })

  /* ----------------------------- history ---------------------------- */

  handle(IPC.historyList, () => historyStore.get().entries)

  handle(IPC.historyRemove, (id: string) => {
    historyStore.update((draft) => {
      draft.entries = draft.entries.filter((e) => e.id !== id)
    })
    historyStore.flush()
    return historyStore.get().entries
  })

  handle(IPC.historyClear, () => {
    historyStore.update((draft) => {
      draft.entries = []
    })
    historyStore.flush()
    return []
  })

  /* --------------------------- automation --------------------------- */

  handle(IPC.automationList, () => automationStore.get().rules)

  handle(IPC.automationSave, (rule: AutomationRule) => {
    automationStore.update((draft) => {
      const index = draft.rules.findIndex((r) => r.id === rule.id)
      if (index >= 0) draft.rules[index] = rule
      else draft.rules.push(rule)
    })
    automationStore.flush()
    automation.sync(automationStore.get().rules)
    return automationStore.get().rules
  })

  handle(IPC.automationDelete, (id: string) => {
    automation.stop(id)
    automationStore.update((draft) => {
      draft.rules = draft.rules.filter((r) => r.id !== id)
    })
    automationStore.flush()
    return automationStore.get().rules
  })

  handle(IPC.automationScan, async (id: string) => {
    const rule = automationStore.get().rules.find((r) => r.id === id)
    if (!rule) return 0
    const count = await automation.scanExisting(rule)
    if (count > 0) queue.start()
    return count
  })

  /* ------------------------------ logs ------------------------------ */

  handle(IPC.logsList, (limit?: number) => logger.getRecords(limit ?? 1000))
  handle(IPC.logsClear, () => logger.clear())

  handle(IPC.logsExport, async () => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export log',
      defaultPath: `gconverter-log-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text file', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, logger.exportText(), 'utf-8')
    return result.filePath
  })

  logger.subscribe((record) => send(IPC.logRecord, record))

  /* ------------------------------ shell ----------------------------- */

  handle(IPC.openPath, (target: string) => shell.openPath(target))
  handle(IPC.revealPath, (target: string) => {
    shell.showItemInFolder(target)
  })

  handle(IPC.openExternal, async (url: string) => {
    // Only ever hand http(s) to the OS: a file:// or custom-scheme URL
    // arriving here would be a way to launch arbitrary local programs.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      logger.warn('shell', 'Refused to open a malformed URL', { url })
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      logger.warn('shell', 'Refused to open a non-web URL', { url })
      return
    }
    await shell.openExternal(parsed.href)
  })
  handle(IPC.copyText, (text: string) => {
    clipboard.writeText(text)
  })
  handle(IPC.fileUrl, (target: string) => pathToFileURL(target).href)

  handle(IPC.saveTextFile, async (defaultName: string, contents: string) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, contents, 'utf-8')
    return result.filePath
  })

  /* ----------------------------- youtube ---------------------------- */

  handle(IPC.youtubeEngine, () => ytdlpInfo)
  handle(IPC.youtubeInfo, (url: string, cookiesBrowser: YouTubeCookiesBrowser) =>
    youtube.fetchInfo(url, cookiesBrowser)
  )
  handle(IPC.youtubeStart, (request: YouTubeRequest) => {
    const download = youtube.start(request)
    // Remember the choices so the page opens with them next time.
    settingsStore.update((draft) => {
      draft.youtube.downloadFolder = download.request.outputFolder
      draft.youtube.mode = download.request.mode
      draft.youtube.quality = download.request.quality
      draft.youtube.videoFormat = download.request.videoFormat
      draft.youtube.audioFormat = download.request.audioFormat
      draft.youtube.cookiesBrowser = download.request.cookiesBrowser
    })
    return download
  })
  handle(IPC.youtubeList, () => youtube.list())
  handle(IPC.youtubeCancel, (id: string) => youtube.cancel(id))
  handle(IPC.youtubeRetry, (id: string, cookiesBrowser?: YouTubeCookiesBrowser) =>
    youtube.retry(id, cookiesBrowser)
  )
  handle(IPC.youtubeAuthStatus, () => youtubeAuth.status())
  handle(IPC.youtubeVerify, (url?: string, autoClose?: boolean) =>
    youtubeAuth.verify(url, autoClose === true)
  )
  handle(IPC.youtubeVerifyFinish, () => youtubeAuth.finish())
  handle(IPC.youtubeSignOut, () => youtubeAuth.signOut())
  handle(IPC.youtubeRemove, (id: string) => youtube.remove(id))
  handle(IPC.youtubeClearFinished, () => youtube.clearFinished())

  /* ------------------------------- app ------------------------------ */

  handle(
    IPC.appInfo,
    (): AppInfo => ({
      name: 'GConverter',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      directories
    })
  )
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

// A second instance would fight over the settings file; focus the first one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    await bootstrap()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Never leave orphaned FFmpeg processes or half-written files behind.
  try {
    engine?.cancelAll()
    youtube?.cancelAll()
    automation?.stopAll()
    settingsStore?.flush()
    historyStore?.flush()
    profileStore?.flush()
    automationStore?.flush()
    logger.info('app', 'GConverter shutting down')
    logger.close()
  } catch {
    /* shutting down anyway */
  }
})

// A crash in the main process must produce a log entry, not a silent death.
process.on('uncaughtException', (err) => {
  logger.error('app', 'Uncaught exception', { message: err.message, stack: err.stack })
})
process.on('unhandledRejection', (reason) => {
  logger.error('app', 'Unhandled rejection', { reason: String(reason) })
})
