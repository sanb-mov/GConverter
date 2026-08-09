/** Display formatters shared across the UI. */

export function formatBytes(bytes: number | undefined, decimals?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = decimals ?? (value < 10 ? 2 : value < 100 ? 1 : 0)
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Seconds → "1:32:41" or "3:07". */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Milliseconds → "4 min 12 s" style, for ETAs. */
export function formatEta(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatBitrate(bitsPerSecond: number | undefined): string {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond)) return '—'
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

export function formatFps(fps: number | undefined): string {
  if (!fps || !Number.isFinite(fps)) return '—'
  // 23.976 and 29.97 must not be rounded to 24 / 30 — editors care.
  const rounded = Math.round(fps)
  return Math.abs(fps - rounded) < 0.005 ? `${rounded} fps` : `${fps.toFixed(3)} fps`
}

export function formatSampleRate(hz: number | undefined): string {
  if (!hz) return '—'
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`
}

export function formatChannels(channels: number | undefined, layout?: string): string {
  if (layout) {
    const pretty: Record<string, string> = {
      mono: 'Mono',
      stereo: 'Stereo',
      '5.1': '5.1 Surround',
      '5.1(side)': '5.1 Surround',
      '7.1': '7.1 Surround',
      'quad': 'Quadraphonic'
    }
    return pretty[layout] ?? layout
  }
  if (!channels) return '—'
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  return `${channels} channels`
}

export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return '—'
  return `${width} × ${height}`
}

/** Common marketing name for a resolution, shown as a secondary label. */
export function resolutionName(width?: number, height?: number): string | null {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long >= 7600) return '8K'
  if (long >= 3800) return '4K'
  if (long >= 2500) return '1440p'
  if (short >= 1000) return '1080p'
  if (short >= 700) return '720p'
  if (short >= 470) return '480p'
  return `${short}p`
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(value < 10 ? 1 : 0)}%`
}

export function formatSpeed(speed: number | undefined): string {
  if (!speed || !Number.isFinite(speed)) return '—'
  return `${speed.toFixed(speed < 10 ? 2 : 1)}×`
}

/**
 * Relative day label used in History.
 * Takes a translator so "Today"/"Hoy" follows the selected language, and
 * formats absolute dates with that language's locale conventions.
 */
export function formatRelativeDate(
  timestamp: number,
  t?: (key: string, params?: Record<string, string | number>) => string,
  locale?: string
): string {
  const now = new Date()
  const date = new Date(timestamp)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000)

  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const label = (key: string, params?: Record<string, string | number>): string =>
    t ? t(key, params) : key

  if (dayDiff === 0) return `${t ? label('history.today') : 'Today'}, ${time}`
  if (dayDiff === 1) return `${t ? label('history.yesterday') : 'Yesterday'}, ${time}`
  if (dayDiff < 7) {
    return t ? label('history.daysAgo', { count: dayDiff }) : `${dayDiff} days ago`
  }
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/** Translation key for the time-of-day greeting on Home (spec §43). */
export function greetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'home.greetingNight'
  if (hour < 12) return 'home.greetingMorning'
  if (hour < 18) return 'home.greetingAfternoon'
  return 'home.greetingEvening'
}

/** "-54%" style delta, with sign, for the size comparison. */
export function formatDelta(from: number, to: number): { text: string; good: boolean } {
  if (!from || !to) return { text: '—', good: true }
  const percent = ((to - from) / from) * 100
  const rounded = Math.round(percent)
  return {
    text: `${rounded > 0 ? '+' : ''}${rounded}%`,
    good: rounded <= 0
  }
}

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function dirname(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  parts.pop()
  return parts.join('/')
}

/** Shorten a long path for display: "C:\…\Videos\clip.mp4". */
export function shortenPath(filePath: string, maxLength = 48): string {
  if (filePath.length <= maxLength) return filePath
  const name = basename(filePath)
  const root = filePath.slice(0, 3)
  if (name.length + 6 >= maxLength) return `…${name.slice(-(maxLength - 1))}`
  return `${root}…${filePath.slice(-(maxLength - root.length - 1))}`
}
