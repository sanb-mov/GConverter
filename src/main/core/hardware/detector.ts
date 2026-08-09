/**
 * Hardware acceleration detection (spec §12, §13).
 *
 * Presence of an encoder in `ffmpeg -encoders` is NOT proof it works — a
 * build can advertise h264_nvenc on a machine with no NVIDIA GPU, or with a
 * driver too old to initialise. GConverter therefore *verifies* each
 * candidate by running a one-frame test encode to /dev/null before telling
 * the user it is available (spec §12: "No asumir que el hardware existe").
 */

import { execFile } from 'node:child_process'
import os from 'node:os'
import type {
  GpuInfo,
  HardwareCapabilities,
  HardwareEncoder,
  HardwareVendor
} from '@shared/models'
import { logger } from '../logging/logger'

const NULL_SINK = process.platform === 'win32' ? 'NUL' : '/dev/null'

interface Candidate {
  name: string
  vendor: HardwareVendor
  codec: string
  label: string
  /** Extra args this encoder needs to initialise during the probe. */
  probeArgs?: string[]
}

const CANDIDATES: Candidate[] = [
  { name: 'h264_nvenc', vendor: 'nvidia', codec: 'h264', label: 'NVIDIA NVENC H.264' },
  { name: 'hevc_nvenc', vendor: 'nvidia', codec: 'hevc', label: 'NVIDIA NVENC HEVC' },
  { name: 'av1_nvenc', vendor: 'nvidia', codec: 'av1', label: 'NVIDIA NVENC AV1' },
  { name: 'h264_amf', vendor: 'amd', codec: 'h264', label: 'AMD AMF H.264' },
  { name: 'hevc_amf', vendor: 'amd', codec: 'hevc', label: 'AMD AMF HEVC' },
  { name: 'av1_amf', vendor: 'amd', codec: 'av1', label: 'AMD AMF AV1' },
  { name: 'h264_qsv', vendor: 'intel', codec: 'h264', label: 'Intel Quick Sync H.264' },
  { name: 'hevc_qsv', vendor: 'intel', codec: 'hevc', label: 'Intel Quick Sync HEVC' },
  { name: 'av1_qsv', vendor: 'intel', codec: 'av1', label: 'Intel Quick Sync AV1' },
  {
    name: 'h264_videotoolbox',
    vendor: 'apple',
    codec: 'h264',
    label: 'Apple VideoToolbox H.264'
  },
  {
    name: 'hevc_videotoolbox',
    vendor: 'apple',
    codec: 'hevc',
    label: 'Apple VideoToolbox HEVC'
  }
]

/** Run a 1-frame synthetic encode; success means the encoder really works. */
function testEncoder(ffmpegPath: string, candidate: Candidate): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x240:d=0.1:r=10',
      '-frames:v',
      '1',
      '-c:v',
      candidate.name,
      ...(candidate.probeArgs ?? []),
      '-f',
      'null',
      NULL_SINK
    ]

    execFile(
      ffmpegPath,
      args,
      { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error) => resolve(!error)
    )
  })
}

/* --------------------------- GPU enumeration --------------------------- */

function exec(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      resolve(err ? '' : out)
    )
  })
}

function vendorFromName(name: string): HardwareVendor {
  const lower = name.toLowerCase()
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro')) {
    return 'nvidia'
  }
  if (lower.includes('amd') || lower.includes('radeon') || lower.includes('ati ')) return 'amd'
  if (lower.includes('intel') || lower.includes('arc') || lower.includes('iris')) return 'intel'
  if (lower.includes('apple')) return 'apple'
  return 'none'
}

async function detectGpusWindows(): Promise<GpuInfo[]> {
  // PowerShell CIM query — structured and does not need a shell.
  const out = await exec('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress'
  ])
  if (!out.trim()) return []
  try {
    const parsed = JSON.parse(out)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((g) => g?.Name)
      .map((g) => ({
        name: String(g.Name),
        vendor: vendorFromName(String(g.Name)),
        // AdapterRAM is a signed 32-bit field and wraps above 4 GB; ignore bad values.
        vram: typeof g.AdapterRAM === 'number' && g.AdapterRAM > 0 ? g.AdapterRAM : undefined,
        driver: g.DriverVersion ? String(g.DriverVersion) : undefined
      }))
  } catch {
    return []
  }
}

async function detectGpusLinux(): Promise<GpuInfo[]> {
  const out = await exec('lspci', ['-mm'])
  const gpus: GpuInfo[] = []
  for (const line of out.split('\n')) {
    if (!/VGA|3D controller|Display controller/i.test(line)) continue
    const parts = line.match(/"([^"]*)"/g)?.map((p) => p.replace(/"/g, '')) ?? []
    const name = [parts[2], parts[3]].filter(Boolean).join(' ').trim()
    if (name) gpus.push({ name, vendor: vendorFromName(name) })
  }
  return gpus
}

async function detectGpusMac(): Promise<GpuInfo[]> {
  const out = await exec('system_profiler', ['SPDisplaysDataType', '-json'], 15000)
  try {
    const parsed = JSON.parse(out)
    const displays = parsed?.SPDisplaysDataType ?? []
    return displays
      .filter((d: Record<string, unknown>) => d?._name)
      .map((d: Record<string, unknown>) => ({
        name: String(d._name),
        vendor: vendorFromName(String(d._name)),
        vram: undefined
      }))
  } catch {
    return [{ name: 'Apple GPU', vendor: 'apple' }]
  }
}

async function detectGpus(): Promise<GpuInfo[]> {
  try {
    switch (process.platform) {
      case 'win32':
        return await detectGpusWindows()
      case 'linux':
        return await detectGpusLinux()
      case 'darwin':
        return await detectGpusMac()
      default:
        return []
    }
  } catch (err) {
    logger.warn('hardware', 'GPU enumeration failed', { err: String(err) })
    return []
  }
}

/** NVIDIA reports true VRAM via nvidia-smi when the driver is installed. */
async function nvidiaVram(): Promise<number | undefined> {
  const out = await exec('nvidia-smi', [
    '--query-gpu=memory.total',
    '--format=csv,noheader,nounits'
  ])
  const mb = Number(out.trim().split('\n')[0])
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : undefined
}

/* ------------------------------ detection ------------------------------ */

let cached: HardwareCapabilities | null = null

export async function detectHardware(
  ffmpegPath: string,
  availableEncoders: string[],
  force = false
): Promise<HardwareCapabilities> {
  if (cached && !force) return cached

  const cpus = os.cpus()
  const gpus = await detectGpus()

  if (gpus.some((g) => g.vendor === 'nvidia')) {
    const vram = await nvidiaVram()
    if (vram) {
      const target = gpus.find((g) => g.vendor === 'nvidia')!
      target.vram = vram
    }
  }

  const encoderSet = new Set(availableEncoders)
  const present = CANDIDATES.filter((c) => encoderSet.has(c.name))

  // Only test encoders whose vendor matches an installed GPU — probing an
  // AMD encoder on an NVIDIA-only box just wastes several seconds.
  const gpuVendors = new Set(gpus.map((g) => g.vendor))
  if (process.platform === 'darwin') gpuVendors.add('apple')

  const encoders: HardwareEncoder[] = []
  for (const candidate of present) {
    const plausible = gpuVendors.has(candidate.vendor)
    let verified = false
    if (plausible) {
      verified = await testEncoder(ffmpegPath, candidate)
    }
    encoders.push({
      name: candidate.name,
      vendor: candidate.vendor,
      codec: candidate.codec,
      label: candidate.label,
      available: verified,
      verified: plausible
    })
  }

  const working = encoders.filter((e) => e.available)
  const preferredVendor: HardwareVendor =
    working.find((e) => e.vendor === 'nvidia')?.vendor ??
    working.find((e) => e.vendor === 'apple')?.vendor ??
    working.find((e) => e.vendor === 'intel')?.vendor ??
    working.find((e) => e.vendor === 'amd')?.vendor ??
    'none'

  const capabilities: HardwareCapabilities = {
    cpuModel: cpus[0]?.model?.trim() ?? 'Unknown CPU',
    cpuCores: physicalCoreEstimate(cpus.length),
    cpuThreads: cpus.length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    platform: process.platform,
    arch: process.arch,
    gpus,
    encoders,
    accelerationAvailable: working.length > 0,
    preferredVendor,
    detectedAt: Date.now()
  }

  cached = capabilities
  logger.info('hardware', 'Hardware detection complete', {
    cpu: capabilities.cpuModel,
    threads: capabilities.cpuThreads,
    gpus: gpus.map((g) => g.name),
    working: working.map((e) => e.name)
  })

  return capabilities
}

/** os.cpus() reports logical CPUs; most consumer parts are 2-way SMT. */
function physicalCoreEstimate(threads: number): number {
  return threads > 1 && threads % 2 === 0 ? threads / 2 : threads
}

export function getCachedHardware(): HardwareCapabilities | null {
  return cached
}

/** Refresh only the volatile fields (free memory) without re-probing. */
export function refreshMemory(): void {
  if (cached) cached.freeMemory = os.freemem()
}

/**
 * Choose the best encoder for a codec given the user's preference and what
 * actually works on this machine. Returns null when CPU encoding should be
 * used instead.
 */
export function pickHardwareEncoder(
  capabilities: HardwareCapabilities | null,
  codec: string,
  preference: 'auto' | 'cpu' | 'nvidia' | 'amd' | 'intel' | 'apple'
): HardwareEncoder | null {
  if (!capabilities || preference === 'cpu') return null

  const usable = capabilities.encoders.filter((e) => e.available && e.codec === codec)
  if (usable.length === 0) return null

  if (preference === 'auto') {
    const order: HardwareVendor[] = ['nvidia', 'apple', 'intel', 'amd']
    for (const vendor of order) {
      const match = usable.find((e) => e.vendor === vendor)
      if (match) return match
    }
    return usable[0]
  }

  return usable.find((e) => e.vendor === preference) ?? null
}
