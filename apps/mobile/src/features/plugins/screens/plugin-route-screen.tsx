import { useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { pluginEntryRoutes } from '../domain/plugin-pages';
import { PluginPage, PluginPageDeck, PluginPageTabBar, usePluginPageSelection } from '../components/plugin-pages';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';

const PLUGINS_TAB = '/(tabs)/plugins' as Href;

/**
 * Hosts a plugin's full-screen page on the shared `/plugin/[pluginId]/[pageId]` route.
 * Entry pages of a plugin with several of them share one screen with a bottom page bar.
 */
export function PluginRouteScreen() {
  const insets = useSafeAreaInsets();
  useMarkInitialContentReady(true);
  const { pluginId, pageId, ...rest } = useLocalSearchParams<{ pluginId: string; pageId: string }>();
  const { host } = usePluginRuntime();
  useSyncExternalStore(host.subscribe, host.getVersion);
  const manifest = host.getEntry(pluginId)?.plugin.manifest;
  const route = manifest?.contributes.slots['app.route'].find((item) => item.id === pageId);
  const entryRoutes = manifest ? pluginEntryRoutes(manifest) : [];
  const restKey = JSON.stringify(rest);
  const params = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(JSON.parse(restKey) as Record<string, unknown>).filter(
          (item): item is [string, string] => typeof item[1] === 'string',
        ),
      ),
    [restKey],
  );
  const { activeId, visited, select } = usePluginPageSelection(pageId);
  const tabbed = route !== undefined && !route.hidden && entryRoutes.length > 1;
  const activeRoute = tabbed ? (entryRoutes.find((item) => item.id === activeId) ?? route) : route;

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader
        title={activeRoute ? host.localize(pluginId, activeRoute.title) : ''}
        fallback={PLUGINS_TAB}
        settingsPluginId={route && !route.hidden ? pluginId : undefined}
      />
      <View className="flex-1" style={{ paddingBottom: (tabbed ? APP_TAB_BAR_HEIGHT : 0) + insets.bottom }}>
        {tabbed ? (
          <PluginPageDeck
            host={host}
            pluginId={pluginId}
            visited={visited}
            activeId={activeId}
            initialPageId={pageId}
            initialParams={params}
          />
        ) : route ? (
          <PluginPage host={host} pluginId={pluginId} pageId={pageId} params={params} />
        ) : null}
      </View>
      {tabbed ? (
        <PluginPageTabBar host={host} pluginId={pluginId} routes={entryRoutes} activeId={activeId} onSelect={select} />
      ) : null}
    </View>
  );
}
