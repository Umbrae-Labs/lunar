import { ThemedBottomSheetPortal } from '@/components/ui/themed-bottom-sheet-portal';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { useEffect } from 'react';
import { BackHandler, Keyboard, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ReaderFontRole } from '@/reader';
import { FontPickerContent } from './font-picker-content';

interface ReaderFontSelectionSheetProps {
  readonly role: ReaderFontRole;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** Reuses the reader's font catalog and persisted selection outside a reading session. */
export function ReaderFontSelectionSheet({ role, isOpen, onOpenChange }: ReaderFontSelectionSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onOpenChange]);

  const handleOpenChange = (open: boolean) => {
    if (!open) Keyboard.dismiss();
    onOpenChange(open);
  };

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <ThemedBottomSheetPortal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="bg-background dark:bg-surface"
          contentContainerClassName="h-full flex-1 p-0"
          topInset={insets.top}
          bottomInset={insets.bottom}
          enableDynamicSizing={false}
          enableOverDrag={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          enableBlurKeyboardOnGesture
          snapPoints={[Math.max(1, Math.min(height * 0.75, height - insets.top - insets.bottom))]}>
          <FontPickerContent key={role} role={role} onBack={() => handleOpenChange(false)} />
        </BottomSheet.Content>
      </ThemedBottomSheetPortal>
    </BottomSheet>
  );
}
