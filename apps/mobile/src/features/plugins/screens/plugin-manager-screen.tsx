import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Menu } from 'heroui-native/menu';
import { Spinner } from 'heroui-native/spinner';
import { useToast } from 'heroui-native/toast';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { Icon } from '@/components/ui/icon';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { PluginStatus } from '../domain/installed-plugin';
import { pluginErrorMessage } from '../domain/plugin-error';
import { pluginIconSource } from '../domain/plugin-icons';
import { pluginEntryRoutes } from '../domain/plugin-pages';
import { pickPluginPackage } from '../infrastructure/expo-plugin-files';
import { takeExternalPluginPackage } from '../services/external-plugin-install';
import { PluginIcon } from '../components/plugin-icon';
import { PluginInstallDialog } from '../components/plugin-install-dialog';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { usePluginCatalogs } from '../hooks/use-plugin-catalogs';
import { usePluginInstall } from '../hooks/use-plugin-install';

const PLUGIN_SETTINGS_ROUTE = '/settings/plugins' as Href;
const CATALOG_ROUTE = '/plugins/catalog' as Href;
const DOWNLOADS_ROUTE = '/plugins/downloads' as Href;

export function PluginManagerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { install: installRequest } = useLocalSearchParams<{ install?: string }>();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  useMarkInitialContentReady(true);
  const runtime = usePluginRuntime();
  const statuses = useSyncExternalStore(runtime.host.subscribe, runtime.host.getStatuses);
  const downloads = useSyncExternalStore(runtime.host.downloads.subscribe, runtime.host.downloads.getSnapshot);
  const activeDownloads = downloads.filter(
    (download) => download.status === 'running' || download.status === 'queued',
  ).length;
  const setSafeModeRequested = usePluginStore((state) => state.setSafeModeRequested);
  const [safeMode, setSafeMode] = useState(runtime.isSafeMode());
  const [isPicking, setIsPicking] = useState(false);
  const iconColor = useThemeColor('foreground');
  const { inspect, dialogProps } = usePluginInstall();
  const { offers } = usePluginCatalogs();
  const updates = useMemo(
    () =>
      new Map(offers.filter((offer) => offer.state === 'update').map((offer) => [offer.entry.id, offer.entry.version])),
    [offers],
  );

  const pickPackage = async () => {
    setIsPicking(true);
    try {
      const picked = await pickPluginPackage();
      if (picked) await inspect(picked.bytes);
    } catch (error) {
      toast.show({ variant: 'danger', label: pluginErrorMessage(error) });
    } finally {
      setIsPicking(false);
    }
  };

  // Packages opened from a file manager or another app arrive as `?install=<requestId>`.
  useEffect(() => {
    if (!installRequest) return;
    router.setParams({ install: undefined });
    const opened = takeExternalPluginPackage(installRequest);
    if (!opened) return;
    void inspect(opened.then((picked) => picked.bytes));
  }, [inspect, installRequest, router]);

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View className="w-full max-w-[800px] flex-row items-center gap-2 self-center px-4 pt-1 pb-2">
        <Text accessibilityRole="header" className="min-w-0 flex-1 px-1 text-2xl font-semibold text-foreground">
          {t('plugins.title')}
        </Text>
        {downloads.length > 0 ? (
          <Button
            accessibilityLabel={
              activeDownloads > 0
                ? t('plugins.downloads.openWithCount', { count: activeDownloads })
                : t('plugins.downloads.open')
            }
            className="h-9 rounded-full"
            hitSlop={4}
            isIconOnly
            onPress={() => router.push(DOWNLOADS_ROUTE)}
            size="sm"
            variant="secondary">
            <Icon name="download" size={19} color={iconColor} />
            {activeDownloads > 0 ? (
              <View
                importantForAccessibility="no-hide-descendants"
                className="absolute right-0 top-0 size-2.5 rounded-full bg-accent"
              />
            ) : null}
          </Button>
        ) : null}
        <Button
          accessibilityLabel={t('plugins.catalog.browse')}
          className="h-9 rounded-full"
          hitSlop={4}
          isDisabled={isPicking}
          isIconOnly
          onPress={() => router.push(CATALOG_ROUTE)}
          size="sm"
          variant="secondary">
          {isPicking ? <Spinner color={iconColor} size="sm" /> : <Icon name="plus" size={19} color={iconColor} />}
        </Button>
        <Menu>
          <Menu.Trigger asChild>
            <Button
              accessibilityLabel={t('plugins.moreActions')}
              className="h-9 rounded-full"
              hitSlop={4}
              isIconOnly
              size="sm"
              variant="secondary">
              <Icon name="more" size={19} color={iconColor} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Overlay />
            <Menu.Content align="end" placement="bottom" presentation="popover" width={240}>
              <Menu.Item onPress={() => void pickPackage()}>
                <Menu.ItemTitle>{t('plugins.installFromFile')}</Menu.ItemTitle>
              </Menu.Item>
              <Menu.Item onPress={() => router.push(PLUGIN_SETTINGS_ROUTE)}>
                <Menu.ItemTitle>{t('plugins.settingsTitle')}</Menu.ItemTitle>
              </Menu.Item>
              <Menu.Item
                onPress={() => {
                  setSafeModeRequested(true);
                  toast.show({ variant: 'default', label: t('plugins.safeModeScheduled') });
                }}>
                <Menu.ItemTitle>{t('plugins.requestSafeMode')}</Menu.ItemTitle>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow px-4 pt-2"
        contentContainerStyle={{ paddingBottom: APP_TAB_BAR_HEIGHT + insets.bottom + 32 }}>
        <View className="w-full max-w-[800px] grow gap-6 self-center">
          {safeMode ? (
            <View className="gap-3 rounded-3xl bg-surface p-5">
              <Text className="text-base font-semibold text-foreground">{t('plugins.safeModeTitle')}</Text>
              <Text className="text-sm leading-5 text-muted">{t('plugins.safeModeBody')}</Text>
              <Button
                variant="secondary"
                onPress={() => {
                  runtime.exitSafeMode();
                  setSafeMode(false);
                }}>
                {t('plugins.exitSafeMode')}
              </Button>
            </View>
          ) : null}

          {statuses.length === 0 ? (
            <View className="grow items-center justify-center gap-3 px-6 pb-16">
              <View className="size-16 items-center justify-center rounded-3xl border border-border bg-surface">
                <Icon name={pluginIconSource(undefined)} size={30} color={iconColor} />
              </View>
              <Text className="text-base font-semibold text-foreground">{t('plugins.empty')}</Text>
            </View>
          ) : (
            <View className="gap-1">
              {statuses.map((status) => {
                const openDetail = () =>
                  router.push({
                    pathname: '/plugins/[pluginId]',
                    params: { pluginId: status.plugin.id },
                  } as unknown as Href);
                // Plugins with pages open their first entry page; the rest open their settings screen.
                const page = status.enabled ? pluginEntryRoutes(status.plugin.manifest)[0] : undefined;
                return (
                  <PluginRow
                    key={status.plugin.id}
                    status={status}
                    title={runtime.host.localize(status.plugin.id, status.plugin.manifest.name)}
                    description={
                      status.plugin.manifest.description
                        ? runtime.host.localize(status.plugin.id, status.plugin.manifest.description)
                        : undefined
                    }
                    updateVersion={updates.get(status.plugin.id)}
                    iconColor={iconColor}
                    onOpenPage={
                      page
                        ? () =>
                            router.push({
                              pathname: '/plugin/[pluginId]/[pageId]',
                              params: { pluginId: status.plugin.id, pageId: page.id },
                            } as unknown as Href)
                        : undefined
                    }
                    onOpenSettings={openDetail}
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <PluginInstallDialog {...dialogProps} />
    </View>
  );
}

function PluginRow({
  status,
  title,
  description,
  updateVersion,
  iconColor,
  onOpenPage,
  onOpenSettings,
}: {
  readonly status: PluginStatus;
  readonly title: string;
  readonly description?: string;
  /** A newer compatible version that an added catalog offers. */
  readonly updateVersion?: string;
  readonly iconColor: string;
  /** Opens the plugin's own entry page; absent when the plugin has none or is disabled. */
  readonly onOpenPage?: () => void;
  /** Opens the host-provided settings screen every plugin has; its pages reach it from their header. */
  readonly onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const hasProblem = status.state === 'failed' || status.notice !== undefined;
  const detail = [
    status.plugin.version,
    status.enabled ? undefined : t('plugins.disabled'),
    updateVersion ? t('plugins.catalog.updateAvailable', { version: updateVersion }) : undefined,
    t(`plugins.source.${status.plugin.source}`),
    status.pendingVersion ? t('plugins.pendingVersion', { version: status.pendingVersion }) : undefined,
    status.state === 'failed' ? t('plugins.failed') : undefined,
    status.notice ? t('plugins.restoredVersion', { version: status.notice.restoredVersion }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={
          onOpenPage ? `${detail}. ${t('plugins.openPageHint')}` : `${detail}. ${t('plugins.openSettings')}`
        }
        className="min-w-0 flex-1 flex-row items-center gap-4 rounded-3xl px-2 py-3 active:bg-surface"
        onPress={onOpenPage ?? onOpenSettings}>
        <View className={status.enabled ? undefined : 'opacity-50'}>
          <PluginIcon plugin={status.plugin} size="md" />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {title}
          </Text>
          {description ? (
            <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
          <Text className={`text-xs leading-4 ${hasProblem ? 'text-danger' : 'text-muted'}`} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="pr-1">
          <Icon name="chevronRight" size={18} color={iconColor} />
        </View>
      </Pressable>
    </View>
  );
}
