import { ThemedBottomSheetPortal } from '@/components/ui/themed-bottom-sheet-portal';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useToast } from 'heroui-native/toast';
import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import type { ReaderSnapshot, ReaderTocEntry } from '@/reader';
import type { LunarReaderRuntime } from '@/reader/native';
import { useTranslation } from '@/i18n';
import { getReaderBottomTabBarInset } from './constants';
import { useDrawerNavigation } from '../../hooks/controls/use-drawer-navigation';

interface TocDrawerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly toc: readonly ReaderTocEntry[];
}

interface FlatTocEntry extends ReaderTocEntry {
  readonly depth: number;
}

function TocDrawerContent({ isOpen, onOpenChange, runtime, toc, snapshot }: TocDrawerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const bottomInset = getReaderBottomTabBarInset(insets.bottom);
  const activeColor = useCSSVariable('--color-navigation-active') as string;
  const entries = useMemo(() => flattenToc(toc), [toc]);
  const manifestHref = snapshot.position?.locator?.manifestHref;
  const anchorId = snapshot.position?.locator?.anchorId;
  const { busy, requestNavigation } = useDrawerNavigation({
    onOpenChange,
    onFailure: () => toast.show({ variant: 'danger', label: t('reader.tocNavigationFailed') }),
  });

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <ThemedBottomSheetPortal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: bottomInset }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={bottomInset}
          contentContainerClassName="h-full"
          contentContainerProps={{ style: { flex: 1, padding: 0 } }}
          detached
          enableDynamicSizing={false}
          enableOverDrag={false}
          snapPoints={['62%', '88%']}>
          <View className="flex-row items-center justify-between px-5 pb-3">
            <View className="min-w-0 flex-1 gap-1 pr-3">
              <BottomSheet.Title className="text-xl text-foreground">{t('reader.toc')}</BottomSheet.Title>
              <BottomSheet.Description className="text-sm text-muted">
                {entries.length > 0 ? t('reader.tocCount', { count: entries.length }) : t('reader.noToc')}
              </BottomSheet.Description>
            </View>
          </View>
          <BottomSheetFlatList<FlatTocEntry>
            data={entries}
            extraData={{ busy, manifestHref, anchorId }}
            keyExtractor={(entry: FlatTocEntry, index: number) => `${entry.href}:${index}`}
            contentContainerClassName="gap-1 px-3"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            renderItem={({ item: entry }: { item: FlatTocEntry }) => {
              const isCurrent = isCurrentTocEntry(entry, manifestHref, anchorId);
              return (
                <Button
                  accessibilityLabel={t('reader.goToToc', { title: entry.label })}
                  accessibilityState={{ selected: isCurrent }}
                  className="h-auto min-h-12 justify-start rounded-xl px-3 dark:bg-transparent"
                  isDisabled={busy}
                  onPress={() => requestNavigation(() => runtime.goToToc(entry.href))}
                  style={{ marginLeft: Math.min(entry.depth, 4) * 14 }}
                  variant="ghost">
                  <Button.Label
                    className="flex-1 text-left"
                    numberOfLines={2}
                    style={isCurrent ? { color: activeColor } : undefined}>
                    {entry.label}
                  </Button.Label>
                </Button>
              );
            }}
            ListEmptyComponent={<Text className="px-4 py-8 text-center text-muted">{t('reader.noToc')}。</Text>}
          />
        </BottomSheet.Content>
      </ThemedBottomSheetPortal>
    </BottomSheet>
  );
}

function isCurrentTocEntry(entry: ReaderTocEntry, manifestHref?: string, currentAnchorId?: string): boolean {
  if (!manifestHref) return false;
  const [href, anchorId] = entry.href.split('#', 2);
  return href === manifestHref && anchorId === currentAnchorId;
}

function flattenToc(entries: readonly ReaderTocEntry[], depth = 0): FlatTocEntry[] {
  const flattened: FlatTocEntry[] = [];
  const visited = new Set<ReaderTocEntry>();
  const stack = entries
    .slice()
    .reverse()
    .map((entry) => ({ entry, depth }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current.entry)) continue;
    visited.add(current.entry);
    flattened.push({ ...current.entry, depth: current.depth });
    for (let index = current.entry.children.length - 1; index >= 0; index -= 1) {
      stack.push({ entry: current.entry.children[index], depth: current.depth + 1 });
    }
  }
  return flattened;
}

/** Keep the closing view mounted while settled-page updates stay outside it. */
export const TocDrawer = memo(
  TocDrawerContent,
  (previous, next) =>
    previous.isOpen === next.isOpen &&
    previous.runtime === next.runtime &&
    previous.onOpenChange === next.onOpenChange &&
    previous.toc === next.toc &&
    (!next.isOpen || previous.snapshot === next.snapshot),
);
