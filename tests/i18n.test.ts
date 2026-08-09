/**
 * Translation coverage and correctness.
 *
 * The point of these tests is to make the language selector honest: a key
 * that exists in English but not in Spanish would silently fall back and
 * leave the user staring at English text, which is exactly the bug this
 * suite exists to prevent.
 */

import { describe, expect, it } from 'vitest'
import { LANGUAGES, dictionaryFor, englishKeys, t, translator } from '../src/shared/i18n'
import { BUILT_IN_PRESETS } from '../src/main/core/profiles/defaults'
import { planConversion } from '../src/main/core/conversion/planner'
import { explainFFmpegError } from '../src/main/core/conversion/errorMapper'
import { createDefaultSettings } from '../src/main/core/profiles/defaults'
import type { AudioStream, MediaFile, VideoStream } from '../src/shared/models'

const PLACEHOLDER = /\{(\w+)\}/g

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort()
}

describe('dictionary coverage', () => {
  it('translates every English key into every other language', () => {
    const keys = englishKeys()
    expect(keys.length).toBeGreaterThan(300)

    for (const { code } of LANGUAGES) {
      if (code === 'en') continue
      const dict = dictionaryFor(code)
      const missing = keys.filter((key) => dict[key] === undefined)
      expect(missing, `missing ${code} translations: ${missing.join(', ')}`).toEqual([])
    }
  })

  it('has no keys in a translation that English does not define', () => {
    const english = new Set(englishKeys())
    for (const { code } of LANGUAGES) {
      if (code === 'en') continue
      const extra = Object.keys(dictionaryFor(code)).filter((key) => !english.has(key))
      expect(extra, `stale ${code} keys: ${extra.join(', ')}`).toEqual([])
    }
  })

  it('keeps the same placeholders in every language', () => {
    const en = dictionaryFor('en')
    for (const { code } of LANGUAGES) {
      if (code === 'en') continue
      const dict = dictionaryFor(code)
      for (const key of englishKeys()) {
        const expected = placeholdersIn(en[key])
        const actual = placeholdersIn(dict[key] ?? '')
        expect(actual, `placeholder mismatch in ${code} "${key}"`).toEqual(expected)
      }
    }
  })

  it('actually differs from English — the translation is real, not copied', () => {
    const en = dictionaryFor('en')
    const es = dictionaryFor('es')
    const keys = englishKeys()

    // Some strings legitimately match (brand names, "Mono", "MIT"). Most
    // must not: if they did, the language switch would be cosmetic.
    const identical = keys.filter((key) => en[key] === es[key])
    expect(identical.length / keys.length).toBeLessThan(0.15)
  })
})

describe('t()', () => {
  it('substitutes named placeholders', () => {
    expect(t('en', 'common.threads', { count: 12 })).toBe('12 threads')
    expect(t('es', 'common.threads', { count: 12 })).toBe('12 hilos')
  })

  it('leaves unknown placeholders untouched rather than printing undefined', () => {
    expect(t('en', 'common.threads', {})).toBe('{count} threads')
  })

  it('passes unknown keys through, so free text works at the same call site', () => {
    expect(t('es', 'My Custom Preset')).toBe('My Custom Preset')
  })

  it('falls back to English for a language it does not know', () => {
    expect(t('de' as never, 'nav.home')).toBe('Home')
  })

  it('binds a language once with translator()', () => {
    const tr = translator('es')
    expect(tr('nav.settings')).toBe('Configuración')
  })
})

describe('built-in presets', () => {
  it('reference i18n keys that both languages define', () => {
    const en = dictionaryFor('en')
    const es = dictionaryFor('es')

    for (const profile of BUILT_IN_PRESETS) {
      expect(en[profile.name], `missing en name for ${profile.id}`).toBeDefined()
      expect(es[profile.name], `missing es name for ${profile.id}`).toBeDefined()
      expect(en[profile.description!], `missing en desc for ${profile.id}`).toBeDefined()
      expect(es[profile.description!], `missing es desc for ${profile.id}`).toBeDefined()
    }
  })
})

/* ------------------------------------------------------------------ */
/* Localised engine output                                             */
/* ------------------------------------------------------------------ */

function sampleFile(): MediaFile {
  const video: VideoStream = {
    index: 0,
    kind: 'video',
    codec: 'h264',
    isDefault: true,
    isForced: false,
    width: 1920,
    height: 1080,
    fps: 25,
    isHDR: false,
    isAttachedPic: false
  }
  const audio: AudioStream = {
    index: 1,
    kind: 'audio',
    codec: 'aac',
    isDefault: true,
    isForced: false,
    sampleRate: 48000,
    channels: 2
  }
  return {
    id: 'x',
    path: '/tmp/a.mkv',
    name: 'a.mkv',
    directory: '/tmp',
    extension: 'mkv',
    size: 1000,
    formatName: 'matroska,webm',
    duration: 10,
    streams: [video, audio],
    chapters: [],
    metadata: {},
    primaryVideo: video,
    primaryAudio: audio,
    hasVideo: true,
    hasAudio: true,
    hasSubtitles: false,
    probedAt: 0
  }
}

describe('conversion verdicts are localised', () => {
  const context = { hardware: null, availableEncoders: ['libx264', 'aac'] }

  it('produces Spanish verdicts when asked', () => {
    const plan = planConversion(sampleFile(), createDefaultSettings('mp4'), {
      ...context,
      lang: 'es'
    })
    expect(plan.mode).toBe('lossless-remux')
    expect(plan.headline).toBe('Sin pérdida: no hace falta recodificar')
    expect(plan.detail).toContain('bit a bit')
  })

  it('defaults to English when no language is given', () => {
    const plan = planConversion(sampleFile(), createDefaultSettings('mp4'), context)
    expect(plan.headline).toMatch(/^Lossless/)
  })

  it('localises per-stream reasons', () => {
    const plan = planConversion(sampleFile(), createDefaultSettings('mp4'), {
      ...context,
      lang: 'es'
    })
    const videoPlan = plan.streams.find((s) => s.kind === 'video')
    expect(videoPlan?.reason).toContain('sin recodificar')
  })

  it('localises warnings', () => {
    const file = sampleFile()
    const settings = createDefaultSettings('mkv')
    settings.audio.codec = 'flac'
    const plan = planConversion(file, settings, {
      hardware: null,
      availableEncoders: ['libx264', 'flac'],
      lang: 'es'
    })
    expect(plan.warnings.join(' ')).toContain('no puede recuperar el detalle')
  })
})

describe('error explanations are localised', () => {
  it('translates a recognised failure', () => {
    const stderr = 'x264 [error]: No space left on device'
    expect(explainFFmpegError(stderr, 1, 'es').message).toBe(
      'No hay espacio suficiente en el disco'
    )
    expect(explainFFmpegError(stderr, 1, 'en').message).toBe('Not enough disk space')
  })

  it('always supplies a suggestion in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const error = explainFFmpegError('something entirely unexpected', 1, lang)
      expect(error.suggestion).toBeTruthy()
      expect(error.message).toBeTruthy()
    }
  })
})
