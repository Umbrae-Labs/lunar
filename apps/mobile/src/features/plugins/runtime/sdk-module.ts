import { useThemeColor } from 'heroui-native/hooks';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';
import type * as Sdk from '@umbrae-labs/lunar-plugin-sdk';

import { useTranslation } from '@/i18n';
import { usePluginScope } from './plugin-scope';

const ThemeColorKeys = [
  'foreground',
  'background',
  'surface',
  'surface-secondary',
  'muted',
  'border',
  'danger',
  'success',
] as const;
const Spacing: Sdk.Theme['spacing'] = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

function usePlugin() {
  return usePluginScope('usePlugin').context;
}

function useReader(): Sdk.ReaderSessionInfo | undefined;
function useReader<T>(selector: (session: Sdk.ReaderSessionInfo | undefined) => T): T;
function useReader<T>(selector?: (session: Sdk.ReaderSessionInfo | undefined) => T): unknown {
  const { context } = usePluginScope('useReader');
  const session = context.reader.session;
  const cache = useRef<{ readonly info: Sdk.ReaderSessionInfo | undefined; readonly value: unknown } | undefined>(
    undefined,
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscription = session.subscribe(listener);
      return () => subscription.dispose();
    },
    [session],
  );
  const getSnapshot = useCallback(() => {
    const info = session.current();
    const previous = cache.current;
    if (previous && previous.info === info) return previous.value;
    const value = selector ? selector(info) : info;
    // Selectors may build fresh objects; equal results keep their identity.
    const stable = previous !== undefined && shallowEqual(previous.value, value) ? previous.value : value;
    cache.current = { info, value: stable };
    return stable;
  }, [selector, session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useReaderEvent<E extends Sdk.ReaderEventName>(
  event: E,
  listener: (payload: Sdk.ReaderEvents[E]) => void,
): void {
  const { context } = usePluginScope('useReaderEvent');
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    const subscription = context.reader.on(event, (payload) => latest.current(payload));
    return () => subscription.dispose();
  }, [context, event]);
}

function useSetting<T extends Sdk.JsonValue = Sdk.JsonValue>(key: string): readonly [T, (value: T) => Promise<void>] {
  const { context } = usePluginScope('useSetting');
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscription = context.settings.onChange(key, listener);
      return () => subscription.dispose();
    },
    [context, key],
  );
  const getSnapshot = useCallback(() => context.settings.get<T>(key), [context, key]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const set = useCallback((next: T) => context.settings.set(key, next), [context, key]);
  return [value, set] as const;
}

function useStorage<T extends Sdk.JsonValue = Sdk.JsonValue>(
  key: string,
): readonly [T | undefined, (value: T) => Promise<void>, boolean] {
  const { context, host, pluginId } = usePluginScope('useStorage');
  const [state, setState] = useState<{ readonly key: string; readonly value?: T; readonly loaded: boolean }>({
    key,
    loaded: false,
  });
  useEffect(() => {
    let active = true;
    const load = () => {
      context.storage
        .get<T>(key)
        .then((value) => {
          if (active) setState({ key, value, loaded: true });
        })
        .catch(() => {
          if (active) setState({ key, loaded: true });
        });
    };
    load();
    const unsubscribe = host.onStorageChange(pluginId, key, load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [context, host, key, pluginId]);
  const set = useCallback((value: T) => context.storage.set(key, value), [context, key]);
  const current = state.key === key ? state : { value: undefined, loaded: false };
  return [current.value, set, current.loaded] as const;
}

function useTheme(): Sdk.Theme {
  const { theme } = useUniwind();
  const [foreground, background, surface, surfaceSecondary, muted, border, danger, success] =
    useThemeColor(ThemeColorKeys);
  const accent = useCSSVariable('--color-navigation-active') as string;
  return useMemo(
    () => ({
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      colors: { foreground, background, surface, surfaceSecondary, muted, accent, border, danger, success },
      spacing: Spacing,
    }),
    [accent, background, border, danger, foreground, muted, success, surface, surfaceSecondary, theme],
  );
}

function useT() {
  const { context } = usePluginScope('useT');
  // Subscribing to the host language re-renders plugin text when it changes.
  const { i18n } = useTranslation();
  const language = i18n.language;
  return useCallback(
    (key: string, params?: Readonly<Record<string, string | number>>) => {
      void language;
      return context.i18n.t(key, params);
    },
    [context, language],
  );
}

export const sdkModule = {
  definePlugin: (definition: Sdk.PluginDefinition) => definition,
  usePlugin,
  useReader,
  useReaderEvent,
  useSetting,
  useStorage,
  useTheme,
  useT,
} satisfies typeof Sdk;

function shallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  );
}
