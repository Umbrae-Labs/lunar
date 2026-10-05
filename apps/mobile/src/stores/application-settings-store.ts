import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { LanguagePreference } from '@/i18n';
import { mmkvStateStorage } from './mmkv-state-storage';

export type ApplicationThemeMode = 'system' | 'light' | 'dark';

interface ApplicationSettingsState {
  readonly themeMode: ApplicationThemeMode;
  readonly language: LanguagePreference;
  readonly resumeReadingOnLaunch: boolean;
  setThemeMode(themeMode: ApplicationThemeMode): void;
  setLanguage(language: LanguagePreference): void;
  setResumeReadingOnLaunch(enabled: boolean): void;
}

type PersistedApplicationSettings = Pick<ApplicationSettingsState, 'themeMode' | 'language' | 'resumeReadingOnLaunch'>;

const DEFAULT_THEME_MODE: ApplicationThemeMode = 'system';
const DEFAULT_LANGUAGE: LanguagePreference = 'system';
const DEFAULT_RESUME_READING_ON_LAUNCH = true;

export const useApplicationSettingsStore = create<ApplicationSettingsState>()(
  persist<ApplicationSettingsState, [], [], PersistedApplicationSettings>(
    (set) => ({
      themeMode: DEFAULT_THEME_MODE,
      language: DEFAULT_LANGUAGE,
      resumeReadingOnLaunch: DEFAULT_RESUME_READING_ON_LAUNCH,
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
      setResumeReadingOnLaunch: (resumeReadingOnLaunch) => set({ resumeReadingOnLaunch }),
    }),
    {
      name: 'settings.application',
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({ themeMode, language, resumeReadingOnLaunch }) => ({
        themeMode,
        language,
        resumeReadingOnLaunch,
      }),
    },
  ),
);
