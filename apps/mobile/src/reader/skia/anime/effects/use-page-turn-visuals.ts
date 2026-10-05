import { processTransform3d, type Matrix4 } from '@shopify/react-native-skia';
import { useDerivedValue, type DerivedValue, type SharedValue } from 'react-native-reanimated';

import type { ReaderPageTurnEffect } from '../core/page-turn-effect';

export interface ReaderPageTurnVisualValues {
  readonly primaryMatrix: DerivedValue<Matrix4>;
  readonly incomingMatrix: DerivedValue<Matrix4>;
  readonly outgoingMatrix: DerivedValue<Matrix4>;
}

export function useReaderPageTurnVisuals(
  pageTurnEffect: ReaderPageTurnEffect,
  direction: 1 | -1,
  width: number,
  progress: SharedValue<number> | DerivedValue<number>,
): ReaderPageTurnVisualValues {
  const getPrimaryTransform = pageTurnEffect.visual.getPrimaryTransform;
  const getIncomingTransform = pageTurnEffect.visual.getIncomingTransform;
  const getOutgoingTransform = pageTurnEffect.visual.getOutgoingTransform;
  const primaryMatrix = useDerivedValue(
    () => processTransform3d(getPrimaryTransform({ direction, width, progress: progress.value })),
    [direction, getPrimaryTransform, progress, width],
  );
  const incomingMatrix = useDerivedValue(
    () => processTransform3d(getIncomingTransform({ direction, width, progress: progress.value })),
    [direction, getIncomingTransform, progress, width],
  );
  const outgoingMatrix = useDerivedValue(
    () => processTransform3d(getOutgoingTransform({ direction, width, progress: progress.value })),
    [direction, getOutgoingTransform, progress, width],
  );

  return { primaryMatrix, incomingMatrix, outgoingMatrix };
}
