import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { pluginEntryRoutes } from '../domain/plugin-pages';
import { PluginPageDeck, PluginPageSegments, usePluginPageSelection } from '../components/plugin-pages';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';
import { usePluginAppTabs, type PluginAppTab } from '../hooks/use-plugin-app-tabs';

const NO_PARAMS: Readonly<Record<string, string>> = {};

/** A plugin pinned to the bottom navigation, shown at the given reserved tab position. */
export function PluginTabScreen({ position }: { readonly position: number }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  useMarkInitialContentReady(true);
  const tab = usePluginAppTabs()[position];

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      {tab ? (
        <PinnedPlugin key={tab.pluginId} tab={tab} />
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-muted">{t('plugins.slotUnavailable')}</Text>
        </View>
      )}
    </View>
  );
}

function PinnedPlugin({ tab }: { readonly tab: PluginAppTab }) {
  const insets = useSafeAreaInsets();
  const { host } = usePluginRuntime();
  useSyncExternalStore(host.subscribe, host.getVersion);
  const manifest = host.getEntry(tab.pluginId)?.plugin.manifest;
  const routes = manifest ? pluginEntryRoutes(manifest) : [];
  const { activeId, visited, select } = usePluginPageSelection(tab.route.id);
  const activeRoute = routes.find((route) => route.id === activeId) ?? tab.route;

  return (
    <>
      <PluginScreenHeader
        title={host.localize(tab.pluginId, routes.length > 1 && manifest ? manifest.name : activeRoute.title)}
        settingsPluginId={tab.pluginId}
      />
      {routes.length > 1 ? (
        <PluginPageSegments host={host} pluginId={tab.pluginId} routes={routes} activeId={activeId} onSelect={select} />
      ) : null}
      <View className="flex-1" style={{ paddingBottom: APP_TAB_BAR_HEIGHT + insets.bottom }}>
        <PluginPageDeck
          host={host}
          pluginId={tab.pluginId}
          visited={visited}
          activeId={activeId}
          initialPageId={tab.route.id}
          initialParams={NO_PARAMS}
        />
      </View>
    </>
  );
}
