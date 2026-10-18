# GConverter

**Convert anything. Keep everything.**

A universal audio and video converter built on FFmpeg. GConverter's guiding
principle is honesty about quality: it detects when a conversion can be done
losslessly, does it that way whenever possible, and tells you in plain
language exactly what will happen to every stream before you commit.

---

## Getting started

1. **Drop a file** anywhere on the window — or use *Add files* / *Add folder*.
2. GConverter probes it with FFprobe and shows every stream it found.
3. **Pick an output format.** Formats that can accept your file without
   re-encoding are marked *lossless available*.
4. Press **Convert**.

That is the whole workflow for the common case. Everything below is optional.

---

## What "lossless" means here

GConverter never uses the word loosely. Three distinct outcomes are reported:

| Verdict | What happened | Quality |
|---|---|---|
| **Lossless — no re-encoding required** | Streams were copied bit-for-bit into a new container | Byte-identical |
| **Lossless — re-compressed without quality loss** | Re-encoded with a mathematically lossless codec (FFV1, FLAC, ALAC, PCM) | Decoded output identical |
| **Partially re-encoded** | Some streams copied, others re-encoded | Near-identical |
| **Re-encoded** | Streams were re-encoded with a lossy codec | High quality, not identical |

A container change such as **MKV → MP4** with H.264 + AAC inside is a *remux*:
no pixels are touched and it finishes almost instantly. The test suite proves
this by comparing the MD5 of the video bitstream before and after.

Conversions that genuinely cannot be lossless — H.264 → AV1, FLAC → MP3 — are
labelled as re-encodes, and GConverter picks high-quality settings rather than
arbitrary low ones.

---

## Quality rules

GConverter will **never**, on its own:

- reduce resolution (4K stays 4K),
- reduce frame rate (60 fps stays 60 fps),
- reduce bitrate merely to save space,
- drop HDR metadata silently,
- convert a lossless source to a lossy codec.

Presets that *do* impose a limit — YouTube 1080p, WhatsApp, Discord — say so on
the card, and their caps only ever apply when the source **exceeds** them. A
720p video run through the "YouTube 1080p" preset stays at 720p; nothing is
ever upscaled.

---

## Hardware acceleration

GConverter detects NVIDIA NVENC, AMD AMF, Intel Quick Sync and Apple
VideoToolbox. Presence in the FFmpeg build is not treated as proof: each
candidate encoder is **verified with a real one-frame test encode** before
being offered. *Settings → System* shows exactly which ones passed.

Hardware encoding is much faster; CPU encoding (x264/x265) generally produces
slightly better quality per bit. Use *Auto* unless you have a reason not to.

---

## Features

- **Smart Convert** — choose only a target format; codecs, quality, bit depth
  and hardware are derived from the source.
- **Media Inspector** — every container, stream, colour, HDR, chapter and
  metadata property FFprobe can report, exportable as JSON or text.
- **Conversion queue** — batch processing with live progress, ETA, fps, speed
  and running output size; pause, stop and per-job cancel.
- **30 built-in presets** plus your own custom ones.
- **Automation** — watch a folder, convert everything that lands in it, and
  optionally move or delete the originals.
- **Subtitles** — keep, remove, convert, or burn into the picture.
- **Metadata and chapters** — preserve, strip or edit.
- **Command preview** — see and copy the exact FFmpeg command.
- **Logs** — structured, filterable, exportable.
- **Images** — JPG, PNG, WebP, AVIF, BMP, TIFF, ICO, TGA and GIF, with
  quality, size, transparency background and metadata removal, plus image
  presets. A video can also be saved as a single frame.
- **YouTube downloader** — whole video or audio only, choice of quality,
  format and folder, and the option to download only a fragment (e.g. 30:00 to
  50:00). When YouTube asks to confirm you are not a robot, GConverter opens a
  YouTube window with the check and retries on its own once you pass it.

---

## Where files go

By default output is written next to the source with a `_converted` suffix.
Change this in *Settings → General*. GConverter never overwrites your source
file, and by default never overwrites an existing output either — it appends
`(2)`, `(3)` and so on.

If a conversion is cancelled or fails, the partial output file is deleted so
no corrupt or half-written media is left behind.

---

## Keyboard and troubleshooting

**Nothing converts / "FFmpeg is not available"**
Open *Settings → System*. GConverter ships with FFmpeg, but if that build is
missing it also looks on your `PATH`, and you can point it at any FFmpeg
installation under *Settings → Advanced*.

**A conversion failed**
Open the job's *Details* in the queue. GConverter translates FFmpeg's error
into a plain-language reason and a suggested fix, and shows the raw output.

**The preview player shows an error but conversion works**
The built-in player uses the browser engine's decoders, which are narrower
than FFmpeg's. HEVC, ProRes and some MKV files will not preview. Conversion is
unaffected.

**Subtitles disappeared**
Not every container supports subtitles, and image-based subtitles (PGS, VobSub)
cannot be converted to text formats. GConverter warns before converting. Use
MKV to keep everything, or burn the subtitles into the video.

---

## Data locations

| What | Where |
|---|---|
| Settings, history, presets | `%APPDATA%/gconverter` (Windows), `~/.config/gconverter` (Linux), `~/Library/Application Support/gconverter` (macOS) |
| Logs | `<data>/logs` — one file per session |
| Temporary files | `<data>/temp` — cleaned automatically |
| YouTube session | `<data>/youtube/cookies.txt` — erase it with *Forget session* |

---

## Licensing

GConverter is MIT licensed. It bundles FFmpeg, which is distributed under the
LGPL/GPL depending on build configuration; the bundled build's license terms
apply to the FFmpeg binary itself. See <https://ffmpeg.org/legal.html>.
It also bundles yt-dlp (<https://github.com/yt-dlp/yt-dlp>), released under the
Unlicense. Only download content you have the right to keep.
