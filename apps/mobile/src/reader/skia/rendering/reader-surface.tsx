import { Canvas, Fill, RoundedRect, useCanvasSize } from '@shopify/react-native-skia';
import { PixelRatio, processColor, type StyleProp, type ViewStyle } from 'react-native';
import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { i18n } from '@/i18n';
import type { ReaderRect, ReaderSnapshot, ReaderSpreadMode } from '../../contracts';
import type { LunarReaderRuntime } from '../../runtime/core/native-reader-runtime';
import { readerPerformanceActivity, startReaderPerformanceMonitor } from '../../runtime/core/performance';
import {
  describeSnapshotIdentity,
  getReaderPageTurnEffect,
  useReaderComposer,
  usePageTurnState,
  ReaderPageTurnStore,
  type ReaderComposerLayer,
  type ReaderPageAnimationStyle,
  type ReaderPageContent,
  type ReaderPageTurnState,
  type ReaderPageTurnSurfaceBinding,
} from '../anime';
import {
  createReaderOverlaySourcesResolver,
  decorateReaderPageOverlays,
  mergeReaderOverlayRects,
  resolveReaderCurrentOverlaySources,
  type ReaderOverlaySource,
} from './reader-overlays';
import { ReaderBookmarkPullMark } from './reader-bookmark-mark';
import { composePageCurlPicture, recordNativeViewportPicture } from './page-picture';
import { readerBookmarkPlacement, ReaderBookmarkWidth } from './reader-bookmark-geometry';
import { createReaderSurfaceTransform, type ReaderSurfaceTransform } from './surface-transform';
import type { ReaderSelectionBinding } from './selection-binding';
import { ReaderSelectionLayer } from './selection-layer';

export type { ReaderSurfaceTransform } from './surface-transform';
export { PAGE_TURN_DURATION_MS, READER_PAGE_ANIMATION_STYLES } from '../anime';
export type { ReaderPageAnimationStyle, ReaderPageContent } from '../anime';

export interface ReaderSurfaceProps {
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly style?: StyleProp<ViewStyle>;
  /** Canvas color used before the composer shows the first page. */
  readonly initialBackgroundColor?: string;
  /** Independent overlay producers, merged for every painted page. */
  readonly overlaySources?: readonly ReaderOverlaySource[];
  /** Transient selection in viewport coordinates; excluded from turn recordings. */
  readonly selectionRects?: readonly ReaderRect[];
  readonly selectionColor?: string;
  readonly selectionBinding?: ReaderSelectionBinding;
  readonly selectionShowFill?: boolean;
  readonly selectionHandleColor?: string;
  readonly selectionOutlineColor?: string;
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
  /** The page-turn controller's surface binding; the composer reports to it. */
  readonly pageTurn?: ReaderPageTurnSurfaceBinding;
  /** Chapter title for pages whose snapshot carries none. */
  readonly chapterTitle?: string;
  readonly overlayColor?: string;
  readonly overlayInsets?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}

const IdlePageTurnStore = new ReaderPageTurnStore();
const selectTurning = (state: ReaderPageTurnState) => state.turning;
const selectStocks = (state: ReaderPageTurnState) => state.stocks;
const DefaultOverlayInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The reader's page surface. The native composer beneath this Canvas paints
 * every page and every turn; the Canvas holds only transient UI above them:
 * the text selection and the bookmark pull mark.
 */
export const ReaderSurface = memo(function ReaderSurface({
  runtime,
  snapshot,
  style,
  initialBackgroundColor = '#000000',
  overlaySources,
  selectionRects,
  selectionColor,
  selectionBinding,
  selectionShowFill = true,
  selectionHandleColor,
  selectionOutlineColor,
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
  pageTurn,
  chapterTitle,
  overlayColor = '#777777',
  overlayInsets = DefaultOverlayInsets,
}: ReaderSurfaceProps) {
  useEffect(() => startReaderPerformanceMonitor(), []);
  const pageTurnStore = pageTurn?.store ?? IdlePageTurnStore;
  const turning = usePageTurnState(pageTurnStore, selectTurning);
  const preparedStocks = usePageTurnState(pageTurnStore, selectStocks);
  useEffect(() => {
    readerPerformanceActivity('surface.commit', 0, {
      revision: snapshot.revisionId,
      spread: snapshot.spreadIndex,
      renderId: snapshot.renderId,
      effect: animationStyle,
    });
  });
  const resolvePageOverlays = useMemo(() => createReaderOverlaySourcesResolver(overlaySources), [overlaySources]);
  const decoratePage = useCallback(
    (content: ReaderPageContent): ReaderPageContent => ({
      ...decorateReaderPageOverlays(content, resolvePageOverlays),
      bookmarked: resolvePageBookmark?.(content.snapshot, content.frame) ?? false,
    }),
    [resolvePageBookmark, resolvePageOverlays],
  );
  // A pair leaving the page on screen starts from that page as the surface
  // shows it now: background pagination can republish its chrome after the
  // pair was stocked, and the composer must not turn an older paint of it.
  const shownKey = snapshot.phase === 'ready' ? describeSnapshotIdentity(snapshot) : undefined;
  const pageTurnStocks = useMemo(
    () =>
      preparedStocks.map((stock) => ({
        ...stock,
        source: decoratePage(stock.source.key === shownKey ? { ...stock.source, snapshot } : stock.source),
        target: decoratePage(stock.target),
      })),
    [decoratePage, preparedStocks, shownKey, snapshot],
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
  const currentOverlays = useMemo(
    () =>
      mergeReaderOverlayRects(
        resolveReaderCurrentOverlaySources(overlaySources, snapshot, frame).filter(
          (overlay) => overlay.revisionId === undefined || overlay.revisionId === snapshot.revisionId,
        ),
      ),
    [frame, overlaySources, snapshot],
  );
  const currentContent = useMemo<ReaderPageContent | undefined>(
    () =>
      snapshot.phase === 'ready' && compiled && frame
        ? {
            key: describeSnapshotIdentity(snapshot),
            snapshot,
            picture: compiled,
            frame,
            overlays: currentOverlays,
            bookmarked: resolvePageBookmark?.(snapshot, frame) ?? false,
          }
        : undefined,
    [compiled, currentOverlays, frame, resolvePageBookmark, snapshot],
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
  const nativePaperColor = nativeColor(paperColor);
  const nativeRevealColor = nativeColor(pullBackgroundColor ?? paperColor);
  const spread = spreadMode === 'double';
  const separateNativeChrome = pageTurnEffect.native?.separateChrome === true && !spread;
  // Page textures stay within the composer's 72 MiB budget: the resting page,
  // a moving pair and the runway, including split chrome.
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
    chapterTitle,
  ]);
  const recordPage = useCallback(
    (content: ReaderPageContent, layer: ReaderComposerLayer) => {
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
      bookmarkColor,
      chapterTitle,
      chromeProgressFont,
      chromeTitleFont,
      nativePixelHeight,
      nativePixelWidth,
      nativeTextureScale,
      offsetX,
      offsetY,
      overlayBottom,
      overlayColor,
      overlayLeft,
      overlayRight,
      overlayTop,
      paperColor,
      scale,
      viewport.height,
      viewport.width,
    ],
  );
  const composer = useReaderComposer({
    canvasRef: ref,
    binding: pageTurn,
    pageTurnEffect,
    spread,
    currentContent,
    stocks: pageTurnStocks,
    recordPage,
    paintKey: nativePaintKey,
    pixelWidth: nativePixelWidth,
    pixelHeight: nativePixelHeight,
    paperColor: nativePaperColor,
    animationDuration,
    fixedChromeTop: overlayTop + 24,
    fixedChromeBottom: overlayBottom + 24,
    pullDistance: bookmarkPullDistance,
    revealColor: nativeRevealColor,
  });

  useEffect(() => {
    onTransformChange?.(createReaderSurfaceTransform(scale, offsetX, offsetY));
  }, [offsetX, offsetY, onTransformChange, scale]);

  return (
    <Canvas
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      ref={ref}
      style={style}>
      {/* Until the composer shows a page, the Canvas holds the paper. */}
      {!composer.showing && <Fill color={paperColor} />}
      {pullPlacement && bookmarkPullLabels && bookmarkPullDistance && bookmarkPullBookmarked && (
        <ReaderBookmarkPullMark
          distance={bookmarkPullDistance}
          pullBookmarked={bookmarkPullBookmarked}
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
      {selectionBinding && selectionColor && !turning && (
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
        !turning &&
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

function nativeColor(color: string): number {
  const processed = processColor(color);
  return typeof processed === 'number' ? processed >>> 0 : 0xffffffff;
}

function progressLabelForSnapshot(snapshot: ReaderSnapshot): string {
  const totalSpreads = snapshot.totalSpreads;
  const currentSpread = snapshot.bookSpreadIndex ?? snapshot.spreadIndex;
  const progressText =
    totalSpreads === undefined ? i18n.t('reader.calculatingPages') : `${currentSpread + 1} / ${totalSpreads}`;
  if (totalSpreads === undefined) return progressText;
  const progressPercentage = Math.round((currentSpread / Math.max(totalSpreads - 1, 1)) * 100);
  return `${progressText} · ${progressPercentage}%`;
}
