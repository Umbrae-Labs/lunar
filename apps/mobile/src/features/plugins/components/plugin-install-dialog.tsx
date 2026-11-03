import { Button } from 'heroui-native/button';
import { Dialog } from 'heroui-native/dialog';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { localizeManifestText } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import { useTranslation } from '@/i18n';
import type { PluginInstallPreview } from '../services/plugin-installer';
import { pickMessages } from '../services/plugin-locale';

interface PluginInstallDialogProps {
  readonly preview?: PluginInstallPreview;
  readonly isInstalling: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** States the trust model plainly before a plugin's code is ever written to disk or run. */
export function PluginInstallDialog({ preview, isInstalling, onConfirm, onCancel }: PluginInstallDialogProps) {
  const { t, i18n } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const manifest = preview?.package.manifest;
  const messages = manifest
    ? pickMessages(
        {
          id: manifest.id,
          version: manifest.version,
          source: 'community',
          manifest,
          locales: preview.package.locales,
          installedAt: 0,
          updatedAt: 0,
        },
        i18n.language,
      )
    : undefined;
  const text = (value: string) => localizeManifestText(value, messages);
  const added = new Set(preview?.addedPermissions);

  return (
    <Dialog
      isOpen={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open && !isInstalling) onCancel();
      }}>
      <Dialog.Portal unstable_accessibilityContainerViewIsModal>
        <Dialog.Overlay className="bg-black/40 dark:bg-black/70" />
        {/* Swiping to dismiss would claim the vertical drags the permission list needs. */}
        <Dialog.Content className="mx-5 max-w-md gap-4 rounded-2xl p-5" isSwipeable={false}>
          {manifest && preview ? (
            <>
              <Dialog.Title>
                {t(`plugins.installTitle.${preview.kind}`, { name: text(manifest.name), version: manifest.version })}
              </Dialog.Title>
              <ScrollView contentContainerClassName="gap-3" style={{ maxHeight: windowHeight * 0.5 }}>
                <Text className="text-sm leading-5 text-muted">
                  {[
                    manifest.id,
                    manifest.author,
                    preview.current ? `${preview.current.version} → ${manifest.version}` : manifest.version,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {manifest.description ? (
                  <Text className="text-sm leading-5 text-foreground">{text(manifest.description)}</Text>
                ) : null}
                <View className="gap-1 rounded-xl bg-danger-soft p-3">
                  <Text className="text-sm font-semibold text-danger">{t('plugins.trustTitle')}</Text>
                  <Text className="text-sm leading-5 text-foreground">{t('plugins.trustBody')}</Text>
                </View>
                <Text
                  className={`text-sm leading-5 ${preview.trust.kind === 'verified' ? 'text-foreground' : 'text-muted'}`}>
                  {preview.trust.kind === 'verified'
                    ? t('plugins.catalog.verifiedBy', { name: preview.trust.catalogName })
                    : preview.trust.kind === 'unknownKey'
                      ? t('plugins.catalog.unknownKey', { key: preview.trust.keyId.slice(0, 12) })
                      : t('plugins.unsigned')}
                </Text>
                {preview.current && preview.kind !== 'reinstall' ? (
                  <Text className="text-sm leading-5 text-muted">
                    {t(preview.kind === 'downgrade' ? 'plugins.downgradeWarning' : 'plugins.updateSafety', {
                      version: preview.current.version,
                    })}
                  </Text>
                ) : null}
                {preview.migratesData && preview.kind === 'update' ? (
                  <Text className="text-sm leading-5 text-muted">{t('plugins.migratesData')}</Text>
                ) : null}
                <Text className="text-sm font-semibold text-foreground">{t('plugins.permissions')}</Text>
                {manifest.permissions.length === 0 ? (
                  <Text className="text-sm text-muted">{t('plugins.noPermissions')}</Text>
                ) : (
                  manifest.permissions.map((permission) => (
                    <View key={permission.name} className="gap-0.5">
                      <Text className="text-sm font-medium text-foreground">
                        {permissionLabel(permission.name, t)}
                        {added.has(permission.name) && preview.current ? ` · ${t('plugins.newPermission')}` : ''}
                      </Text>
                      <Text className="text-xs leading-4 text-muted">{text(permission.reason)}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
              <View className="flex-row gap-3">
                <Button className="flex-1" isDisabled={isInstalling} onPress={onCancel} variant="tertiary">
                  {t('action.cancel')}
                </Button>
                <Button className="flex-1" isDisabled={isInstalling} onPress={onConfirm} variant="primary">
                  {isInstalling ? t('plugins.installing') : t('plugins.install')}
                </Button>
              </View>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

export function permissionLabel(name: string, t: (key: string, options?: Record<string, string>) => string): string {
  // Per-origin names come from manifests installed before the single `network` permission.
  if (name.startsWith('network:')) return t('plugins.permission.network');
  return t(`plugins.permission.${name}`);
}
