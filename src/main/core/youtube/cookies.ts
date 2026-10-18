/**
 * Conversion of browser cookies into the Netscape cookies.txt format that
 * yt-dlp reads with --cookies. Pure, so it can be tested without Electron.
 */

/** The subset of Electron.Cookie this module needs. */
export interface CookieLike {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  expirationDate?: number
}

/** Only YouTube's and Google's own cookies are ever written to disk. */
export function isYouTubeCookie(cookie: CookieLike): boolean {
  const domain = (cookie.domain ?? '').replace(/^\./, '').toLowerCase()
  return (
    domain === 'youtube.com' ||
    domain.endsWith('.youtube.com') ||
    domain === 'google.com' ||
    domain.endsWith('.google.com')
  )
}

/** Cookie names that only exist once someone has signed in to Google. */
const SIGNED_IN = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PSID', 'LOGIN_INFO']

export function looksSignedIn(cookies: CookieLike[]): boolean {
  return cookies.some((c) => SIGNED_IN.includes(c.name))
}

export function toNetscapeCookies(cookies: CookieLike[]): string {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Written by GConverter for yt-dlp. Contains your YouTube session — keep it private.',
    ''
  ]

  for (const cookie of cookies) {
    if (!cookie.domain || !isYouTubeCookie(cookie)) continue
    // Tabs or newlines inside a field would corrupt the whole file.
    if (/[\t\r\n]/.test(cookie.name + cookie.value + (cookie.path ?? ''))) continue

    const includeSubdomains = !cookie.hostOnly
    let domain = cookie.domain
    if (includeSubdomains && !domain.startsWith('.')) domain = `.${domain}`
    if (!includeSubdomains) domain = domain.replace(/^\./, '')

    lines.push(
      [
        (cookie.httpOnly ? '#HttpOnly_' : '') + domain,
        includeSubdomains ? 'TRUE' : 'FALSE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        // 0 marks a session cookie.
        String(Math.max(0, Math.round(cookie.expirationDate ?? 0))),
        cookie.name,
        cookie.value
      ].join('\t')
    )
  }

  return lines.join('\n') + '\n'
}
