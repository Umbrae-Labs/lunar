import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { ControlField } from 'heroui-native/control-field';
import { useThemeColor } from 'heroui-native/hooks';
import { Menu } from 'heroui-native/menu';
import { Spinner } from 'heroui-native/spinner';
import { useToast } from 'heroui-native/toast';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { PluginStatus } from '../domain/installed-plugin';
import { pluginErrorMessage } from '../domain/plugin-error';
import { pluginSymbolName } from '../domain/plugin-icons';
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

export function PluginManagerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { install: installRequest } = useLocalSearchParams<{ install?: string }>();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  useMarkInitialContentReady(true);
  const runtime = usePluginRuntime();
  const statuses = useSyncExternalStore(runtime.host.subscribe, runtime.host.getStatuses);
  const setEnabled = usePluginStore((state) => state.setEnabled);
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
        <Button
          accessibilityLabel={t('plugins.catalog.browse')}
          className="h-9 rounded-full"
          hitSlop={4}
          isDisabled={isPicking}
          isIconOnly
          onPress={() => router.push(CATALOG_ROUTE)}
          size="sm"
          variant="secondary">
          {isPicking ? (
            <Spinner color={iconColor} size="sm" />
          ) : (
            <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={19} tintColor={iconColor} />
          )}
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
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }}
                size={19}
                tintColor={iconColor}
              />
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
                <SymbolView name={pluginSymbolName(undefined)} size={30} tintColor={iconColor} />
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
                // Plugins with pages open their first entry page; the rest open their information screen.
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
                    safeMode={safeMode}
                    updateVersion={updates.get(status.plugin.id)}
                    onToggle={(enabled) => setEnabled(status.plugin.id, enabled)}
                    opensPage={page !== undefined}
                    onPress={
                      page
                        ? () =>
                            router.push({
                              pathname: '/plugin/[pluginId]/[pageId]',
                              params: { pluginId: status.plugin.id, pageId: page.id },
                            } as unknown as Href)
                        : openDetail
                    }
                    onLongPress={openDetail}
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
  safeMode,
  updateVersion,
  onToggle,
  opensPage,
  onPress,
  onLongPress,
}: {
  readonly status: PluginStatus;
  readonly title: string;
  readonly description?: string;
  readonly safeMode: boolean;
  /** A newer compatible version that an added catalog offers. */
  readonly updateVersion?: string;
  readonly onToggle: (enabled: boolean) => void;
  readonly opensPage: boolean;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const development = status.plugin.source === 'development';
  const hasProblem = status.state === 'failed' || status.notice !== undefined;
  const detail = [
    status.plugin.version,
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
        accessibilityHint={opensPage ? `${detail}. ${t('plugins.longPressForInfo')}` : detail}
        accessibilityActions={[{ name: 'longpress', label: t('plugins.detailTitle') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') onLongPress();
        }}
        className="min-w-0 flex-1 flex-row items-center gap-4 rounded-3xl px-2 py-3 active:bg-surface"
        delayLongPress={400}
        onLongPress={onLongPress}
        onPress={onPress}>
        <PluginIcon plugin={status.plugin} size="md" />
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
      </Pressable>
      {development ? null : (
        <View className="pl-2 pr-2">
          <ControlField
            accessibilityLabel={t('plugins.enable', { name: title })}
            accessibilityRole="switch"
            accessibilityState={{ checked: status.enabled, disabled: safeMode }}
            isDisabled={safeMode}
            isSelected={status.enabled}
            onSelectedChange={onToggle}>
            <ControlField.Indicator>
              <ToggleSwitch accessibilityElementsHidden />
            </ControlField.Indicator>
          </ControlField>
        </View>
      )}
    </View>
  );
}
