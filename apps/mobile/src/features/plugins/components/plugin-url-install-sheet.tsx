import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useBottomSheetAwareHandlers, useThemeColor } from 'heroui-native/hooks';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { Spinner } from 'heroui-native/spinner';
import { TextField } from 'heroui-native/text-field';
import { useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';

interface PluginUrlInstallSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Downloads and inspects the package; returns whether it advanced to install confirmation. */
  readonly onSubmit: (url: string) => Promise<boolean>;
}

/** Bottom sheet for installing a plugin package from a GitHub repository, release, or asset URL. */
export function PluginUrlInstallSheet({ isOpen, onClose, onSubmit }: PluginUrlInstallSheetProps) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const close = () => {
    setUrl('');
    onClose();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isDownloading) close();
  };

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed || isDownloading) return;
    Keyboard.dismiss();
    setIsDownloading(true);
    try {
      const accepted = await onSubmit(trimmed);
      if (accepted) close();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl"
          bottomInset={insets.bottom}
          contentContainerClassName="gap-4 px-5 pb-6"
          enableOverDrag={false}
          enablePanDownToClose={!isDownloading}>
          <UrlInstallForm
            isDownloading={isDownloading}
            onCancel={close}
            onChangeUrl={setUrl}
            onSubmit={() => void submit()}
            url={url}
          />
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

function UrlInstallForm({
  url,
  isDownloading,
  onChangeUrl,
  onCancel,
  onSubmit,
}: {
  readonly url: string;
  readonly isDownloading: boolean;
  readonly onChangeUrl: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const accentForeground = useThemeColor('accent-foreground');
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();

  return (
    <>
      <BottomSheet.Title className="text-xl text-foreground">{t('plugins.installFromUrl')}</BottomSheet.Title>
      <TextField isDisabled={isDownloading}>
        <Label>{t('plugins.catalog.github')}</Label>
        <Input
          accessibilityLabel={t('plugins.catalog.github')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onBlur={onBlur}
          onChangeText={onChangeUrl}
          onFocus={onFocus}
          onSubmitEditing={onSubmit}
          placeholder="https://github.com/owner/plugin"
          returnKeyType="go"
          value={url}
        />
      </TextField>
      <View className="flex-row gap-3">
        <Button className="flex-1" isDisabled={isDownloading} onPress={onCancel} variant="tertiary">
          {t('action.cancel')}
        </Button>
        <Button className="flex-1" isDisabled={!url.trim() || isDownloading} onPress={onSubmit} variant="primary">
          {isDownloading ? <Spinner color={accentForeground} size="sm" /> : t('plugins.installFromUrlAction')}
        </Button>
      </View>
    </>
  );
}
