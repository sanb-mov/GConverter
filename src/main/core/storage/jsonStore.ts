/**
 * Minimal, dependency-free persistent JSON store.
 *
 * Writes are atomic (temp file + rename) so a crash mid-write can never
 * leave the user with a corrupted settings or history file. A corrupt file
 * found at load time is backed up rather than silently discarded.
 */

import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'

export class JsonStore<T extends object> {
  private data: T
  private readonly filePath: string
  private readonly defaults: T
  private writeTimer: NodeJS.Timeout | null = null

  constructor(filePath: string, defaults: T) {
    this.filePath = filePath
    this.defaults = defaults
    this.data = this.load()
  }

  private load(): T {
    try {
      if (!fs.existsSync(this.filePath)) return structuredClone(this.defaults)
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      if (!raw.trim()) return structuredClone(this.defaults)
      const parsed = JSON.parse(raw) as T
      // Merge so new keys added in later versions get their defaults.
      return deepMerge(structuredClone(this.defaults), parsed)
    } catch (err) {
      logger.error('storage', `Corrupt store at ${this.filePath}; using defaults`, {
        err: String(err)
      })
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        /* nothing more we can do */
      }
      return structuredClone(this.defaults)
    }
  }

  get(): T {
    return this.data
  }

  set(value: T): void {
    this.data = value
    this.scheduleWrite()
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data)
    this.scheduleWrite()
    return this.data
  }

  reset(): T {
    this.data = structuredClone(this.defaults)
    this.scheduleWrite()
    return this.data
  }

  /** Debounced so rapid updates (e.g. a slider drag) hit the disk once. */
  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      logger.error('storage', `Failed to persist ${this.filePath}`, { err: String(err) })
    }
  }
}

/** Recursive merge used to layer a stored file over the current defaults. */
export function deepMerge<T>(base: T, override: Partial<T>): T {
  if (override === null || override === undefined) return base
  if (Array.isArray(override)) return override as unknown as T
  if (typeof override !== 'object' || typeof base !== 'object' || base === null) {
    return override as T
  }
  const result = { ...(base as object) } as Record<string, unknown>
  for (const [key, value] of Object.entries(override as object)) {
    const existing = result[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing, value as object)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}
