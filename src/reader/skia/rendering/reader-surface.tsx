import {
  Canvas,
  Fill,
  Group,
  Picture,
  Path,
  Rect as SkiaRect,
  RoundedRect,
  Text as SkiaText,
  processTransform3d,
  type SkFont,
  useCanvasSize,
} from '@shopify/react-native-skia';
import { PixelRatio, processColor, type StyleProp, type ViewStyle } from 'react-native';
import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { i18n } from '@/i18n';
import type { ReaderRect, ReaderSnapshot, ReaderSpreadMode } from '../../contracts';
import type { LunarReaderRuntime } from '../../runtime/core/native-reader-runtime';
import { readerPerformanceActivity, startReaderPerformanceMonitor } from '../../runtime/core/performance';
import {
  PageCurlMesh,
  automaticPageTurnPaintOrder,
  getReaderPageTurnEffect,
  nativeAutomaticPageTurnBaseContent,
  nativeInteractivePageTurnBaseContent,
  useNativePageTurns,
  useReaderPageTransition,
  usePageCurlTexture,
  type ReaderAutomaticTurn,
  type ReaderPageAnimationStyle,
  type ReaderPageContent,
  type ReaderPageTurnEffect,
  type ReaderInteractiveTurn,
  type ReaderPageTurnSurfaceBinding,
} from '../anime';
import {
  decorateReaderPageOverlays,
  mergeReaderOverlayRects,
  readerOverlayColor,
  readerOverlayDecorationPath,
  type ReaderOverlayRect,
  type ReaderPageOverlayResolver,
} from './reader-overlays';
import { ReaderBookmarkMark, ReaderBookmarkPullMark } from './reader-bookmark-mark';
import { composePageCurlPicture, recordNativeViewportPicture } from './page-picture';
import { readerBookmarkPlacement, ReaderBookmarkWidth } from './reader-bookmark-geometry';
import { createReaderSurfaceTransform, type ReaderSurfaceTransform } from './surface-transform';
import type { ReaderSelectionBinding } from './selection-binding';
import { ReaderSelectionLayer } from './selection-layer';

export type { ReaderSurfaceTransform } from './surface-transform';
export { PAGE_TURN_DURATION_MS, READER_PAGE_ANIMATION_STYLES } from '../anime';
export type { ReaderAutomaticTurn, ReaderInteractiveTurn, ReaderPageAnimationStyle, ReaderPageContent } from '../anime';

export interface ReaderSurfaceProps {
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly style?: StyleProp<ViewStyle>;
  /** Canvas color used before the runtime has produced its first page. */
  readonly initialBackgroundColor?: string;
  readonly overlays?: readonly ReaderOverlayRect[];
  /** Transient selection in viewport coordinates; excluded from turn recordings. */
  readonly selectionRects?: readonly ReaderRect[];
  readonly selectionColor?: string;
  readonly selectionBinding?: ReaderSelectionBinding;
  readonly selectionShowFill?: boolean;
  readonly selectionHandleColor?: string;
  readonly selectionOutlineColor?: string;
  readonly resolvePageOverlays?: ReaderPageOverlayResolver;
  readonly resolvePageBookmark?: (snapshot: ReaderSnapshot, frame: ReaderPageContent['frame']) => boolean;
  readonly bookmarkColor?: string;
  readonly bookmarkPullDistance?: SharedValue<number>;
  readonly bookmarkPullBookmarked?: SharedValue<boolean>;
  readonly bookmarkPullThreshold?: number;
  readonly bookmarkPullLabels?: Readonly<{
    addPulling: string;
    addReady: string;
    removePulling: string;
    removeReady: string;
  }>;
  readonly bookmarkOutlineColor?: string;
  readonly bookmarkHintColor?: string;
  readonly bookmarkReadyColor?: string;
  readonly pullBackgroundColor?: string;
  readonly onTransformChange?: (transform: ReaderSurfaceTransform) => void;
  /** Defaults to `slide`, which keeps the page content legible throughout the turn. */
  readonly animationStyle?: ReaderPageAnimationStyle;
  /** Duration in milliseconds for a page turn. */
  readonly animationDuration?: number;
  readonly spreadMode?: ReaderSpreadMode;
  /** Optional finger-controlled turn; its target picture can arrive during the drag. */
  readonly interactiveTurn?: ReaderInteractiveTurn;
  /** Automatic page turns retained until their visual transition completes. */
  readonly automaticTurns?: readonly ReaderAutomaticTurn[];
  readonly automaticNavigationActive?: boolean;
  readonly onAutomaticTurnComplete?: (turnId: number) => void;
  readonly pageTurnSurfaceBinding?: ReaderPageTurnSurfaceBinding;
  /** Skia-owned reader chrome rendered in the same Canvas as the page. */
  readonly chapterTitle?: string;
  readonly progressLabel?: string;
  readonly overlayColor?: string;
  readonly overlayInsets?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}

const EmptyOverlays: readonly ReaderOverlayRect[] = [];
const EmptyAutomaticTurns: readonly ReaderAutomaticTurn[] = [];
const DefaultOverlayInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const ReaderSurface = memo(function ReaderSurface({
  runtime,
  snapshot,
  style,
  initialBackgroundColor = '#000000',
  overlays,
  selectionRects,
  selectionColor,
  selectionBinding,
  selectionShowFill = true,
  selectionHandleColor,
  selectionOutlineColor,
  resolvePageOverlays,
  resolvePageBookmark,
  bookmarkColor = '#E5594B',
  bookmarkPullDistance,
  bookmarkPullBookmarked,
  bookmarkPullThreshold = 96,
  bookmarkPullLabels,
  bookmarkOutlineColor = '#FFFFFF',
  bookmarkHintColor = '#A3A3A3',
  bookmarkReadyColor = '#FFFFFF',
  pullBackgroundColor,
  onTransformChange,
  animationStyle = 'slide',
  animationDuration = 360,
  spreadMode = 'double',
  interactiveTurn: preparedInteractiveTurn,
  automaticTurns: preparedAutomaticTurns = EmptyAutomaticTurns,
  automaticNavigationActive = false,
  onAutomaticTurnComplete,
  pageTurnSurfaceBinding,
  chapterTitle,
  progressLabel,
  overlayColor = '#777777',
  overlayInsets = DefaultOverlayInsets,
}: ReaderSurfaceProps) {
  useEffect(() => startReaderPerformanceMonitor(), []);
  useEffect(() => {
    readerPerformanceActivity('surface.commit', 0, {
      revision: snapshot.revisionId,
      spread: snapshot.spreadIndex,
      renderId: snapshot.renderId,
      effect: animationStyle,
      interactive: Boolean(preparedInteractiveTurn),
      automatic: preparedAutomaticTurns.length,
    });
  });
  const restingPull = useSharedValue(0);
  const restingBookmark = useSharedValue(false);
  const pull = bookmarkPullDistance ?? restingPull;
  const pullBookmarked = bookmarkPullBookmarked ?? restingBookmark;
  const pullMatrix = useDerivedValue(() => processTransform3d([{ translateY: pull.value }]), [pull]);
  const bookmarkPageOpacity = useDerivedValue(() => (pull.value > 0 ? 0 : 1), [pull]);
  const decoratePage = useCallback(
    (content: ReaderPageContent): ReaderPageContent => ({
      ...decorateReaderPageOverlays(content, resolvePageOverlays),
      bookmarked: resolvePageBookmark?.(content.snapshot, content.frame) ?? false,
    }),
    [resolvePageBookmark, resolvePageOverlays],
  );
  const interactiveTurn = useMemo(
    () =>
      preparedInteractiveTurn
        ? {
            ...preparedInteractiveTurn,
            source: preparedInteractiveTurn.source ? decoratePage(preparedInteractiveTurn.source) : undefined,
            content: preparedInteractiveTurn.content ? decoratePage(preparedInteractiveTurn.content) : undefined,
          }
        : undefined,
    [decoratePage, preparedInteractiveTurn],
  );
  const automaticTurns = useMemo(
    () =>
      preparedAutomaticTurns.map((turn) => ({
        ...turn,
        from: decoratePage(turn.from),
        to: decoratePage(turn.to),
      })),
    [decoratePage, preparedAutomaticTurns],
  );
  const pageTurnEffect = getReaderPageTurnEffect(animationStyle);
  const { ref, size: viewport } = useCanvasSize();
  const compiled =
    snapshot.phase === 'ready'
      ? runtime.getCurrentPicture(snapshot.revisionId, snapshot.spreadIndex, snapshot.renderId)
      : undefined;
  const frame = snapshot.phase === 'ready' ? runtime.getCurrentFrame(snapshot.spreadIndex) : undefined;
  const scale =
    frame && viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / frame.width, viewport.height / frame.height)
      : 1;
  const overlayLeft = overlayInsets.left;
  const overlayRight = overlayInsets.right;
  const overlayTop = overlayInsets.top;
  const overlayBottom = overlayInsets.bottom;
  const offsetX = frame ? (viewport.width - frame.width * scale) / 2 : 0;
  const offsetY = frame ? (viewport.height - frame.height * scale) / 2 : 0;
  const currentKey =
    snapshot.phase === 'ready' && compiled && frame
      ? `${snapshot.revisionId}:${snapshot.spreadIndex}:${snapshot.renderId ?? 0}`
      : undefined;
  const currentOverlays = useMemo(() => {
    const synchronous = frame ? (resolvePageOverlays?.(snapshot, frame) ?? []) : [];
    const source = overlays !== undefined && overlays.length > 0 ? overlays : synchronous;
    return mergeReaderOverlayRects(
      source.filter((overlay) => overlay.revisionId === undefined || overlay.revisionId === snapshot.revisionId),
    );
  }, [frame, overlays, resolvePageOverlays, snapshot]);
  const currentContent = useMemo<ReaderPageContent | undefined>(
    () =>
      currentKey && compiled && frame
        ? {
            key: currentKey,
            snapshot,
            picture: compiled,
            frame,
            overlays: currentOverlays,
            bookmarked: resolvePageBookmark?.(snapshot, frame) ?? false,
          }
        : undefined,
    [compiled, currentKey, currentOverlays, frame, resolvePageBookmark, snapshot],
  );
  const pullPlacement = currentContent
    ? readerBookmarkPlacement(currentContent.frame, scale, offsetX, offsetY, overlayTop)
    : undefined;
  // The runtime swaps the chrome face behind `getUiFont` without any prop
  // changing, and this component is memoized, so a subscription is the only way
  // the change reaches it. Once re-rendered, the fonts below are new objects and
  // every memo holding one of them rebuilds.
  const subscribeChromeFont = useCallback((listener: () => void) => runtime.subscribeChromeFont(listener), [runtime]);
  const chromeFontEpoch = useSyncExternalStore(subscribeChromeFont, () => runtime.getChromeFontEpoch());
  const bookmarkHintFont = bookmarkPullLabels ? runtime.getUiFont(16) : undefined;
  // Resolved in the render body rather than inside each memo, so that the
  // memos can depend on the font itself instead of on a change counter.
  const chromePageScale = Math.max(0.001, scale);
  const chromeTitleFont = runtime.getUiFont(14 / chromePageScale);
  const chromeProgressFont = runtime.getUiFont(12 / chromePageScale);
  const paperColor = snapshot.phase === 'ready' ? runtime.getBackgroundColor() : initialBackgroundColor;
  const processedPaperColor = processColor(paperColor);
  const nativePaperColor = typeof processedPaperColor === 'number' ? processedPaperColor >>> 0 : 0xffffffff;
  const separateNativeChrome = pageTurnEffect.native?.separateChrome === true;
  // Reserve room for the moving pair and retained handoff below the native
  // 72 MiB budget, including older clients that rasterize split chrome.
  const nativeTextureScale = Math.min(
    3,
    Math.max(1, PixelRatio.get()),
    Math.sqrt(
      (64 * 1024 * 1024) /
        ((separateNativeChrome ? 4 : 2) * 4 * Math.max(1, viewport.width) * Math.max(1, viewport.height)),
    ),
  );
  const nativePixelWidth = Math.max(1, Math.round(viewport.width * nativeTextureScale));
  const nativePixelHeight = Math.max(1, Math.round(viewport.height * nativeTextureScale));
  const nativePaintKey = JSON.stringify([
    snapshot.revisionId,
    chromeFontEpoch,
    nativePixelWidth,
    nativePixelHeight,
    scale,
    offsetX,
    offsetY,
    overlayTop,
    overlayRight,
    overlayBottom,
    overlayLeft,
    overlayColor,
    bookmarkColor,
    paperColor,
    separateNativeChrome,
  ]);
  const createNativePagePicture = useCallback(
    (content: ReaderPageContent, layer: 'all' | 'page' | 'chrome' = separateNativeChrome ? 'page' : 'all') => {
      const pageScale = Math.max(0.001, scale);
      const title = content.snapshot.chapterTitle ?? chapterTitle;
      const pagePicture = composePageCurlPicture({
        layer,
        base: content.picture.picture,
        frame: content.frame,
        color: overlayColor,
        height: content.frame.height,
        offsetX,
        offsetY,
        overlayInsets: {
          top: overlayTop,
          right: overlayRight,
          bottom: overlayBottom,
          left: overlayLeft,
        },
        overlays: content.overlays,
        bookmarked: content.bookmarked,
        bookmarkColor,
        pageScale,
        progress: progressLabelForSnapshot(content.snapshot),
        progressFont: chromeProgressFont,
        title,
        titleFont: title ? chromeTitleFont : undefined,
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
        width: content.frame.width,
      });
      try {
        return recordNativeViewportPicture({
          pagePicture,
          paperColor: layer === 'chrome' ? 'transparent' : paperColor,
          pageScale,
          offsetX,
          offsetY,
          pixelHeight: nativePixelHeight,
          pixelWidth: nativePixelWidth,
          textureScale: nativeTextureScale,
        });
      } finally {
        pagePicture.dispose();
      }
    },
    [
      nativePixelHeight,
      nativePixelWidth,
      nativeTextureScale,
      bookmarkColor,
      chapterTitle,
      chromeProgressFont,
      chromeTitleFont,
      offsetX,
      offsetY,
      overlayBottom,
      overlayColor,
      overlayLeft,
      overlayRight,
      overlayTop,
      paperColor,
      separateNativeChrome,
      scale,
      viewport.height,
      viewport.width,
    ],
  );
  const createNativeChromePicture = useCallback(
    (content: ReaderPageContent) => createNativePagePicture(content, 'chrome'),
    [createNativePagePicture],
  );
  const nativeAutomaticPageTurnState = useNativePageTurns({
    paintKey: nativePaintKey,
    canvasRef: ref,
    enabled:
      pageTurnEffect.native !== undefined &&
      spreadMode === 'single' &&
      (onAutomaticTurnComplete !== undefined || pageTurnSurfaceBinding !== undefined),
    turns: automaticTurns,
    pixelWidth: nativePixelWidth,
    pixelHeight: nativePixelHeight,
    paperColor: nativePaperColor,
    createPicture: createNativePagePicture,
    createChromePicture: separateNativeChrome ? createNativeChromePicture : undefined,
    onComplete: onAutomaticTurnComplete,
    pageTurnEffect,
    fixedChromeTop: overlayTop + 24,
    fixedChromeBottom: overlayBottom + 24,
    currentContent,
    interactiveTurn,
    interactiveSource: interactiveTurn?.source ?? currentContent,
    surfaceBinding: pageTurnSurfaceBinding,
  });
  const {
    transition: activeTransition,
    visibleContent,
    visualKind: pageTurnVisualKind,
    coverMatrix,
    incomingSlideMatrix,
    outgoingSlideMatrix,
    progress,
    grabX,
    grabY,
  } = useReaderPageTransition(
    currentContent,
    pageTurnEffect,
    animationDuration,
    interactiveTurn,
    spreadMode,
    automaticTurns[0],
    automaticTurns.length,
    automaticNavigationActive,
    onAutomaticTurnComplete,
    nativeAutomaticPageTurnState.enabled,
  );
  const incomingContent = interactiveTurn && !interactiveTurn.content ? undefined : (visibleContent ?? currentContent);
  const incomingSnapshot = incomingContent?.snapshot ?? snapshot;
  const incomingFrame = incomingContent?.frame ?? frame;
  const automaticDirection = automaticTurns[0]?.direction ?? 1;
  const automaticPaintTurns = useMemo(
    () =>
      automaticPageTurnPaintOrder(automaticTurns, automaticDirection).map((turn) => ({
        ...turn,
        from: activeTransition?.from.key === turn.from.key ? activeTransition.from : turn.from,
      })),
    [activeTransition, automaticDirection, automaticTurns],
  );
  const automaticBackgroundContent =
    automaticPaintTurns.length === 0
      ? undefined
      : automaticDirection > 0
        ? automaticPaintTurns.at(-1)?.to
        : automaticPaintTurns[0]?.from;
  const automaticPageTurnsVisible = pageTurnVisualKind === 'curl' && automaticTurns.length > 0;
  const nativeAutomaticPageTurnsVisible = automaticTurns.length > 0 && nativeAutomaticPageTurnState.enabled;
  const fallbackAutomaticPageTurnsVisible = automaticPageTurnsVisible && !nativeAutomaticPageTurnState.enabled;
  const nativeInteractiveGestureDriven = interactiveTurn?.nativeGesture?.driven === true;
  const nativeInteractiveBaseContent = nativeInteractivePageTurnBaseContent(
    activeTransition?.from,
    interactiveTurn?.content,
    interactiveTurn?.nativeGesture,
  );
  const nativeAutomaticBaseContent = nativeAutomaticPageTurnBaseContent(
    automaticTurns,
    currentContent,
    nativeAutomaticPageTurnState.presentedTurnId,
  );

  // The moving sheet owns its chrome. Recording it into the same source
  // picture prevents a footer or chapter title from travelling on a separate
  // linear transform while the paper follows the curl profile.
  const isSinglePreviousPageTurn =
    pageTurnVisualKind === 'curl' && spreadMode === 'single' && activeTransition?.direction === -1;
  const pageCurlSource =
    pageTurnVisualKind === 'curl' && !automaticNavigationActive && !nativeInteractiveGestureDriven
      ? activeTransition
        ? isSinglePreviousPageTurn
          ? incomingContent
          : activeTransition.from
        : incomingContent
      : undefined;
  const pageCurlWidth = pageCurlSource?.frame.width ?? activeTransition?.from.frame.width ?? 0;
  const pageCurlHeight = pageCurlSource?.frame.height ?? activeTransition?.from.frame.height ?? 0;
  const pageCurlProgressText = pageCurlSource ? progressLabelForSnapshot(pageCurlSource.snapshot) : undefined;
  const pageCurlBase = pageCurlSource?.picture.picture;
  const pageCurlFrame = pageCurlSource?.frame;
  const pageCurlTitle = pageCurlSource?.snapshot.chapterTitle;
  const pageCurlBookmarked = pageCurlSource?.bookmarked;
  // Gesture preparation/settling creates new content wrappers and overlay
  // arrays. Equal paint data must keep the same Picture and GPU texture.
  const pageCurlOverlayKey = JSON.stringify(pageCurlSource?.overlays ?? EmptyOverlays);
  const pageCurlOverlays = useMemo<readonly ReaderOverlayRect[]>(
    () => JSON.parse(pageCurlOverlayKey),
    [pageCurlOverlayKey],
  );
  const pageCurlTexturePicture = useMemo(() => {
    if (!pageCurlBase || !pageCurlFrame || !pageCurlProgressText) return undefined;
    const pageScale = Math.max(0.001, scale);
    const title = pageCurlTitle;
    const titleFont = title ? chromeTitleFont : undefined;
    const progressFont = chromeProgressFont;
    if ((!title || !titleFont) && !progressFont) return undefined;
    return composePageCurlPicture({
      base: pageCurlBase,
      frame: pageCurlFrame,
      color: overlayColor,
      height: pageCurlFrame.height,
      offsetX,
      offsetY,
      pageScale,
      progress: pageCurlProgressText,
      bookmarked: pageCurlBookmarked,
      bookmarkColor,
      progressFont,
      title,
      titleFont,
      viewportHeight: viewport.height,
      viewportWidth: viewport.width,
      width: pageCurlFrame.width,
      overlayInsets: {
        top: overlayTop,
        right: overlayRight,
        bottom: overlayBottom,
        left: overlayLeft,
      },
      overlays: pageCurlOverlays,
    });
  }, [
    offsetX,
    offsetY,
    overlayColor,
    overlayBottom,
    overlayLeft,
    overlayRight,
    overlayTop,
    bookmarkColor,
    chromeProgressFont,
    chromeTitleFont,
    pageCurlProgressText,
    pageCurlBase,
    pageCurlFrame,
    pageCurlTitle,
    pageCurlBookmarked,
    pageCurlOverlays,
    scale,
    viewport.height,
    viewport.width,
  ]);
  const pageCurlTexture = usePageCurlTexture(
    pageCurlTexturePicture ?? pageCurlSource?.picture.picture,
    pageCurlSource?.frame.width ?? 0,
    pageCurlSource?.frame.height ?? 0,
    pageCurlSource?.key,
    pageCurlTexturePicture !== undefined,
  );

  useEffect(() => {
    onTransformChange?.(createReaderSurfaceTransform(scale, offsetX, offsetY));
  }, [offsetX, offsetY, onTransformChange, scale]);

  const canRenderFrame =
    snapshot.phase === 'ready' &&
    ((compiled !== undefined && frame !== undefined) || activeTransition !== undefined || automaticPageTurnsVisible);
  const renderChrome = (
    chromeSnapshot: ReaderSnapshot,
    chromeFrame: { readonly width: number; readonly height: number },
    titleOverride?: string,
    progressOverride?: string,
  ): ReactNode => {
    const pageScale = Math.max(0.001, scale);
    const title = titleOverride ?? chromeSnapshot.chapterTitle ?? chapterTitle;
    const progress = progressOverride ?? progressLabelForSnapshot(chromeSnapshot);
    const titleFont = title ? chromeTitleFont : undefined;
    const progressFont = progress ? chromeProgressFont : undefined;
    const chapterX = (overlayInsets.left + 18 - offsetX) / pageScale;
    const chapterY = (overlayInsets.top + 16 - offsetY) / pageScale;
    const progressWidth = progressFont && progress ? progressFont.getTextWidth(progress) : 0;
    const progressX = Math.max(
      chapterX,
      (viewport.width - overlayInsets.right - 18 - progressWidth * pageScale - offsetX) / pageScale,
    );
    const progressY =
      (Math.max(overlayInsets.top + 12, viewport.height - overlayInsets.bottom - 12) - offsetY) / pageScale;
    const chapterClipWidth = Math.max(0, (viewport.width - overlayInsets.right - 18 - offsetX) / pageScale - chapterX);
    if ((!title || !titleFont) && (!progress || !progressFont)) return null;
    return (
      <>
        {title && titleFont && (
          <Group
            clip={{
              x: chapterX,
              y: (overlayInsets.top - offsetY) / pageScale,
              width: chapterClipWidth,
              height: 24 / pageScale,
            }}>
            <SkiaText color={overlayColor} font={titleFont} text={title} x={chapterX} y={chapterY} />
          </Group>
        )}
        {progress && progressFont && chromeFrame.width > 0 && chromeFrame.height > 0 && (
          <SkiaText color={overlayColor} font={progressFont} text={progress} x={progressX} y={progressY} />
        )}
      </>
    );
  };
  const renderPage = (content: ReaderPageContent): ReactNode => (
    <>
      <ReaderPagePicture content={content} />
      {content.bookmarked && (
        <Group opacity={bookmarkPageOpacity}>
          <ReaderBookmarkMark
            frame={content.frame}
            pageScale={scale}
            offsetX={offsetX}
            topInset={overlayTop}
            offsetY={offsetY}
            color={bookmarkColor}
          />
        </Group>
      )}
    </>
  );

  return (
    <Canvas
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      ref={ref}
      style={style}>
      <Fill color={pullBackgroundColor ?? paperColor} />
      <Group matrix={pullMatrix}>
        <SkiaRect x={0} y={0} width={viewport.width} height={viewport.height} color={paperColor} />
        {canRenderFrame && (
          <Group transform={[{ translateX: offsetX }, { translateY: offsetY }, { scale }]}>
            {nativeAutomaticPageTurnsVisible && nativeAutomaticBaseContent ? (
              <Group>
                {renderPage(nativeAutomaticBaseContent)}
                {renderChrome(nativeAutomaticBaseContent.snapshot, nativeAutomaticBaseContent.frame)}
              </Group>
            ) : fallbackAutomaticPageTurnsVisible && automaticBackgroundContent ? (
              <Group>
                {renderPage(automaticBackgroundContent)}
                {renderChrome(automaticBackgroundContent.snapshot, automaticBackgroundContent.frame)}
                {automaticPaintTurns.map((turn) => (
                  <AutomaticPageCurlLayer
                    key={turn.id}
                    animationDuration={animationDuration}
                    chromeProgressFont={chromeProgressFont}
                    chromeTitleFont={chromeTitleFont}
                    offsetX={offsetX}
                    offsetY={offsetY}
                    onComplete={onAutomaticTurnComplete}
                    overlayColor={overlayColor}
                    bookmarkColor={bookmarkColor}
                    overlayInsets={overlayInsets}
                    pageTurnEffect={pageTurnEffect}
                    runtime={runtime}
                    scale={scale}
                    spreadMode={spreadMode}
                    turn={turn}
                    viewportHeight={viewport.height}
                    viewportWidth={viewport.width}
                  />
                ))}
              </Group>
            ) : pageTurnVisualKind === 'curl' ? (
              <Group key="page-content">
                <Group key="page-current">
                  {nativeInteractiveBaseContent ? (
                    <>
                      {renderPage(nativeInteractiveBaseContent)}
                      {renderChrome(nativeInteractiveBaseContent.snapshot, nativeInteractiveBaseContent.frame)}
                    </>
                  ) : (
                    <>
                      {incomingContent && renderPage(incomingContent)}
                      {incomingFrame &&
                        renderChrome(
                          incomingSnapshot,
                          incomingFrame,
                          chapterTitle,
                          interactiveTurn ? undefined : progressLabel,
                        )}
                    </>
                  )}
                </Group>
                {activeTransition && !nativeInteractiveGestureDriven && isSinglePreviousPageTurn && (
                  <Group key={`page-source:${activeTransition.from.key}`}>
                    {renderPage(activeTransition.from)}
                    {renderChrome(activeTransition.from.snapshot, activeTransition.from.frame)}
                  </Group>
                )}
                {activeTransition && !nativeInteractiveGestureDriven && (
                  <PageCurlMesh
                    key={pageCurlSource?.key ?? activeTransition.from.key}
                    direction={activeTransition.direction}
                    grabX={isSinglePreviousPageTurn ? pageCurlWidth * 0.6 : grabX}
                    grabY={isSinglePreviousPageTurn ? pageCurlHeight / 2 : grabY}
                    grabYValue={isSinglePreviousPageTurn ? undefined : interactiveTurn?.grabYValue}
                    heldRollTilt={isSinglePreviousPageTurn ? undefined : interactiveTurn?.heldRollTilt}
                    heldRollTiltValue={isSinglePreviousPageTurn ? undefined : interactiveTurn?.heldRollTiltValue}
                    height={pageCurlHeight}
                    initialProgress={interactiveTurn?.progress}
                    paperColor={paperColor}
                    phase={isSinglePreviousPageTurn ? 'incoming-landing' : 'full'}
                    spreadMode={spreadMode}
                    gestureDriven={Boolean(interactiveTurn)}
                    settling={interactiveTurn?.settling}
                    settleTo={interactiveTurn?.settleTo}
                    picture={pageCurlSource?.picture ?? activeTransition.from.picture}
                    pressedEdgeX={isSinglePreviousPageTurn ? undefined : interactiveTurn?.pressedEdgeX}
                    pressedEdgeXValue={isSinglePreviousPageTurn ? undefined : interactiveTurn?.pressedEdgeXValue}
                    progress={progress}
                    texture={pageCurlTexture}
                    width={pageCurlWidth}
                  />
                )}
              </Group>
            ) : activeTransition && pageTurnVisualKind === 'cover' ? (
              <Group>
                <Group>
                  {renderPage(activeTransition.from)}
                  {renderChrome(activeTransition.from.snapshot, activeTransition.from.frame)}
                </Group>
                <Group matrix={coverMatrix}>
                  {incomingContent && renderPage(incomingContent)}
                  {incomingFrame &&
                    renderChrome(
                      incomingSnapshot,
                      incomingFrame,
                      chapterTitle,
                      interactiveTurn ? undefined : progressLabel,
                    )}
                </Group>
              </Group>
            ) : pageTurnVisualKind === 'slide' ? (
              <Group>
                {nativeInteractiveGestureDriven && nativeInteractiveBaseContent ? (
                  <Group key={`slide-native-base:${nativeInteractiveBaseContent.key}`}>
                    {renderPage(nativeInteractiveBaseContent)}
                    {renderChrome(nativeInteractiveBaseContent.snapshot, nativeInteractiveBaseContent.frame)}
                  </Group>
                ) : (
                  <>
                    <Group key="slide-current" matrix={activeTransition ? incomingSlideMatrix : undefined}>
                      {incomingContent && renderPage(incomingContent)}
                    </Group>
                    {activeTransition && (
                      <Group key={`slide-outgoing:${activeTransition.from.key}`} matrix={outgoingSlideMatrix}>
                        {renderPage(activeTransition.from)}
                      </Group>
                    )}
                    {incomingFrame &&
                      renderChrome(
                        incomingSnapshot,
                        incomingFrame,
                        chapterTitle,
                        interactiveTurn ? undefined : progressLabel,
                      )}
                  </>
                )}
              </Group>
            ) : (
              <>
                {incomingContent && renderPage(incomingContent)}
                {incomingFrame &&
                  renderChrome(
                    incomingSnapshot,
                    incomingFrame,
                    chapterTitle,
                    interactiveTurn ? undefined : progressLabel,
                  )}
              </>
            )}
          </Group>
        )}
      </Group>
      {pullPlacement && bookmarkPullLabels && (
        <ReaderBookmarkPullMark
          distance={pull}
          pullBookmarked={pullBookmarked}
          baselineHeight={pullPlacement.height}
          rightEdge={pullPlacement.x + ReaderBookmarkWidth}
          threshold={bookmarkPullThreshold}
          color={bookmarkColor}
          outlineColor={bookmarkOutlineColor}
          hintColor={bookmarkHintColor}
          readyColor={bookmarkReadyColor}
          font={bookmarkHintFont}
          labels={bookmarkPullLabels}
        />
      )}
      {selectionBinding && selectionColor && !interactiveTurn && automaticTurns.length === 0 && (
        <ReaderSelectionLayer
          binding={selectionBinding}
          color={selectionColor}
          handleColor={selectionHandleColor ?? selectionColor}
          outlineColor={selectionOutlineColor ?? paperColor}
          showFill={selectionShowFill}
        />
      )}
      {!selectionBinding &&
        selectionColor &&
        !interactiveTurn &&
        automaticTurns.length === 0 &&
        selectionRects?.map((rect, index) => (
          <RoundedRect
            key={`selection:${index}`}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            r={2}
            color={selectionColor}
          />
        ))}
    </Canvas>
  );
});

function ReaderPagePicture({ content }: { readonly content: ReaderPageContent }) {
  return (
    <>
      <Picture picture={content.picture.picture} />
      {mergeReaderOverlayRects(content.overlays ?? []).map((overlay, index) => {
        const path = readerOverlayDecorationPath(overlay);
        return path ? (
          <Path
            key={index}
            path={path}
            color={readerOverlayColor(overlay)}
            style="stroke"
            strokeWidth={overlay.thickness ?? 1.5}
          />
        ) : (
          <RoundedRect
            key={`${index}:${overlay.bounds.x}:${overlay.bounds.y}`}
            x={overlay.bounds.x}
            y={overlay.bounds.y}
            width={overlay.bounds.width}
            height={overlay.bounds.height}
            r={overlay.radius ?? 0}
            color={overlay.color}
            style={overlay.outline ? 'stroke' : 'fill'}
            strokeWidth={overlay.thickness ?? 1}
          />
        );
      })}
    </>
  );
}

interface AutomaticPageCurlLayerProps {
  readonly animationDuration: number;
  readonly bookmarkColor: string;
  /** Chrome fonts resolved by the owner; see the note in `ReaderSurface`. */
  readonly chromeTitleFont?: SkFont;
  readonly chromeProgressFont?: SkFont;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly onComplete?: (turnId: number) => void;
  readonly overlayColor: string;
  readonly overlayInsets: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly runtime: LunarReaderRuntime;
  readonly scale: number;
  readonly spreadMode: ReaderSpreadMode;
  readonly turn: ReaderAutomaticTurn;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

const AutomaticPageCurlLayer = memo(function AutomaticPageCurlLayer({
  animationDuration,
  bookmarkColor,
  chromeTitleFont,
  chromeProgressFont,
  offsetX,
  offsetY,
  onComplete,
  overlayColor,
  overlayInsets,
  pageTurnEffect,
  runtime,
  scale,
  spreadMode,
  turn,
  viewportHeight,
  viewportWidth,
}: AutomaticPageCurlLayerProps) {
  const { direction, id: turnId } = turn;
  const incomingLanding = spreadMode === 'single' && direction < 0;
  const source = incomingLanding ? turn.to : turn.from;
  const progressText = progressLabelForSnapshot(source.snapshot);
  const texturePicture = useMemo(() => {
    const pageScale = Math.max(0.001, scale);
    const title = source.snapshot.chapterTitle;
    const titleFont = title ? chromeTitleFont : undefined;
    const progressFont = chromeProgressFont;
    if ((!title || !titleFont) && !progressFont) return undefined;
    return composePageCurlPicture({
      base: source.picture.picture,
      frame: source.frame,
      bookmarked: source.bookmarked,
      bookmarkColor,
      color: overlayColor,
      height: source.frame.height,
      offsetX,
      offsetY,
      overlayInsets,
      overlays: source.overlays,
      pageScale,
      progress: progressText,
      progressFont,
      title,
      titleFont,
      viewportHeight,
      viewportWidth,
      width: source.frame.width,
    });
  }, [
    bookmarkColor,
    chromeProgressFont,
    chromeTitleFont,
    offsetX,
    offsetY,
    overlayColor,
    overlayInsets,
    progressText,
    scale,
    source,
    viewportHeight,
    viewportWidth,
  ]);
  const texture = usePageCurlTexture(
    texturePicture ?? source.picture.picture,
    source.frame.width,
    source.frame.height,
    `${source.key}:automatic:${turnId}`,
    texturePicture !== undefined,
  );
  const progress = useSharedValue(0);
  const texturesReady = texture.ready;

  useEffect(() => {
    if (!texturesReady) return;
    const duration = pageTurnEffect.motion.getDuration({
      releaseVelocity: 0,
      animationDuration,
      incomingPageLanding: incomingLanding,
    });
    progress.set(
      withTiming(
        1,
        {
          duration,
          easing: pageTurnEffect.motion.getEasing({
            fromProgress: 0,
            targetProgress: 1,
            releaseVelocityPxPerMs: 0,
            incomingPageLanding: incomingLanding,
            interactive: false,
          }),
        },
        (finished) => {
          if (finished && onComplete) scheduleOnRN(onComplete, turnId);
        },
      ),
    );
    return () => cancelAnimation(progress);
  }, [animationDuration, incomingLanding, onComplete, pageTurnEffect, progress, texturesReady, turnId]);

  return (
    <PageCurlMesh
      direction={direction}
      grabX={incomingLanding ? source.frame.width * 0.6 : direction > 0 ? 0 : source.frame.width}
      grabY={source.frame.height / 2}
      height={source.frame.height}
      phase={incomingLanding ? 'incoming-landing' : 'full'}
      paperColor={runtime.getBackgroundColor()}
      picture={source.picture}
      progress={progress}
      spreadMode={spreadMode}
      texture={texture}
      width={source.frame.width}
    />
  );
});

function progressLabelForSnapshot(snapshot: ReaderSnapshot): string {
  const totalSpreads = snapshot.totalSpreads;
  const currentSpread = snapshot.bookSpreadIndex ?? snapshot.spreadIndex;
  const progressText =
    totalSpreads === undefined ? i18n.t('reader.calculatingPages') : `${currentSpread + 1} / ${totalSpreads}`;
  if (totalSpreads === undefined) return progressText;
  const progressPercentage = Math.round((currentSpread / Math.max(totalSpreads - 1, 1)) * 100);
  return `${progressText} · ${progressPercentage}%`;
}
