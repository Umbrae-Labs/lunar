import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { SymbolView } from 'expo-symbols';
import { useBottomSheetAwareHandlers, useThemeColor } from 'heroui-native/hooks';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { BackHandler, Keyboard, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useTranslation } from '@/i18n';
import { MarkdownEditor } from '@/components/markdown';
import { ReaderNoteMaxLength } from '../../domain/reader-highlight';

interface NoteEditorProps {
  readonly isOpen: boolean;
  readonly initialNote: string;
  readonly onClose: () => void;
  readonly onSave: (content: string) => Promise<void>;
  readonly portalHostName: string;
  readonly confirmationHostName: string;
}

export function NoteEditor({
  isOpen,
  initialNote,
  onClose,
  onSave,
  portalHostName,
  confirmationHostName,
}: NoteEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor('foreground');
  const [value, setValue] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const pending = useRef(false);
  const dirty = value !== initialNote;
  const [draftSession, setDraftSession] = useState({ isOpen, initialNote });
  // Reset the draft for an opening session without remounting the sheet.
  // HeroUI needs the same sheet instance to transition from false to true.
  if (draftSession.isOpen !== isOpen || draftSession.initialNote !== initialNote) {
    setDraftSession({ isOpen, initialNote });
    if (isOpen) {
      setValue(initialNote);
      setDiscarding(false);
    }
  }

  const close = useCallback(() => {
    if (pending.current) return;
    if (dirty) {
      setDiscarding(true);
      return;
    }
    Keyboard.dismiss();
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!isOpen || discarding) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close, discarding, isOpen]);

  async function save() {
    if (pending.current || !value.trim()) return;
    pending.current = true;
    setSaving(true);
    try {
      await onSave(value);
      Keyboard.dismiss();
      onClose();
      toast.show({ variant: 'success', label: t('reader.noteSaved') });
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: t('reader.noteSaveFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onOpenChange={(next) => {
          if (!next) close();
        }}>
        <BottomSheet.Portal
          hostName={portalHostName}
          disableFullWindowOverlay
          unstable_accessibilityContainerViewIsModal>
          <BottomSheet.Overlay isCloseOnPress={!saving} />
          <BottomSheet.Content
            snapPoints={['72%', '92%']}
            enableDynamicSizing={false}
            enableOverDrag={false}
            enablePanDownToClose={!dirty && !saving}
            enableContentPanningGesture={false}
            topInset={insets.top}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
            contentContainerClassName="h-full flex-1 gap-3 px-5 pt-2"
            contentContainerProps={{ style: { paddingBottom: insets.bottom + 16 } }}>
            <View className="flex-row items-center">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="size-10 shrink-0"
                hitSlop={4}
                accessibilityLabel={t('action.cancel')}
                isDisabled={saving}
                onPress={close}>
                <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={foreground} />
              </Button>
              <BottomSheet.Title className="min-w-0 flex-1 text-center" numberOfLines={1}>
                {t(initialNote ? 'reader.noteEdit' : 'reader.noteAdd')}
              </BottomSheet.Title>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="size-10 shrink-0"
                hitSlop={4}
                accessibilityLabel={t(saving ? 'reader.noteSaving' : 'reader.noteSave')}
                accessibilityState={{ busy: saving }}
                isDisabled={saving || !dirty || !value.trim()}
                onPress={() => void save()}>
                <SymbolView
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={22}
                  tintColor={foreground}
                />
              </Button>
            </View>
            <View className="min-h-0 flex-1 rounded-2xl bg-surface p-3">
              <NoteEditorInput
                toolbarLabels={{
                  bold: t('markdown.bold'),
                  italic: t('markdown.italic'),
                  strikethrough: t('markdown.strikethrough'),
                  code: t('markdown.code'),
                  heading: t('markdown.heading'),
                  quote: t('markdown.quote'),
                  codeBlock: t('markdown.codeBlock'),
                  link: t('markdown.link'),
                }}
                value={value}
                editable={!saving}
                accessibilityLabel={t('reader.noteMine')}
                placeholder={t('reader.notePlaceholder')}
                className="min-h-0 flex-1 px-0 py-3"
                maxLength={ReaderNoteMaxLength}
                onChangeText={setValue}
              />
              <Text className="text-xs text-muted">
                {t('reader.noteMarkdownHint')} · {value.length}/{ReaderNoteMaxLength}
              </Text>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
      <ConfirmModal
        portalHostName={confirmationHostName}
        isOpen={discarding}
        title={t('reader.noteDiscardTitle')}
        description={t('reader.noteDiscardDescription')}
        confirmLabel={t('reader.noteDiscard')}
        isDestructive
        isConfirming={saving}
        onOpenChange={(open) => {
          if (!open && !pending.current) setDiscarding(false);
        }}
        onConfirm={() => {
          setDiscarding(false);
          Keyboard.dismiss();
          onClose();
        }}
      />
    </>
  );
}

function NoteEditorInput(props: ComponentProps<typeof MarkdownEditor>) {
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();
  return <MarkdownEditor {...props} onFocus={onFocus} onBlur={onBlur} />;
}
