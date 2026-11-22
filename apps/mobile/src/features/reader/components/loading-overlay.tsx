import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const CYCLE_DURATION_MS = 2400;
const INITIAL_PHASE = 0.32;
const MAX_SHADOW_OFFSET = 27;
// Tilted -20° so the lit crescent curves around the upper-right, echoing Lunar's mark.
const AXIS_ANGLE_RAD = (-20 * Math.PI) / 180;
const AXIS_COS = Math.cos(AXIS_ANGLE_RAD);
const AXIS_SIN = Math.sin(AXIS_ANGLE_RAD);
const INITIAL_ORBIT_DEG = 45;
const Exiting = FadeOut.duration(160);

export interface LunarPhaseMotion {
  readonly shadowX: number;
  readonly shadowY: number;
  readonly orbitDeg: number;
  readonly moonOpacity: number;
}

/** Computes the continuous lunar eclipse shadow offset and satellite orbit angle for a cycle position in [0, 1). */
export function resolveLunarPhaseMotion(progress: number): LunarPhaseMotion {
  'worklet';
  const wrapped = ((progress % 1) + 1) % 1;
  const phase = (wrapped + INITIAL_PHASE) % 1;
  const signed = phase * 2 - 1;
  const curved = 0.72 * signed + 0.28 * signed * signed * signed;
  const offset = curved * MAX_SHADOW_OFFSET;
  return {
    shadowX: offset * AXIS_COS,
    shadowY: offset * AXIS_SIN,
    orbitDeg: INITIAL_ORBIT_DEG + wrapped * 360,
    moonOpacity: 0.8 + 0.1 * Math.abs(signed),
  };
}

export interface ReaderLoadingOverlayProps {
  readonly paperColor: string;
  readonly inkColor: string;
  readonly accessibilityLabel: string;
}

/** Quiet monochrome lunar-phase loading overlay rendered directly on the active reading paper. */
export const ReaderLoadingOverlay = memo(function ReaderLoadingOverlay({
  paperColor,
  inkColor,
  accessibilityLabel,
}: ReaderLoadingOverlayProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(withRepeat(withTiming(1, { duration: CYCLE_DURATION_MS, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, reducedMotion]);

  const moonStyle = useAnimatedStyle(() => ({
    opacity: resolveLunarPhaseMotion(progress.value).moonOpacity,
  }));

  const shadowStyle = useAnimatedStyle(() => {
    const motion = resolveLunarPhaseMotion(progress.value);
    return {
      transform: [{ translateX: motion.shadowX }, { translateY: motion.shadowY }],
    };
  });

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${resolveLunarPhaseMotion(progress.value).orbitDeg}deg` }],
  }));

  return (
    <Animated.View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      exiting={Exiting}
      pointerEvents="none"
      className="absolute inset-0 items-center justify-center"
      style={{ backgroundColor: paperColor }}>
      <View importantForAccessibility="no-hide-descendants" className="size-13 items-center justify-center">
        <View className="absolute inset-0 rounded-full border" style={{ borderColor: inkColor, opacity: 0.14 }} />
        <Animated.View className="absolute inset-0 items-center" style={orbitStyle}>
          <View className="-top-[1.5px] size-1 rounded-full" style={{ backgroundColor: inkColor, opacity: 0.72 }} />
        </Animated.View>
        <View className="size-6.5 overflow-hidden rounded-full">
          <Animated.View className="absolute inset-0 rounded-full" style={[{ backgroundColor: inkColor }, moonStyle]} />
          <Animated.View
            className="absolute -left-px -top-px size-7 rounded-full"
            style={[{ backgroundColor: paperColor }, shadowStyle]}
          />
        </View>
        <View className="absolute size-7 rounded-full border-2" style={{ borderColor: paperColor }} />
        <View className="absolute size-6 rounded-full border" style={{ borderColor: inkColor, opacity: 0.18 }} />
      </View>
    </Animated.View>
  );
});
