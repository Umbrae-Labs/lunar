import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ReaderRect } from '../../contracts';

interface ReaderSelectionOverlayProps {
  readonly rects: readonly ReaderRect[];
  readonly color: string;
  readonly style: StyleProp<ViewStyle>;
}

/** Keeps transient selection paints separate from the page picture and turn composer. */
export const ReaderSelectionOverlay = memo(function ReaderSelectionOverlay({
  rects,
  color,
  style,
}: ReaderSelectionOverlayProps) {
  if (rects.length === 0) return null;
  return (
    <Canvas
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={style}>
      {rects.map((rect, index) => (
        <RoundedRect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} r={2} color={color} />
      ))}
    </Canvas>
  );
});
