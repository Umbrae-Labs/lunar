import type { Href } from 'expo-router';
import { Button } from 'heroui-native/button';
import { ControlField } from 'heroui-native/control-field';
import { Description } from 'heroui-native/description';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { ListGroup } from 'heroui-native/list-group';
import { Separator } from 'heroui-native/separator';
import { useToast } from 'heroui-native/toast';
import { useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import { pluginErrorMessage } from '../domain/plugin-error';
import { PluginCatalogSettings } from '../components/plugin-catalog-settings';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';

export function PluginSettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  useMarkInitialContentReady(true);
  const runtime = usePluginRuntime();
  const devStatus = useSyncExternalStore(runtime.subscribeDevStatus, runtime.getDevStatus);
  const developerMode = usePluginStore((state) => state.developerMode);
  const setDeveloperMode = usePluginStore((state) => state.setDeveloperMode);
  const [devUrl, setDevUrl] = useState(devStatus?.url ?? '');

  const connect = () => {
    try {
      runtime.connectDevServer(devUrl);
    } catch (error) {
      toast.show({ variant: 'danger', label: pluginErrorMessage(error) });
    }
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader title={t('plugins.settingsTitle')} fallback={'/(tabs)/settings' as Href} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="grow px-4 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[800px] gap-6 self-center">
          <ListGroup className="overflow-hidden rounded-3xl bg-surface">
            <ControlField
              accessibilityLabel={t('plugins.developerMode')}
              accessibilityRole="switch"
              accessibilityState={{ checked: developerMode }}
              className="min-h-[72px] px-5 py-4 active:bg-surface-secondary"
              isSelected={developerMode}
              onSelectedChange={(enabled) => {
                setDeveloperMode(enabled);
                if (!enabled) runtime.disconnectDevServer();
              }}>
              <View className="flex-1 pr-4">
                <Label className="text-base font-medium text-foreground">{t('plugins.developerMode')}</Label>
                <Description className="mt-0.5 text-sm leading-5 text-muted">
                  {t('plugins.developerModeDescription')}
                </Description>
              </View>
              <ControlField.Indicator>
                <ToggleSwitch accessibilityElementsHidden />
              </ControlField.Indicator>
            </ControlField>
            {developerMode ? (
              <View className="gap-3 px-5 pb-5">
                <Separator />
                <Label>{t('plugins.devServer')}</Label>
                <Input
                  value={devUrl}
                  onChangeText={setDevUrl}
                  placeholder="http://192.168.1.2:5757/?token=…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel={t('plugins.devServer')}
                />
                {devStatus ? (
                  <Text className={`text-sm ${devStatus.state === 'error' ? 'text-danger' : 'text-muted'}`}>
                    {devStatus.state === 'error'
                      ? devStatus.error
                      : devStatus.state === 'connected'
                        ? t('plugins.devConnected', {
                            id: devStatus.pluginId ?? '',
                            revision: String(devStatus.revision ?? 0),
                          })
                        : t('plugins.devConnecting')}
                  </Text>
                ) : null}
                <View className="flex-row gap-3">
                  <Button className="flex-1" variant="primary" isDisabled={!devUrl.trim()} onPress={connect}>
                    {t(devStatus ? 'plugins.devReconnect' : 'plugins.devConnect')}
                  </Button>
                  {devStatus ? (
                    <Button className="flex-1" variant="tertiary" onPress={() => runtime.disconnectDevServer()}>
                      {t('plugins.devDisconnect')}
                    </Button>
                  ) : null}
                </View>
              </View>
            ) : null}
          </ListGroup>
          <PluginCatalogSettings />
        </View>
      </ScrollView>
    </View>
  );
}
