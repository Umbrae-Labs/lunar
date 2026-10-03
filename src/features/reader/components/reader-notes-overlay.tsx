import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useToast } from 'heroui-native/toast';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Portal, PortalHost } from 'heroui-native/portal';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind, withUniwind } from 'uniwind';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useTranslation } from '@/i18n';
import type { ReaderNote } from '../domain/reader-highlight';
import { normalizeReaderDisplayText } from '../domain/reader-display-text';
import { MarkdownView } from '@/components/markdown';
import { ReaderNoteEditorDrawer } from './reader-note-editor-drawer';

const NotesBlur = withUniwind(BlurView);
const Entering = FadeIn.duration(180);
const Exiting = FadeOut.duration(140);

interface ReaderNotesOverlayProps {
  readonly quote: string;
  readonly notes: readonly ReaderNote[];
  readonly blurTarget: RefObject<View | null>;
  readonly onClose: () => void;
  readonly onSave: (content: string, noteId?: string) => Promise<void>;
  readonly onRemove: (noteId: string) => Promise<void>;
}

export function ReaderNotesOverlay({ quote, notes, blurTarget, onClose, onSave, onRemove }: ReaderNotesOverlayProps) {
  const { t } = useTranslation();
  const { theme } = useUniwind();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor('foreground');
  const muted = useThemeColor('muted');
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);
  const [quoteLayout, setQuoteLayout] = useState({ quote: '', overflows: false });
  const expanded = expandedQuote === quote;
  const canExpandQuote = quoteLayout.quote === quote && quoteLayout.overflows;
  const [editor, setEditor] = useState<{ note?: ReaderNote; open: boolean }>();
  const [deleting, setDeleting] = useState<ReaderNote>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const portalId = useId();
  const editorHostName = `${portalId}:editor`;
  const confirmationHostName = `${portalId}:confirmation`;
  const canClose = !editor?.open && !deleting && !busy;
  const displayQuote = normalizeReaderDisplayText(quote);

  useEffect(() => {
    if (!canClose) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [canClose, onClose]);

  function edit(note?: ReaderNote) {
    setEditor({ note, open: true });
  }

  async function copy() {
    try {
      await Clipboard.setStringAsync(quote);
      toast.show({ variant: 'success', label: t('reader.selectionCopied') });
    } catch {
      toast.show({ variant: 'danger', label: t('reader.noteCopyFailed') });
    }
  }

  async function remove() {
    if (!deleting || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await onRemove(deleting.id);
      setDeleting(undefined);
      toast.show({ variant: 'success', label: t('reader.noteRemoved') });
    } catch {
      toast.show({ variant: 'danger', label: t('reader.noteSaveFailed') });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Portal name={`${portalId}:notes`}>
      <View className="absolute inset-0 z-100" accessibilityViewIsModal>
        <Animated.View
          entering={Entering}
          exiting={Exiting}
          accessibilityViewIsModal
          onAccessibilityEscape={() => {
            if (canClose) onClose();
          }}
          className="absolute inset-0 z-50">
          <NotesBlur
            pointerEvents="none"
            blurTarget={blurTarget}
            blurMethod="dimezisBlurView"
            intensity={72}
            blurReductionFactor={2}
            tint={theme === 'dark' ? 'dark' : 'light'}
            className="absolute inset-0"
          />
          <View pointerEvents="none" className="absolute inset-0 bg-background/20" />
          <View className="flex-1" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 12 }}>
            <View className="mb-5 h-1 w-10 self-center rounded-full bg-muted/50" />
            <ScrollView
              className="flex-1"
              contentContainerClassName="gap-4 px-6 pb-5"
              showsVerticalScrollIndicator={false}
              accessibilityElementsHidden={Boolean(editor?.open)}
              importantForAccessibility={editor?.open ? 'no-hide-descendants' : 'auto'}>
              <View className="overflow-hidden rounded-3xl bg-surface p-4 shadow-sm dark:bg-surface-secondary">
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="absolute left-3 top-1 opacity-40">
                  <SymbolView
                    name={{ ios: 'quote.opening', android: 'format_quote', web: 'format_quote' }}
                    size={64}
                    tintColor={muted}
                  />
                </View>
                <View className="pt-6">
                  <View>
                    {/* Measure the full text at the visible quote's width on both platforms. */}
                    <Text
                      accessible={false}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      pointerEvents="none"
                      className="absolute inset-x-0 top-0 text-lg leading-7 text-foreground opacity-0"
                      onTextLayout={({ nativeEvent }) => {
                        const overflows = nativeEvent.lines.length > 2;
                        setQuoteLayout((current) =>
                          current.quote === quote && current.overflows === overflows ? current : { quote, overflows },
                        );
                      }}>
                      {displayQuote}
                    </Text>
                    <Text
                      selectable
                      numberOfLines={expanded ? undefined : 2}
                      className="text-lg leading-7 text-foreground">
                      {displayQuote}
                    </Text>
                  </View>
                </View>
                {canExpandQuote && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedQuote(expanded ? null : quote)}>
                    <Button.Label className="text-xs text-muted">
                      {t(expanded ? 'reader.noteCollapseQuote' : 'reader.noteExpandQuote')}
                    </Button.Label>
                  </Button>
                )}
                <View className="flex-row border-t border-border dark:border-muted/40">
                  <Button variant="ghost" className="flex-1" size="sm" onPress={() => void copy()}>
                    <SymbolView
                      name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }}
                      size={20}
                      tintColor={foreground}
                    />
                    <Button.Label>{t('reader.copySelection')}</Button.Label>
                  </Button>
                  <Button variant="ghost" className="flex-1" size="sm" onPress={() => edit()}>
                    <SymbolView
                      name={{ ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' }}
                      size={22}
                      tintColor={foreground}
                    />
                    <Button.Label>{t('reader.noteAdd')}</Button.Label>
                  </Button>
                </View>
              </View>
              {notes.length === 0 ? (
                <View className="items-center gap-3 rounded-3xl bg-surface px-5 py-8 dark:bg-surface-secondary">
                  <Text className="text-sm text-muted">{t('reader.noteNone')}</Text>
                  <Button size="sm" variant="secondary" onPress={() => edit()}>
                    {t('reader.noteAdd')}
                  </Button>
                </View>
              ) : (
                notes.map((note) => (
                  <View key={note.id} className="gap-1 rounded-3xl bg-surface p-4 dark:bg-surface-secondary">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 gap-1">
                        <Text className="text-xs text-muted">{new Date(note.updatedAt).toLocaleString()}</Text>
                      </View>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={t('reader.noteEdit')}
                        isDisabled={busy}
                        onPress={() => edit(note)}>
                        <SymbolView
                          name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                          size={19}
                          tintColor={foreground}
                        />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={t('reader.noteDelete')}
                        isDisabled={busy}
                        onPress={() => setDeleting(note)}>
                        <SymbolView
                          name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                          size={19}
                          tintColor={muted}
                        />
                      </Button>
                    </View>
                    <MarkdownView
                      value={note.content}
                      onLinkError={() => toast.show({ variant: 'danger', label: t('reader.linkOpenFailed') })}
                    />
                  </View>
                ))
              )}
            </ScrollView>
            <Button
              isIconOnly
              variant="primary"
              accessibilityLabel={t('action.close')}
              isDisabled={!canClose}
              className="mt-3 size-12 self-center rounded-full"
              onPress={onClose}>
              <Button.Label className="text-2xl">×</Button.Label>
            </Button>
          </View>
        </Animated.View>
        <View pointerEvents="box-none" collapsable={false} className="absolute inset-0 z-60">
          <PortalHost name={editorHostName} />
          <View pointerEvents="box-none" className="absolute inset-0 z-10">
            <PortalHost name={confirmationHostName} />
          </View>
        </View>
        <ReaderNoteEditorDrawer
          isOpen={Boolean(editor?.open)}
          initialNote={editor?.note?.content ?? ''}
          portalHostName={editorHostName}
          confirmationHostName={confirmationHostName}
          onClose={() => setEditor((current) => (current ? { ...current, open: false } : current))}
          onSave={(content) => onSave(content, editor?.note?.id)}
        />
        <ConfirmModal
          portalHostName={confirmationHostName}
          isOpen={Boolean(deleting)}
          title={t('reader.noteDelete')}
          description={t('reader.noteDeleteDescription')}
          confirmLabel={t('reader.noteDelete')}
          isDestructive
          isConfirming={busy}
          onOpenChange={(open) => {
            if (!open && !pending.current) setDeleting(undefined);
          }}
          onConfirm={() => void remove()}
        />
      </View>
    </Portal>
  );
}
