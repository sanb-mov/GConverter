/**
 * Downloads the official yt-dlp standalone binary into bin/ so
 * electron-builder can ship it inside the installer (extraResources).
 *
 *   node build/fetch-ytdlp.cjs              # binary for this OS
 *   node build/fetch-ytdlp.cjs --platform=linux
 *   node build/fetch-ytdlp.cjs --force      # re-download even if present
 *
 * The download is checked against the SHA2-256SUMS file published with the
 * same release; a mismatch deletes the file and fails the build.
 */

const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const crypto = require('node:crypto')

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'

const ASSETS = {
  win32: { remote: 'yt-dlp.exe', local: 'yt-dlp.exe' },
  linux: { remote: 'yt-dlp_linux', local: 'yt-dlp' },
  darwin: { remote: 'yt-dlp_macos', local: 'yt-dlp' }
}

const args = process.argv.slice(2)
const platformArg = args.find((a) => a.startsWith('--platform='))?.split('=')[1]
const platform = platformArg ?? process.platform
const force = args.includes('--force')

const asset = ASSETS[platform]
if (!asset) {
  console.error(`[yt-dlp] Unsupported platform: ${platform}`)
  process.exit(1)
}

const binDir = path.join(__dirname, '..', 'bin')
const target = path.join(binDir, asset.local)

/** GET with redirect following (GitHub release assets redirect to a CDN). */
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'gconverter-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects > 10) return reject(new Error('Too many redirects'))
          return resolve(get(new URL(res.headers.location, url).href, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  if (!force && fs.existsSync(target)) {
    console.log(`[yt-dlp] Already present: ${path.relative(process.cwd(), target)}`)
    return
  }

  fs.mkdirSync(binDir, { recursive: true })

  console.log(`[yt-dlp] Downloading ${asset.remote}…`)
  const [binary, sums] = await Promise.all([
    get(RELEASE + asset.remote),
    get(RELEASE + 'SHA2-256SUMS')
  ])

  const expected = sums
    .toString('utf-8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset.remote)?.[0]
  const actual = crypto.createHash('sha256').update(binary).digest('hex')

  if (!expected || expected.toLowerCase() !== actual) {
    throw new Error(`Checksum mismatch for ${asset.remote} (expected ${expected}, got ${actual})`)
  }

  fs.writeFileSync(target, binary)
  if (platform !== 'win32') fs.chmodSync(target, 0o755)
  console.log(`[yt-dlp] Saved ${path.relative(process.cwd(), target)} (${(binary.length / 1e6).toFixed(1)} MB, sha256 ok)`)
}

main().catch((err) => {
  try {
    fs.rmSync(target, { force: true })
  } catch {
    /* nothing to clean */
  }
  console.error(`[yt-dlp] ${err.message}`)
  process.exit(1)
})
