import { BottomSheet } from 'heroui-native/bottom-sheet';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { InstalledPlugin } from '../domain/installed-plugin';
import { permissionLabel } from './plugin-install-dialog';

interface PluginInfoSheetProps {
  readonly plugin: InstalledPlugin;
  readonly localize: (value: string) => string;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

function InfoSheet({
  title,
  isOpen,
  onOpenChange,
  children,
}: {
  readonly title: string;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay variant="blur" blurViewProps={{ intensity: 28 }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl"
          bottomInset={insets.bottom}
          contentContainerClassName="gap-4 px-5 pb-6"
          enableOverDrag={false}>
          <BottomSheet.Title className="text-xl text-foreground">{title}</BottomSheet.Title>
          {children}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

export function PluginPermissionsSheet({ plugin, localize, isOpen, onOpenChange }: PluginInfoSheetProps) {
  const { t } = useTranslation();
  const permissions = plugin.manifest.permissions;
  return (
    <InfoSheet title={t('plugins.permissions')} isOpen={isOpen} onOpenChange={onOpenChange}>
      <Text className="text-sm leading-5 text-muted">{t('plugins.trustBody')}</Text>
      {permissions.length === 0 ? (
        <Text className="text-base text-foreground">{t('plugins.noPermissions')}</Text>
      ) : (
        <View className="gap-4">
          {permissions.map((permission) => (
            <View key={permission.name} className="gap-0.5">
              <Text className="text-base font-medium text-foreground">{permissionLabel(permission.name, t)}</Text>
              <Text className="text-sm leading-5 text-muted">{localize(permission.reason)}</Text>
            </View>
          ))}
        </View>
      )}
    </InfoSheet>
  );
}

export function PluginSourceSheet({ plugin, isOpen, onOpenChange }: PluginInfoSheetProps) {
  const { t } = useTranslation();
  const catalog = usePluginStore((state) => state.catalogs.find((item) => item.keyId === plugin.signerKeyId));
  const rows = [
    [t('plugins.info.id'), plugin.id],
    [t('plugins.info.version'), plugin.version],
    [t('plugins.info.author'), plugin.manifest.author ?? t('plugins.info.unknown')],
    [t('plugins.info.type'), t(`plugins.source.${plugin.source}`)],
    [
      t('plugins.info.signer'),
      plugin.signerKeyId
        ? catalog
          ? `${catalog.name} · ${plugin.signerKeyId}`
          : plugin.signerKeyId
        : t('plugins.info.unsigned'),
    ],
  ] as const;
  return (
    <InfoSheet title={t('plugins.info.title')} isOpen={isOpen} onOpenChange={onOpenChange}>
      <View className="gap-4">
        {rows.map(([label, value]) => (
          <View key={label} className="gap-0.5">
            <Text className="text-sm text-muted">{label}</Text>
            <Text selectable className="text-base text-foreground">
              {value}
            </Text>
          </View>
        ))}
      </View>
    </InfoSheet>
  );
}
