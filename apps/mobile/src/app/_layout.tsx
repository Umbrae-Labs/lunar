import '@/global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useLayoutEffect } from 'react';
import { AppState } from 'react-native';
import { Uniwind, useCSSVariable, useUniwind } from 'uniwind';

import { AppProviders } from '@/components/providers/app-providers';
import { ExternalEpubShareListener } from '@/features/library';
import { PluginRuntimeProvider } from '@/features/plugins';
import { applyLanguagePreference } from '@/i18n';
import { useApplicationLaunchStore, useApplicationSettingsStore } from '@/stores';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 180, fade: true });

export default function RootLayout() {
  const { theme } = useUniwind();
  const themeMode = useApplicationSettingsStore((state) => state.themeMode);
  const language = useApplicationSettingsStore((state) => state.language);
  const initialContentReady = useApplicationLaunchStore((state) => state.initialContentReady);
  const isDark = theme === 'dark';
  const backgroundColor = useCSSVariable('--color-background') as string | undefined;

  useLayoutEffect(() => {
    Uniwind.setTheme(themeMode);
  }, [themeMode]);

  // Native stack transitions briefly expose the root view at the screen edge.
  useEffect(() => {
    if (backgroundColor) {
      void SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => undefined);
    }
  }, [backgroundColor]);

  useLayoutEffect(() => {
    applyLanguagePreference(language);
  }, [language]);

  useEffect(() => {
    if (language !== 'system') {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        applyLanguagePreference('system');
      }
    });
    return () => subscription.remove();
  }, [language]);

  useEffect(() => {
    if (initialContentReady) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [initialContentReady]);

  return (
    <AppProviders>
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <NavigationBar hidden={false} style={isDark ? 'dark' : 'light'} />
        <ExternalEpubShareListener />
        <PluginRuntimeProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="reader/[bookId]" />
            <Stack.Screen name="import-epub" />
          </Stack>
        </PluginRuntimeProvider>
      </ThemeProvider>
    </AppProviders>
  );
}
