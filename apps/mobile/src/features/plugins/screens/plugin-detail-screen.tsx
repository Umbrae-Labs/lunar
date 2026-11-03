import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from 'heroui-native/button';
import { ControlField } from 'heroui-native/control-field';
import { Description } from 'heroui-native/description';
import { Label } from 'heroui-native/label';
import { ListGroup } from 'heroui-native/list-group';
import { Separator } from 'heroui-native/separator';
import { Switch } from 'heroui-native/switch';
import { useToast } from 'heroui-native/toast';
import { useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { MAX_PLUGIN_TABS, usePluginStore } from '@/stores';
import { pluginErrorMessage } from '../domain/plugin-error';
import { pluginEntryRoutes } from '../domain/plugin-pages';
import { PluginIcon } from '../components/plugin-icon';
import { PluginPermissionsSheet, PluginSourceSheet } from '../components/plugin-info-sheets';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';
import { PluginSettingsForm } from '../components/plugin-settings-form';
import { PluginSlotView } from '../components/plugin-slot-view';
import { canPinPluginTab } from '../hooks/use-plugin-app-tabs';

const PLUGINS_TAB = '/(tabs)/plugins' as Href;

export function PluginDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  useMarkInitialContentReady(true);
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const runtime = usePluginRuntime();
  const host = runtime.host;
  const statuses = useSyncExternalStore(host.subscribe, host.getStatuses);
  useSyncExternalStore(host.subscribeLogs, host.getLogVersion);
  const status = statuses.find((item) => item.plugin.id === pluginId);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const pinnedTabs = usePluginStore((state) => state.tabs);
  const setTabPinned = usePluginStore((state) => state.setTabPinned);
  const credentialRecords = usePluginStore((state) => state.credentials[pluginId]);
  const [keepData, setKeepData] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [sheet, setSheet] = useState<'permissions' | 'source'>();

  if (!status) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <PluginScreenHeader title={t('plugins.detailTitle')} fallback={PLUGINS_TAB} />
        <Text className="px-5 text-sm text-muted">{t('plugins.notFound')}</Text>
      </View>
    );
  }

  const { plugin } = status;
  const manifest = plugin.manifest;
  const text = (value: string) => host.localize(plugin.id, value);
  const development = plugin.source === 'development';
  const customSettings = manifest.contributes.slots['settings.plugin'][0];
  const routes = pluginEntryRoutes(manifest);
  const pinnable = canPinPluginTab(status);
  const pinned = pinnedTabs.includes(plugin.id);
  const pinFull = !pinned && pinnedTabs.length >= MAX_PLUGIN_TABS;
  const logCount = host.getLogs(plugin.id).length;
  const stateText = [
    t(`plugins.state.${status.state}`),
    status.activationMs !== undefined ? t('plugins.activationTime', { ms: String(status.activationMs) }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const problems = [
    status.error,
    status.notice
      ? t('plugins.reverted', {
          failed: status.notice.failedVersion,
          restored: status.notice.restoredVersion,
          reason: status.notice.reason,
        })
      : undefined,
  ].filter((problem): problem is string => Boolean(problem));

  const uninstall = async () => {
    setIsUninstalling(true);
    try {
      await runtime.uninstall(plugin.id, keepData);
      setConfirmUninstall(false);
      if (router.canGoBack()) router.back();
      else router.replace(PLUGINS_TAB);
    } catch (error) {
      toast.show({ variant: 'danger', label: pluginErrorMessage(error) });
    } finally {
      setIsUninstalling(false);
    }
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader title={t('plugins.detailTitle')} fallback={PLUGINS_TAB} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow px-4 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[800px] gap-6 self-center">
          <ListGroup className="overflow-hidden rounded-3xl bg-surface">
            <View className="gap-4 px-5 pt-5 pb-4">
              <View className="flex-row items-center gap-4">
                <PluginIcon plugin={plugin} size="lg" />
                <View className="min-w-0 flex-1 gap-1">
                  <Text accessibilityRole="header" className="text-xl font-semibold text-foreground" numberOfLines={2}>
                    {text(manifest.name)}
                  </Text>
                  <Text className="text-sm text-muted">{t('plugins.versionLabel', { version: plugin.version })}</Text>
                </View>
              </View>
              {manifest.description ? (
                <Text className="text-sm leading-5 text-muted">{text(manifest.description)}</Text>
              ) : null}
              {status.pendingVersion ? (
                <Text className="text-sm leading-5 text-muted">
                  {t('plugins.pendingVersion', { version: status.pendingVersion })}
                </Text>
              ) : null}
              {problems.map((problem) => (
                <Text key={problem} className="text-sm leading-5 text-danger">
                  {problem}
                </Text>
              ))}
            </View>
            <Separator className="mx-5" />

            <ControlField
              accessibilityLabel={t('plugins.enable', { name: text(manifest.name) })}
              accessibilityRole="switch"
              accessibilityState={{ checked: status.enabled, disabled: development || runtime.isSafeMode() }}
              className="min-h-[72px] px-5 py-4 active:bg-surface-secondary"
              isDisabled={development || runtime.isSafeMode()}
              isSelected={status.enabled}
              onSelectedChange={(enabled) => setEnabled(plugin.id, enabled)}>
              <View className="flex-1 pr-4">
                <Label className="text-base font-medium text-foreground">{t('plugins.enabled')}</Label>
                <Description className="mt-0.5 text-sm leading-5 text-muted">{stateText}</Description>
              </View>
              <ControlField.Indicator>
                <Switch className="h-7 w-12" accessibilityElementsHidden>
                  <Switch.Thumb className="size-5" />
                </Switch>
              </ControlField.Indicator>
            </ControlField>
            <InfoRow
              title={t('plugins.permissions')}
              value={
                manifest.permissions.length === 0
                  ? t('plugins.permissionCountNone')
                  : t('plugins.permissionCount', { count: String(manifest.permissions.length) })
              }
              onPress={() => setSheet('permissions')}
            />
            <InfoRow
              title={t('plugins.info.title')}
              value={t(`plugins.source.${plugin.source}`)}
              onPress={() => setSheet('source')}
            />
            <InfoRow
              title={t('plugins.logs')}
              value={String(logCount)}
              onPress={() =>
                router.push({
                  pathname: '/plugins/[pluginId]/logs',
                  params: { pluginId: plugin.id },
                } as unknown as Href)
              }
            />
          </ListGroup>

          {status.enabled && routes.length > 0 ? (
            <ListGroup className="overflow-hidden rounded-3xl bg-surface">
              {routes.map((route) => (
                <InfoRow
                  key={route.id}
                  title={text(route.title)}
                  value={t('plugins.openPage')}
                  onPress={() =>
                    router.push({
                      pathname: '/plugin/[pluginId]/[pageId]',
                      params: { pluginId: plugin.id, pageId: route.id },
                    } as unknown as Href)
                  }
                />
              ))}
              {pinnable ? (
                <ControlField
                  accessibilityLabel={t('plugins.pinTab')}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: pinned, disabled: pinFull }}
                  className="min-h-[72px] px-5 py-4 active:bg-surface-secondary"
                  isDisabled={pinFull}
                  isSelected={pinned}
                  onSelectedChange={(value) => setTabPinned(plugin.id, value)}>
                  <View className="flex-1 pr-4">
                    <Label className="text-base font-medium text-foreground">{t('plugins.pinTab')}</Label>
                    <Description className="mt-0.5 text-sm leading-5 text-muted">
                      {pinFull
                        ? t('plugins.pinTabFull', { count: String(MAX_PLUGIN_TABS) })
                        : t('plugins.pinTabDescription')}
                    </Description>
                  </View>
                  <ControlField.Indicator>
                    <Switch className="h-7 w-12" accessibilityElementsHidden>
                      <Switch.Thumb className="size-5" />
                    </Switch>
                  </ControlField.Indicator>
                </ControlField>
              ) : null}
            </ListGroup>
          ) : null}

          {manifest.contributes.credentials.length > 0 ? (
            <View className="gap-2">
              <Text className="ml-3 text-sm font-medium text-muted">{t('plugins.credentials')}</Text>
              <ListGroup className="overflow-hidden rounded-3xl bg-surface">
                {manifest.contributes.credentials.map((credential) => {
                  const record = credentialRecords?.[credential.id];
                  return (
                    <InfoRow
                      key={credential.id}
                      title={text(credential.title)}
                      value={
                        record
                          ? t('plugins.credentialConfigured', { host: new URL(record.baseUrl).host })
                          : t('plugins.credentialMissing')
                      }
                      onPress={() => void runtime.configureCredential(plugin.id, credential.id)}
                    />
                  );
                })}
              </ListGroup>
            </View>
          ) : null}

          {manifest.contributes.settings.length > 0 || customSettings ? (
            <View className="gap-2">
              <Text className="ml-3 text-sm font-medium text-muted">{t('plugins.settings')}</Text>
              <View className="gap-4 rounded-3xl bg-surface p-5">
                <PluginSettingsForm host={host} plugin={plugin} />
                {customSettings && status.enabled ? (
                  <PluginSlotView
                    host={host}
                    pluginId={plugin.id}
                    componentKey={`settings.plugin:${customSettings.id}`}
                    componentProps={{ slotId: customSettings.id }}
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          {development ? null : (
            <View className="gap-3">
              <ControlField
                accessibilityLabel={t('plugins.keepData')}
                accessibilityRole="switch"
                accessibilityState={{ checked: keepData }}
                className="px-3"
                isSelected={keepData}
                onSelectedChange={setKeepData}>
                <View className="flex-1 pr-4">
                  <Label className="text-sm text-foreground">{t('plugins.keepData')}</Label>
                </View>
                <ControlField.Indicator>
                  <Switch className="h-7 w-12" accessibilityElementsHidden>
                    <Switch.Thumb className="size-5" />
                  </Switch>
                </ControlField.Indicator>
              </ControlField>
              <Button variant="danger" onPress={() => setConfirmUninstall(true)}>
                {t('plugins.uninstall')}
              </Button>
            </View>
          )}
        </View>
      </ScrollView>

      <PluginPermissionsSheet
        plugin={plugin}
        localize={text}
        isOpen={sheet === 'permissions'}
        onOpenChange={(isOpen) => setSheet(isOpen ? 'permissions' : undefined)}
      />
      <PluginSourceSheet
        plugin={plugin}
        localize={text}
        isOpen={sheet === 'source'}
        onOpenChange={(isOpen) => setSheet(isOpen ? 'source' : undefined)}
      />
      <ConfirmModal
        isOpen={confirmUninstall}
        title={t('plugins.uninstallTitle', { name: text(manifest.name) })}
        description={t(keepData ? 'plugins.uninstallKeepData' : 'plugins.uninstallDeleteData')}
        confirmLabel={t('plugins.uninstall')}
        isDestructive
        isConfirming={isUninstalling}
        onConfirm={() => void uninstall()}
        onOpenChange={setConfirmUninstall}
      />
    </View>
  );
}

function InfoRow({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <ListGroup.Item
      accessibilityLabel={`${title}, ${value}`}
      accessibilityRole="button"
      className="min-h-[64px] px-5 py-4 active:bg-surface-secondary"
      onPress={onPress}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="text-base font-medium text-foreground">{title}</ListGroup.ItemTitle>
      </ListGroup.ItemContent>
      <Text className="ml-4 text-sm text-muted">{value}</Text>
      <ListGroup.ItemSuffix className="ml-2" iconProps={{ size: 18 }} />
    </ListGroup.Item>
  );
}
