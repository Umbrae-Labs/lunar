import { Canvas, Fill, Rect, Text as SkiaText, useCanvasSize } from '@shopify/react-native-skia';
import { PixelRatio, processColor, type StyleProp, type ViewStyle } from 'react-native';
import { memo, useCallback, useMemo, useSyncExternalStore } from 'react';

import { i18n } from '@/i18n';
import type { ReaderSnapshot } from '../../contracts';
import type { LunarReaderRuntime } from '../../runtime/core/native-reader-runtime';
import {
  useReaderScrollComposer,
  useReaderScrollState,
  type ReaderPageContent,
  type ReaderScrollSurfaceBinding,
} from '../anime';
import { composePageCurlPicture, recordNativeViewportPicture } from './page-picture';
import {
  createReaderOverlaySourcesResolver,
  decorateReaderPageOverlays,
  type ReaderOverlaySource,
} from './reader-overlays';

export interface ReaderScrollSurfaceProps {
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly binding: ReaderScrollSurfaceBinding;
  readonly style?: StyleProp<ViewStyle>;
  /** Canvas color used before the composer shows the first window. */
  readonly initialBackgroundColor?: string;
  readonly overlaySources?: readonly ReaderOverlaySource[];
  readonly chapterTitle?: string;
  readonly overlayColor?: string;
  readonly overlayInsets?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}

/** Windows the composer holds at once: the visible one and two either way. */
const STRIP_TEXTURE_COUNT = 5;
const DefaultOverlayInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * A scrolled reader's surface. The native composer beneath this Canvas draws
 * the strip of windows at the offset the scroll gesture sets; the Canvas holds
 * the header and footer above it, on paper, so text scrolls beneath them.
 */
export const ReaderScrollSurface = memo(function ReaderScrollSurface({
  runtime,
  snapshot,
  binding,
  style,
  initialBackgroundColor = '#000000',
  overlaySources,
  chapterTitle,
  overlayColor = '#777777',
  overlayInsets = DefaultOverlayInsets,
}: ReaderScrollSurfaceProps) {
  const { ref, size: viewport } = useCanvasSize();
  const state = useReaderScrollState(binding.coordinator);
  const resolvePageOverlays = useMemo(() => createReaderOverlaySourcesResolver(overlaySources), [overlaySources]);
  const windows = useMemo(
    () =>
      state.windows.map((window) => ({
        ...window,
        content: decorateReaderPageOverlays(window.content, resolvePageOverlays),
      })),
    [resolvePageOverlays, state.windows],
  );
  const subscribeChromeFont = useCallback((listener: () => void) => runtime.subscribeChromeFont(listener), [runtime]);
  const chromeFontEpoch = useSyncExternalStore(subscribeChromeFont, () => runtime.getChromeFontEpoch());
  const paperColor = snapshot.phase === 'ready' ? runtime.getBackgroundColor() : initialBackgroundColor;
  const textureScale = Math.min(
    3,
    Math.max(1, PixelRatio.get()),
    Math.sqrt(
      (64 * 1024 * 1024) / (STRIP_TEXTURE_COUNT * 4 * Math.max(1, viewport.width) * Math.max(1, viewport.height)),
    ),
  );
  const pixelWidth = Math.max(1, Math.round(viewport.width * textureScale));
  const pixelHeight = Math.max(1, Math.round(viewport.height * textureScale));
  const paintKey = JSON.stringify([
    snapshot.revisionId,
    pixelWidth,
    pixelHeight,
    viewport.width,
    overlayColor,
    paperColor,
  ]);
  const recordPage = useCallback(
    (content: ReaderPageContent) => {
      const pageScale = viewport.width > 0 && content.frame.width > 0 ? viewport.width / content.frame.width : 1;
      const pagePicture = composePageCurlPicture({
        layer: 'page',
        base: content.picture.picture,
        frame: content.frame,
        color: overlayColor,
        height: content.frame.height,
        offsetX: 0,
        offsetY: 0,
        overlayInsets,
        overlays: content.overlays,
        bookmarked: false,
        bookmarkColor: overlayColor,
        pageScale,
        progress: '',
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
        width: content.frame.width,
      });
      try {
        return recordNativeViewportPicture({
          pagePicture,
          paperColor,
          pageScale,
          offsetX: 0,
          offsetY: 0,
          pixelHeight,
          pixelWidth,
          textureScale,
        });
      } finally {
        pagePicture.dispose();
      }
    },
    [overlayColor, overlayInsets, paperColor, pixelHeight, pixelWidth, textureScale, viewport.height, viewport.width],
  );
  const composer = useReaderScrollComposer({
    canvasRef: ref,
    binding,
    windows,
    recordPage,
    paintKey,
    pixelWidth,
    pixelHeight,
    paperColor: nativeColor(paperColor),
  });

  // Header and footer stay on the view's margins, over the scrolling text.
  const scale = windows[0]?.scale ?? 1;
  const margins = runtime.getLayoutMargins();
  const topBand = Math.max(overlayInsets.top, margins.top * scale);
  const bottomBand = Math.max(overlayInsets.bottom, margins.bottom * scale);
  const titleFont = chromeFontEpoch >= 0 ? runtime.getUiFont(14) : undefined;
  const progressFont = chromeFontEpoch >= 0 ? runtime.getUiFont(12) : undefined;
  const title = snapshot.phase === 'ready' ? (snapshot.chapterTitle ?? chapterTitle) : undefined;
  const progress = snapshot.phase === 'ready' ? progressLabel(snapshot) : '';
  const progressWidth = progressFont && progress ? progressFont.getTextWidth(progress) : 0;

  return (
    <Canvas
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      ref={ref}
      style={style}>
      {!composer.showing && <Fill color={paperColor} />}
      <Rect x={0} y={0} width={viewport.width} height={topBand} color={paperColor} />
      <Rect x={0} y={viewport.height - bottomBand} width={viewport.width} height={bottomBand} color={paperColor} />
      {title && titleFont && (
        <SkiaText
          x={overlayInsets.left + 18}
          y={overlayInsets.top + 16}
          text={title}
          font={titleFont}
          color={overlayColor}
        />
      )}
      {progress && progressFont && (
        <SkiaText
          x={viewport.width - overlayInsets.right - 18 - progressWidth}
          y={Math.max(overlayInsets.top + 12, viewport.height - overlayInsets.bottom - 12)}
          text={progress}
          font={progressFont}
          color={overlayColor}
        />
      )}
    </Canvas>
  );
});

function nativeColor(color: string): number {
  const processed = processColor(color);
  return typeof processed === 'number' ? processed >>> 0 : 0xffffffff;
}

function progressLabel(snapshot: ReaderSnapshot): string {
  const totalSpreads = snapshot.totalSpreads;
  const currentSpread = snapshot.bookSpreadIndex ?? snapshot.spreadIndex;
  if (totalSpreads === undefined) return i18n.t('reader.calculatingPages');
  const percentage = Math.round((currentSpread / Math.max(totalSpreads - 1, 1)) * 100);
  return `${percentage}%`;
}
