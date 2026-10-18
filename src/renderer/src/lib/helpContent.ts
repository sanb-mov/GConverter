/**
 * Help content (in-app manual).
 *
 * Kept as structured data rather than flat i18n keys because each article is
 * long-form prose with sub-entries; a dictionary of 300 sentence fragments
 * would be unmaintainable and impossible to translate coherently.
 */

import type { LanguageCode } from '@shared/models'

export interface HelpOption {
  /** The control's label, exactly as it appears in the interface. */
  name: string
  /** What it does and when to change it. */
  text: string
}

export interface HelpArticle {
  id: string
  /** Matches the sidebar icon name so the help mirrors the navigation. */
  icon: string
  title: string
  /** One line: what this part of the app is for. */
  summary: string
  /** Step-by-step usage, when the section has a workflow. */
  steps?: string[]
  /** Every control in the section, explained. */
  options?: HelpOption[]
  /** Things worth knowing that are not obvious from the UI. */
  notes?: string[]
}

/* ------------------------------------------------------------------ */
/* English                                                             */
/* ------------------------------------------------------------------ */

const EN: HelpArticle[] = [
  {
    id: 'concepts',
    icon: 'lightbulb',
    title: 'Core concepts',
    summary:
      'Two ideas explain almost everything GConverter does: containers versus codecs, and remuxing versus re-encoding.',
    options: [
      {
        name: 'Container (MP4, MKV, MOV…)',
        text: 'The box. It decides which codecs fit inside, whether subtitles and chapters can be stored, and how well the file plays on different devices. Changing the container alone does not touch the picture or the sound.'
      },
      {
        name: 'Codec (H.264, HEVC, AAC, FLAC…)',
        text: 'The compression used for the actual picture or sound. Changing the codec always means decoding and re-encoding, which is where quality can be lost.'
      },
      {
        name: 'Remux (lossless)',
        text: 'Moving the existing streams into a different container without touching them. The result is byte-identical and finishes almost instantly. GConverter does this automatically whenever the target container accepts the source codecs.'
      },
      {
        name: 'Re-encode',
        text: 'Decoding and compressing again with a different codec or different settings. Necessary when the container will not accept the codec, or when you change resolution, frame rate, or burn in subtitles.'
      },
      {
        name: 'Lossless codec',
        text: 'FFV1, FLAC, ALAC and PCM re-compress without discarding anything: decoded output is identical to the source. GConverter labels these as lossless even though re-encoding happened.'
      }
    ],
    notes: [
      'Converting a lossy file (MP3, H.264) to a lossless format does not restore quality. It only makes the file bigger. GConverter warns you when you try.',
      'GConverter never uses "lossless" loosely. The banner above the output settings always states exactly which of these cases applies.'
    ]
  },
  {
    id: 'home',
    icon: 'home',
    title: 'Home',
    summary: 'The dashboard: a place to drop files and a summary of what you have converted.',
    steps: [
      'Drag files or folders onto the window — anywhere, not just the drop area.',
      'Or use "Add files" to pick individual files, or "Add folder" to pull in every media file inside a directory, including subfolders.',
      'GConverter analyses each file with FFprobe and moves you to the Convert page.'
    ],
    options: [
      { name: 'Conversions', text: 'How many conversions have completed successfully, all time.' },
      {
        name: 'Storage saved',
        text: 'Total space reclaimed across completed jobs. Conversions that made a file larger are not counted as negative savings.'
      },
      {
        name: 'Hardware encoding',
        text: 'Whether a GPU encoder was found and verified on this machine. See the Settings → System section for the details.'
      },
      { name: 'System', text: 'CPU threads and installed memory available to the encoder.' },
      {
        name: 'Recent conversions',
        text: 'The last five jobs, with their size change. Click "View all" for the full history.'
      }
    ]
  },
  {
    id: 'convert',
    icon: 'repeat',
    title: 'Convert',
    summary:
      'Where you choose what the output should be. The left side describes the source; the right side is your file list and presets.',
    steps: [
      'Select a file in the Files list on the right.',
      'Read the coloured banner at the top — it tells you whether the conversion will be lossless before you commit.',
      'Choose a Format. Formats marked "lossless available" can hold your file without re-encoding.',
      'Adjust anything else you need, or apply a preset.',
      'Press Convert for the selected file, or "Convert all" to queue every file with its own settings.'
    ],
    options: [
      {
        name: 'Format',
        text: 'The output container. Changing it re-derives sensible codec choices for that container automatically. MKV accepts virtually anything; MP4 is the most compatible for sharing.'
      },
      {
        name: 'Quality',
        text: 'A quality tier that maps to a concrete CRF value for whichever encoder is selected. "Original / Lossless" copies or uses a lossless codec. It has no effect when every stream is being copied.'
      },
      {
        name: 'Video codec',
        text: '"Copy" means no re-encoding at all. "None" removes video entirely. Only codecs the chosen container can hold, and that your FFmpeg build can actually encode, are listed.'
      },
      {
        name: 'Audio codec',
        text: 'Same rules as video. Choosing "None" produces a silent file — useful for stripping audio from a clip.'
      },
      {
        name: 'Resolution',
        text: 'Leave at Original unless you specifically want a smaller file. Only resolutions equal to or smaller than the source are offered — GConverter never upscales. Changing this forces a re-encode.'
      },
      {
        name: 'Frame rate',
        text: 'Leave at Original. Only rates at or below the source are offered. Lowering it forces a re-encode and makes motion less smooth.'
      },
      {
        name: 'Subtitles',
        text: '"Keep as tracks" keeps them selectable in your player. "Burn into video" paints them permanently onto the picture and forces a re-encode — use it only when the target player cannot show subtitle tracks.'
      },
      {
        name: 'Metadata',
        text: 'Keep, strip everything, or edit title/artist/album and similar fields by hand.'
      },
      {
        name: 'Quick convert',
        text: 'Pick only a target format and GConverter derives codecs, quality, bit depth and hardware from the source. This is the fastest route for the common case.'
      },
      {
        name: 'Preview file',
        text: 'Plays the source in a built-in player. Some formats (HEVC, ProRes, many MKVs) cannot be previewed because the browser engine lacks the decoder — this never affects the conversion itself.'
      }
    ],
    notes: [
      'The "Estimated result" panel shows a size range, not a single number, because CRF output size genuinely depends on the content.',
      'The "Stream plan" lists every track and states whether it will be copied, re-encoded or dropped, and why.'
    ]
  },
  {
    id: 'advanced',
    icon: 'sliders',
    title: 'Advanced options',
    summary:
      'The three collapsible panels at the bottom of the Output card. Ignore them entirely unless you know you need them — the defaults are good.',
    options: [
      {
        name: 'Encoder',
        text: 'Which chip does the work. "Auto" prefers a verified GPU encoder. CPU (x264/x265) is slower but usually gives slightly better quality per megabyte. GPU is dramatically faster and ideal for long files.'
      },
      {
        name: 'Rate control',
        text: 'CRF targets a constant visual quality and lets the bitrate float — best for files you keep. Average bitrate targets a file size. Constrained bitrate caps the peak, which streaming platforms require.'
      },
      {
        name: 'CRF / CQ / QP',
        text: 'The quality dial. Lower is better and bigger. For H.264, 18 is visually transparent, 23 is a good default, 28 is visibly soft. HEVC and AV1 use different scales for the same result.'
      },
      {
        name: 'Preset',
        text: 'How hard the encoder works. Slower presets produce smaller files at the same quality; they do not produce better quality. "medium" is a sensible balance.'
      },
      {
        name: 'Profile / Level',
        text: 'Compatibility limits for old hardware players. Leave on Auto unless a specific device refuses the file.'
      },
      {
        name: 'GOP size',
        text: 'How often a fully self-contained keyframe is written. Smaller values allow finer seeking and are required by streaming; larger values compress better.'
      },
      {
        name: 'B-frames',
        text: 'Frames predicted from both directions. More improves compression but costs encode time and hurts very old decoders.'
      },
      {
        name: 'Reference frames',
        text: 'How many previous frames the encoder may look back at. More improves compression slightly at a real speed cost.'
      },
      {
        name: 'Pixel format',
        text: 'Colour sampling and bit depth. "Auto" matches the source. yuv420p is the universally compatible choice; 10-bit formats reduce banding.'
      },
      {
        name: '10-bit output',
        text: 'Required to preserve HDR. Also reduces banding in gradients even on standard-range content.'
      },
      {
        name: 'Audio bitrate',
        text: 'For lossy codecs. Roughly: 128 kbps is fine for speech, 192–256 for music, 320 is the practical ceiling for MP3. Disabled for lossless codecs, where bit depth matters instead.'
      },
      {
        name: 'Sample rate / Channels',
        text: 'Leave at Original. Changing either forces a re-encode. Downmixing 5.1 to stereo loses the surround information permanently.'
      },
      {
        name: 'Compression level (FLAC)',
        text: 'Purely a size-versus-time trade-off. Quality is identical at every level because FLAC is lossless.'
      },
      {
        name: 'Fast start',
        text: 'Moves the index to the front of an MP4 so it can begin playing before it finishes downloading. Leave on for anything going on the web.'
      },
      {
        name: 'Fragmented MP4',
        text: 'For streaming protocols like DASH. Not needed for ordinary playback and reduces compatibility.'
      },
      {
        name: 'Threads',
        text: '0 lets FFmpeg decide. Lower it only if you want to keep CPU free for other work.'
      }
    ]
  },
  {
    id: 'images',
    icon: 'image',
    title: 'Images',
    summary:
      'Photos and graphics convert on the Convert page like any other file: JPG, PNG, WebP, AVIF, BMP, TIFF, ICO, TGA and GIF.',
    steps: [
      'Drop images onto the window (or use Add). They are recognised as pictures, not videos.',
      'Pick the target under Format. Only image formats are offered for an image.',
      'Adjust quality, size and background if needed, then press Convert.'
    ],
    options: [
      {
        name: 'Quality',
        text: 'Applies to JPG, WebP and AVIF. Higher keeps more detail; lower gives smaller files. 100 on WebP means lossless. PNG, BMP, TIFF, TGA and ICO are always lossless.'
      },
      {
        name: 'Width / Height',
        text: 'Leave both empty to keep the size. With one value the other follows the aspect ratio; with both, the picture fits inside that box without being stretched.'
      },
      {
        name: 'Background for transparency',
        text: 'JPG and AVIF cannot store transparency, so transparent areas are painted with this colour instead of turning black.'
      },
      {
        name: 'Remove metadata',
        text: 'Drops EXIF data such as camera model and GPS location. Worth doing before posting photos online.'
      },
      {
        name: 'Frame at (seconds)',
        text: 'When the source is a video, an image format saves a single frame from that moment.'
      }
    ],
    notes: [
      'ICO files are limited to 256 × 256; larger pictures are scaled down automatically.',
      'HEIC/HEIF photos (iPhone) cannot be read by the bundled FFmpeg. Export them as JPG first.'
    ]
  },
  {
    id: 'youtube',
    icon: 'youtube',
    title: 'YouTube',
    summary: 'Download a YouTube video or just its audio — the whole thing or only a fragment.',
    steps: [
      'Paste the video link and press Analyse (or Enter). The title, length and available qualities appear.',
      'Choose "Video with audio" or "Audio only", then the quality and format.',
      'Pick the folder to save into.',
      'To keep only part of the video, turn on "Download only a part" and type the start and end, e.g. 30:00 and 50:00.',
      'Press Download. Progress appears in the list below; when it finishes you can open the file or its folder.'
    ],
    options: [
      {
        name: 'Quality',
        text: 'The highest resolution to download. If the video has nothing that small, the closest one is used.'
      },
      {
        name: 'Format',
        text: 'MP4 plays everywhere (H.264 + AAC is preferred). MKV accepts anything. WebM keeps YouTube’s VP9/Opus streams untouched.'
      },
      {
        name: 'Audio format / bitrate',
        text: 'MP3 and M4A are the most compatible; Opus is the original YouTube audio; FLAC and WAV are lossless containers (the source itself is still lossy).'
      },
      {
        name: 'Download only a part',
        text: 'Only that range is downloaded, so an hour-long video does not have to be fetched in full. Times accept HH:MM:SS, MM:SS or plain seconds.'
      },
      {
        name: 'Exact cut',
        text: 'Without it the part starts at the nearest keyframe, which can be a couple of seconds early. With it the edges are re-encoded so it starts exactly on time; slower.'
      },
      {
        name: 'Use sign-in from',
        text: 'When YouTube asks to confirm you are not a robot, GConverter shows a "Verify" dialog: it opens a YouTube window with the "I\'m not a robot" check, closes it by itself once you pass, and retries. If that is not enough, sign in with Google in that same window. "Verify / sign in" does the same at any time, and "Forget session" erases it. You can also use the session of an installed browser instead.'
      }
    ],
    notes: [
      'Downloads use yt-dlp, which ships with GConverter. YouTube changes often; if downloads start failing, a newer yt-dlp usually fixes it (Settings → Advanced → yt-dlp path).',
      'Live streams cannot be downloaded.',
      'Only download content you have the right to keep, and respect YouTube’s terms and the creator’s rights.'
    ]
  },
  {
    id: 'queue',
    icon: 'list',
    title: 'Queue',
    summary: 'Everything waiting, running or finished, with live progress.',
    options: [
      { name: 'Start', text: 'Begins processing pending jobs.' },
      {
        name: 'Pause',
        text: 'Stops new jobs from starting. Jobs already running are allowed to finish so nothing is corrupted.'
      },
      {
        name: 'Stop',
        text: 'Cancels everything, including the job in progress. Partial output files are deleted.'
      },
      { name: 'Clear finished', text: 'Removes completed, failed and cancelled rows from the list.' },
      {
        name: 'Progress readout',
        text: 'Percentage, time remaining, encoding frames per second, speed relative to real time, bytes written so far and a projected final size.'
      },
      {
        name: 'Details (on a failed job)',
        text: 'Explains the failure in plain language, suggests a fix, and shows the raw FFmpeg output and the exact command used.'
      },
      { name: 'Retry', text: 'Re-runs the job. Fix the settings first if the cause was a bad choice.' }
    ],
    notes: [
      'Cancelling always deletes the partial file. GConverter never leaves half-written media behind.',
      'How many jobs run at once is set in Settings → Performance.'
    ]
  },
  {
    id: 'presets',
    icon: 'sparkles',
    title: 'Presets',
    summary: 'Named bundles of settings for common destinations, plus your own.',
    steps: [
      'Select a file on the Convert page first.',
      'Open Presets and press Apply on the one you want.',
      'GConverter tells you exactly what the preset will change about that specific file.'
    ],
    options: [
      {
        name: 'Resolution badges (≤ 1080p and similar)',
        text: 'A ceiling, not a target. A 720p source run through a 1080p preset stays at 720p — presets never upscale and never raise the frame rate.'
      },
      {
        name: 'Create preset',
        text: 'Builds a custom preset. Max width / height / frame rate are optional caps that only apply when the source exceeds them.'
      },
      {
        name: 'Original Quality',
        text: 'Copies every stream. Instant when only the container changes. The safest choice.'
      },
      {
        name: 'Archive (Lossless)',
        text: 'FFV1 video and FLAC audio in MKV. Mathematically lossless and very large — intended for long-term preservation, not for sharing.'
      },
      {
        name: 'Editing (ProRes)',
        text: 'An intermediate codec that decodes cheaply so video editors can scrub the timeline smoothly. Files are much larger than the source.'
      }
    ],
    notes: [
      'Built-in presets cannot be edited, but pressing edit on one creates an editable copy.'
    ]
  },
  {
    id: 'inspector',
    icon: 'search',
    title: 'Media Inspector',
    summary:
      'A read-only report of everything FFprobe can determine about a file. Nothing here modifies anything.',
    steps: [
      'Drop a file onto the strip at the top, or pick one of the already-loaded files.',
      'Read the container, per-stream and metadata panels.',
      'Use Copy, Export JSON or Export TXT to take the report elsewhere.'
    ],
    options: [
      {
        name: 'Container panel',
        text: 'Format, size, exact duration, overall bitrate, and how many streams and chapters exist.'
      },
      {
        name: 'Video stream',
        text: 'Codec and profile, resolution, frame rate, pixel format, colour space and transfer characteristics, HDR type and rotation.'
      },
      {
        name: 'Audio stream',
        text: 'Codec, sample rate, channel layout, sample format, bit depth and bitrate.'
      },
      {
        name: 'Export JSON',
        text: 'The complete raw FFprobe output, useful for bug reports or scripting.'
      }
    ],
    notes: [
      'HDR is detected from the colour transfer characteristics and side data, so it is reported accurately even when the filename says nothing.'
    ]
  },
  {
    id: 'automation',
    icon: 'zap',
    title: 'Automation',
    summary:
      'Watch a folder and convert anything that appears in it, without opening the app again.',
    steps: [
      'Press "New rule" and give it a name.',
      'Choose the folder to watch and the folder to write results into. They must be different.',
      'Pick the preset to convert with.',
      'Decide what happens to the original after a successful conversion.',
      'Turn on "Enable immediately" and save.'
    ],
    options: [
      {
        name: 'Watch folder',
        text: 'Any new file appearing here is converted. GConverter waits until the file has stopped growing before touching it, so files still being copied or downloaded are handled safely.'
      },
      {
        name: 'File types',
        text: 'Comma-separated extensions to accept. Leave it empty to accept every supported media format.'
      },
      {
        name: 'Include subfolders',
        text: 'Also watch directories nested inside the watch folder.'
      },
      {
        name: 'When conversion succeeds',
        text: 'Leave the original alone, move it to another folder, send it to the recycle bin, or delete it permanently. The action only runs after the conversion actually succeeded.'
      },
      {
        name: 'Scan now',
        text: 'Processes files that are already sitting in the folder, rather than waiting for new ones.'
      }
    ],
    notes: [
      '"Delete the original permanently" does not use the recycle bin and cannot be undone. Prefer "move" or "recycle bin" unless you are certain.',
      'Files already produced by the rule are never re-processed, so the output folder cannot feed itself.'
    ]
  },
  {
    id: 'history',
    icon: 'clock',
    title: 'History',
    summary: 'Every conversion that finished, failed or was cancelled.',
    options: [
      {
        name: 'Convert again',
        text: 'Reloads the original file with the exact settings that were used, ready to run once more.'
      },
      { name: 'Open file / Show in folder', text: 'Opens the result, or reveals it in your file manager.' },
      { name: 'Filters', text: 'Narrow the list to completed or failed jobs.' }
    ],
    notes: [
      'History records the settings used, so a conversion can always be reproduced exactly.',
      'The list is capped at the 500 most recent entries.'
    ]
  },
  {
    id: 'logs',
    icon: 'terminal',
    title: 'Logs',
    summary:
      'A structured record of what the app did this session. The first place to look when something behaves unexpectedly.',
    options: [
      {
        name: 'Level filter',
        text: 'Debug shows everything including individual FFmpeg invocations. Info is the sensible default. Error shows only failures.'
      },
      { name: 'Follow', text: 'Auto-scrolls as new entries arrive.' },
      { name: 'Export', text: 'Saves the visible session log to a text file, useful for bug reports.' }
    ],
    notes: [
      'A log file is also written to disk for every session, in the folder shown under Settings → Advanced.'
    ]
  },
  {
    id: 'settings',
    icon: 'settings',
    title: 'Settings',
    summary: 'Application-wide preferences, grouped into five tabs.',
    options: [
      {
        name: 'General → Save next to the source file',
        text: 'On, output lands beside the original. Off, everything goes to one chosen folder.'
      },
      {
        name: 'General → Output naming',
        text: 'Add a suffix, reuse the same name with a new extension, or write into a GConverter subfolder. GConverter never overwrites your source file under any of these.'
      },
      {
        name: 'Performance → CPU threads',
        text: 'Auto lets FFmpeg use what it needs. Lower it to keep the machine responsive for other work.'
      },
      {
        name: 'Performance → Simultaneous conversions',
        text: 'More at once helps with many small files. For one large file, one at a time is faster.'
      },
      {
        name: 'Performance → Hardware acceleration',
        text: 'Turns GPU encoding on or off, and lets you force a specific vendor. Only encoders that passed a real test encode can be selected.'
      },
      {
        name: 'Performance → Low priority',
        text: 'Runs encoders below normal priority so the rest of the system stays usable during long jobs.'
      },
      {
        name: 'Conversion → Prefer lossless',
        text: 'When on, GConverter copies streams instead of re-encoding whenever the target container allows it. Leave this on.'
      },
      {
        name: 'Conversion → If the output already exists',
        text: 'Add a number (the safe default) or overwrite. Your source file is never overwritten either way.'
      },
      {
        name: 'Advanced → FFmpeg / FFprobe path',
        text: 'Empty uses the bundled build, then anything on your PATH. Point it elsewhere to use a build with extra codecs.'
      },
      {
        name: 'Advanced → Log level',
        text: 'Set to Debug when reporting a problem so the log captures every command.'
      },
      {
        name: 'System tab',
        text: 'Read-only. Shows the detected FFmpeg build, your CPU, memory, GPUs, and exactly which hardware encoders were verified as working.'
      }
    ]
  },
  {
    id: 'troubleshooting',
    icon: 'help',
    title: 'Troubleshooting',
    summary: 'The problems people actually hit, and what to do about them.',
    options: [
      {
        name: 'The app says FFmpeg is missing',
        text: 'Open Settings → System and press "Re-detect". If it still fails, point GConverter at an FFmpeg executable under Settings → Advanced.'
      },
      {
        name: 'A conversion failed',
        text: 'Open Details on the failed row. The reason is written in plain language with a suggested fix. Converting to MKV with default settings resolves most container-related failures.'
      },
      {
        name: 'The preview player shows an error',
        text: 'The player uses the browser engine, whose decoders are narrower than FFmpeg\'s. HEVC, ProRes and some MKVs cannot preview. Conversion is unaffected.'
      },
      {
        name: 'My subtitles disappeared',
        text: 'Not every container supports them, and image-based subtitles (PGS, VobSub) cannot become text. Use MKV to keep everything, or burn them into the picture.'
      },
      {
        name: 'The output is larger than the source',
        text: 'Normal when going from a lossy codec to a lossless one, or to a much less efficient codec. The estimate panel warns before you start.'
      },
      {
        name: 'GPU encoding is greyed out',
        text: 'No encoder passed verification. Settings → System shows each candidate and why it failed — usually an outdated driver or no matching GPU.'
      },
      {
        name: 'Conversion is very slow',
        text: 'AV1 and slow presets are genuinely slow on CPU. Switch the encoder to your GPU, or choose a faster preset.'
      }
    ]
  }
]

/* ------------------------------------------------------------------ */
/* Spanish                                                             */
/* ------------------------------------------------------------------ */

const ES: HelpArticle[] = [
  {
    id: 'concepts',
    icon: 'lightbulb',
    title: 'Conceptos básicos',
    summary:
      'Dos ideas explican casi todo lo que hace GConverter: contenedor frente a códec, y remultiplexar frente a recodificar.',
    options: [
      {
        name: 'Contenedor (MP4, MKV, MOV…)',
        text: 'La caja. Determina qué códecs caben dentro, si se pueden guardar subtítulos y capítulos, y en qué dispositivos se reproducirá bien. Cambiar solo el contenedor no toca la imagen ni el sonido.'
      },
      {
        name: 'Códec (H.264, HEVC, AAC, FLAC…)',
        text: 'La compresión de la imagen o el sonido en sí. Cambiar de códec siempre implica decodificar y volver a codificar, que es donde se puede perder calidad.'
      },
      {
        name: 'Remultiplexado (sin pérdida)',
        text: 'Mover las pistas existentes a otro contenedor sin tocarlas. El resultado es idéntico byte a byte y termina casi al instante. GConverter lo hace solo siempre que el contenedor de destino admita los códecs del origen.'
      },
      {
        name: 'Recodificar',
        text: 'Decodificar y volver a comprimir con otro códec u otros ajustes. Es necesario cuando el contenedor no admite el códec, o cuando cambias la resolución, los fotogramas por segundo o incrustas subtítulos.'
      },
      {
        name: 'Códec sin pérdida',
        text: 'FFV1, FLAC, ALAC y PCM recomprimen sin descartar nada: la salida decodificada es idéntica al original. GConverter los etiqueta como sin pérdida aunque haya habido recodificación.'
      }
    ],
    notes: [
      'Convertir un archivo con pérdida (MP3, H.264) a un formato sin pérdida no recupera calidad. Solo hace el archivo más grande. GConverter te avisa cuando lo intentas.',
      'GConverter nunca usa «sin pérdida» a la ligera. El aviso de color encima de los ajustes de salida indica siempre cuál de estos casos se aplica.'
    ]
  },
  {
    id: 'home',
    icon: 'home',
    title: 'Inicio',
    summary: 'El panel principal: un sitio donde soltar archivos y un resumen de lo que has convertido.',
    steps: [
      'Arrastra archivos o carpetas a la ventana, en cualquier punto, no solo en la zona de soltar.',
      'O usa «Añadir archivos» para elegirlos uno a uno, o «Añadir carpeta» para incorporar todos los archivos multimedia de un directorio, incluidas las subcarpetas.',
      'GConverter analiza cada archivo con FFprobe y te lleva a la página Convertir.'
    ],
    options: [
      { name: 'Conversiones', text: 'Cuántas conversiones se han completado correctamente en total.' },
      {
        name: 'Espacio ahorrado',
        text: 'Espacio total recuperado en los trabajos completados. Las conversiones que agrandaron el archivo no cuentan como ahorro negativo.'
      },
      {
        name: 'Codificación por hardware',
        text: 'Si se ha encontrado y verificado un codificador de GPU en esta máquina. Los detalles están en Configuración → Sistema.'
      },
      { name: 'Sistema', text: 'Hilos de CPU y memoria instalada disponibles para el codificador.' },
      {
        name: 'Conversiones recientes',
        text: 'Los últimos cinco trabajos con su cambio de tamaño. Pulsa «Ver todo» para el historial completo.'
      }
    ]
  },
  {
    id: 'convert',
    icon: 'repeat',
    title: 'Convertir',
    summary:
      'Donde eliges cómo debe ser la salida. La parte izquierda describe el origen; la derecha es tu lista de archivos y los ajustes preestablecidos.',
    steps: [
      'Selecciona un archivo en la lista Archivos, a la derecha.',
      'Lee el aviso de color de arriba: te dice si la conversión será sin pérdida antes de empezar.',
      'Elige un Formato. Los que aparecen como «sin pérdida disponible» pueden guardar tu archivo sin recodificar.',
      'Ajusta lo que necesites o aplica un ajuste preestablecido.',
      'Pulsa Convertir para el archivo seleccionado, o «Convertir todo» para poner en cola todos los archivos con sus propios ajustes.'
    ],
    options: [
      {
        name: 'Formato',
        text: 'El contenedor de salida. Al cambiarlo se recalculan automáticamente los códecs adecuados. MKV admite prácticamente todo; MP4 es el más compatible para compartir.'
      },
      {
        name: 'Calidad',
        text: 'Un nivel de calidad que se traduce en un valor CRF concreto para el codificador elegido. «Original / Sin pérdida» copia o usa un códec sin pérdida. No tiene efecto si todas las pistas se están copiando.'
      },
      {
        name: 'Códec de vídeo',
        text: '«Copiar» significa que no se recodifica nada. «Ninguno» elimina el vídeo por completo. Solo se muestran los códecs que admite el contenedor elegido y que tu versión de FFmpeg puede codificar.'
      },
      {
        name: 'Códec de audio',
        text: 'Las mismas reglas que el vídeo. Elegir «Ninguno» produce un archivo mudo, útil para quitarle el audio a un clip.'
      },
      {
        name: 'Resolución',
        text: 'Déjala en Original salvo que quieras un archivo más pequeño a propósito. Solo se ofrecen resoluciones iguales o menores que el origen: GConverter nunca amplía. Cambiarla obliga a recodificar.'
      },
      {
        name: 'Fotogramas por segundo',
        text: 'Déjalo en Original. Solo se ofrecen valores iguales o menores que el origen. Bajarlo obliga a recodificar y hace el movimiento menos fluido.'
      },
      {
        name: 'Subtítulos',
        text: '«Mantener como pistas» permite activarlos y desactivarlos en el reproductor. «Incrustar en el vídeo» los pinta de forma permanente sobre la imagen y obliga a recodificar: úsalo solo si el reproductor de destino no admite pistas de subtítulos.'
      },
      {
        name: 'Metadatos',
        text: 'Mantenerlos, eliminarlos todos, o editar a mano campos como título, artista y álbum.'
      },
      {
        name: 'Conversión rápida',
        text: 'Eliges solo un formato de destino y GConverter deduce del origen los códecs, la calidad, la profundidad de bits y el hardware. Es el camino más rápido para el caso habitual.'
      },
      {
        name: 'Previsualizar archivo',
        text: 'Reproduce el origen en un reproductor integrado. Algunos formatos (HEVC, ProRes, muchos MKV) no se pueden previsualizar porque el motor del navegador no tiene el decodificador; esto nunca afecta a la conversión.'
      }
    ],
    notes: [
      'El panel «Resultado estimado» muestra un rango de tamaño, no una cifra exacta, porque el tamaño con CRF depende realmente del contenido.',
      'El «Plan de pistas» enumera cada pista e indica si se copiará, se recodificará o se descartará, y por qué.'
    ]
  },
  {
    id: 'advanced',
    icon: 'sliders',
    title: 'Opciones avanzadas',
    summary:
      'Los tres paneles desplegables del final de la tarjeta Salida. Ignóralos por completo salvo que sepas que los necesitas: los valores por defecto son buenos.',
    options: [
      {
        name: 'Codificador',
        text: 'Qué chip hace el trabajo. «Automático» prefiere un codificador de GPU verificado. La CPU (x264/x265) es más lenta pero suele dar algo más de calidad por megabyte. La GPU es muchísimo más rápida, ideal para archivos largos.'
      },
      {
        name: 'Control de tasa',
        text: 'CRF busca una calidad visual constante y deja flotar el bitrate: lo mejor para archivos que vas a conservar. El bitrate medio busca un tamaño concreto. El bitrate limitado acota el pico, que es lo que exigen las plataformas de streaming.'
      },
      {
        name: 'CRF / CQ / QP',
        text: 'El mando de calidad. Más bajo es mejor y más grande. En H.264, 18 es visualmente transparente, 23 es un buen valor por defecto y 28 ya se ve blando. HEVC y AV1 usan escalas distintas para el mismo resultado.'
      },
      {
        name: 'Preajuste',
        text: 'Cuánto se esfuerza el codificador. Los preajustes más lentos generan archivos más pequeños con la misma calidad; no generan más calidad. «medium» es un buen equilibrio.'
      },
      {
        name: 'Perfil / Nivel',
        text: 'Límites de compatibilidad para reproductores antiguos. Déjalo en Automático salvo que un dispositivo concreto rechace el archivo.'
      },
      {
        name: 'Tamaño del GOP',
        text: 'Cada cuánto se escribe un fotograma clave completo. Valores pequeños permiten buscar con más precisión y son necesarios para streaming; los grandes comprimen mejor.'
      },
      {
        name: 'Fotogramas B',
        text: 'Fotogramas predichos en ambos sentidos. Más mejoran la compresión pero cuestan tiempo de codificación y dan problemas en decodificadores muy antiguos.'
      },
      {
        name: 'Fotogramas de referencia',
        text: 'Cuántos fotogramas anteriores puede consultar el codificador. Más mejora ligeramente la compresión a costa de velocidad.'
      },
      {
        name: 'Formato de píxel',
        text: 'Muestreo de color y profundidad de bits. «Automático» usa el del origen. yuv420p es la opción universalmente compatible; los formatos de 10 bits reducen el banding.'
      },
      {
        name: 'Salida de 10 bits',
        text: 'Necesaria para conservar el HDR. También reduce el banding en degradados incluso en contenido de rango estándar.'
      },
      {
        name: 'Bitrate de audio',
        text: 'Para códecs con pérdida. A grandes rasgos: 128 kbps basta para voz, 192–256 para música, y 320 es el techo práctico en MP3. Se desactiva en códecs sin pérdida, donde lo que importa es la profundidad de bits.'
      },
      {
        name: 'Frecuencia de muestreo / Canales',
        text: 'Déjalos en Original. Cambiar cualquiera obliga a recodificar. Mezclar 5.1 a estéreo pierde la información envolvente de forma permanente.'
      },
      {
        name: 'Nivel de compresión (FLAC)',
        text: 'Es puramente un compromiso entre tamaño y tiempo. La calidad es idéntica en todos los niveles porque FLAC no tiene pérdida.'
      },
      {
        name: 'Inicio rápido',
        text: 'Mueve el índice al principio del MP4 para que empiece a reproducirse antes de terminar de descargarse. Déjalo activado para cualquier cosa que vaya a la web.'
      },
      {
        name: 'MP4 fragmentado',
        text: 'Para protocolos de streaming como DASH. No hace falta para la reproducción normal y reduce la compatibilidad.'
      },
      {
        name: 'Hilos',
        text: 'Con 0 decide FFmpeg. Bájalo solo si quieres dejar CPU libre para otras tareas.'
      }
    ]
  },
  {
    id: 'images',
    icon: 'image',
    title: 'Imágenes',
    summary:
      'Las fotos y gráficos se convierten en la página Convertir como cualquier otro archivo: JPG, PNG, WebP, AVIF, BMP, TIFF, ICO, TGA y GIF.',
    steps: [
      'Arrastra las imágenes a la ventana (o usa Añadir). Se reconocen como imágenes, no como vídeos.',
      'Elige el destino en Formato. Para una imagen solo se ofrecen formatos de imagen.',
      'Ajusta calidad, tamaño y fondo si hace falta y pulsa Convertir.'
    ],
    options: [
      {
        name: 'Calidad',
        text: 'Se aplica a JPG, WebP y AVIF. Más alta conserva más detalle; más baja da archivos más pequeños. 100 en WebP significa sin pérdida. PNG, BMP, TIFF, TGA e ICO siempre son sin pérdida.'
      },
      {
        name: 'Ancho / Alto',
        text: 'Déjalos vacíos para mantener el tamaño. Con un solo valor, el otro sigue la proporción; con ambos, la imagen cabe en ese recuadro sin deformarse.'
      },
      {
        name: 'Fondo para la transparencia',
        text: 'JPG y AVIF no admiten transparencia, así que las zonas transparentes se pintan con este color en lugar de quedar negras.'
      },
      {
        name: 'Quitar metadatos',
        text: 'Elimina los datos EXIF, como el modelo de cámara y la ubicación GPS. Conviene hacerlo antes de publicar fotos en Internet.'
      },
      {
        name: 'Fotograma en (segundos)',
        text: 'Si el origen es un vídeo, un formato de imagen guarda un único fotograma de ese momento.'
      }
    ],
    notes: [
      'Los ICO están limitados a 256 × 256; las imágenes más grandes se reducen automáticamente.',
      'Las fotos HEIC/HEIF (iPhone) no se pueden leer con el FFmpeg incluido. Expórtalas antes como JPG.'
    ]
  },
  {
    id: 'youtube',
    icon: 'youtube',
    title: 'YouTube',
    summary: 'Descarga un vídeo de YouTube o solo su audio, completo o solo un fragmento.',
    steps: [
      'Pega el enlace del vídeo y pulsa Analizar (o Intro). Aparecen el título, la duración y las calidades disponibles.',
      'Elige «Vídeo con audio» o «Solo audio» y después la calidad y el formato.',
      'Elige la carpeta donde guardarlo.',
      'Para quedarte solo con una parte, activa «Descargar solo una parte» y escribe el inicio y el fin, por ejemplo 30:00 y 50:00.',
      'Pulsa Descargar. El progreso aparece en la lista de abajo; al terminar puedes abrir el archivo o su carpeta.'
    ],
    options: [
      {
        name: 'Calidad',
        text: 'La resolución máxima a descargar. Si el vídeo no tiene ninguna tan pequeña, se usa la más cercana.'
      },
      {
        name: 'Formato',
        text: 'MP4 se reproduce en todas partes (se prefiere H.264 + AAC). MKV admite cualquier cosa. WebM conserva intactos los flujos VP9/Opus de YouTube.'
      },
      {
        name: 'Formato / bitrate de audio',
        text: 'MP3 y M4A son los más compatibles; Opus es el audio original de YouTube; FLAC y WAV son contenedores sin pérdida (el origen sigue siendo con pérdida).'
      },
      {
        name: 'Descargar solo una parte',
        text: 'Solo se descarga ese tramo, así que no hace falta bajar entero un vídeo de una hora. Los tiempos aceptan HH:MM:SS, MM:SS o segundos.'
      },
      {
        name: 'Corte exacto',
        text: 'Sin él, la parte empieza en el fotograma clave más cercano, que puede estar un par de segundos antes. Con él se recodifican los bordes para que empiece justo a tiempo; es más lento.'
      },
      {
        name: 'Usar la sesión de',
        text: 'Cuando YouTube pide confirmar que no eres un robot, GConverter muestra un aviso «Verificar»: abre una ventana de YouTube con la casilla «No soy un robot», se cierra sola cuando la superas y vuelve a intentarlo. Si no alcanza, inicia sesión con Google en esa misma ventana. «Verificar / iniciar sesión» hace lo mismo cuando quieras y «Olvidar sesión» la borra. También puedes usar la sesión de un navegador instalado.'
      }
    ],
    notes: [
      'Las descargas usan yt-dlp, que viene incluido con GConverter. YouTube cambia a menudo; si las descargas empiezan a fallar, un yt-dlp más reciente suele solucionarlo (Configuración → Avanzado → Ruta de yt-dlp).',
      'No se pueden descargar emisiones en directo.',
      'Descarga solo contenido que tengas derecho a conservar y respeta los términos de YouTube y los derechos del creador.'
    ]
  },
  {
    id: 'queue',
    icon: 'list',
    title: 'Cola',
    summary: 'Todo lo que está esperando, en marcha o terminado, con progreso en tiempo real.',
    options: [
      { name: 'Iniciar', text: 'Empieza a procesar los trabajos pendientes.' },
      {
        name: 'Pausar',
        text: 'Impide que se inicien trabajos nuevos. Los que ya están en marcha terminan, para no corromper nada.'
      },
      {
        name: 'Detener',
        text: 'Cancela todo, incluido el trabajo en curso. Los archivos de salida parciales se eliminan.'
      },
      {
        name: 'Limpiar finalizados',
        text: 'Quita de la lista las filas completadas, fallidas y canceladas.'
      },
      {
        name: 'Indicadores de progreso',
        text: 'Porcentaje, tiempo restante, fotogramas por segundo de codificación, velocidad respecto al tiempo real, bytes escritos y una proyección del tamaño final.'
      },
      {
        name: 'Detalles (en un trabajo fallido)',
        text: 'Explica el fallo en lenguaje claro, sugiere una solución y muestra la salida en bruto de FFmpeg y el comando exacto que se usó.'
      },
      {
        name: 'Reintentar',
        text: 'Vuelve a ejecutar el trabajo. Corrige antes los ajustes si la causa fue una mala elección.'
      }
    ],
    notes: [
      'Cancelar siempre elimina el archivo parcial. GConverter nunca deja archivos a medio escribir.',
      'Cuántos trabajos se ejecutan a la vez se configura en Configuración → Rendimiento.'
    ]
  },
  {
    id: 'presets',
    icon: 'sparkles',
    title: 'Ajustes preestablecidos',
    summary: 'Paquetes de ajustes con nombre para destinos habituales, más los tuyos propios.',
    steps: [
      'Selecciona primero un archivo en la página Convertir.',
      'Abre Ajustes preestablecidos y pulsa Aplicar en el que quieras.',
      'GConverter te dice exactamente qué va a cambiar ese ajuste en ese archivo concreto.'
    ],
    options: [
      {
        name: 'Distintivos de resolución (≤ 1080p y similares)',
        text: 'Es un techo, no un objetivo. Un origen a 720p con un ajuste de 1080p se queda en 720p: los ajustes nunca amplían ni suben los fotogramas por segundo.'
      },
      {
        name: 'Crear ajuste',
        text: 'Crea un ajuste personalizado. La anchura, altura y FPS máximos son límites opcionales que solo se aplican cuando el origen los supera.'
      },
      {
        name: 'Calidad original',
        text: 'Copia todas las pistas. Instantáneo si solo cambia el contenedor. La opción más segura.'
      },
      {
        name: 'Archivado (sin pérdida)',
        text: 'Vídeo FFV1 y audio FLAC en MKV. Matemáticamente sin pérdida y muy grande: pensado para conservación a largo plazo, no para compartir.'
      },
      {
        name: 'Edición (ProRes)',
        text: 'Un códec intermedio que se decodifica con poco esfuerzo para que los editores de vídeo se muevan con fluidez por la línea de tiempo. Los archivos son mucho más grandes que el original.'
      }
    ],
    notes: [
      'Los ajustes incluidos no se pueden editar, pero al pulsar editar en uno se crea una copia editable.'
    ]
  },
  {
    id: 'inspector',
    icon: 'search',
    title: 'Inspector de medios',
    summary:
      'Un informe de solo lectura con todo lo que FFprobe puede averiguar de un archivo. Aquí no se modifica nada.',
    steps: [
      'Arrastra un archivo a la franja de arriba, o elige uno de los ya cargados.',
      'Consulta los paneles de contenedor, pistas y metadatos.',
      'Usa Copiar, Exportar JSON o Exportar TXT para llevarte el informe a otro sitio.'
    ],
    options: [
      {
        name: 'Panel de contenedor',
        text: 'Formato, tamaño, duración exacta, bitrate total y cuántas pistas y capítulos hay.'
      },
      {
        name: 'Pista de vídeo',
        text: 'Códec y perfil, resolución, fotogramas por segundo, formato de píxel, espacio de color y características de transferencia, tipo de HDR y rotación.'
      },
      {
        name: 'Pista de audio',
        text: 'Códec, frecuencia de muestreo, disposición de canales, formato de muestra, profundidad de bits y bitrate.'
      },
      {
        name: 'Exportar JSON',
        text: 'La salida completa y en bruto de FFprobe, útil para informes de errores o para automatizar.'
      }
    ],
    notes: [
      'El HDR se detecta a partir de las características de transferencia de color y los datos auxiliares, así que se informa con precisión aunque el nombre del archivo no diga nada.'
    ]
  },
  {
    id: 'automation',
    icon: 'zap',
    title: 'Automatización',
    summary:
      'Vigila una carpeta y convierte todo lo que aparezca en ella, sin tener que volver a abrir la aplicación.',
    steps: [
      'Pulsa «Nueva regla» y ponle un nombre.',
      'Elige la carpeta que se vigilará y la carpeta donde se escribirán los resultados. Deben ser distintas.',
      'Elige el ajuste preestablecido con el que convertir.',
      'Decide qué pasa con el original tras una conversión correcta.',
      'Activa «Activar inmediatamente» y guarda.'
    ],
    options: [
      {
        name: 'Carpeta vigilada',
        text: 'Cualquier archivo nuevo que aparezca aquí se convierte. GConverter espera a que el archivo deje de crecer antes de tocarlo, así que los archivos que todavía se están copiando o descargando se tratan de forma segura.'
      },
      {
        name: 'Tipos de archivo',
        text: 'Extensiones separadas por comas que se aceptarán. Déjalo vacío para aceptar cualquier formato multimedia compatible.'
      },
      {
        name: 'Incluir subcarpetas',
        text: 'Vigila también los directorios anidados dentro de la carpeta vigilada.'
      },
      {
        name: 'Cuando la conversión termine bien',
        text: 'Dejar el original en su sitio, moverlo a otra carpeta, enviarlo a la papelera o eliminarlo definitivamente. La acción solo se ejecuta si la conversión ha ido bien.'
      },
      {
        name: 'Analizar ahora',
        text: 'Procesa los archivos que ya están en la carpeta, en lugar de esperar a que lleguen nuevos.'
      }
    ],
    notes: [
      '«Eliminar el original definitivamente» no pasa por la papelera y no se puede deshacer. Es preferible «mover» o «papelera» salvo que estés seguro.',
      'Los archivos que ya ha generado la regla nunca se vuelven a procesar, así que la carpeta de salida no puede realimentarse.'
    ]
  },
  {
    id: 'history',
    icon: 'clock',
    title: 'Historial',
    summary: 'Todas las conversiones que terminaron, fallaron o se cancelaron.',
    options: [
      {
        name: 'Convertir de nuevo',
        text: 'Vuelve a cargar el archivo original con los mismos ajustes que se usaron, listo para ejecutarlo otra vez.'
      },
      {
        name: 'Abrir archivo / Mostrar en la carpeta',
        text: 'Abre el resultado o lo muestra en tu explorador de archivos.'
      },
      { name: 'Filtros', text: 'Reduce la lista a los trabajos completados o fallidos.' }
    ],
    notes: [
      'El historial guarda los ajustes utilizados, así que una conversión siempre se puede reproducir exactamente igual.',
      'La lista se limita a las 500 entradas más recientes.'
    ]
  },
  {
    id: 'logs',
    icon: 'terminal',
    title: 'Registros',
    summary:
      'Un registro estructurado de lo que ha hecho la aplicación en esta sesión. El primer sitio donde mirar si algo se comporta de forma rara.',
    options: [
      {
        name: 'Filtro de nivel',
        text: 'Depuración muestra todo, incluidas las llamadas individuales a FFmpeg. Información es el valor sensato por defecto. Error muestra solo los fallos.'
      },
      { name: 'Seguir', text: 'Desplaza la vista automáticamente según llegan entradas nuevas.' },
      {
        name: 'Exportar',
        text: 'Guarda el registro visible de la sesión en un archivo de texto, útil para informar de errores.'
      }
    ],
    notes: [
      'También se escribe un archivo de registro en disco por cada sesión, en la carpeta que se indica en Configuración → Avanzado.'
    ]
  },
  {
    id: 'settings',
    icon: 'settings',
    title: 'Configuración',
    summary: 'Preferencias generales de la aplicación, agrupadas en cinco pestañas.',
    options: [
      {
        name: 'General → Guardar junto al archivo original',
        text: 'Activado, la salida se coloca junto al original. Desactivado, todo va a una carpeta elegida.'
      },
      {
        name: 'General → Nombre de la salida',
        text: 'Añadir un sufijo, reutilizar el mismo nombre con otra extensión, o escribir en una subcarpeta GConverter. En ninguno de los casos se sobrescribe tu archivo de origen.'
      },
      {
        name: 'Rendimiento → Hilos de CPU',
        text: 'Automático deja que FFmpeg use lo que necesite. Bájalo para mantener la máquina receptiva para otras tareas.'
      },
      {
        name: 'Rendimiento → Conversiones simultáneas',
        text: 'Varias a la vez ayudan con muchos archivos pequeños. Para un archivo grande, de uno en uno es más rápido.'
      },
      {
        name: 'Rendimiento → Aceleración por hardware',
        text: 'Activa o desactiva la codificación por GPU y permite forzar un fabricante concreto. Solo se pueden elegir los codificadores que superaron una codificación de prueba real.'
      },
      {
        name: 'Rendimiento → Prioridad baja',
        text: 'Ejecuta los codificadores por debajo de la prioridad normal para que el resto del sistema siga usable durante trabajos largos.'
      },
      {
        name: 'Conversión → Preferir sin pérdida',
        text: 'Activado, GConverter copia las pistas en vez de recodificarlas siempre que el contenedor de destino lo permita. Déjalo activado.'
      },
      {
        name: 'Conversión → Si la salida ya existe',
        text: 'Añadir un número (la opción segura por defecto) o sobrescribir. En ningún caso se sobrescribe tu archivo de origen.'
      },
      {
        name: 'Avanzado → Ruta de FFmpeg / FFprobe',
        text: 'Vacío usa la versión incluida y luego lo que haya en tu PATH. Apúntalo a otro sitio para usar una versión con códecs adicionales.'
      },
      {
        name: 'Avanzado → Nivel de registro',
        text: 'Ponlo en Depuración cuando vayas a informar de un problema, para que el registro capture todos los comandos.'
      },
      {
        name: 'Pestaña Sistema',
        text: 'Solo lectura. Muestra la versión de FFmpeg detectada, tu CPU, la memoria, las GPU y exactamente qué codificadores por hardware se han verificado como funcionales.'
      }
    ]
  },
  {
    id: 'troubleshooting',
    icon: 'help',
    title: 'Resolución de problemas',
    summary: 'Los problemas que aparecen de verdad y qué hacer con ellos.',
    options: [
      {
        name: 'La aplicación dice que falta FFmpeg',
        text: 'Abre Configuración → Sistema y pulsa «Volver a detectar». Si sigue fallando, indica a GConverter un ejecutable de FFmpeg en Configuración → Avanzado.'
      },
      {
        name: 'Una conversión ha fallado',
        text: 'Abre Detalles en la fila fallida. El motivo está escrito en lenguaje claro con una solución sugerida. Convertir a MKV con los ajustes por defecto resuelve la mayoría de fallos de contenedor.'
      },
      {
        name: 'El reproductor de previsualización da error',
        text: 'El reproductor usa el motor del navegador, cuyos decodificadores son más limitados que los de FFmpeg. HEVC, ProRes y algunos MKV no se pueden previsualizar. La conversión no se ve afectada.'
      },
      {
        name: 'Han desaparecido mis subtítulos',
        text: 'No todos los contenedores los admiten, y los subtítulos basados en imagen (PGS, VobSub) no se pueden convertir a texto. Usa MKV para conservarlo todo, o incrústalos en la imagen.'
      },
      {
        name: 'La salida es más grande que el original',
        text: 'Es normal al pasar de un códec con pérdida a uno sin pérdida, o a un códec mucho menos eficiente. El panel de estimación te avisa antes de empezar.'
      },
      {
        name: 'La codificación por GPU aparece deshabilitada',
        text: 'Ningún codificador ha superado la verificación. Configuración → Sistema muestra cada candidato y por qué falló: normalmente un controlador desactualizado o que no hay una GPU compatible.'
      },
      {
        name: 'La conversión va muy lenta',
        text: 'AV1 y los preajustes lentos son realmente lentos en CPU. Cambia el codificador a tu GPU o elige un preajuste más rápido.'
      }
    ]
  }
]

export function helpArticles(lang: LanguageCode): HelpArticle[] {
  return lang === 'es' ? ES : EN
}

/* ------------------------------------------------------------------ */
/* Credits                                                             */
/* ------------------------------------------------------------------ */

export interface CreditLink {
  label: string
  url: string
  icon: string
}

export const AUTHOR_LINKS: CreditLink[] = [
  { label: 'GitHub', url: 'https://github.com/sanb-mov', icon: 'github' },
  { label: 'Linktree', url: 'https://linktr.ee/gripg', icon: 'link' }
]

export interface CreditEntry {
  name: string
  role: string
  url?: string
}

const OPEN_SOURCE_EN: CreditEntry[] = [
  {
    name: 'FFmpeg',
    role: 'Multimedia engine — decoding, encoding, muxing',
    url: 'https://ffmpeg.org'
  },
  { name: 'Electron', role: 'Desktop application runtime', url: 'https://electronjs.org' },
  { name: 'React', role: 'User interface', url: 'https://react.dev' },
  { name: 'Vite', role: 'Build tooling', url: 'https://vite.dev' },
  { name: 'TypeScript', role: 'Language and type checking', url: 'https://typescriptlang.org' },
  { name: 'Zustand', role: 'State management', url: 'https://zustand-demo.pmnd.rs' },
  { name: 'Lucide', role: 'Icon set', url: 'https://lucide.dev' },
  {
    name: 'Chokidar',
    role: 'Folder watching for automation',
    url: 'https://github.com/paulmillr/chokidar'
  }
]

const OPEN_SOURCE_ES: CreditEntry[] = [
  {
    name: 'FFmpeg',
    role: 'Motor multimedia: decodificación, codificación y multiplexado',
    url: 'https://ffmpeg.org'
  },
  { name: 'Electron', role: 'Entorno de ejecución de la aplicación', url: 'https://electronjs.org' },
  { name: 'React', role: 'Interfaz de usuario', url: 'https://react.dev' },
  { name: 'Vite', role: 'Herramientas de compilación', url: 'https://vite.dev' },
  {
    name: 'TypeScript',
    role: 'Lenguaje y comprobación de tipos',
    url: 'https://typescriptlang.org'
  },
  { name: 'Zustand', role: 'Gestión del estado', url: 'https://zustand-demo.pmnd.rs' },
  { name: 'Lucide', role: 'Conjunto de iconos', url: 'https://lucide.dev' },
  {
    name: 'Chokidar',
    role: 'Vigilancia de carpetas para la automatización',
    url: 'https://github.com/paulmillr/chokidar'
  }
]

export function openSource(lang: LanguageCode): CreditEntry[] {
  return lang === 'es' ? OPEN_SOURCE_ES : OPEN_SOURCE_EN
}
