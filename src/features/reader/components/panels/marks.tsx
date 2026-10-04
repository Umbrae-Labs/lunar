import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useToast } from 'heroui-native/toast';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind, withUniwind } from 'uniwind';
import { useTranslation } from '@/i18n';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { ReaderLocator, ReaderRuntime, ReaderTocEntry } from '@/reader';
import type { ReaderBookmark } from '../../domain/reader-bookmark';
import type { ReaderHighlight } from '../../domain/reader-highlight';
import { normalizeReaderDisplayText } from '../../domain/reader-display-text';
import { getBarInset } from '../navigation/layout';
import { useDrawerNavigation } from '../../hooks/controls/use-drawer-navigation';

const MarkPressable = withUniwind(Pressable);

interface MarksProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
  readonly runtime: ReaderRuntime;
  readonly toc: readonly ReaderTocEntry[];
  readonly bookmarks: readonly ReaderBookmark[];
  readonly highlights: readonly ReaderHighlight[];
  readonly bookmarksLoaded: boolean;
  readonly highlightsLoaded: boolean;
  readonly bookmarksError?: unknown;
  readonly highlightsError?: unknown;
  readonly onRemoveBookmark: (id: string) => Promise<void>;
  readonly onRemoveHighlight: (id: string) => Promise<void>;
  readonly onOpenNote: (highlight: ReaderHighlight) => void;
  readonly onNavigated: () => void;
}

interface MarkEntry {
  readonly id: string;
  readonly locator: ReaderLocator;
  readonly title: string;
  readonly text: string;
  readonly createdAt: number;
  readonly noteCount?: number;
}

export function Marks(props: MarksProps) {
  const { t } = useTranslation();
  const { theme } = useUniwind();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const bottomInset = getBarInset(insets.bottom);
  const dangerForeground = useThemeColor('danger-foreground');
  const noteColor = useCSSVariable('--color-navigation-active') as string;
  const [tab, setTab] = useState<'bookmarks' | 'highlights'>('bookmarks');
  const [removing, setRemoving] = useState(false);
  const [noteMarkToDelete, setNoteMarkToDelete] = useState<string>();
  const pending = useRef(false);
  const navigation = useDrawerNavigation({
    onOpenChange: props.onOpenChange,
    onNavigated: props.onNavigated,
    onFailure: () => toast.show({ variant: 'danger', label: t('reader.markNavigationFailed') }),
  });
  const busy = removing || navigation.busy;
  const entries = useMemo<MarkEntry[]>(() => {
    if (tab === 'bookmarks')
      return props.bookmarks.map((bookmark) => ({
        ...bookmark,
        title: bookmark.label || t('reader.bookmark'),
      }));
    const titles = chapterTitles(props.toc);
    return props.highlights
      .map((highlight) => ({
        id: highlight.id,
        title: titles.get(highlight.href) ?? t('reader.highlightSelection'),
        text: normalizeReaderDisplayText(highlight.text).replace(/\n+/gu, ' ').trim(),
        createdAt: highlight.createdAt,
        noteCount: highlight.notes?.length,
        locator: {
          spineIdref: highlight.href,
          manifestHref: highlight.href,
          chapterProgress: 0,
          sourcePoint: highlight.sourceRange.start,
          sourceRange: highlight.sourceRange,
        },
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [props.bookmarks, props.highlights, props.toc, t, tab]);
  const loaded = tab === 'bookmarks' ? props.bookmarksLoaded : props.highlightsLoaded;
  const error = tab === 'bookmarks' ? props.bookmarksError : props.highlightsError;

  function navigate(entry: MarkEntry) {
    if (pending.current) return;
    navigation.requestNavigation(() => props.runtime.goToLocator(entry.locator));
  }

  async function remove(id: string, kind: 'bookmarks' | 'highlights') {
    if (pending.current || navigation.isPending()) return;
    pending.current = true;
    setRemoving(true);
    try {
      if (kind === 'bookmarks') await props.onRemoveBookmark(id);
      else await props.onRemoveHighlight(id);
      setNoteMarkToDelete(undefined);
      toast.show({
        variant: 'success',
        label: t(kind === 'bookmarks' ? 'reader.bookmarkRemoved' : 'reader.highlightRemoved'),
      });
    } catch {
      toast.show({
        variant: 'danger',
        label: t(kind === 'bookmarks' ? 'reader.bookmarkRemoveFailed' : 'reader.highlightRemoveFailed'),
      });
    } finally {
      pending.current = false;
      setRemoving(false);
    }
  }

  return (
    <>
      <BottomSheet isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
        <BottomSheet.Portal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
          <BottomSheet.Overlay style={{ bottom: bottomInset }} />
          <BottomSheet.Content
            backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
            bottomInset={bottomInset}
            contentContainerClassName="h-full flex-1 p-0!"
            detached
            enableDynamicSizing={false}
            enableOverDrag={false}
            snapPoints={['62%', '88%']}
            activeOffsetY={[-12, 12]}
            failOffsetX={[-8, 8]}>
            <View className="gap-3 border-b border-border px-5 pb-3">
              <BottomSheet.Title className="text-xl text-foreground">{t('reader.marks')}</BottomSheet.Title>
              <View className="flex-row gap-2">
                {(['bookmarks', 'highlights'] as const).map((key) => (
                  <Button
                    key={key}
                    className={
                      tab === key && theme === 'dark'
                        ? 'flex-1'
                        : tab === key
                          ? 'flex-1 bg-surface'
                          : 'flex-1 dark:bg-transparent'
                    }
                    size="sm"
                    variant={tab === key && theme === 'dark' ? 'secondary' : 'ghost'}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === key }}
                    onPress={() => setTab(key)}>
                    <Button.Label>
                      {t(key === 'bookmarks' ? 'reader.bookmarksCount' : 'reader.highlightsCount', {
                        count: key === 'bookmarks' ? props.bookmarks.length : props.highlights.length,
                      })}
                    </Button.Label>
                  </Button>
                ))}
              </View>
            </View>
            <BottomSheetFlatList<MarkEntry>
              className="flex-1"
              data={entries}
              keyExtractor={(item: MarkEntry) => item.id}
              contentContainerClassName="px-3 pb-6"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }: { item: MarkEntry }) => {
                const content = (
                  <PressableFeedback
                    asChild
                    animation={false}
                    className="min-h-20 w-full flex-row px-3 pb-2 pt-4"
                    isDisabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t('reader.goToMark', { text: item.text || item.title })}
                    onPress={() => void navigate(item)}>
                    <MarkPressable cancelable>
                      <PressableFeedback.Highlight />
                      <View className="flex-1 gap-2">
                        <Text className="text-xs text-muted" numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text className="text-base leading-6 text-foreground" numberOfLines={3}>
                          {item.text || item.title}
                        </Text>
                      </View>
                    </MarkPressable>
                  </PressableFeedback>
                );
                return (
                  <View className="overflow-hidden border-b border-border">
                    <ReanimatedSwipeable
                      dragOffsetFromLeftEdge={8}
                      dragOffsetFromRightEdge={8}
                      enabled={!busy}
                      enableTrackpadTwoFingerGesture
                      overshootRight={false}
                      rightThreshold={32}
                      renderRightActions={(_progress, _translation, swipeableMethods) => (
                        <Button
                          accessibilityLabel={
                            tab === 'bookmarks'
                              ? t('reader.removeBookmark', { title: item.title })
                              : t('reader.removeHighlight')
                          }
                          className="h-full w-20 self-stretch rounded-none px-0"
                          isDisabled={busy}
                          onPress={() => {
                            swipeableMethods.close();
                            if (tab === 'highlights' && item.noteCount) setNoteMarkToDelete(item.id);
                            else void remove(item.id, tab);
                          }}
                          size="sm"
                          variant="danger">
                          <SymbolView
                            name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                            size={22}
                            tintColor={dangerForeground}
                          />
                        </Button>
                      )}>
                      <View className="bg-background dark:bg-overlay">
                        {content}
                        <View className="min-h-8 flex-row items-center justify-between gap-2 px-3 pb-3">
                          <Text className="flex-1 text-xs text-muted">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </Text>
                          {Boolean(item.noteCount) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1 px-2"
                              accessibilityLabel={t('reader.notesCount', { count: item.noteCount })}
                              isDisabled={busy}
                              onPress={() => {
                                const highlight = props.highlights.find((entry) => entry.id === item.id);
                                if (highlight) props.onOpenNote(highlight);
                              }}>
                              <SymbolView
                                name={{
                                  ios: 'text.bubble',
                                  android: 'chat_bubble_outline',
                                  web: 'chat_bubble_outline',
                                }}
                                size={18}
                                tintColor={noteColor}
                              />
                              <Button.Label className="text-xs text-navigation-active">{item.noteCount}</Button.Label>
                            </Button>
                          )}
                        </View>
                      </View>
                    </ReanimatedSwipeable>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text className="px-5 py-10 text-center leading-6 text-muted">
                  {error
                    ? t(tab === 'bookmarks' ? 'reader.bookmarkLoadFailed' : 'reader.highlightLoadFailed')
                    : !loaded
                      ? t('reader.loadingMarks')
                      : t(tab === 'bookmarks' ? 'reader.noBookmarks' : 'reader.noHighlights')}
                </Text>
              }
            />
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
      <ConfirmModal
        isOpen={Boolean(noteMarkToDelete)}
        title={t('reader.removeHighlight')}
        description={t('reader.noteRemoveMarkDescription')}
        confirmLabel={t('reader.removeHighlight')}
        isDestructive
        isConfirming={removing}
        onOpenChange={(open) => {
          if (!open) setNoteMarkToDelete(undefined);
        }}
        onConfirm={() => {
          if (noteMarkToDelete) void remove(noteMarkToDelete, 'highlights');
        }}
      />
    </>
  );
}

function chapterTitles(toc: readonly ReaderTocEntry[]): Map<string, string> {
  const titles = new Map<string, string>();
  const seen = new Set<ReaderTocEntry>();
  const stack = [...toc].reverse();
  while (stack.length) {
    const entry = stack.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const href = entry.href.split('#', 1)[0];
    if (!titles.has(href)) titles.set(href, entry.label);
    stack.push(...[...entry.children].reverse());
  }
  return titles;
}
