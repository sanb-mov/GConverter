/**
 * Renderer-side translation binding.
 *
 * `useT()` subscribes to the language stored in settings, so switching the
 * language in Settings re-renders every component that uses it — no reload.
 */

import { useCallback } from 'react'
import { t as translate, type TranslateParams } from '@shared/i18n'
import type { LanguageCode } from '@shared/models'
import { useStore } from '../store/useStore'

export function useLanguage(): LanguageCode {
  return useStore((s) => s.settings?.general.language ?? 'en')
}

export function useT(): (key: string, params?: TranslateParams) => string {
  const lang = useLanguage()
  return useCallback((key: string, params?: TranslateParams) => translate(lang, key, params), [lang])
}

/**
 * Pluralisation helper for the "1 file / 2 files" cases. English and Spanish
 * share the same one/other split, so a single rule covers both.
 */
export function plural(count: number, one: string, other: string): string {
  return count === 1 ? one : other
}
