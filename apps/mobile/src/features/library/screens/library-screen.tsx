import { SymbolView } from 'expo-symbols';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Menu, type MenuKey } from 'heroui-native/menu';
import { SearchField } from 'heroui-native/search-field';
import { Separator } from 'heroui-native/separator';
import { Skeleton } from 'heroui-native/skeleton';
import { Spinner } from 'heroui-native/spinner';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { FloatingActionToolbar, type FloatingToolbarAction } from '@/components/ui/floating-action-toolbar';
import { BookCard, type LibraryBook } from '@/features/library/components/book-card';
import { ImportingBookCard } from '@/features/library/components/importing-book-card';
import {
  BOOK_CARD_COVER_ASPECT_RATIO,
  LibraryGridSelectionSession,
  resolveLibraryGridEdgeScroll,
} from '@/features/library/components/library-grid-selection';
import { sortLibraryBooks } from '@/features/library/domain/library-sort';
import { Spacing } from '@/hooks/use-theme';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { i18n, useTranslation } from '@/i18n';
import { isLibrarySortDirection, isLibrarySortField, useLibraryStore } from '@/stores';
import { importEpubFile, listLibraryBooks, removeLibraryBooks, selectEpubFiles } from '../services/library-service';

const SELECTION_TOOLBAR_HEIGHT = 64;
const LIBRARY_COLUMN_COUNT = 3;
const LIBRARY_SKELETON_COUNT = 9;
const TOP_ROW_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 } as const;
const AUTO_SCROLL_INITIAL_FRAME_DURATION = 1000 / 60;
const AUTO_SCROLL_MAX_FRAME_DURATION = 32;
const BACK_TO_TOP_ENTERING = FadeIn.duration(180);
const BACK_TO_TOP_EXITING = FadeOut.duration(150);

type ImportingBook = {
  readonly id: string;
  readonly title: string;
  readonly progress: number;
  readonly isWaiting: boolean;
};

type LibraryItem =
  { readonly kind: 'book'; readonly book: LibraryBook } | { readonly kind: 'importing'; readonly book: ImportingBook };

export default function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  useMarkInitialContentReady(true);
  const librarySortLocale = i18n.resolvedLanguage;
  const [query, setQuery] = useState('');
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const librarySort = useLibraryStore((state) => state.sort);
  const setSortField = useLibraryStore((state) => state.setSortField);
  const setSortDirection = useLibraryStore((state) => state.setSortDirection);
  const [importingBooks, setImportingBooks] = useState<readonly ImportingBook[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBackToTopVisible, setIsBackToTopVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const [importIconColor, searchIconColor, backToTopIconColor, sortIconColor] = useThemeColor([
    'foreground',
    'muted',
    'foreground',
    'foreground',
  ]);
  const { toast } = useToast();
  const [gridSelectionSession] = useState(() => new LibraryGridSelectionSession());
  const gridContainerRef = useRef<View>(null);
  const libraryListRef = useRef<FlatList<LibraryItem>>(null);
  const selectedBookIdsRef = useRef(selectedBookIds);
  const slidingSelectionValueRef = useRef(true);
  const slidingSelectionPointRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const gridViewportRef = useRef({ viewportHeight: 0, windowOriginY: 0 });
  const gridContentHeightRef = useRef(0);
  const gridScrollOffsetRef = useRef(0);
  const autoScrollFrameRef = useRef<number | null>(null);
  const previousAutoScrollTimestampRef = useRef<number | null>(null);
  const selectionToolbarObscuredHeight = APP_TAB_BAR_HEIGHT + insets.bottom + Spacing.two + SELECTION_TOOLBAR_HEIGHT;

  useEffect(() => {
    selectedBookIdsRef.current = selectedBookIds;
  }, [selectedBookIds]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listLibraryBooks()
        .then((records) => {
          if (active) {
            setLibraryBooks(records.map((record) => toLibraryBook(record, t)));
          }
        })
        .catch((error: unknown) => {
          if (active) {
            toast.show({
              variant: 'danger',
              label: t('library.loadFailed'),
              description: getErrorMessage(error),
            });
          }
        })
        .finally(() => {
          if (active) {
            setIsLoadingLibrary(false);
          }
        });

      return () => {
        active = false;
      };
    }, [t, toast]),
  );

  const handleImport = useCallback(async () => {
    if (isImporting) {
      return;
    }

    setIsImporting(true);
    try {
      const selectedFiles = await selectEpubFiles();
      if (selectedFiles.length === 0) {
        return;
      }

      const tasks = selectedFiles.map((file, index) => ({
        id: `import-${Date.now()}-${index}`,
        file,
      }));
      setImportingBooks(
        tasks.map(({ id, file }) => ({
          id,
          title: fileNameWithoutExtension(file.fileName),
          progress: 0,
          isWaiting: true,
        })),
      );

      for (const task of tasks) {
        setImportingBooks((current) =>
          current.map((book) =>
            book.id === task.id ? { ...book, isWaiting: false, progress: Math.max(book.progress, 0.01) } : book,
          ),
        );
        try {
          const imported = await importEpubFile(task.file, (progress) => {
            setImportingBooks((current) =>
              current.map((book) =>
                book.id === task.id ? { ...book, progress: Math.max(book.progress, progress) } : book,
              ),
            );
          });
          setImportingBooks((current) => current.filter((book) => book.id !== task.id));
          setLibraryBooks((current) => [
            toLibraryBook(imported, t),
            ...current.filter((book) => book.id !== imported.id),
          ]);
          toast.show({
            variant: 'success',
            label: t('library.importCompleted'),
            description: imported.title,
          });
        } catch (error) {
          setImportingBooks((current) => current.filter((book) => book.id !== task.id));
          toast.show({
            variant: 'danger',
            label: t('library.importFailed'),
            description: `${task.file.fileName}：${getErrorMessage(error)}`,
          });
        }
      }
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: t('library.cannotSelectEpub'),
        description: getErrorMessage(error),
      });
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, t, toast]);

  const items = useMemo<readonly LibraryItem[]>(() => {
    const keyword = query.trim().toLocaleLowerCase();
    const filteredBooks = keyword
      ? libraryBooks.filter((book) => `${book.title} ${book.author}`.toLocaleLowerCase().includes(keyword))
      : libraryBooks;
    const sortedBooks = sortLibraryBooks(filteredBooks, librarySort, librarySortLocale);

    return [
      ...importingBooks.map((book) => ({ kind: 'importing' as const, book })),
      ...sortedBooks.map((book) => ({ kind: 'book' as const, book })),
    ];
  }, [importingBooks, libraryBooks, librarySort, librarySortLocale, query]);

  const selectedSortFields = useMemo<ReadonlySet<MenuKey>>(() => new Set([librarySort.field]), [librarySort.field]);
  const selectedSortDirections = useMemo<ReadonlySet<MenuKey>>(
    () => new Set([librarySort.direction]),
    [librarySort.direction],
  );

  const handleSortFieldChange = useCallback(
    (keys: Set<MenuKey>) => {
      const field = keys.values().next().value;
      if (isLibrarySortField(field)) {
        setSortField(field);
        libraryListRef.current?.scrollToOffset({ animated: false, offset: 0 });
      }
    },
    [setSortField],
  );

  const handleSortDirectionChange = useCallback(
    (keys: Set<MenuKey>) => {
      const direction = keys.values().next().value;
      if (isLibrarySortDirection(direction)) {
        setSortDirection(direction);
        libraryListRef.current?.scrollToOffset({ animated: false, offset: 0 });
      }
    },
    [setSortDirection],
  );

  const visibleBookIds = useMemo(() => items.flatMap((item) => (item.kind === 'book' ? [item.book.id] : [])), [items]);
  const allVisibleBooksSelected =
    visibleBookIds.length > 0 && visibleBookIds.every((bookId) => selectedBookIds.has(bookId));

  useEffect(() => {
    gridSelectionSession.update({
      itemIds: items.map((item) => (item.kind === 'book' ? item.book.id : undefined)),
    });
  }, [gridSelectionSession, items]);

  const updateBookSelection = useCallback((bookIds: readonly string[], selected: boolean) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      for (const bookId of bookIds) {
        if (selected) {
          next.add(bookId);
        } else {
          next.delete(bookId);
        }
      }
      return next;
    });
  }, []);

  const toggleBookSelection = useCallback((bookId: string) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  }, []);

  const handleBookPress = useCallback(
    (book: LibraryBook) => {
      if (isSelectionMode) {
        toggleBookSelection(book.id);
        return;
      }
      router.push(`/reader/${encodeURIComponent(book.id)}` as Href);
    },
    [isSelectionMode, router, toggleBookSelection],
  );

  const continueSlidingSelectionAtPoint = useCallback(
    (x: number, y: number) => {
      const edgeScrollState = resolveLibraryGridEdgeScroll(y, {
        obscuredBottomHeight: selectionToolbarObscuredHeight,
        ...gridViewportRef.current,
      });
      const newlyVisitedIds = gridSelectionSession.continueFromWindow({
        x,
        y: edgeScrollState.selectionWindowY,
      });
      if (newlyVisitedIds.length > 0) {
        setIsSelectionMode(true);
        updateBookSelection(newlyVisitedIds, slidingSelectionValueRef.current);
      }
    },
    [gridSelectionSession, selectionToolbarObscuredHeight, updateBookSelection],
  );

  const runAutoScroll = useCallback(
    function runFrame(timestamp: number) {
      autoScrollFrameRef.current = null;
      const point = slidingSelectionPointRef.current;
      if (point === null) {
        previousAutoScrollTimestampRef.current = null;
        return;
      }

      const { scrollVelocity } = resolveLibraryGridEdgeScroll(point.y, {
        obscuredBottomHeight: selectionToolbarObscuredHeight,
        ...gridViewportRef.current,
      });
      if (scrollVelocity === 0) {
        previousAutoScrollTimestampRef.current = null;
        return;
      }

      const previousTimestamp = previousAutoScrollTimestampRef.current;
      const frameDuration =
        previousTimestamp === null
          ? AUTO_SCROLL_INITIAL_FRAME_DURATION
          : Math.min(timestamp - previousTimestamp, AUTO_SCROLL_MAX_FRAME_DURATION);
      previousAutoScrollTimestampRef.current = timestamp;

      const currentOffset = gridScrollOffsetRef.current;
      const maximumOffset = Math.max(0, gridContentHeightRef.current - gridViewportRef.current.viewportHeight);
      const nextOffset = Math.min(maximumOffset, Math.max(0, currentOffset + (scrollVelocity * frameDuration) / 1000));
      if (Math.abs(nextOffset - currentOffset) < 0.1) {
        previousAutoScrollTimestampRef.current = null;
        return;
      }

      gridScrollOffsetRef.current = nextOffset;
      gridSelectionSession.update({ scrollOffset: nextOffset });
      libraryListRef.current?.scrollToOffset({ animated: false, offset: nextOffset });
      continueSlidingSelectionAtPoint(point.x, point.y);
      autoScrollFrameRef.current = requestAnimationFrame(runFrame);
    },
    [continueSlidingSelectionAtPoint, gridSelectionSession, selectionToolbarObscuredHeight],
  );

  const scheduleAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    }
  }, [runAutoScroll]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    previousAutoScrollTimestampRef.current = null;
  }, []);

  const selectBooksAtGridPoint = useCallback(
    (x: number, y: number) => {
      slidingSelectionPointRef.current = { x, y };
      continueSlidingSelectionAtPoint(x, y);
      scheduleAutoScroll();
    },
    [continueSlidingSelectionAtPoint, scheduleAutoScroll],
  );

  const beginSlidingSelection = useCallback(
    (x: number, y: number) => {
      const edgeScrollState = resolveLibraryGridEdgeScroll(y, {
        obscuredBottomHeight: selectionToolbarObscuredHeight,
        ...gridViewportRef.current,
      });
      const newlyVisitedIds = gridSelectionSession.beginFromWindow({
        x,
        y: edgeScrollState.selectionWindowY,
      });
      if (newlyVisitedIds.length > 0) {
        const shouldSelect = !selectedBookIdsRef.current.has(newlyVisitedIds[0]);
        slidingSelectionValueRef.current = shouldSelect;
        slidingSelectionPointRef.current = { x, y };
        setIsSelectionMode(true);
        updateBookSelection(newlyVisitedIds, shouldSelect);
        scheduleAutoScroll();
      }
    },
    [gridSelectionSession, scheduleAutoScroll, selectionToolbarObscuredHeight, updateBookSelection],
  );

  const finishSlidingSelection = useCallback(() => {
    slidingSelectionPointRef.current = null;
    stopAutoScroll();
    gridSelectionSession.finish();
    slidingSelectionValueRef.current = true;
  }, [gridSelectionSession, stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const closeSelectionMode = useCallback(() => {
    finishSlidingSelection();
    setIsSelectionMode(false);
    setSelectedBookIds(new Set());
  }, [finishSlidingSelection]);

  const handleSelectAll = useCallback(() => {
    if (allVisibleBooksSelected) {
      updateBookSelection(visibleBookIds, false);
    } else {
      updateBookSelection(visibleBookIds, true);
    }
  }, [allVisibleBooksSelected, updateBookSelection, visibleBookIds]);

  const handleDeleteSelectedBooks = useCallback(async () => {
    const ids = Array.from(selectedBookIds);
    if (ids.length === 0 || isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await removeLibraryBooks(ids);
      const removedIdSet = new Set(result.removedIds);
      setLibraryBooks((current) => current.filter((book) => !removedIdSet.has(book.id)));
      setIsDeleteDialogOpen(false);
      closeSelectionMode();
      toast.show({
        variant: 'success',
        label: t('library.booksDeleted', { count: result.removedIds.length }),
      });
      if (result.fileCleanupFailedIds.length > 0) {
        toast.show({
          variant: 'danger',
          label: t('library.fileCleanupFailed'),
          description: t('library.fileCleanupFailedDescription'),
        });
      }
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: t('library.deleteFailed'),
        description: getErrorMessage(error),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [closeSelectionMode, isDeleting, selectedBookIds, t, toast]);

  const toolbarActions = useMemo<readonly FloatingToolbarAction[]>(
    () => [
      {
        key: 'select-all',
        label: allVisibleBooksSelected ? t('action.deselectAll') : t('action.selectAll'),
        icon: {
          ios: allVisibleBooksSelected ? 'checkmark.circle.fill' : 'checkmark.circle',
          android: 'select_all',
          web: 'select_all',
        },
        isDisabled: visibleBookIds.length === 0 || isDeleting,
        onPress: handleSelectAll,
      },
      {
        key: 'delete',
        label: selectedBookIds.size > 0 ? `${t('action.delete')} ${selectedBookIds.size}` : t('action.delete'),
        icon: { ios: 'trash', android: 'delete', web: 'delete' },
        isDisabled: selectedBookIds.size === 0 || isDeleting,
        isDestructive: true,
        onPress: () => setIsDeleteDialogOpen(true),
      },
      {
        key: 'close',
        label: t('action.close'),
        icon: { ios: 'xmark', android: 'close', web: 'close' },
        isDisabled: isDeleting,
        onPress: closeSelectionMode,
      },
    ],
    [
      allVisibleBooksSelected,
      closeSelectionMode,
      handleSelectAll,
      isDeleting,
      selectedBookIds.size,
      t,
      visibleBookIds.length,
    ],
  );

  const handleGridLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height, width } = event.nativeEvent.layout;
      gridViewportRef.current = {
        ...gridViewportRef.current,
        viewportHeight: height,
      };
      gridSelectionSession.update({ viewportWidth: width });
      gridContainerRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        gridViewportRef.current = {
          viewportHeight: measuredHeight,
          windowOriginY: y,
        };
        gridSelectionSession.update({
          viewportWidth: measuredWidth,
          windowOriginX: x,
          windowOriginY: y,
        });
      });
    },
    [gridSelectionSession],
  );

  const handleGridScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollOffset = event.nativeEvent.contentOffset.y;
      gridScrollOffsetRef.current = scrollOffset;
      gridSelectionSession.update({ scrollOffset });
    },
    [gridSelectionSession],
  );

  const handleGridContentSizeChange = useCallback((_width: number, height: number) => {
    gridContentHeightRef.current = height;
  }, []);

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: readonly { readonly index: number | null }[] }) => {
      const hasVisibleItems = viewableItems.some(({ index }) => index !== null);
      const isTopRowVisible = viewableItems.some(({ index }) => index !== null && index < LIBRARY_COLUMN_COUNT);
      setIsBackToTopVisible(hasVisibleItems && !isTopRowVisible);
    },
    [],
  );

  const handleBackToTop = useCallback(() => {
    libraryListRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1" style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
        <View className="w-full max-w-[800px] flex-1 self-center">
          <View className="flex-row items-center gap-2 px-4 pt-1 pb-2">
            <SearchField className="flex-1" value={query} onChange={setQuery}>
              <SearchField.Group className="h-9 rounded-3xl bg-field shadow-field">
                <SearchField.SearchIcon iconProps={{ size: 20, color: searchIconColor }} />
                <SearchField.Input
                  placeholder={t('library.searchPlaceholder')}
                  accessibilityLabel={t('library.searchLibrary')}
                  className="h-9 min-h-9 rounded-3xl py-0 text-sm leading-5 ios:focus:outline-transparent android:focus:border-transparent"
                  style={{ textAlignVertical: 'center', includeFontPadding: false }}
                />
                <SearchField.ClearButton accessibilityLabel={t('library.clearSearch')} />
              </SearchField.Group>
            </SearchField>
            <Button
              accessibilityLabel={t('library.importEpub')}
              className="h-9 rounded-full"
              hitSlop={4}
              isDisabled={isImporting}
              isIconOnly
              onPress={() => void handleImport()}
              size="sm"
              variant="secondary">
              {isImporting ? (
                <Spinner color={importIconColor} size="sm" />
              ) : (
                <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={19} tintColor={importIconColor} />
              )}
            </Button>
            <Menu>
              <Menu.Trigger asChild>
                <Button
                  accessibilityLabel={t('library.sortMenuCurrent', {
                    direction: t(`library.sortDirection.${librarySort.direction}`),
                    field: t(`library.sortField.${librarySort.field}`),
                  })}
                  className="h-9 rounded-full"
                  hitSlop={4}
                  isIconOnly
                  size="sm"
                  variant="secondary">
                  <SymbolView
                    name={{
                      ios: 'line.3.horizontal.decrease',
                      android: 'filter_list',
                      web: 'filter_list',
                    }}
                    size={19}
                    tintColor={sortIconColor}
                  />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content align="end" placement="bottom" presentation="popover" width={240}>
                  <Menu.Label>{t('library.sortBy')}</Menu.Label>
                  <Menu.Group
                    disallowEmptySelection
                    onSelectionChange={handleSortFieldChange}
                    selectedKeys={selectedSortFields}
                    selectionMode="single"
                    shouldCloseOnSelect={false}>
                    <Menu.Item id="addedAt">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortField.addedAt')}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item id="recentlyRead">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortField.recentlyRead')}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item id="title">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortField.title')}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item id="author">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortField.author')}</Menu.ItemTitle>
                    </Menu.Item>
                  </Menu.Group>
                  <Separator className="mx-2 my-2 opacity-75" />
                  <Menu.Label>{t('library.sortOrder')}</Menu.Label>
                  <Menu.Group
                    disallowEmptySelection
                    onSelectionChange={handleSortDirectionChange}
                    selectedKeys={selectedSortDirections}
                    selectionMode="single"
                    shouldCloseOnSelect={false}>
                    <Menu.Item id="ascending">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortDirection.ascending')}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item id="descending">
                      <Menu.ItemIndicator />
                      <Menu.ItemTitle>{t('library.sortDirection.descending')}</Menu.ItemTitle>
                    </Menu.Item>
                  </Menu.Group>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </View>

          <View ref={gridContainerRef} collapsable={false} className="flex-1" onLayout={handleGridLayout}>
            <FlatList
              ref={libraryListRef}
              data={items}
              extraData={selectedBookIds}
              keyExtractor={(item) => item.book.id}
              numColumns={LIBRARY_COLUMN_COUNT}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={handleGridContentSizeChange}
              onScroll={handleGridScroll}
              onViewableItemsChanged={handleViewableItemsChanged}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              viewabilityConfig={TOP_ROW_VIEWABILITY_CONFIG}
              columnWrapperClassName="items-start"
              contentContainerClassName="px-[10px] pt-2"
              contentContainerStyle={{
                paddingBottom:
                  APP_TAB_BAR_HEIGHT +
                  insets.bottom +
                  Spacing.four +
                  (isSelectionMode ? SELECTION_TOOLBAR_HEIGHT + Spacing.two : 0),
              }}
              renderItem={({ item }) =>
                item.kind === 'importing' ? (
                  <ImportingBookCard
                    isWaiting={item.book.isWaiting}
                    progress={item.book.progress}
                    title={item.book.title}
                  />
                ) : (
                  <BookCard
                    book={item.book}
                    isSelected={selectedBookIds.has(item.book.id)}
                    isSelectionMode={isSelectionMode}
                    onPress={handleBookPress}
                    onSelectionGestureFinish={finishSlidingSelection}
                    onSelectionGestureMove={selectBooksAtGridPoint}
                    onSelectionGestureStart={beginSlidingSelection}
                  />
                )
              }
              ListEmptyComponent={
                isLoadingLibrary ? (
                  <LibraryLoadingSkeleton />
                ) : (
                  <View className="items-center px-6 pt-20">
                    <Text className="font-serif text-xl font-semibold text-foreground">
                      {query.trim() ? t('library.noSearchResults') : t('library.empty')}
                    </Text>
                    <Text className="mt-2 text-[13px] text-muted">
                      {query.trim() ? t('library.searchSuggestion') : t('library.importSuggestion')}
                    </Text>
                  </View>
                )
              }
            />
          </View>
        </View>
      </View>

      {isSelectionMode && (
        <FloatingActionToolbar
          accessibilityLabel={t('library.selectionToolbar', { count: selectedBookIds.size })}
          actions={toolbarActions}
          bottom={APP_TAB_BAR_HEIGHT + insets.bottom + Spacing.two}
        />
      )}

      {isBackToTopVisible && (
        <Animated.View
          className="absolute z-20"
          entering={BACK_TO_TOP_ENTERING}
          exiting={BACK_TO_TOP_EXITING}
          style={{
            bottom:
              APP_TAB_BAR_HEIGHT +
              insets.bottom +
              Spacing.four +
              (isSelectionMode ? SELECTION_TOOLBAR_HEIGHT + Spacing.two : 0),
            right: insets.right + Spacing.four,
          }}>
          <Button
            accessibilityLabel={t('library.backToTop')}
            className="size-12 rounded-full border border-border shadow-lg"
            hitSlop={6}
            isIconOnly
            onPress={handleBackToTop}
            size="lg"
            variant="secondary">
            <SymbolView
              name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
              size={23}
              tintColor={backToTopIconColor}
            />
          </Button>
        </Animated.View>
      )}

      <ConfirmModal
        confirmLabel={t('action.delete')}
        confirmingLabel={t('action.deleting')}
        description={t('library.deleteDescription', { count: selectedBookIds.size })}
        isConfirming={isDeleting}
        isDestructive
        isOpen={isDeleteDialogOpen}
        onConfirm={() => void handleDeleteSelectedBooks()}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('library.deleteTitle')}
      />
    </View>
  );
}

function LibraryLoadingSkeleton() {
  return (
    <View className="w-full flex-row flex-wrap items-start">
      {Array.from({ length: LIBRARY_SKELETON_COUNT }, (_, index) => (
        <View key={index} className="mb-6 w-1/3 overflow-visible px-[6px]">
          <Skeleton
            className="w-full rounded bg-surface-secondary"
            style={{ aspectRatio: BOOK_CARD_COVER_ASPECT_RATIO }}
          />
          <Skeleton className="mt-[7px] h-4 w-4/5 rounded-md" />
          <Skeleton className="mt-px h-[14px] w-3/5 rounded-md" />
        </View>
      ))}
    </View>
  );
}

function toLibraryBook(
  record: Awaited<ReturnType<typeof listLibraryBooks>>[number],
  t: ReturnType<typeof useTranslation>['t'],
): LibraryBook {
  return {
    id: record.id,
    title: record.title,
    author: record.author ?? t('library.unknownAuthor'),
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    readingProgress: record.readingProgress ?? 0,
    cover: {
      imageUri: record.coverUri,
      mark: Array.from(record.title.trim())[0] ?? t('library.fallbackBookMark'),
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t('library.unknownError');
}

function fileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.epub$/i, '') || fileName;
}
