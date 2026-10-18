/**
 * YouTube helpers shared by the renderer (live validation) and the main
 * process (which re-validates everything before yt-dlp ever runs).
 */

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

/**
 * Accept only http(s) links to YouTube itself. Anything else — other sites,
 * file:// URLs, or text starting with "-" that yt-dlp could read as a flag —
 * is rejected.
 */
export function normalizeYouTubeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || text.startsWith('-')) return null

  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null

  const host = url.hostname.toLowerCase()
  const allowed = YOUTUBE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  if (!allowed) return null

  url.protocol = 'https:'
  return url.href
}

/**
 * "1:02:03", "62:03", "45", "45.5" → seconds. Returns null for anything
 * malformed (minutes/seconds ≥ 60 in a colon form count as malformed).
 */
export function parseTimecode(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)

  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text)
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (minutes >= 60 || seconds >= 60) return null
  return hours * 3600 + minutes * 60 + seconds
}

/** Seconds → "H:MM:SS" (or "M:SS" under an hour). */
export function formatTimecode(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Check a fragment range. `duration` of 0 means unknown, in which case only
 * the ordering is checked.
 */
export function isValidSection(start: number, end: number, duration: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  if (start < 0 || end <= start) return false
  // One second of slack: YouTube rounds durations.
  if (duration > 0 && (start >= duration || end > duration + 1)) return false
  return true
}
