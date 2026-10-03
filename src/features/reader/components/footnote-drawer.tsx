import { ThemedBottomSheetPortal } from '@/components/ui/themed-bottom-sheet-portal';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import type { ReaderFootnote } from '@/reader';

interface FootnoteDrawerProps {
  readonly footnote?: ReaderFootnote;
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
}

export function FootnoteDrawer({ footnote, isOpen, onOpenChange }: FootnoteDrawerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <ThemedBottomSheetPortal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay variant="blur" blurViewProps={{ intensity: 28 }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl"
          bottomInset={insets.bottom}
          contentContainerClassName="gap-4 px-5 pb-6"
          enableOverDrag={false}>
          <View className="gap-1">
            <BottomSheet.Title className="text-xl text-foreground">{t('reader.footnote')}</BottomSheet.Title>
            {footnote && (
              <BottomSheet.Description className="text-xs uppercase text-muted">
                {t(`reader.footnoteKind.${footnote.kind}`)}
              </BottomSheet.Description>
            )}
          </View>
          <Text selectable className="text-base leading-7 text-foreground">
            {footnote?.text ?? t('reader.loadingFootnote')}
          </Text>
        </BottomSheet.Content>
      </ThemedBottomSheetPortal>
    </BottomSheet>
  );
}
