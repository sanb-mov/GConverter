/**
 * Built-in YouTube window for the "confirm you're not a robot" check.
 *
 * When YouTube refuses yt-dlp, the user opens this window, solves the
 * captcha or signs in, and closes it. Its cookies are then written to a
 * private cookies.txt that yt-dlp uses for every later request.
 *
 * The window is deliberately locked down: its own persistent session (so
 * nothing leaks into the app), no preload, no Node, sandboxed, every
 * permission denied, and navigation limited to YouTube and Google — any
 * other link opens in the user's real browser.
 */

import { BrowserWindow, session, shell, type Session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { YouTubeAuthStatus, YouTubeVerifyResult } from '@shared/models'
import { logger } from '../logging/logger'
import { isYouTubeCookie, looksSignedIn, toNetscapeCookies } from './cookies'

const PARTITION = 'persist:youtube-auth'

/** Hosts the window may navigate to; everything else goes to the real browser. */
export function isAllowedAuthHost(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ['youtube.com', 'youtu.be', 'google.com'].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  )
}

/** Google's "unusual traffic" page that hosts the "I'm not a robot" captcha. */
export function isCaptchaPage(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return /(^|\.)google\.com$/.test(url.hostname) && url.pathname.startsWith('/sorry')
  } catch {
    return false
  }
}

function isYouTubePage(rawUrl: string): boolean {
  try {
    return /(^|\.)youtube\.com$/.test(new URL(rawUrl).hostname)
  } catch {
    return false
  }
}

export class YouTubeAuth {
  private window: BrowserWindow | null = null
  private pending: Promise<YouTubeVerifyResult> | null = null
  private configured = false
  /** Set by signOut so closing the window does not write cookies back. */
  private skipSave = false

  constructor(
    private readonly cookieFile: string,
    private readonly getParent: () => BrowserWindow | null,
    private readonly title: () => string
  ) {}

  /** Path to hand yt-dlp, or null when nothing has been saved yet. */
  cookiesFile(): string | null {
    return fs.existsSync(this.cookieFile) ? this.cookieFile : null
  }

  private session(): Session {
    const ses = session.fromPartition(PARTITION)
    if (!this.configured) {
      this.configured = true
      // Google refuses sign-in from anything that admits to being Electron.
      ses.setUserAgent(
        ses.getUserAgent().replace(/\s(Electron|gconverter|GConverter)\/\S+/g, '')
      )
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      ses.setPermissionCheckHandler(() => false)
      ses.on('will-download', (event) => event.preventDefault())
    }
    return ses
  }

  async status(): Promise<YouTubeAuthStatus> {
    const cookies = (await this.session().cookies.get({})).filter(isYouTubeCookie)
    return { hasCookies: this.cookiesFile() !== null, signedIn: looksSignedIn(cookies) }
  }

  /**
   * Open the window on `url` (the video that was refused, ideally) and
   * resolve once the user closes it and the cookies are saved.
   */
  verify(url?: string, autoClose = false): Promise<YouTubeVerifyResult> {
    if (this.pending) {
      this.window?.focus()
      return this.pending
    }

    const target = url && isAllowedAuthHost(url) ? url : 'https://www.youtube.com/'
    const parent = this.getParent()

    const win = new BrowserWindow({
      width: 1080,
      height: 780,
      parent: parent ?? undefined,
      modal: false,
      title: this.title(),
      autoHideMenuBar: true,
      backgroundColor: '#0f0f0f',
      webPreferences: {
        session: this.session(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    this.window = win

    // Keep our title; YouTube would otherwise replace it with the video name.
    win.on('page-title-updated', (event) => event.preventDefault())

    const guard = (event: { preventDefault: () => void }, next: string): void => {
      if (isAllowedAuthHost(next)) return
      event.preventDefault()
      if (/^https?:\/\//i.test(next)) void shell.openExternal(next)
    }
    win.webContents.on('will-navigate', guard)
    win.webContents.on('will-redirect', guard)

    // The robot check lives on google.com/sorry; once it sends the user back
    // to YouTube the check is passed, so close and let the retry happen.
    let sawCaptcha = false
    win.webContents.on('did-navigate', (_event, next) => {
      if (isCaptchaPage(next)) {
        sawCaptcha = true
        return
      }
      if (autoClose && sawCaptcha && isYouTubePage(next)) {
        logger.info('youtube', 'Robot check passed; closing verification window')
        // Give YouTube a moment to set its cookies before we read them.
        setTimeout(() => {
          if (!win.isDestroyed()) win.close()
        }, 2500)
      }
    })
    win.webContents.setWindowOpenHandler(({ url: next }) => {
      // Google sign-in sometimes opens a popup; keep it in this window.
      if (isAllowedAuthHost(next)) void win.loadURL(next)
      else if (/^https?:\/\//i.test(next)) void shell.openExternal(next)
      return { action: 'deny' }
    })

    this.pending = new Promise<YouTubeVerifyResult>((resolve) => {
      win.on('closed', () => {
        this.window = null
        const skip = this.skipSave
        this.skipSave = false
        void (skip
          ? Promise.resolve<YouTubeVerifyResult>({ ok: false, hasCookies: false, signedIn: false })
          : this.saveCookies())
          .then(resolve)
          .catch((err) => {
            logger.error('youtube', 'Could not save YouTube cookies', { err: String(err) })
            resolve({ ok: false, hasCookies: this.cookiesFile() !== null, signedIn: false })
          })
          .finally(() => {
            this.pending = null
          })
      })
    })

    void win.loadURL(target).catch((err) => {
      logger.warn('youtube', 'Verification window failed to load', { err: String(err) })
    })
    logger.info('youtube', 'Opened YouTube verification window')
    return this.pending
  }

  /** "I'm done" from the app: closing the window triggers the save. */
  finish(): void {
    this.window?.close()
  }

  private async saveCookies(): Promise<YouTubeVerifyResult> {
    const cookies = (await this.session().cookies.get({})).filter(isYouTubeCookie)
    const signedIn = looksSignedIn(cookies)

    if (cookies.length === 0) {
      return { ok: true, hasCookies: this.cookiesFile() !== null, signedIn: false }
    }

    fs.mkdirSync(path.dirname(this.cookieFile), { recursive: true })
    // Write-then-rename so yt-dlp never reads a half-written file.
    const tmp = `${this.cookieFile}.tmp`
    fs.writeFileSync(tmp, toNetscapeCookies(cookies), { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(tmp, this.cookieFile)
    logger.info('youtube', 'Saved YouTube session for yt-dlp', { count: cookies.length, signedIn })
    return { ok: true, hasCookies: true, signedIn }
  }

  /** Forget the session entirely: browser storage and the cookies file. */
  async signOut(): Promise<YouTubeAuthStatus> {
    if (this.window) {
      this.skipSave = true
      this.window.destroy()
      await this.pending
    }
    await this.session().clearStorageData()
    fs.rmSync(this.cookieFile, { force: true })
    logger.info('youtube', 'YouTube session cleared')
    return { hasCookies: false, signedIn: false }
  }
}
