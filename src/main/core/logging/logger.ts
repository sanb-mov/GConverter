/**
 * Structured session logging (spec §55).
 *
 * Every record is kept in a bounded ring buffer for the in-app Logs panel
 * and appended to a per-session file on disk. Listeners let the renderer
 * stream new records live.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { LogLevel, LogRecord } from '@shared/models'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warning: 30, error: 40 }
const MAX_BUFFER = 5000

type Listener = (record: LogRecord) => void

class Logger {
  private buffer: LogRecord[] = []
  private listeners = new Set<Listener>()
  private stream: fs.WriteStream | null = null
  private minLevel: LogLevel = 'info'
  private sessionFile = ''

  /** Called once the app knows its userData directory. */
  init(logDirectory: string, level: LogLevel = 'info'): void {
    this.minLevel = level
    try {
      fs.mkdirSync(logDirectory, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      this.sessionFile = path.join(logDirectory, `session-${stamp}.log`)
      this.stream = fs.createWriteStream(this.sessionFile, { flags: 'a' })
      this.info('logger', 'Log session started', { file: this.sessionFile })
    } catch (err) {
      // Logging must never take the app down.
      console.error('Logger init failed:', err)
    }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level
  }

  getSessionFile(): string {
    return this.sessionFile
  }

  private write(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return

    const record: LogRecord = { timestamp: Date.now(), level, scope, message, data }

    this.buffer.push(record)
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER)

    const line =
      `[${new Date(record.timestamp).toISOString()}] ${level.toUpperCase().padEnd(7)} ` +
      `${scope.padEnd(12)} ${message}` +
      (data !== undefined ? ` ${safeJson(data)}` : '')

    try {
      this.stream?.write(line + '\n')
    } catch {
      /* disk full or stream closed — keep the in-memory log working */
    }

    if (level === 'error') console.error(line)
    else if (process.env.NODE_ENV !== 'production') console.log(line)

    for (const listener of this.listeners) {
      try {
        listener(record)
      } catch {
        /* a broken listener must not break logging */
      }
    }
  }

  debug(scope: string, message: string, data?: unknown): void {
    this.write('debug', scope, message, data)
  }
  info(scope: string, message: string, data?: unknown): void {
    this.write('info', scope, message, data)
  }
  warn(scope: string, message: string, data?: unknown): void {
    this.write('warning', scope, message, data)
  }
  error(scope: string, message: string, data?: unknown): void {
    this.write('error', scope, message, data)
  }

  getRecords(limit = 1000): LogRecord[] {
    return this.buffer.slice(-limit)
  }

  clear(): void {
    this.buffer = []
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Export the whole session buffer as plain text. */
  exportText(): string {
    return this.buffer
      .map(
        (r) =>
          `[${new Date(r.timestamp).toISOString()}] ${r.level.toUpperCase().padEnd(7)} ` +
          `${r.scope.padEnd(12)} ${r.message}` +
          (r.data !== undefined ? ` ${safeJson(r.data)}` : '')
      )
      .join('\n')
  }

  /** Delete session logs older than `days` (spec §32). */
  cleanup(logDirectory: string, days: number): void {
    if (days <= 0) return
    const cutoff = Date.now() - days * 86_400_000
    try {
      for (const name of fs.readdirSync(logDirectory)) {
        if (!name.startsWith('session-') || !name.endsWith('.log')) continue
        const full = path.join(logDirectory, name)
        if (full === this.sessionFile) continue
        try {
          if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full)
        } catch {
          /* file vanished or locked */
        }
      }
    } catch {
      /* log directory unreadable */
    }
  }

  close(): void {
    try {
      this.stream?.end()
    } catch {
      /* already closed */
    }
    this.stream = null
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = new Logger()
