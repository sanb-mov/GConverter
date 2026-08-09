/**
 * Translates FFmpeg's stderr into an actionable explanation (spec §30).
 *
 * Users should never be shown a raw "Error while opening encoder" with no
 * idea what to do next. Each rule pairs a recognisable signature with a
 * plain-language reason and a concrete suggestion, both localised.
 */

import type { ConversionError, LanguageCode } from '@shared/models'
import { t as translate } from '@shared/i18n'

interface Rule {
  test: RegExp
  /** i18n key prefix; `.message`, `.reason` and `.suggestion` hang off it. */
  key: string
}

const RULES: Rule[] = [
  { test: /No space left on device|ENOSPC/i, key: 'err.noSpace' },
  { test: /Permission denied|EACCES|EPERM/i, key: 'err.permission' },
  { test: /Cannot open file|No such file or directory|ENOENT/i, key: 'err.notFound' },
  { test: /Unknown encoder/i, key: 'err.unknownEncoder' },
  {
    test: /Cannot load nvcuda|Cannot load libcuda|OpenEncodeSessionEx failed|InitializeEncoder failed|no NVENC capable devices/i,
    key: 'err.nvenc'
  },
  { test: /Failed to initialise VAAPI|vaapi|Device creation failed/i, key: 'err.vaapi' },
  { test: /AMF|amfenc/i, key: 'err.amf' },
  { test: /qsv|Quick Sync|MFX/i, key: 'err.qsv' },
  {
    test: /Could not find tag for codec .* in stream|Only audio, video, and subtitles are supported|codec not currently supported in container/i,
    key: 'err.container'
  },
  {
    test: /Invalid data found when processing input|moov atom not found|Invalid NAL unit|error reading header/i,
    key: 'err.corrupt'
  },
  { test: /Experimental codecs are not enabled|strict/i, key: 'err.experimental' },
  { test: /Width and height must be even|not divisible by 2|invalid dimensions/i, key: 'err.dimensions' },
  { test: /Sample rate .* not supported|Invalid sample rate/i, key: 'err.sampleRate' },
  { test: /Too many packets buffered|muxing queue/i, key: 'err.muxQueue' },
  {
    test: /does not contain any stream|Output file .* does not contain any stream/i,
    key: 'err.noStream'
  },
  { test: /Filter .* not found|No such filter|Error initializing filter/i, key: 'err.filter' },
  { test: /Unable to parse option value|Invalid argument|Error setting option/i, key: 'err.option' },
  { test: /Conversion failed!/i, key: 'err.failed' }
]

/** Pull the most informative line out of a noisy stderr dump. */
function significantLine(stderr: string, lang: LanguageCode): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^\s*(configuration|built with|lib[a-z]+\s)/i.test(l))

  const errorLine = [...lines].reverse().find((l) => /error|failed|invalid|cannot|unable/i.test(l))
  return errorLine ?? lines[lines.length - 1] ?? translate(lang, 'err.generic.fallbackReason')
}

export function explainFFmpegError(
  stderr: string,
  exitCode: number | null,
  lang: LanguageCode = 'en'
): ConversionError {
  const tail = stderr.slice(-4000)
  const t = (key: string): string => translate(lang, key)

  for (const rule of RULES) {
    if (rule.test.test(tail)) {
      return {
        message: t(`${rule.key}.message`),
        reason: t(`${rule.key}.reason`),
        suggestion: t(`${rule.key}.suggestion`),
        exitCode: exitCode ?? undefined,
        stderrTail: tail.slice(-2000)
      }
    }
  }

  return {
    message: t('err.generic.message'),
    // FFmpeg's own line is left untranslated: it is diagnostic output, and
    // mangling it would make it unsearchable.
    reason: significantLine(tail, lang),
    suggestion: t('err.generic.suggestion'),
    exitCode: exitCode ?? undefined,
    stderrTail: tail.slice(-2000)
  }
}
