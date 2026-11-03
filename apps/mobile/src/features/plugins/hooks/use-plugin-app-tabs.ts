import type { Href } from 'expo-router';
import type { PluginRouteContribution } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { useSyncExternalStore } from 'react';

import { useTranslation } from '@/i18n';
import { MAX_PLUGIN_TABS, usePluginStore } from '@/stores';
import type { PluginStatus } from '../domain/installed-plugin';
import { pluginSymbols } from '../domain/plugin-icons';
import { pluginEntryRoutes } from '../domain/plugin-pages';
import { usePluginRuntime } from '../components/plugin-runtime-provider';

/**
 * Bottom navigation positions reserved for plugins. Each position is its own route file under
 * `app/(tabs)` because a tab navigator maps every trigger to a distinct route.
 */
export const PLUGIN_TAB_ROUTES = Array.from({ length: MAX_PLUGIN_TABS }, (_, index) => `/plugin-tab-${index + 1}`);

export interface PluginAppTab {
  readonly pluginId: string;
  /** The entry route the tab opens first. */
  readonly route: PluginRouteContribution;
  readonly name: string;
  readonly href: Href;
  readonly label: string;
  readonly icon: { readonly ios: string; readonly android: string };
}

/** Whether the plugin declares an `app.tab` entry that opens one of its entry routes. */
export function canPinPluginTab(status: PluginStatus): boolean {
  return resolveTabRoute(status) !== undefined;
}

function resolveTabRoute(status: PluginStatus) {
  const tab = status.plugin.manifest.contributes.slots['app.tab'][0];
  const route = tab && pluginEntryRoutes(status.plugin.manifest).find((item) => item.id === tab.route);
  return tab && route ? { tab, route } : undefined;
}

/** Enabled plugins the user pinned to the bottom navigation, each bound to a reserved tab route. */
export function usePluginAppTabs(): readonly PluginAppTab[] {
  // Labels come from plugin locale tables, so a language change has to re-render.
  useTranslation();
  const { host } = usePluginRuntime();
  const statuses = useSyncExternalStore(host.subscribe, host.getStatuses);
  const pinned = usePluginStore((state) => state.tabs);

  return pinned
    .flatMap((pluginId) => {
      const status = statuses.find((item) => item.plugin.id === pluginId);
      const resolved = status?.enabled ? resolveTabRoute(status) : undefined;
      if (!status || !resolved) return [];
      const { tab, route } = resolved;
      return [
        {
          pluginId,
          route,
          label: host.localize(pluginId, tab.title ?? route.title),
          icon: pluginSymbols(tab.icon ?? route.icon ?? status.plugin.manifest.icon),
        },
      ];
    })
    .slice(0, PLUGIN_TAB_ROUTES.length)
    .map((tab, index) => ({ ...tab, name: `plugin-tab-${index + 1}`, href: PLUGIN_TAB_ROUTES[index] as Href }));
}
