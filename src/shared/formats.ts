/**
 * GConverter — Format, container and codec registry.
 *
 * This is the knowledge base the engine consults to decide whether a
 * conversion can be performed as a lossless remux (spec §50) or requires
 * re-encoding, and to populate the UI with only relevant options.
 *
 * Adding a codec or container here is enough for it to appear throughout
 * the app — no changes to the conversion core are required (spec §3).
 */

import type { QualityMode } from './models'

/* ------------------------------------------------------------------ */
/* Containers                                                          */
/* ------------------------------------------------------------------ */

export interface ContainerDef {
  id: string
  label: string
  extensions: string[]
  kind: 'video' | 'audio'
  /** ffmpeg muxer name when it differs from the extension. */
  muxer?: string
  /** Codecs that can be stored without re-encoding. '*' = anything. */
  videoCodecs: string[]
  audioCodecs: string[]
  subtitleCodecs: string[]
  supportsChapters: boolean
  supportsAttachments: boolean
  supportsFaststart: boolean
  /** Shown in the UI to explain what the container is good for. */
  description: string
}

export const CONTAINERS: ContainerDef[] = [
  {
    id: 'mp4',
    label: 'MP4',
    extensions: ['mp4', 'm4v'],
    kind: 'video',
    videoCodecs: ['h264', 'hevc', 'av1', 'mpeg4', 'mpeg2video', 'vp9', 'prores'],
    audioCodecs: ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'opus', 'flac'],
    subtitleCodecs: ['mov_text'],
    supportsChapters: true,
    supportsAttachments: false,
    supportsFaststart: true,
    description: 'Universal compatibility. Best for sharing and web playback.'
  },
  {
    id: 'mkv',
    label: 'MKV',
    extensions: ['mkv'],
    kind: 'video',
    muxer: 'matroska',
    videoCodecs: ['*'],
    audioCodecs: ['*'],
    subtitleCodecs: ['*'],
    supportsChapters: true,
    supportsAttachments: true,
    supportsFaststart: false,
    description: 'Holds virtually any codec, unlimited tracks, subtitles and fonts.'
  },
  {
    id: 'mov',
    label: 'MOV',
    extensions: ['mov'],
    kind: 'video',
    videoCodecs: ['h264', 'hevc', 'prores', 'dnxhd', 'mpeg4', 'mjpeg', 'av1'],
    audioCodecs: ['aac', 'alac', 'pcm_s16le', 'pcm_s24le', 'mp3', 'ac3'],
    subtitleCodecs: ['mov_text'],
    supportsChapters: true,
    supportsAttachments: false,
    supportsFaststart: true,
    description: 'Apple QuickTime. Standard for editing workflows and ProRes.'
  },
  {
    id: 'webm',
    label: 'WebM',
    extensions: ['webm'],
    kind: 'video',
    videoCodecs: ['vp8', 'vp9', 'av1'],
    audioCodecs: ['opus', 'vorbis'],
    subtitleCodecs: ['webvtt'],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Open, royalty-free format designed for the web.'
  },
  {
    id: 'avi',
    label: 'AVI',
    extensions: ['avi'],
    kind: 'video',
    videoCodecs: ['mpeg4', 'h264', 'mjpeg', 'huffyuv', 'ffv1', 'rawvideo'],
    audioCodecs: ['mp3', 'ac3', 'pcm_s16le'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Legacy Microsoft container. Wide but dated hardware support.'
  },
  {
    id: 'mpegts',
    label: 'TS',
    extensions: ['ts', 'm2ts', 'mts'],
    kind: 'video',
    muxer: 'mpegts',
    videoCodecs: ['h264', 'hevc', 'mpeg2video', 'mpeg4'],
    audioCodecs: ['aac', 'mp3', 'ac3', 'eac3', 'dts'],
    subtitleCodecs: ['dvb_subtitle'],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Broadcast transport stream. Robust for streaming and capture.'
  },
  {
    id: 'mpeg',
    label: 'MPEG',
    extensions: ['mpg', 'mpeg'],
    kind: 'video',
    muxer: 'mpeg',
    videoCodecs: ['mpeg1video', 'mpeg2video'],
    audioCodecs: ['mp2', 'mp3', 'ac3'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Classic MPEG program stream, for DVD-era compatibility.'
  },
  {
    id: 'flv',
    label: 'FLV',
    extensions: ['flv'],
    kind: 'video',
    videoCodecs: ['h264', 'flv1', 'vp6f'],
    audioCodecs: ['aac', 'mp3'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Flash video. Still used by some legacy streaming pipelines.'
  },
  {
    id: 'wmv',
    label: 'WMV',
    extensions: ['wmv'],
    kind: 'video',
    muxer: 'asf',
    videoCodecs: ['wmv2', 'wmv3', 'msmpeg4v3', 'vc1'],
    audioCodecs: ['wmav2', 'mp3'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Windows Media. Requires WMV/WMA codecs.'
  },
  {
    id: 'ogv',
    label: 'OGV',
    extensions: ['ogv'],
    kind: 'video',
    muxer: 'ogg',
    videoCodecs: ['theora', 'vp8'],
    audioCodecs: ['vorbis', 'opus', 'flac'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Ogg video container using Theora.'
  },
  {
    id: '3gp',
    label: '3GP',
    extensions: ['3gp', '3g2'],
    kind: 'video',
    videoCodecs: ['h264', 'mpeg4', 'h263'],
    audioCodecs: ['aac', 'amr_nb'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: true,
    description: 'Mobile container for low-bandwidth 3G devices.'
  },
  {
    id: 'gif',
    label: 'GIF',
    extensions: ['gif'],
    kind: 'video',
    videoCodecs: ['gif'],
    audioCodecs: [],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Animated image. No audio, limited to 256 colours per frame.'
  },

  /* ---------------------------- audio ---------------------------- */
  {
    id: 'mp3',
    label: 'MP3',
    extensions: ['mp3'],
    kind: 'audio',
    videoCodecs: ['mjpeg', 'png'],
    audioCodecs: ['mp3'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'The universal audio format. Plays on everything.'
  },
  {
    id: 'wav',
    label: 'WAV',
    extensions: ['wav'],
    kind: 'audio',
    videoCodecs: [],
    audioCodecs: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Uncompressed PCM. Lossless but large.'
  },
  {
    id: 'flac',
    label: 'FLAC',
    extensions: ['flac'],
    kind: 'audio',
    videoCodecs: ['mjpeg', 'png'],
    audioCodecs: ['flac'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Free lossless audio. Typically ~50% of WAV size.'
  },
  {
    id: 'm4a',
    label: 'M4A',
    extensions: ['m4a'],
    kind: 'audio',
    muxer: 'ipod',
    videoCodecs: ['mjpeg', 'png'],
    audioCodecs: ['aac', 'alac'],
    subtitleCodecs: [],
    supportsChapters: true,
    supportsAttachments: false,
    supportsFaststart: true,
    description: 'MPEG-4 audio. AAC or Apple Lossless (ALAC).'
  },
  {
    id: 'aac',
    label: 'AAC',
    extensions: ['aac'],
    kind: 'audio',
    muxer: 'adts',
    videoCodecs: [],
    audioCodecs: ['aac'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Raw AAC stream in an ADTS wrapper.'
  },
  {
    id: 'ogg',
    label: 'OGG',
    extensions: ['ogg', 'oga'],
    kind: 'audio',
    videoCodecs: [],
    audioCodecs: ['vorbis', 'opus', 'flac'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Open container, usually paired with Vorbis.'
  },
  {
    id: 'opus',
    label: 'OPUS',
    extensions: ['opus'],
    kind: 'audio',
    muxer: 'opus',
    videoCodecs: [],
    audioCodecs: ['opus'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Best-in-class quality per bit. Ideal for voice and streaming.'
  },
  {
    id: 'aiff',
    label: 'AIFF',
    extensions: ['aiff', 'aif'],
    kind: 'audio',
    videoCodecs: [],
    audioCodecs: ['pcm_s16be', 'pcm_s24be', 'pcm_s16le'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Apple uncompressed PCM, the WAV equivalent on macOS.'
  },
  {
    id: 'wma',
    label: 'WMA',
    extensions: ['wma'],
    kind: 'audio',
    muxer: 'asf',
    videoCodecs: [],
    audioCodecs: ['wmav2'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Windows Media Audio.'
  },
  {
    id: 'ac3',
    label: 'AC3',
    extensions: ['ac3'],
    kind: 'audio',
    videoCodecs: [],
    audioCodecs: ['ac3'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'Dolby Digital surround stream.'
  },
  {
    id: 'dts',
    label: 'DTS',
    extensions: ['dts'],
    kind: 'audio',
    videoCodecs: [],
    audioCodecs: ['dts'],
    subtitleCodecs: [],
    supportsChapters: false,
    supportsAttachments: false,
    supportsFaststart: false,
    description: 'DTS Coherent Acoustics surround stream.'
  }
]

export const CONTAINER_BY_ID = new Map(CONTAINERS.map((c) => [c.id, c]))

/** Resolve a file extension (no dot, any case) to its container definition. */
export function containerForExtension(ext: string): ContainerDef | undefined {
  const clean = ext.replace(/^\./, '').toLowerCase()
  return CONTAINERS.find((c) => c.extensions.includes(clean))
}

/* ------------------------------------------------------------------ */
/* Codecs                                                              */
/* ------------------------------------------------------------------ */

export interface EncoderDef {
  /** ffmpeg encoder name. */
  name: string
  label: string
  vendor: 'cpu' | 'nvidia' | 'amd' | 'intel' | 'apple'
  /** Presets accepted by -preset for this encoder. */
  presets?: string[]
  /** Quality parameter flag: crf, cq, qp or global_quality. */
  qualityFlag?: 'crf' | 'cq' | 'qp' | 'global_quality' | 'qscale'
  qualityRange?: [number, number]
  defaultQuality?: number
  profiles?: string[]
  pixelFormats?: string[]
  supportsTenBit?: boolean
}

export interface CodecDef {
  /** Canonical codec id as ffprobe reports it. */
  id: string
  label: string
  kind: 'video' | 'audio' | 'subtitle'
  /** True when the codec itself preserves every sample exactly. */
  lossless: boolean
  /** Some codecs (FLAC, FFV1) are always lossless; others can be. */
  losslessCapable: boolean
  encoders: EncoderDef[]
  description: string
  /** Rough relative efficiency, used for size estimation heuristics. */
  efficiency?: number
}

const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
  'placebo'
]

const NVENC_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']

export const VIDEO_CODECS: CodecDef[] = [
  {
    id: 'h264',
    label: 'H.264 / AVC',
    kind: 'video',
    lossless: false,
    losslessCapable: true,
    efficiency: 1,
    description: 'The most compatible video codec. Plays everywhere.',
    encoders: [
      {
        name: 'libx264',
        label: 'x264 (CPU)',
        vendor: 'cpu',
        presets: X264_PRESETS,
        qualityFlag: 'crf',
        qualityRange: [0, 51],
        defaultQuality: 18,
        profiles: ['baseline', 'main', 'high', 'high10', 'high422', 'high444'],
        pixelFormats: ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le'],
        supportsTenBit: true
      },
      {
        name: 'h264_nvenc',
        label: 'NVIDIA NVENC',
        vendor: 'nvidia',
        presets: NVENC_PRESETS,
        qualityFlag: 'cq',
        qualityRange: [0, 51],
        defaultQuality: 19,
        profiles: ['baseline', 'main', 'high'],
        pixelFormats: ['yuv420p', 'nv12']
      },
      {
        name: 'h264_amf',
        label: 'AMD AMF',
        vendor: 'amd',
        presets: ['speed', 'balanced', 'quality'],
        qualityFlag: 'qp',
        qualityRange: [0, 51],
        defaultQuality: 20,
        profiles: ['main', 'high'],
        pixelFormats: ['yuv420p', 'nv12']
      },
      {
        name: 'h264_qsv',
        label: 'Intel Quick Sync',
        vendor: 'intel',
        presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
        qualityFlag: 'global_quality',
        qualityRange: [1, 51],
        defaultQuality: 20,
        profiles: ['baseline', 'main', 'high'],
        pixelFormats: ['nv12', 'yuv420p']
      },
      {
        name: 'h264_videotoolbox',
        label: 'Apple VideoToolbox',
        vendor: 'apple',
        qualityFlag: 'qp',
        qualityRange: [1, 100],
        defaultQuality: 55,
        profiles: ['baseline', 'main', 'high'],
        pixelFormats: ['yuv420p', 'nv12']
      }
    ]
  },
  {
    id: 'hevc',
    label: 'H.265 / HEVC',
    kind: 'video',
    lossless: false,
    losslessCapable: true,
    efficiency: 0.6,
    description: 'About 40–50% smaller than H.264 at the same quality.',
    encoders: [
      {
        name: 'libx265',
        label: 'x265 (CPU)',
        vendor: 'cpu',
        presets: X264_PRESETS,
        qualityFlag: 'crf',
        qualityRange: [0, 51],
        defaultQuality: 20,
        profiles: ['main', 'main10', 'main12', 'main444-8'],
        pixelFormats: ['yuv420p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le'],
        supportsTenBit: true
      },
      {
        name: 'hevc_nvenc',
        label: 'NVIDIA NVENC',
        vendor: 'nvidia',
        presets: NVENC_PRESETS,
        qualityFlag: 'cq',
        qualityRange: [0, 51],
        defaultQuality: 21,
        profiles: ['main', 'main10', 'rext'],
        pixelFormats: ['yuv420p', 'p010le', 'nv12'],
        supportsTenBit: true
      },
      {
        name: 'hevc_amf',
        label: 'AMD AMF',
        vendor: 'amd',
        presets: ['speed', 'balanced', 'quality'],
        qualityFlag: 'qp',
        qualityRange: [0, 51],
        defaultQuality: 22,
        pixelFormats: ['yuv420p', 'nv12', 'p010le']
      },
      {
        name: 'hevc_qsv',
        label: 'Intel Quick Sync',
        vendor: 'intel',
        presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
        qualityFlag: 'global_quality',
        qualityRange: [1, 51],
        defaultQuality: 22,
        pixelFormats: ['nv12', 'p010le'],
        supportsTenBit: true
      },
      {
        name: 'hevc_videotoolbox',
        label: 'Apple VideoToolbox',
        vendor: 'apple',
        qualityFlag: 'qp',
        qualityRange: [1, 100],
        defaultQuality: 55,
        pixelFormats: ['yuv420p', 'p010le']
      }
    ]
  },
  {
    id: 'av1',
    label: 'AV1',
    kind: 'video',
    lossless: false,
    losslessCapable: true,
    efficiency: 0.45,
    description: 'Royalty-free and highly efficient. Slower to encode on CPU.',
    encoders: [
      {
        name: 'libsvtav1',
        label: 'SVT-AV1 (CPU)',
        vendor: 'cpu',
        presets: ['0', '2', '4', '6', '8', '10', '12'],
        qualityFlag: 'crf',
        qualityRange: [0, 63],
        defaultQuality: 28,
        pixelFormats: ['yuv420p', 'yuv420p10le'],
        supportsTenBit: true
      },
      {
        name: 'libaom-av1',
        label: 'libaom (CPU, slow)',
        vendor: 'cpu',
        qualityFlag: 'crf',
        qualityRange: [0, 63],
        defaultQuality: 30,
        pixelFormats: ['yuv420p', 'yuv420p10le'],
        supportsTenBit: true
      },
      {
        name: 'av1_nvenc',
        label: 'NVIDIA NVENC (RTX 40+)',
        vendor: 'nvidia',
        presets: NVENC_PRESETS,
        qualityFlag: 'cq',
        qualityRange: [0, 63],
        defaultQuality: 28,
        pixelFormats: ['yuv420p', 'p010le']
      },
      {
        name: 'av1_qsv',
        label: 'Intel Quick Sync (Arc)',
        vendor: 'intel',
        qualityFlag: 'global_quality',
        qualityRange: [1, 63],
        defaultQuality: 28,
        pixelFormats: ['nv12', 'p010le']
      },
      {
        name: 'av1_amf',
        label: 'AMD AMF (RDNA3+)',
        vendor: 'amd',
        qualityFlag: 'qp',
        qualityRange: [0, 63],
        defaultQuality: 28,
        pixelFormats: ['nv12', 'p010le']
      }
    ]
  },
  {
    id: 'vp9',
    label: 'VP9',
    kind: 'video',
    lossless: false,
    losslessCapable: true,
    efficiency: 0.65,
    description: 'Google’s open codec. Native in WebM and browsers.',
    encoders: [
      {
        name: 'libvpx-vp9',
        label: 'libvpx-vp9 (CPU)',
        vendor: 'cpu',
        qualityFlag: 'crf',
        qualityRange: [0, 63],
        defaultQuality: 28,
        pixelFormats: ['yuv420p', 'yuv420p10le'],
        supportsTenBit: true
      },
      {
        name: 'vp9_qsv',
        label: 'Intel Quick Sync',
        vendor: 'intel',
        qualityFlag: 'global_quality',
        qualityRange: [1, 63],
        defaultQuality: 28,
        pixelFormats: ['nv12']
      }
    ]
  },
  {
    id: 'vp8',
    label: 'VP8',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 1.1,
    description: 'Predecessor to VP9. Legacy WebM support.',
    encoders: [
      {
        name: 'libvpx',
        label: 'libvpx (CPU)',
        vendor: 'cpu',
        qualityFlag: 'crf',
        qualityRange: [0, 63],
        defaultQuality: 10,
        pixelFormats: ['yuv420p']
      }
    ]
  },
  {
    id: 'mpeg2video',
    label: 'MPEG-2',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 2.5,
    description: 'DVD and broadcast standard.',
    encoders: [
      {
        name: 'mpeg2video',
        label: 'MPEG-2 (CPU)',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [1, 31],
        defaultQuality: 2,
        pixelFormats: ['yuv420p', 'yuv422p']
      }
    ]
  },
  {
    id: 'mpeg4',
    label: 'MPEG-4 Part 2',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 1.8,
    description: 'DivX/Xvid-era codec for very old devices.',
    encoders: [
      {
        name: 'mpeg4',
        label: 'MPEG-4 (CPU)',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [1, 31],
        defaultQuality: 3,
        pixelFormats: ['yuv420p']
      }
    ]
  },
  {
    id: 'prores',
    label: 'ProRes',
    kind: 'video',
    lossless: false,
    losslessCapable: true,
    efficiency: 12,
    description: 'Apple intermediate codec for editing. Very large files.',
    encoders: [
      {
        name: 'prores_ks',
        label: 'ProRes (Kostya)',
        vendor: 'cpu',
        profiles: ['proxy', 'lt', 'standard', 'hq', '4444', '4444xq'],
        qualityFlag: 'qscale',
        qualityRange: [1, 32],
        defaultQuality: 9,
        pixelFormats: ['yuv422p10le', 'yuv444p10le'],
        supportsTenBit: true
      }
    ]
  },
  {
    id: 'dnxhd',
    label: 'DNxHD / DNxHR',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 12,
    description: 'Avid intermediate codec for professional editing.',
    encoders: [
      {
        name: 'dnxhd',
        label: 'DNxHD / DNxHR',
        vendor: 'cpu',
        profiles: ['dnxhr_lb', 'dnxhr_sq', 'dnxhr_hq', 'dnxhr_hqx', 'dnxhr_444'],
        pixelFormats: ['yuv422p', 'yuv422p10le', 'yuv444p10le'],
        supportsTenBit: true
      }
    ]
  },
  {
    id: 'ffv1',
    label: 'FFV1',
    kind: 'video',
    lossless: true,
    losslessCapable: true,
    efficiency: 8,
    description: 'Mathematically lossless. Used for archival and preservation.',
    encoders: [
      {
        name: 'ffv1',
        label: 'FFV1 (CPU)',
        vendor: 'cpu',
        pixelFormats: ['yuv420p', 'yuv422p10le', 'yuv444p10le', 'rgb24'],
        supportsTenBit: true
      }
    ]
  },
  {
    id: 'theora',
    label: 'Theora',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 2,
    description: 'Legacy open codec used inside Ogg.',
    encoders: [
      {
        name: 'libtheora',
        label: 'libtheora (CPU)',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [0, 10],
        defaultQuality: 8,
        pixelFormats: ['yuv420p']
      }
    ]
  },
  {
    id: 'gif',
    label: 'GIF',
    kind: 'video',
    lossless: false,
    losslessCapable: false,
    efficiency: 20,
    description: 'Animated GIF with an optimised palette.',
    encoders: [{ name: 'gif', label: 'GIF', vendor: 'cpu', pixelFormats: ['pal8'] }]
  }
]

export const AUDIO_CODECS: CodecDef[] = [
  {
    id: 'aac',
    label: 'AAC',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'The standard for MP4 and streaming. Better than MP3 per bit.',
    encoders: [
      {
        name: 'aac',
        label: 'AAC (native)',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [0.1, 2],
        defaultQuality: 1
      },
      { name: 'libfdk_aac', label: 'AAC (Fraunhofer)', vendor: 'cpu' }
    ]
  },
  {
    id: 'mp3',
    label: 'MP3',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Universally compatible lossy audio.',
    encoders: [
      {
        name: 'libmp3lame',
        label: 'LAME MP3',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [0, 9],
        defaultQuality: 0
      }
    ]
  },
  {
    id: 'opus',
    label: 'Opus',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Best quality at low bitrates. Excellent for voice.',
    encoders: [{ name: 'libopus', label: 'libopus', vendor: 'cpu' }]
  },
  {
    id: 'vorbis',
    label: 'Vorbis',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Open lossy codec used in Ogg and WebM.',
    encoders: [
      {
        name: 'libvorbis',
        label: 'libvorbis',
        vendor: 'cpu',
        qualityFlag: 'qscale',
        qualityRange: [-1, 10],
        defaultQuality: 6
      }
    ]
  },
  {
    id: 'flac',
    label: 'FLAC',
    kind: 'audio',
    lossless: true,
    losslessCapable: true,
    description: 'Lossless compression. Bit-identical to the source PCM.',
    encoders: [{ name: 'flac', label: 'FLAC', vendor: 'cpu' }]
  },
  {
    id: 'alac',
    label: 'ALAC',
    kind: 'audio',
    lossless: true,
    losslessCapable: true,
    description: 'Apple Lossless. Bit-identical, native on Apple devices.',
    encoders: [{ name: 'alac', label: 'ALAC', vendor: 'cpu' }]
  },
  {
    id: 'pcm_s16le',
    label: 'PCM 16-bit',
    kind: 'audio',
    lossless: true,
    losslessCapable: true,
    description: 'Uncompressed CD-quality audio.',
    encoders: [{ name: 'pcm_s16le', label: 'PCM 16-bit LE', vendor: 'cpu' }]
  },
  {
    id: 'pcm_s24le',
    label: 'PCM 24-bit',
    kind: 'audio',
    lossless: true,
    losslessCapable: true,
    description: 'Uncompressed studio-quality audio.',
    encoders: [{ name: 'pcm_s24le', label: 'PCM 24-bit LE', vendor: 'cpu' }]
  },
  {
    id: 'pcm_s32le',
    label: 'PCM 32-bit',
    kind: 'audio',
    lossless: true,
    losslessCapable: true,
    description: 'Uncompressed 32-bit audio.',
    encoders: [{ name: 'pcm_s32le', label: 'PCM 32-bit LE', vendor: 'cpu' }]
  },
  {
    id: 'ac3',
    label: 'AC-3',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Dolby Digital. Standard surround for DVD and broadcast.',
    encoders: [{ name: 'ac3', label: 'AC-3', vendor: 'cpu' }]
  },
  {
    id: 'eac3',
    label: 'E-AC-3',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Dolby Digital Plus. More efficient surround.',
    encoders: [{ name: 'eac3', label: 'E-AC-3', vendor: 'cpu' }]
  },
  {
    id: 'dts',
    label: 'DTS',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'DTS surround. Encoder is experimental in FFmpeg.',
    encoders: [{ name: 'dca', label: 'DTS (experimental)', vendor: 'cpu' }]
  },
  {
    id: 'wmav2',
    label: 'WMA',
    kind: 'audio',
    lossless: false,
    losslessCapable: false,
    description: 'Windows Media Audio v2.',
    encoders: [{ name: 'wmav2', label: 'WMA v2', vendor: 'cpu' }]
  }
]

export const ALL_CODECS = [...VIDEO_CODECS, ...AUDIO_CODECS]
export const CODEC_BY_ID = new Map(ALL_CODECS.map((c) => [c.id, c]))

/** ffprobe sometimes reports aliases; normalise them to our canonical ids. */
const CODEC_ALIASES: Record<string, string> = {
  h265: 'hevc',
  x264: 'h264',
  x265: 'hevc',
  avc1: 'h264',
  hev1: 'hevc',
  hvc1: 'hevc',
  'mpeg-4': 'mpeg4',
  msmpeg4v3: 'mpeg4',
  vp08: 'vp8',
  vp09: 'vp9',
  av01: 'av1',
  mp4a: 'aac',
  'mp3float': 'mp3',
  dca: 'dts',
  'pcm_f32le': 'pcm_s32le'
}

export function normalizeCodec(codec: string | undefined): string {
  if (!codec) return ''
  const lower = codec.toLowerCase()
  return CODEC_ALIASES[lower] ?? lower
}

export function getCodec(id: string): CodecDef | undefined {
  return CODEC_BY_ID.get(normalizeCodec(id))
}

/** True when `container` can hold `codec` without re-encoding (spec §50). */
export function containerAcceptsCodec(
  container: ContainerDef,
  codec: string,
  kind: 'video' | 'audio' | 'subtitle'
): boolean {
  const normalized = normalizeCodec(codec)
  const list =
    kind === 'video'
      ? container.videoCodecs
      : kind === 'audio'
        ? container.audioCodecs
        : container.subtitleCodecs
  return list.includes('*') || list.includes(normalized)
}

/* ------------------------------------------------------------------ */
/* Quality mapping                                                     */
/* ------------------------------------------------------------------ */

/**
 * Maps an abstract quality mode onto a concrete quality value for a given
 * encoder. Values are deliberately conservative — GConverter never trades
 * quality for size unless the user asks (spec §49).
 */
export function qualityToValue(mode: QualityMode, encoder: EncoderDef): number {
  const [min, max] = encoder.qualityRange ?? [0, 51]
  const base = encoder.defaultQuality ?? Math.round((min + max) / 3)

  // Higher values mean lower quality for CRF/CQ/QP scales; qscale for
  // audio/mpeg encoders follows the same "lower is better" convention here.
  const offsets: Record<QualityMode, number> = {
    lossless: min - base,
    maximum: -4,
    'very-high': -2,
    high: 0,
    balanced: 3,
    custom: 0
  }
  const value = base + offsets[mode]
  return Math.min(max, Math.max(min, value))
}

/** Default x264/x265-style preset per quality mode. */
export function qualityToPreset(mode: QualityMode, encoder: EncoderDef): string | undefined {
  if (!encoder.presets?.length) return undefined
  const map: Record<QualityMode, string> = {
    lossless: 'veryslow',
    maximum: 'slow',
    'very-high': 'slow',
    high: 'medium',
    balanced: 'medium',
    custom: 'medium'
  }
  const wanted = map[mode]
  if (encoder.presets.includes(wanted)) return wanted
  // Hardware encoders use p1..p7 (p7 = best quality).
  if (encoder.presets[0]?.startsWith('p')) {
    const hw: Record<QualityMode, string> = {
      lossless: 'p7',
      maximum: 'p7',
      'very-high': 'p6',
      high: 'p5',
      balanced: 'p4',
      custom: 'p5'
    }
    return hw[mode]
  }
  if (encoder.presets.includes('quality')) {
    return mode === 'balanced' ? 'balanced' : 'quality'
  }
  return encoder.presets[Math.floor(encoder.presets.length / 2)]
}

/** Reasonable audio bitrate (kbps) per quality mode and channel count. */
export function qualityToAudioBitrate(mode: QualityMode, channels = 2): number {
  const perChannel: Record<QualityMode, number> = {
    lossless: 160,
    maximum: 160,
    'very-high': 128,
    high: 96,
    balanced: 80,
    custom: 96
  }
  return Math.round(perChannel[mode] * Math.max(1, channels))
}

/* ------------------------------------------------------------------ */
/* Extensions accepted by the app                                      */
/* ------------------------------------------------------------------ */

export const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts',
  'flv', 'wmv', 'ogv', '3gp', '3g2', 'vob', 'divx', 'rm', 'rmvb', 'asf', 'f4v',
  'mxf', 'y4m', 'gif'
]

export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'aiff', 'aif',
  'wma', 'ac3', 'dts', 'ape', 'alac', 'mka', 'amr', 'au', 'caf', 'mp2', 'wv'
]

export const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt', 'sub', 'sbv']

export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]

export function isMediaFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return MEDIA_EXTENSIONS.includes(ext)
}

export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.includes(ext.replace(/^\./, '').toLowerCase())
}
