/**
 * Renders build/icon.svg into the raster icons electron-builder needs.
 *
 * Rasterisation happens on a <canvas> in the renderer rather than through
 * capturePage, so true alpha is preserved and no compositor is required.
 * No native image libraries and no downloads.
 *
 *   npx electron build/make-icons.cjs
 *
 * (CommonJS on purpose: with an ESM entry, a top-level `await
 * app.whenReady()` deadlocks, because Electron only emits `ready` once the
 * main module has finished evaluating.)
 */

const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const here = __dirname
const svg = readFileSync(path.join(here, 'icon.svg'), 'utf-8')
const svgDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf-8').toString('base64')

/** Sizes embedded in the Windows .ico. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Minimal ICO container holding PNG-compressed frames. */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  const entries = []
  let offset = 6 + frames.length * 16

  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 encodes 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette size
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)])
}

app.whenReady().then(async () => {
  // Chromium refuses top-level navigation to data: URLs, so use a real file.
  const scratch = path.join(os.tmpdir(), `gconverter-icons-${process.pid}.html`)
  writeFileSync(scratch, '<!doctype html><html><body style="margin:0"></body></html>', 'utf-8')

  const win = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  const renderAt = async (size) => {
    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = ${size}
          canvas.height = ${size}
          const ctx = canvas.getContext('2d')
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.clearRect(0, 0, ${size}, ${size})
          ctx.drawImage(img, 0, 0, ${size}, ${size})
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('SVG failed to decode'))
        img.src = ${JSON.stringify(svgDataUrl)}
      })
    `)
    return Buffer.from(dataUrl.split(',')[1], 'base64')
  }

  let code = 0
  try {
    await win.loadFile(scratch)
    mkdirSync(here, { recursive: true })

    const master = await renderAt(1024)
    writeFileSync(path.join(here, 'icon.png'), master)
    console.log(`wrote build/icon.png (1024x1024, ${master.length} bytes)`)

    writeFileSync(path.join(here, 'icon-512.png'), await renderAt(512))
    console.log('wrote build/icon-512.png')

    const frames = []
    for (const size of ICO_SIZES) frames.push({ size, data: await renderAt(size) })

    const ico = buildIco(frames)
    writeFileSync(path.join(here, 'icon.ico'), ico)
    console.log(`wrote build/icon.ico (${ICO_SIZES.join(', ')}, ${ico.length} bytes)`)
  } catch (err) {
    console.error('Icon generation failed:', err)
    code = 1
  } finally {
    rmSync(scratch, { force: true })
    app.exit(code)
  }
})
