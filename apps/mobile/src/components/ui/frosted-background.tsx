import { BlurView } from 'expo-blur';
import type { RefObject } from 'react';
import { View } from 'react-native';
import { useUniwind, withUniwind } from 'uniwind';

const FrostedBlur = withUniwind(BlurView);

interface FrostedBackgroundProps {
  /**
   * Content that sits beneath the surface. Android only blurs a registered
   * `BlurTargetView`; without one the surface falls back to its translucent tint.
   */
  readonly blurTarget?: RefObject<View | null>;
  /** Translucent colour laid over the blur so foreground content stays legible. */
  readonly tintClassName?: string;
}

/**
 * Frosted-glass backdrop for bars that float above scrolling content. Render it
 * as the first child of a positioned container with `overflow-hidden`.
 */
export function FrostedBackground({ blurTarget, tintClassName = 'bg-default-soft-hover' }: FrostedBackgroundProps) {
  const { theme } = useUniwind();

  return (
    <>
      <FrostedBlur
        pointerEvents="none"
        blurTarget={blurTarget}
        blurMethod={blurTarget ? 'dimezisBlurViewSdk31Plus' : 'none'}
        intensity={20}
        blurReductionFactor={2}
        tint={theme === 'dark' ? 'dark' : 'light'}
        className="absolute inset-0"
      />
      <View pointerEvents="none" className={`absolute inset-0 ${tintClassName}`} />
    </>
  );
}
