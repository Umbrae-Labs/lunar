import {
  Group,
  Path,
  Skia,
  Text as SkiaText,
  processTransform3d,
  type SkCanvas,
  type SkFont,
} from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ReaderRenderFrame } from '../../contracts';
import {
  readerBookmarkPlacement,
  readerBookmarkPullHeight,
  readerBookmarkPullPhase,
  ReaderBookmarkWidth,
} from './reader-bookmark-geometry';

const BookmarkPath = 'M0 0 H32 V100 L16 88 L0 100 Z';

export function ReaderBookmarkMark({
  frame,
  pageScale,
  offsetX,
  offsetY,
  topInset,
  color,
}: {
  readonly frame: ReaderRenderFrame;
  readonly pageScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly topInset: number;
  readonly color: string;
}) {
  const placement = readerBookmarkPlacement(frame, pageScale, offsetX, offsetY, topInset);
  return (
    <Group
      transform={[
        { translateX: placement.pageX },
        { translateY: placement.pageY },
        { scaleX: placement.pageScaleX },
        { scaleY: placement.pageScaleY },
      ]}>
      <Path path={BookmarkPath} color={color} />
    </Group>
  );
}

export function ReaderBookmarkPullMark({
  distance,
  pullBookmarked,
  baselineHeight,
  rightEdge,
  threshold,
  color,
  outlineColor,
  hintColor,
  readyColor,
  font,
  labels,
}: {
  readonly distance: SharedValue<number>;
  readonly pullBookmarked: SharedValue<boolean>;
  readonly baselineHeight: number;
  readonly rightEdge: number;
  readonly threshold: number;
  readonly color: string;
  readonly outlineColor: string;
  readonly hintColor: string;
  readonly readyColor: string;
  readonly font?: SkFont;
  readonly labels: Readonly<{
    addPulling: string;
    addReady: string;
    removePulling: string;
    removeReady: string;
  }>;
}) {
  const matrix = useDerivedValue(
    () =>
      processTransform3d([
        { translateX: rightEdge - ReaderBookmarkWidth },
        { scaleY: readerBookmarkPullHeight(baselineHeight, distance.value) / 100 },
      ]),
    [baselineHeight, distance, rightEdge],
  );
  const visibleArea = useDerivedValue(
    () => ({
      x: rightEdge - ReaderBookmarkWidth,
      y: 0,
      width: ReaderBookmarkWidth,
      height: Math.max(0, distance.value),
    }),
    [distance, rightEdge],
  );
  const filledOpacity = useDerivedValue(
    () => (distance.value > 0 && !pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked],
  );
  const outlineOpacity = useDerivedValue(
    () => (distance.value > 0 && pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked],
  );
  const addPullingOpacity = useDerivedValue(
    () => (readerBookmarkPullPhase(distance.value, threshold) === 'pulling' && !pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked, threshold],
  );
  const addReadyOpacity = useDerivedValue(
    () => (readerBookmarkPullPhase(distance.value, threshold) === 'ready' && !pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked, threshold],
  );
  const removePullingOpacity = useDerivedValue(
    () => (readerBookmarkPullPhase(distance.value, threshold) === 'pulling' && pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked, threshold],
  );
  const removeReadyOpacity = useDerivedValue(
    () => (readerBookmarkPullPhase(distance.value, threshold) === 'ready' && pullBookmarked.value ? 1 : 0),
    [distance, pullBookmarked, threshold],
  );
  const hintY = useDerivedValue(() => Math.max(16, distance.value - 18), [distance]);
  const hintClip = useDerivedValue(
    () => ({
      x: 0,
      y: 0,
      width: rightEdge,
      height: Math.max(0, distance.value),
    }),
    [distance, rightEdge],
  );
  const hintRight = rightEdge - ReaderBookmarkWidth - 16;
  return (
    <>
      <Group clip={visibleArea}>
        <Group matrix={matrix}>
          <Group opacity={filledOpacity}>
            <Path path={BookmarkPath} color={color} />
          </Group>
        </Group>
      </Group>
      <Group matrix={matrix} opacity={outlineOpacity}>
        <Path path={BookmarkPath} color={outlineColor} style="stroke" strokeWidth={2} />
      </Group>
      {font && (
        <Group clip={hintClip}>
          <Group opacity={addPullingOpacity}>
            <SkiaText
              text={labels.addPulling}
              font={font}
              color={hintColor}
              x={hintRight - font.getTextWidth(labels.addPulling)}
              y={hintY}
            />
          </Group>
          <Group opacity={addReadyOpacity}>
            <SkiaText
              text={labels.addReady}
              font={font}
              color={readyColor}
              x={hintRight - font.getTextWidth(labels.addReady)}
              y={hintY}
            />
          </Group>
          <Group opacity={removePullingOpacity}>
            <SkiaText
              text={labels.removePulling}
              font={font}
              color={hintColor}
              x={hintRight - font.getTextWidth(labels.removePulling)}
              y={hintY}
            />
          </Group>
          <Group opacity={removeReadyOpacity}>
            <SkiaText
              text={labels.removeReady}
              font={font}
              color={readyColor}
              x={hintRight - font.getTextWidth(labels.removeReady)}
              y={hintY}
            />
          </Group>
        </Group>
      )}
    </>
  );
}

export function renderReaderBookmarkMark(
  canvas: SkCanvas,
  frame: ReaderRenderFrame,
  pageScale: number,
  offsetX: number,
  offsetY: number,
  topInset: number,
  color: string,
) {
  const placement = readerBookmarkPlacement(frame, pageScale, offsetX, offsetY, topInset);
  const scale = Math.max(0.001, pageScale);
  const path = Skia.Path.MakeFromSVGString(BookmarkPath);
  if (!path) return;
  const paint = Skia.Paint();
  try {
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(color));
    canvas.save();
    try {
      // This picture is recorded in page coordinates and transformed later by
      // the viewport composer. Keep the mark in the page's local coordinate
      // system so the outer scale is applied exactly once.
      canvas.translate(frame.width - ReaderBookmarkWidth / scale, -offsetY / scale);
      canvas.scale(1 / scale, placement.height / (100 * scale));
      canvas.drawPath(path, paint);
    } finally {
      canvas.restore();
    }
  } finally {
    paint.dispose();
    path.dispose();
  }
}
