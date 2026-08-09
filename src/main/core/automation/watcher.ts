/**
 * Watch folders and automation rules (spec §26, §27).
 *
 * A rule watches a folder, waits for each new file to finish being written,
 * probes it, queues a conversion with the rule's profile, and optionally
 * moves or deletes the source afterwards.
 *
 * The "file is still being written" problem is real: a file appears in the
 * directory the moment a copy starts. We therefore poll its size until it
 * stops changing before touching it.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { AutomationRule, ConversionJob, MediaFile } from '@shared/models'
import { MEDIA_EXTENSIONS } from '@shared/formats'
import { logger } from '../logging/logger'

export interface AutomationDependencies {
  probe: (filePath: string) => Promise<MediaFile>
  enqueue: (file: MediaFile, rule: AutomationRule) => ConversionJob | null
  onRuleUpdated: (rule: AutomationRule) => void
  /** Called so the queue starts processing if it is idle. */
  ensureQueueRunning: () => void
}

/** How long a file's size must stay unchanged before we treat it as complete. */
const STABLE_CHECKS = 3
const STABLE_INTERVAL_MS = 700

export class AutomationService {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Set<string>()
  /** Files already handled, so a rename inside the folder is not re-processed. */
  private handled = new Map<string, Set<string>>()

  constructor(private deps: AutomationDependencies) {}

  /** Start (or restart) watching for a rule. */
  start(rule: AutomationRule): void {
    this.stop(rule.id)
    if (!rule.enabled) return

    if (!fs.existsSync(rule.watchFolder)) {
      logger.warn('automation', `Watch folder does not exist: ${rule.watchFolder}`, {
        rule: rule.name
      })
      return
    }

    const watcher = chokidar.watch(rule.watchFolder, {
      ignoreInitial: true,
      depth: rule.recursive ? undefined : 0,
      persistent: true,
      // We do our own stability check, but this filters most partial writes.
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }
    })

    watcher.on('add', (filePath) => {
      void this.handleFile(filePath, rule)
    })

    watcher.on('error', (err) => {
      logger.error('automation', `Watcher error for ${rule.name}`, { err: String(err) })
    })

    this.watchers.set(rule.id, watcher)
    this.handled.set(rule.id, new Set())
    logger.info('automation', `Watching ${rule.watchFolder}`, { rule: rule.name })
  }

  stop(ruleId: string): void {
    const watcher = this.watchers.get(ruleId)
    if (!watcher) return
    void watcher.close()
    this.watchers.delete(ruleId)
    this.handled.delete(ruleId)
  }

  stopAll(): void {
    for (const id of [...this.watchers.keys()]) this.stop(id)
  }

  isWatching(ruleId: string): boolean {
    return this.watchers.has(ruleId)
  }

  /** Re-apply the full rule set (called after any rule edit). */
  sync(rules: AutomationRule[]): void {
    const wanted = new Set(rules.filter((r) => r.enabled).map((r) => r.id))
    for (const id of [...this.watchers.keys()]) {
      if (!wanted.has(id)) this.stop(id)
    }
    for (const rule of rules) {
      if (rule.enabled && !this.watchers.has(rule.id)) this.start(rule)
    }
  }

  /** Process every eligible file already sitting in the folder. */
  async scanExisting(rule: AutomationRule): Promise<number> {
    let count = 0
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (rule.recursive && depth < 8) await walk(full, depth + 1)
          continue
        }
        if (await this.handleFile(full, rule, true)) count++
      }
    }
    await walk(rule.watchFolder, 0)
    return count
  }

  private matchesRule(filePath: string, rule: AutomationRule): boolean {
    const ext = path.extname(filePath).replace('.', '').toLowerCase()
    if (!ext) return false
    if (rule.extensions.length > 0) return rule.extensions.includes(ext)
    return MEDIA_EXTENSIONS.includes(ext)
  }

  private async handleFile(
    filePath: string,
    rule: AutomationRule,
    skipStability = false
  ): Promise<boolean> {
    const key = path.resolve(filePath)

    if (this.pending.has(key)) return false
    if (!this.matchesRule(filePath, rule)) return false

    const seen = this.handled.get(rule.id) ?? new Set()
    if (seen.has(key)) return false

    // Never pick up our own output when the folders overlap.
    if (
      path.resolve(rule.outputFolder) === path.dirname(key) ||
      (rule.sourceMoveFolder && path.resolve(rule.sourceMoveFolder) === path.dirname(key))
    ) {
      return false
    }

    this.pending.add(key)

    try {
      if (!skipStability) {
        const stable = await this.waitForStableSize(filePath)
        if (!stable) {
          logger.warn('automation', `File never stabilised, skipping: ${path.basename(filePath)}`)
          return false
        }
      }

      const media = await this.deps.probe(filePath)
      if (media.error) {
        logger.warn('automation', `Skipping unreadable file: ${media.name}`, {
          error: media.error
        })
        rule.stats.failed++
        this.deps.onRuleUpdated(rule)
        return false
      }

      const job = this.deps.enqueue(media, rule)
      if (!job) return false

      seen.add(key)
      this.handled.set(rule.id, seen)

      rule.stats.processed++
      rule.stats.lastRunAt = Date.now()
      this.deps.onRuleUpdated(rule)
      this.deps.ensureQueueRunning()

      logger.info('automation', `Queued ${media.name} via rule "${rule.name}"`)
      return true
    } catch (err) {
      logger.error('automation', `Failed to handle ${filePath}`, { err: String(err) })
      return false
    } finally {
      this.pending.delete(key)
    }
  }

  /** Poll until the size stops changing — a file being copied grows. */
  private async waitForStableSize(filePath: string): Promise<boolean> {
    let lastSize = -1
    let stableCount = 0

    for (let attempt = 0; attempt < 120; attempt++) {
      let size: number
      try {
        size = (await fsp.stat(filePath)).size
      } catch {
        return false
      }

      if (size === lastSize && size > 0) {
        stableCount++
        if (stableCount >= STABLE_CHECKS) return true
      } else {
        stableCount = 0
        lastSize = size
      }

      await sleep(STABLE_INTERVAL_MS)
    }
    return false
  }
}

/**
 * Post-conversion source handling (spec §26: "mover a /Completed").
 * Runs only after the job actually succeeded.
 */
export async function applySourceAction(
  rule: AutomationRule,
  sourcePath: string
): Promise<void> {
  try {
    switch (rule.sourceAction) {
      case 'move': {
        if (!rule.sourceMoveFolder) return
        await fsp.mkdir(rule.sourceMoveFolder, { recursive: true })
        const target = path.join(rule.sourceMoveFolder, path.basename(sourcePath))
        const finalTarget = fs.existsSync(target)
          ? path.join(
              rule.sourceMoveFolder,
              `${path.parse(sourcePath).name} (${Date.now()})${path.extname(sourcePath)}`
            )
          : target
        try {
          await fsp.rename(sourcePath, finalTarget)
        } catch (err) {
          // rename fails across volumes; fall back to copy + delete.
          if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
            await fsp.copyFile(sourcePath, finalTarget)
            await fsp.unlink(sourcePath)
          } else {
            throw err
          }
        }
        logger.info('automation', `Moved source to ${rule.sourceMoveFolder}`)
        break
      }
      case 'delete': {
        await fsp.unlink(sourcePath)
        logger.info('automation', `Deleted source ${path.basename(sourcePath)}`)
        break
      }
      case 'trash': {
        const { shell } = await import('electron')
        await shell.trashItem(sourcePath)
        logger.info('automation', `Moved source to trash: ${path.basename(sourcePath)}`)
        break
      }
      case 'nothing':
      default:
        break
    }
  } catch (err) {
    logger.error('automation', 'Post-conversion source action failed', {
      action: rule.sourceAction,
      err: String(err)
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
