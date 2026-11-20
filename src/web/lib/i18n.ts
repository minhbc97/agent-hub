import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import vi from '@/locales/vi.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, vi: { translation: vi } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'vi'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'agent-hub.language',
      caches: ['localStorage'],
    },
  });

if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (language) => {
    document.documentElement.lang = language;
  });
}

export { i18n };
export const t = (key: string, options?: Record<string, unknown>): string => String(i18n.t(key, options as never));
