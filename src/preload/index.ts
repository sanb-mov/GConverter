/**
 * Preload bridge.
 *
 * The renderer never touches Node or Electron directly. This file exposes a
 * single frozen `window.gconverter` object whose methods map one-to-one onto
 * vetted IPC channels — nothing else crosses the boundary.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type GConverterApi,
  type QueueEventPayload,
  type YouTubeEventPayload
} from '@shared/ipc'
import type { FFmpegInfo, HardwareCapabilities, LogRecord } from '@shared/models'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: GConverterApi = {
  media: {
    probeFiles: (paths) => invoke(IPC.probeFiles, paths),
    probeRaw: (filePath) => invoke(IPC.probeRaw, filePath),
    pickFiles: () => invoke(IPC.pickFiles),
    pickFolder: () => invoke(IPC.pickFolder),
    scanFolder: (folder, recursive) => invoke(IPC.scanFolder, folder, recursive),
    resolveDropped: (paths) => invoke(IPC.resolveDropped, paths)
  },
  conversion: {
    preview: (source, settings, outputFolder) =>
      invoke(IPC.preview, source, settings, outputFolder),
    smartSettings: (source, targetFormat) => invoke(IPC.smartSettings, source, targetFormat),
    profileSettings: (source, profileId) => invoke(IPC.profileSettings, source, profileId),
    losslessTargets: (source) => invoke(IPC.losslessTargets, source)
  },
  queue: {
    add: (source, settings, options) => invoke(IPC.queueAdd, source, settings, options),
    list: () => invoke(IPC.queueList),
    remove: (jobId) => invoke(IPC.queueRemove, jobId),
    retry: (jobId, settings) => invoke(IPC.queueRetry, jobId, settings),
    cancelJob: (jobId) => invoke(IPC.queueCancelJob, jobId),
    start: () => invoke(IPC.queueStart),
    pause: () => invoke(IPC.queuePause),
    resume: () => invoke(IPC.queueResume),
    stop: () => invoke(IPC.queueStop),
    clear: () => invoke(IPC.queueClear),
    clearFinished: () => invoke(IPC.queueClearFinished),
    reorder: (jobId, index) => invoke(IPC.queueReorder, jobId, index),
    onEvent: (handler) => {
      const listener = (_event: unknown, payload: QueueEventPayload): void => handler(payload)
      ipcRenderer.on(IPC.queueEvent, listener)
      return () => ipcRenderer.removeListener(IPC.queueEvent, listener)
    }
  },
  profiles: {
    list: () => invoke(IPC.profilesList),
    save: (profile) => invoke(IPC.profileSave, profile),
    remove: (profileId) => invoke(IPC.profileDelete, profileId),
    effect: (source, profileId) => invoke(IPC.profileEffect, source, profileId)
  },
  system: {
    ffmpeg: () => invoke(IPC.ffmpegInfo),
    hardware: () => invoke(IPC.hardware),
    refresh: () => invoke(IPC.systemRefresh),
    pickBinary: (kind) => invoke(IPC.pickBinary, kind),
    onRefresh: (handler) => {
      const listener = (
        _event: unknown,
        payload: { ffmpeg: FFmpegInfo; hardware: HardwareCapabilities }
      ): void => handler(payload)
      ipcRenderer.on(IPC.systemRefresh, listener)
      return () => ipcRenderer.removeListener(IPC.systemRefresh, listener)
    }
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (settings) => invoke(IPC.settingsSet, settings),
    reset: () => invoke(IPC.settingsReset)
  },
  history: {
    list: () => invoke(IPC.historyList),
    remove: (id) => invoke(IPC.historyRemove, id),
    clear: () => invoke(IPC.historyClear)
  },
  automation: {
    list: () => invoke(IPC.automationList),
    save: (rule) => invoke(IPC.automationSave, rule),
    remove: (id) => invoke(IPC.automationDelete, id),
    scan: (id) => invoke(IPC.automationScan, id)
  },
  logs: {
    list: (limit) => invoke(IPC.logsList, limit),
    clear: () => invoke(IPC.logsClear),
    export: () => invoke(IPC.logsExport),
    onRecord: (handler) => {
      const listener = (_event: unknown, record: LogRecord): void => handler(record)
      ipcRenderer.on(IPC.logRecord, listener)
      return () => ipcRenderer.removeListener(IPC.logRecord, listener)
    }
  },
  shell: {
    openPath: (target) => invoke(IPC.openPath, target),
    revealPath: (target) => invoke(IPC.revealPath, target),
    openExternal: (url) => invoke(IPC.openExternal, url),
    copyText: (text) => invoke(IPC.copyText, text),
    saveTextFile: (defaultName, contents) => invoke(IPC.saveTextFile, defaultName, contents),
    fileUrl: (target) => invoke(IPC.fileUrl, target)
  },
  youtube: {
    engine: () => invoke(IPC.youtubeEngine),
    info: (url, cookiesBrowser) => invoke(IPC.youtubeInfo, url, cookiesBrowser),
    start: (request) => invoke(IPC.youtubeStart, request),
    list: () => invoke(IPC.youtubeList),
    cancel: (id) => invoke(IPC.youtubeCancel, id),
    retry: (id, cookiesBrowser) => invoke(IPC.youtubeRetry, id, cookiesBrowser),
    authStatus: () => invoke(IPC.youtubeAuthStatus),
    verify: (url, autoClose) => invoke(IPC.youtubeVerify, url, autoClose),
    verifyFinish: () => invoke(IPC.youtubeVerifyFinish),
    signOut: () => invoke(IPC.youtubeSignOut),
    remove: (id) => invoke(IPC.youtubeRemove, id),
    clearFinished: () => invoke(IPC.youtubeClearFinished),
    onEvent: (handler) => {
      const listener = (_event: unknown, payload: YouTubeEventPayload): void => handler(payload)
      ipcRenderer.on(IPC.youtubeEvent, listener)
      return () => ipcRenderer.removeListener(IPC.youtubeEvent, listener)
    }
  },
  app: {
    info: () => invoke(IPC.appInfo)
  }
}

contextBridge.exposeInMainWorld('gconverter', api)

/**
 * Electron 32+ removed `File.path`. `webUtils.getPathForFile` is the
 * supported way to turn a dropped File into an absolute path, and it must
 * be called in the preload context.
 */
contextBridge.exposeInMainWorld('gconverterDrop', {
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
})
