import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

import { en } from './translations/en';
import { zhCN } from './translations/zh-CN';

export type LanguagePreference = 'system' | 'zh-CN' | 'en';
export type SupportedLanguage = Exclude<LanguagePreference, 'system'>;

const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const;

const i18next = createInstance();

i18next.use(initReactI18next).init({
  fallbackLng: 'zh-CN',
  initAsync: false,
  interpolation: { escapeValue: false },
  lng: resolveLanguagePreference('system'),
  resources,
  supportedLngs: ['zh-CN', 'en'],
  react: { useSuspense: false },
});

export function resolveLanguagePreference(preference: LanguagePreference): SupportedLanguage {
  if (preference !== 'system') {
    return preference;
  }

  return getLocales()[0]?.languageCode === 'en' ? 'en' : 'zh-CN';
}

export function applyLanguagePreference(preference: LanguagePreference): void {
  void i18next.changeLanguage(resolveLanguagePreference(preference));
}

export { i18next as i18n, useTranslation };
