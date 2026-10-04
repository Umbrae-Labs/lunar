import { type Href, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { BlurTargetView } from 'expo-blur';
import { Portal } from 'heroui-native/portal';
import { Spinner } from 'heroui-native/spinner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useCSSVariable, useResolveClassNames, useUniwind, withUniwind } from 'uniwind';
import { SafeAreaListener } from 'react-native-safe-area-context';

import { ImageViewer } from '@/components/ui/image-viewer';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { findReaderHitIndex } from '@/reader';
import { ReaderSurface, useReaderPageTurn } from '@/reader/native';
import type { ReaderOverlayRect } from '@/reader/native';
import {
  resolveReaderHighlightOverlays,
  createReaderHighlightOverlayResolver,
} from '../services/highlight-overlay-service';
import { useReaderStore } from '@/stores';
import { TabBar } from '../components/navigation/tab-bar';
import { Progress } from '../components/panels/progress';
import { Marks } from '../components/panels/marks';
import { Toc } from '../components/panels/toc';
import { Typography } from '../components/panels/typography';
import { Appearance } from '../components/panels/appearance';
import { Controls } from '../components/navigation/controls';
import { Footnote } from '../components/panels/footnote';
import { SelectionControls } from '../components/controls/selection';
import { ExcerptSheet } from '../components/annotations/excerpt-sheet';
import type { ReaderExcerpt } from '../domain/reader-excerpt';
import { NotesOverlay } from '../components/annotations/notes-overlay';
import { BookmarkPullThreshold } from '../domain/bookmark-pull';
import { READER_PAPER_PALETTES } from '../domain/reader-paper-palettes';

import { useReaderBookmarks } from '../hooks/bookmarks/use-reader-bookmarks';
import { useReaderBookmarkActions } from '../hooks/bookmarks/use-reader-bookmark-actions';
import { useBookmarkPull } from '../hooks/bookmarks/use-bookmark-pull';
import { useReaderHighlights } from '../hooks/highlights/use-reader-highlights';
import { useReaderHighlightActions } from '../hooks/highlights/use-reader-highlight-actions';
import { useReaderNote } from '../hooks/highlights/use-reader-note';
import { useReaderSelection } from '../hooks/selection/use-reader-selection';
import { useReaderContentActions } from '../hooks/content/use-reader-content-actions';
import { useReaderPanels } from '../hooks/controls/use-reader-panels';
import { useReaderViewport } from '../hooks/controls/use-reader-viewport';
import { useReaderVolumeKeys } from '../hooks/controls/use-reader-volume-keys';
import { useReaderSession } from '../hooks/session/use-reader-session';
import { useReaderHitEntries } from '../hooks/session/use-reader-hit-entries';
import { useReadingTime } from '../hooks/session/use-reading-time';
import { useReaderErrorToast } from '../hooks/session/use-reader-error-toast';
import { useScreenBrightness } from '../hooks/use-screen-brightness';

const ReaderBlurTarget = withUniwind(BlurTargetView);

export default function ReaderScreen() {
  const { t } = useTranslation();
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const {
    viewport,
    reservedInsets,
    contentInsets,
    surfaceTransform,
    handleLayout,
    handleSurfaceTransform,
    handleSafeAreaChange,
  } = useReaderViewport();
  const { theme: readerTheme } = useUniwind();
  const selectionHandleColor = useCSSVariable('--color-reader-selection') as string;
  const selectionFillColor = useCSSVariable('--color-reader-selection-fill') as string;
  const highlightFillColor = useCSSVariable('--color-reader-highlight-fill') as string;
  const highlightPink = useCSSVariable('--color-reader-highlight-pink') as string;
  const highlightPurple = useCSSVariable('--color-reader-highlight-purple') as string;
  const highlightBlue = useCSSVariable('--color-reader-highlight-blue') as string;
  const highlightGreen = useCSSVariable('--color-reader-highlight-green') as string;
  const highlightColors = useMemo(
    () => ({
      yellow: highlightFillColor,
      pink: highlightPink,
      purple: highlightPurple,
      blue: highlightBlue,
      green: highlightGreen,
    }),
    [highlightFillColor, highlightPink, highlightPurple, highlightBlue, highlightGreen],
  );
  const absoluteFillStyle = useResolveClassNames('absolute inset-0');
  const noteBlurTarget = useRef<View>(null);
  const paperColor = useReaderStore((state) => state.paperColors[readerTheme]);
  const paperPalette = READER_PAPER_PALETTES[readerTheme][paperColor];
  const brightness = useReaderStore((state) => state.brightness);
  const { isAvailable: isScreenBrightnessAvailable } = useScreenBrightness({ enabled: isFocused, brightness });
  const animationStyle = useReaderStore((state) => state.animationStyle);
  const keepScreenAwake = useReaderStore((state) => state.keepScreenAwake);
  const showSystemStatusBar = useReaderStore((state) => state.showSystemStatusBar);
  const volumeKeysTurnPages = useReaderStore((state) => state.volumeKeysTurnPages);
  const spreadMode = useReaderStore((state) => state.typography.spreadMode);
  const session = useReaderSession({
    bookId: bookId ?? '',
    viewport,
    contentInsets,
    theme: readerTheme,
    palette: paperPalette,
  });
  const {
    highlights,
    addHighlight,
    removeHighlights,
    updateNotes,
    isLoaded: highlightsLoaded,
    error: highlightsError,
  } = useReaderHighlights(bookId ?? '');
  const note = useReaderNote({ bookId: bookId ?? '', runtime: session.runtime, highlights, addHighlight, updateNotes });
  const {
    bookmarks,
    addBookmark,
    removeBookmark,
    isLoaded: bookmarksLoaded,
    error: bookmarksError,
  } = useReaderBookmarks(bookId ?? '');
  const bookmarkColor = useCSSVariable('--color-reader-bookmark') as string;
  const bookmarkOutlineColor = useCSSVariable('--color-foreground') as string;
  const bookmarkHintColor = useCSSVariable('--color-muted') as string;
  const bookmarkPullLabels = useMemo(
    () => ({
      addPulling: t('reader.pullToBookmark'),
      addReady: t('reader.releaseToBookmark'),
      removePulling: t('reader.pullToRemoveBookmark'),
      removeReady: t('reader.releaseToRemoveBookmark'),
    }),
    [t],
  );
  const resolvePageHighlights = useMemo(
    () => createReaderHighlightOverlayResolver(highlights, highlightColors),
    [highlights, highlightColors],
  );
  const {
    gesture: pageTurnGesture,
    interactiveTurn,
    automaticTurns,
    automaticNavigationActive,
    isSettling,
    completeAutomaticTurn,
    surfaceBinding: pageTurnSurfaceBinding,
    next,
    previous,
  } = useReaderPageTurn({
    runtime: session.runtime,
    snapshot: session.snapshot,
    viewport,
    animationStyle,
    spreadMode,
    surfaceTop: 0,
  });
  const isReady = session.snapshot.phase === 'ready' && (highlightsLoaded || Boolean(highlightsError));
  const readingTime = useReadingTime(bookId ?? '', isFocused, isReady && session.snapshot.bookId === bookId);
  const isReaderFrameReady =
    isReady &&
    session.runtime.getCurrentPicture(
      session.snapshot.revisionId,
      session.snapshot.spreadIndex,
      session.snapshot.renderId,
    ) !== undefined &&
    session.runtime.getCurrentFrame(session.snapshot.spreadIndex) !== undefined;
  useMarkInitialContentReady(isReaderFrameReady || Boolean(session.errorMessage));
  const currentHitEntries = useReaderHitEntries(session.runtime, session.snapshot, isReady);
  const currentHighlightFrame = isReady ? session.runtime.getCurrentFrame(session.snapshot.spreadIndex) : undefined;
  const highlightOverlayRequest = useMemo(() => {
    if (!isReady || !highlightsLoaded) return undefined;
    const frame = currentHighlightFrame;
    const href = frame?.manifestHref ?? session.snapshot.position?.locator?.manifestHref ?? '';
    if (!frame || !href) return undefined;
    return {
      runtime: session.runtime,
      revisionId: session.snapshot.revisionId,
      href,
      entries: frame.hits ?? currentHitEntries,
      highlights,
      colors: highlightColors,
    };
  }, [
    currentHighlightFrame,
    currentHitEntries,
    highlightColors,
    highlights,
    highlightsLoaded,
    isReady,
    session.runtime,
    session.snapshot,
  ]);
  const [highlightOverlayResult, setHighlightOverlayResult] = useState<{
    readonly request: NonNullable<typeof highlightOverlayRequest>;
    readonly overlays: readonly ReaderOverlayRect[];
  }>();
  const [excerpt, setExcerpt] = useState<ReaderExcerpt>();
  const resolvedHighlightOverlays =
    highlightOverlayRequest && highlightOverlayResult?.request === highlightOverlayRequest
      ? highlightOverlayResult.overlays
      : undefined;
  useEffect(() => {
    if (!highlightOverlayRequest) return;
    const request = highlightOverlayRequest;
    let active = true;
    void resolveReaderHighlightOverlays(
      request.runtime,
      request.revisionId,
      request.href,
      request.entries,
      request.highlights,
      request.colors,
    ).then((overlays) => {
      if (active) setHighlightOverlayResult({ request, overlays });
    });
    return () => {
      active = false;
    };
  }, [highlightOverlayRequest]);
  const panels = useReaderPanels(isReady);
  const { toggleControls, setPanelOpen } = panels;
  const {
    selection,
    textSelection,
    activeHighlight,
    selectionDrag,
    selectionGesture,
    selectionViewportRects,
    clearSelection,
    copySelection,
    selectHighlightAtPoint,
    getSelection,
    replaceSelection,
  } = useReaderSelection({
    runtime: session.runtime,
    snapshot: session.snapshot,
    currentHitEntries,
    highlights,
    surfaceTransform,
    enabled: isReady && !isSettling && !automaticNavigationActive,
    onSelectionStart: panels.hideControls,
  });
  const { isHighlighting, highlightToDelete, setHighlightToDelete, highlightSelection, deleteHighlight } =
    useReaderHighlightActions({
      bookId: bookId ?? '',
      runtime: session.runtime,
      snapshot: session.snapshot,
      currentHitEntries,
      selection,
      activeHighlight,
      clearSelection,
      getSelection,
      replaceSelection,
      addHighlight,
      removeHighlights,
    });
  const {
    footnote,
    isFootnoteOpen,
    handleFootnoteOpenChange,
    activeImageViewer,
    hasImageViewer,
    imageDoubleTapGesture,
    openContentHit,
    openFootnote,
    openHyperlink,
    closeImageViewer,
    handleImageError,
  } = useReaderContentActions({
    runtime: session.runtime,
    snapshot: session.snapshot,
    surfaceTransform,
    imageInteractionEnabled: isReady && !isSettling && !automaticNavigationActive && !selection,
  });
  const canTurnWithVolumeKeys =
    isReady &&
    !isSettling &&
    !automaticNavigationActive &&
    !selection &&
    !panels.activePanel &&
    !isFootnoteOpen &&
    !note.isOpen &&
    !hasImageViewer;
  const handleVolumeKeyPress = useCallback(
    (direction: 'next' | 'previous') => {
      if (!canTurnWithVolumeKeys) return;
      void (direction === 'next' ? next() : previous());
    },
    [canTurnWithVolumeKeys, next, previous],
  );
  // Keep consuming volume keys while navigation is temporarily unavailable.
  useReaderVolumeKeys(volumeKeysTurnPages, handleVolumeKeyPress);
  const chapterHref = session.snapshot.position?.locator?.manifestHref ?? '';
  const chapterTitle =
    session.snapshot.chapterTitle ?? session.metadata?.title ?? session.book?.title ?? t('reader.loadingChapter');
  const { currentBookmark, resolvePageBookmark, beginBookmarkPull, commitBookmarkPull } = useReaderBookmarkActions({
    runtime: session.runtime,
    snapshot: session.snapshot,
    currentHitEntries,
    chapterTitle,
    bookmarks,
    addBookmark,
    removeBookmark,
    onPullStart: panels.hideControls,
  });
  const bookmarkPull = useBookmarkPull({
    enabled:
      isReady &&
      bookmarksLoaded &&
      !isSettling &&
      !automaticNavigationActive &&
      !selection &&
      !panels.activePanel &&
      !isFootnoteOpen &&
      !note.isOpen,
    bookmarked: Boolean(currentBookmark),
    onStart: beginBookmarkPull,
    onCommit: commitBookmarkPull,
  });
  const bookTitle = session.book?.title ?? session.metadata?.title ?? t('reader.loadingBook');
  const totalSpreads = session.snapshot.totalSpreads;
  const currentSpread = session.snapshot.bookSpreadIndex ?? session.snapshot.spreadIndex;
  const progressText =
    totalSpreads === undefined ? t('reader.calculatingPages') : `${currentSpread + 1} / ${totalSpreads}`;
  const progressPercentage =
    totalSpreads === undefined ? undefined : Math.round((currentSpread / Math.max(totalSpreads - 1, 1)) * 100);
  const initialPaperColor = paperPalette.backgroundColor;
  const canvasBackground = isReady ? session.runtime.getBackgroundColor() : initialPaperColor;
  const readerChromeVisible =
    !activeImageViewer && (panels.controlsVisible || Boolean(panels.activePanel) || Boolean(session.errorMessage));
  useReaderErrorToast({
    bookId: bookId ?? '',
    error: highlightsError,
    label: t('reader.highlightLoadFailed'),
  });
  useReaderErrorToast({
    bookId: bookId ?? '',
    error: bookmarksError,
    label: t('reader.bookmarkLoadFailed'),
  });
  useReaderErrorToast({
    bookId: bookId ?? '',
    error: readingTime.error,
    label: t('reader.readingTimeSaveFailed'),
  });
  useReaderErrorToast({
    bookId: bookId ?? '',
    error: session.errorMessage,
    label: t('reader.loadingFailed'),
    description: session.errorMessage,
  });

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/library' as Href);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) {
          return false;
        }
        router.replace('/library' as Href);
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  const readingGesture = useMemo(
    () => Gesture.Simultaneous(imageDoubleTapGesture, pageTurnGesture, bookmarkPull.gesture, selectionGesture),
    [bookmarkPull.gesture, imageDoubleTapGesture, pageTurnGesture, selectionGesture],
  );

  const handleReadingPress = useCallback(
    (x: number, y: number) => {
      if (!viewport || !isReady || isSettling || bookmarkPull.distance.get() > 0) return;
      if (selection) {
        clearSelection();
        return;
      }
      if (selectHighlightAtPoint(x, y)) return;
      const hitMap = session.runtime.getCurrentHitMap();
      const point = surfaceTransform?.toDisplayPoint(x, y) ?? { x, y };
      const hitIndex = hitMap ? findReaderHitIndex(hitMap.entries, point.x, point.y) : undefined;
      const hit = hitIndex === undefined ? undefined : hitMap?.entries[hitIndex];
      if (openContentHit(hit)) return;
      if (x < viewport.width * 0.3) void previous();
      else if (x > viewport.width * 0.7) void next();
      else toggleControls();
    },
    [
      viewport,
      isReady,
      isSettling,
      bookmarkPull.distance,
      selection,
      clearSelection,
      selectHighlightAtPoint,
      session.runtime,
      surfaceTransform,
      openContentHit,
      previous,
      next,
      toggleControls,
    ],
  );

  const interactiveHits = useMemo(
    () => (isReady && !selection ? currentHitEntries.filter((entry) => entry.footnoteKey || entry.href) : []),
    [currentHitEntries, isReady, selection],
  );

  const handleTabSelect = useCallback(
    (key: string) => {
      if (key === 'toc' || key === 'marks' || key === 'progress' || key === 'appearance' || key === 'typography') {
        setPanelOpen(key, true);
        if (key === 'marks') clearSelection();
      }
    },
    [clearSelection, setPanelOpen],
  );

  const statusText = useMemo(() => {
    switch (session.snapshot.phase) {
      case 'opening':
        return t('reader.loadingEpub');
      case 'paginating':
        return t('reader.paginating');
      case 'reflowing':
        return t('reader.reflowing');
      default:
        return t('reader.preparing');
    }
  }, [session.snapshot.phase, t]);

  return (
    <View className="flex-1" style={{ backgroundColor: canvasBackground }}>
      {isFocused && keepScreenAwake && <ReaderKeepAwake />}
      <SafeAreaListener onChange={handleSafeAreaChange} pointerEvents="none" style={absoluteFillStyle} />
      <StatusBar
        animated
        hidden={!readerChromeVisible && !showSystemStatusBar}
        style={readerTheme === 'dark' ? 'light' : 'dark'}
      />
      <NavigationBar hidden={!readerChromeVisible} style={readerTheme === 'dark' ? 'dark' : 'light'} />

      <ReaderBlurTarget
        ref={noteBlurTarget}
        onLayout={handleLayout}
        className="absolute inset-0 overflow-hidden bg-default"
        accessibilityElementsHidden={note.isOpen}
        importantForAccessibility={note.isOpen ? 'no-hide-descendants' : 'auto'}>
        <>
          <ReaderSurface
            runtime={session.runtime}
            snapshot={session.snapshot}
            initialBackgroundColor={initialPaperColor}
            animationStyle={animationStyle}
            spreadMode={spreadMode}
            interactiveTurn={interactiveTurn}
            automaticTurns={automaticTurns}
            automaticNavigationActive={automaticNavigationActive}
            onAutomaticTurnComplete={completeAutomaticTurn}
            pageTurnSurfaceBinding={pageTurnSurfaceBinding}
            chapterTitle={chapterTitle}
            progressLabel={`${progressText}${progressPercentage === undefined ? '' : ` · ${progressPercentage}%`}`}
            overlayColor={readerTheme === 'dark' ? '#A3A3A3' : '#5C5C5C'}
            overlayInsets={contentInsets}
            resolvePageOverlays={resolvePageHighlights}
            overlays={resolvedHighlightOverlays}
            selectionBinding={textSelection ? selectionDrag.binding : undefined}
            selectionShowFill={!activeHighlight}
            selectionHandleColor={selectionHandleColor}
            selectionOutlineColor={initialPaperColor}
            selectionColor={selectionFillColor}
            resolvePageBookmark={resolvePageBookmark}
            bookmarkColor={bookmarkColor}
            bookmarkPullDistance={bookmarkPull.distance}
            bookmarkPullBookmarked={bookmarkPull.pullBookmarked}
            bookmarkPullThreshold={BookmarkPullThreshold}
            bookmarkPullLabels={bookmarkPullLabels}
            bookmarkOutlineColor={bookmarkOutlineColor}
            bookmarkHintColor={bookmarkHintColor}
            bookmarkReadyColor={bookmarkOutlineColor}
            pullBackgroundColor={initialPaperColor}
            onTransformChange={handleSurfaceTransform}
            style={absoluteFillStyle}
          />
          {brightness < 0.999 && !isScreenBrightnessAvailable && (
            <View
              className="absolute inset-0"
              pointerEvents="none"
              style={{ backgroundColor: '#000000', opacity: 1 - brightness }}
            />
          )}
          {!isReady && !session.errorMessage && (
            <View
              pointerEvents="none"
              className="absolute inset-0 items-center justify-center gap-4"
              style={{ backgroundColor: initialPaperColor }}>
              <Spinner color="default" size="lg" />
              <Text className="text-sm text-muted">{statusText}</Text>
            </View>
          )}
        </>
        <GestureDetector gesture={readingGesture}>
          <View collapsable={false} className="absolute inset-0">
            <Pressable
              accessibilityLabel={t('reader.readerPage')}
              accessibilityRole="adjustable"
              accessibilityActions={
                bookmarksLoaded
                  ? [
                      {
                        name: 'bookmark',
                        label: t(currentBookmark ? 'reader.removeCurrentBookmark' : 'reader.addBookmark'),
                      },
                    ]
                  : []
              }
              onAccessibilityAction={(event) => {
                if (
                  event.nativeEvent.actionName === 'bookmark' &&
                  isReady &&
                  !isSettling &&
                  !automaticNavigationActive
                ) {
                  beginBookmarkPull();
                  void commitBookmarkPull();
                }
              }}
              accessibilityValue={{
                min: 1,
                max: totalSpreads ?? Math.max(1, currentSpread + 1),
                now: currentSpread + 1,
                text: progressText,
              }}
              onPress={(event) => handleReadingPress(event.nativeEvent.locationX, event.nativeEvent.locationY)}
              className="absolute inset-0"
            />
            {surfaceTransform &&
              interactiveHits.map((hit, index) => {
                const origin = surfaceTransform.toViewportPoint(hit.bounds.x, hit.bounds.y);
                return (
                  <Pressable
                    key={`${hit.pageIndex}:${index}:${hit.footnoteKey ?? hit.href}`}
                    accessibilityHint={hit.footnoteKey ? t('reader.openFootnote') : t('reader.openLink')}
                    accessibilityLabel={hit.text || hit.imageAlt || hit.href}
                    accessibilityRole={hit.footnoteKey ? 'button' : 'link'}
                    className="absolute"
                    hitSlop={6}
                    onPress={() => {
                      if (hit.footnoteKey) {
                        void openFootnote(hit.footnoteKey, hit.footnotePending);
                      } else if (hit.href) {
                        void openHyperlink(hit.href);
                      }
                    }}
                    style={{
                      left: origin.x,
                      top: origin.y,
                      width: hit.bounds.width * surfaceTransform.scale,
                      height: hit.bounds.height * surfaceTransform.scale,
                    }}
                  />
                );
              })}
          </View>
        </GestureDetector>
      </ReaderBlurTarget>

      {selection && viewport && !note.isOpen && !excerpt && (
        <SelectionControls
          copyLabel={t('reader.copySelection')}
          endHandleLabel={t('reader.selectionEndHandle')}
          highlightLabel={t(activeHighlight ? 'reader.removeHighlight' : 'reader.highlightSelection')}
          noteLabel={t('reader.noteTitle')}
          excerptLabel={t('reader.excerptTitle')}
          onNote={() => note.openSelection(selection, chapterHref, activeHighlight)}
          onExcerpt={() => {
            setExcerpt({
              text: selection.text,
              bookTitle,
              author: session.book?.author,
              chapterTitle,
              createdAt: Date.now(),
            });
          }}
          isExistingHighlight={Boolean(activeHighlight)}
          selectedColor={activeHighlight?.color ?? 'yellow'}
          selectedStyle={activeHighlight?.style ?? 'highlight'}
          styleLabels={{
            highlight: t('reader.highlightStyleFill'),
            underline: t('reader.highlightStyleUnderline'),
            wavy: t('reader.highlightStyleWavy'),
          }}
          onStyleChange={(style) => void highlightSelection(undefined, style)}
          colorLabels={{
            yellow: t('reader.highlightYellow'),
            pink: t('reader.highlightPink'),
            purple: t('reader.highlightPurple'),
            blue: t('reader.highlightBlue'),
            green: t('reader.highlightGreen'),
          }}
          onColorChange={(color) => void highlightSelection(color)}
          isHighlightDisabled={isHighlighting || !highlightsLoaded}
          drag={textSelection ? selectionDrag : undefined}
          onCopy={() => void copySelection()}
          onHighlight={() => {
            if (activeHighlight?.notes?.length) setHighlightToDelete(activeHighlight);
            else void (activeHighlight ? deleteHighlight() : highlightSelection());
          }}
          rects={selectionViewportRects}
          safeAreaInsets={reservedInsets}
          selectionLabel={t('reader.selectionToolbar')}
          startHandleLabel={t('reader.selectionStartHandle')}
          viewportHeight={viewport.height}
          viewportWidth={viewport.width}
        />
      )}

      <ExcerptSheet
        excerpt={excerpt}
        blurTarget={noteBlurTarget}
        onOpenChange={(open) => {
          if (!open) {
            setExcerpt(undefined);
            clearSelection();
          }
        }}
      />

      {note.isOpen && note.target && (
        <NotesOverlay
          key={note.target.key}
          quote={note.target.text}
          notes={note.notes}
          blurTarget={noteBlurTarget}
          onClose={note.close}
          onSave={note.save}
          onRemove={note.remove}
        />
      )}
      <ConfirmModal
        isOpen={Boolean(highlightToDelete)}
        title={t('reader.removeHighlight')}
        description={t('reader.noteRemoveMarkDescription')}
        confirmLabel={t('reader.removeHighlight')}
        isDestructive
        isConfirming={isHighlighting}
        onOpenChange={(open) => {
          if (!open) setHighlightToDelete(undefined);
        }}
        onConfirm={() => void deleteHighlight(highlightToDelete)}
      />

      {session.errorMessage && (
        <View className="absolute inset-0 items-center justify-center gap-3 bg-background px-8">
          <Text className="text-center text-xl font-semibold text-foreground">{t('reader.loadingFailed')}</Text>
          <Text className="text-center text-sm leading-6 text-muted">{session.errorMessage}</Text>
        </View>
      )}

      <Toc
        isOpen={panels.activePanel === 'toc'}
        onOpenChange={(open) => panels.setPanelOpen('toc', open)}
        runtime={session.runtime}
        snapshot={session.snapshot}
        toc={session.toc}
      />
      <Marks
        isOpen={panels.activePanel === 'marks'}
        onOpenChange={(open) => panels.setPanelOpen('marks', open)}
        runtime={session.runtime}
        toc={session.toc}
        bookmarks={bookmarks}
        highlights={highlights}
        onOpenNote={note.openHighlight}
        bookmarksLoaded={bookmarksLoaded}
        highlightsLoaded={highlightsLoaded}
        bookmarksError={bookmarksError}
        highlightsError={highlightsError}
        onRemoveBookmark={removeBookmark}
        onRemoveHighlight={(id) => removeHighlights([id])}
        onNavigated={clearSelection}
      />
      <Progress
        bookId={bookId ?? ''}
        isOpen={panels.activePanel === 'progress'}
        onOpenChange={(open) => panels.setPanelOpen('progress', open)}
        runtime={session.runtime}
        snapshot={session.snapshot}
      />
      <Typography
        isOpen={panels.activePanel === 'typography'}
        onOpenChange={(open) => panels.setPanelOpen('typography', open)}
      />
      <Appearance
        isOpen={panels.activePanel === 'appearance'}
        onOpenChange={(open) => panels.setPanelOpen('appearance', open)}
      />
      {readerChromeVisible && (
        <Portal name="reader-chrome">
          <Controls onBack={handleBack} safeAreaInsets={reservedInsets} bookTitle={bookTitle} />
          <TabBar
            activeKey={panels.activePanel}
            items={panels.tabItems}
            onSelect={handleTabSelect}
            safeAreaInsets={reservedInsets}
          />
        </Portal>
      )}
      <Footnote footnote={footnote} isOpen={isFootnoteOpen} onOpenChange={handleFootnoteOpenChange} />
      {activeImageViewer && viewport && (
        <ImageViewer
          key={activeImageViewer.uri}
          uri={activeImageViewer.uri}
          origin={activeImageViewer.origin}
          viewport={viewport}
          description={activeImageViewer.description}
          closeLabel={t('reader.closeImageViewer')}
          onClose={closeImageViewer}
          onError={handleImageError}
        />
      )}
    </View>
  );
}

function ReaderKeepAwake() {
  useKeepAwake();
  return null;
}
