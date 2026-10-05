import { Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { mergeReaderSelectionRects } from '../../interaction/selection-geometry';
import type { ReaderSelectionBinding } from './selection-binding';

export function ReaderSelectionLayer({
  binding,
  color,
  handleColor,
  outlineColor,
  showFill,
}: {
  readonly binding: ReaderSelectionBinding;
  readonly color: string;
  readonly handleColor: string;
  readonly outlineColor: string;
  readonly showFill: boolean;
}) {
  const { rects, startHandle, endHandle, dragging, visible } = binding;
  const path = useDerivedValue(() => {
    const builder = Skia.PathBuilder.Make();
    try {
      for (const rect of mergeReaderSelectionRects(rects.value)) {
        builder.addRRect(Skia.RRectXY(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), 2, 2));
      }
      return builder.build();
    } finally {
      builder.dispose();
    }
  });
  const stems = useDerivedValue(() => {
    const builder = Skia.PathBuilder.Make();
    try {
      for (const point of [startHandle.value, endHandle.value]) {
        builder.addRect(Skia.XYWHRect(point.x - 1, point.y - 8, 2, 12));
      }
      return builder.build();
    } finally {
      builder.dispose();
    }
  });
  const opacity = useDerivedValue(() => (visible.value ? 1 : 0));
  const fillOpacity = useDerivedValue(() => (showFill || dragging.value ? 1 : 0), [showFill]);
  const startX = useDerivedValue(() => startHandle.value.x);
  const startY = useDerivedValue(() => startHandle.value.y + 14);
  const endX = useDerivedValue(() => endHandle.value.x);
  const endY = useDerivedValue(() => endHandle.value.y + 14);
  return (
    <Group opacity={opacity}>
      <Group opacity={fillOpacity}>
        <Path path={path} color={color} />
      </Group>
      <Path path={stems} color={handleColor} />
      <Circle cx={startX} cy={startY} r={9} color={handleColor} />
      <Circle cx={startX} cy={startY} r={9} color={outlineColor} style="stroke" strokeWidth={2} />
      <Circle cx={endX} cy={endY} r={9} color={handleColor} />
      <Circle cx={endX} cy={endY} r={9} color={outlineColor} style="stroke" strokeWidth={2} />
    </Group>
  );
}
