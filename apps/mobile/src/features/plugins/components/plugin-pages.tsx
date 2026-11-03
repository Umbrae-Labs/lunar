import type { PluginRouteContribution } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { Tabs } from 'heroui-native/tabs';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppTabBar, AppTabButton } from '@/components/ui/app-tabs';
import { pluginSymbols } from '../domain/plugin-icons';
import type { PluginHost } from '../services/plugin-host';
import { PluginSlotView } from './plugin-slot-view';

const NO_PARAMS: Readonly<Record<string, string>> = {};

/** The active entry page and every page opened so far, which stay mounted to keep their state. */
export function usePluginPageSelection(initialPageId: string) {
  const [activeId, setActiveId] = useState(initialPageId);
  const [visited, setVisited] = useState<readonly string[]>([initialPageId]);
  const select = useCallback((pageId: string) => {
    setActiveId(pageId);
    setVisited((current) => (current.includes(pageId) ? current : [...current, pageId]));
  }, []);
  return { activeId, visited, select };
}

interface PluginPageDeckProps {
  readonly host: PluginHost;
  readonly pluginId: string;
  readonly visited: readonly string[];
  readonly activeId: string;
  /** The page the screen was opened with; only it receives the route parameters. */
  readonly initialPageId: string;
  readonly initialParams: Readonly<Record<string, string>>;
}

/** Renders the visited entry pages and shows the active one. */
export function PluginPageDeck({
  host,
  pluginId,
  visited,
  activeId,
  initialPageId,
  initialParams,
}: PluginPageDeckProps) {
  return (
    <View className="flex-1">
      {visited.map((pageId) => (
        <View key={pageId} className={pageId === activeId ? 'flex-1' : 'hidden'}>
          <PluginPage
            host={host}
            pluginId={pluginId}
            pageId={pageId}
            params={pageId === initialPageId ? initialParams : NO_PARAMS}
          />
        </View>
      ))}
    </View>
  );
}

export function PluginPage({
  host,
  pluginId,
  pageId,
  params,
}: {
  readonly host: PluginHost;
  readonly pluginId: string;
  readonly pageId: string;
  readonly params: Readonly<Record<string, string>>;
}) {
  const componentProps = useMemo(() => ({ pageId, params }), [pageId, params]);
  return (
    <PluginSlotView host={host} pluginId={pluginId} componentKey={`route:${pageId}`} componentProps={componentProps} />
  );
}

interface PluginPageTabsProps {
  readonly host: PluginHost;
  readonly pluginId: string;
  readonly routes: readonly PluginRouteContribution[];
  readonly activeId: string;
  readonly onSelect: (pageId: string) => void;
}

/** Bottom bar for a full-screen plugin with several entry pages. */
export function PluginPageTabBar({ host, pluginId, routes, activeId, onSelect }: PluginPageTabsProps) {
  return (
    <AppTabBar>
      {routes.map((route) => (
        <AppTabButton
          key={route.id}
          accessibilityRole="tab"
          isFocused={route.id === activeId}
          label={host.localize(pluginId, route.title)}
          icon={pluginSymbols(route.icon)}
          onPress={() => onSelect(route.id)}
        />
      ))}
    </AppTabBar>
  );
}

/** Top switcher for plugin pages hosted in a bottom navigation tab, where the bottom edge is taken. */
export function PluginPageSegments({ host, pluginId, routes, activeId, onSelect }: PluginPageTabsProps) {
  return (
    <View className="w-full max-w-[800px] self-center px-4 pb-2">
      <Tabs value={activeId} onValueChange={onSelect} variant="primary">
        <Tabs.List>
          <Tabs.Indicator />
          {routes.map((route) => (
            <Tabs.Trigger key={route.id} value={route.id}>
              <Tabs.Label>{host.localize(pluginId, route.title)}</Tabs.Label>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs>
    </View>
  );
}
