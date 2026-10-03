import { Slider } from 'heroui-native/slider';
import { memo, useEffect, useMemo } from 'react';
import { I18nManager, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { isUIRuntime, runOnUI, scheduleOnRN } from 'react-native-worklets';

const AnimatedFill = Animated.createAnimatedComponent(Slider.Fill);
const AnimatedThumb = Animated.createAnimatedComponent(Slider.Thumb);
const ThumbSize = 28;
const MinBrightness = 0.2;
const MaxBrightness = 1;

interface ReaderBrightnessSliderProps {
  readonly accessibilityLabel: string;
  readonly value: number;
  readonly onChangeEnd: (value: number) => void;
}

/** Keeps the thumb and fill on the UI runtime while the setting commits once on release. */
export const ReaderBrightnessSlider = memo(function ReaderBrightnessSlider({
  accessibilityLabel,
  value,
  onChangeEnd,
}: ReaderBrightnessSliderProps) {
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const initialOffset = useSharedValue(0);
  const initialValue = useSharedValue(value);
  const previewValue = useSharedValue(value);
  const dragging = useSharedValue(false);
  const direction = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    runOnUI((nextValue: number) => {
      'worklet';
      if (!dragging.value) {
        const travel = Math.max(0, width.value - ThumbSize);
        offset.set(valueToOffset(nextValue, travel));
        previewValue.set(nextValue);
      }
    })(value);
  }, [dragging, offset, previewValue, value, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    runOnUI((next: number, nextValue: number) => {
      'worklet';
      width.set(next);
      if (!dragging.value) {
        offset.set(valueToOffset(nextValue, Math.max(0, next - ThumbSize)));
        previewValue.set(nextValue);
      }
    })(nextWidth, value);
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-2, 2])
        .failOffsetY([-8, 8])
        .maxPointers(1)
        .onBegin(() => {
          'worklet';
          initialOffset.set(offset.value);
          initialValue.set(previewValue.value);
          dragging.set(true);
        })
        .onUpdate((event) => {
          'worklet';
          const travel = Math.max(0, width.value - ThumbSize);
          offset.set(Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction)));
          previewValue.set(offsetToValue(offset.value, travel));
        })
        .onEnd((event, success) => {
          'worklet';
          if (!success) return;
          const travel = Math.max(0, width.value - ThumbSize);
          const finalOffset = Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction));
          const nextValue = offsetToValue(finalOffset, travel);
          offset.set(valueToOffset(nextValue, travel));
          previewValue.set(nextValue);
          scheduleOnRN(onChangeEnd, nextValue);
        })
        .onFinalize((_event, success) => {
          'worklet';
          dragging.set(false);
          if (!success) {
            offset.set(initialOffset.value);
            previewValue.set(initialValue.value);
          }
        }),
    [direction, dragging, initialOffset, initialValue, offset, onChangeEnd, previewValue, width],
  );

  const fillStyle = useAnimatedStyle(() => {
    if (!isUIRuntime()) return { start: 0, width: ThumbSize };
    return { start: 0, width: Math.min(width.value, offset.value + ThumbSize) };
  });
  const thumbStyle = useAnimatedStyle(() => {
    if (!isUIRuntime()) return { start: 0, transform: [{ translateX: 0 }] };
    return { start: 0, transform: [{ translateX: offset.value * direction }] };
  });

  return (
    <Slider
      accessibilityLabel={accessibilityLabel}
      className="min-w-0 flex-1 px-2"
      maxValue={MaxBrightness}
      minValue={MinBrightness}
      step={0.01}
      value={value}
      onChangeEnd={(next) => onChangeEnd(clampBrightness(toSliderValue(next)))}>
      <Slider.Track className="h-2 rounded-full bg-surface-tertiary" onLayout={onLayout}>
        <AnimatedFill className="rounded-full bg-accent" style={fillStyle} />
        <GestureDetector gesture={gesture}>
          <AnimatedThumb
            className="size-7 border border-border bg-surface dark:border-0 dark:bg-surface-tertiary"
            isDisabled
            style={thumbStyle}
          />
        </GestureDetector>
      </Slider.Track>
    </Slider>
  );
});

function toSliderValue(value: number | number[]): number {
  return Array.isArray(value) ? (value[0] ?? MaxBrightness) : value;
}

function clampBrightness(value: number): number {
  'worklet';
  return Math.min(MaxBrightness, Math.max(MinBrightness, Number.isFinite(value) ? value : MaxBrightness));
}

function valueToOffset(value: number, travel: number): number {
  'worklet';
  return travel * ((clampBrightness(value) - MinBrightness) / (MaxBrightness - MinBrightness));
}

function offsetToValue(offset: number, travel: number): number {
  'worklet';
  if (travel <= 0) return MaxBrightness;
  return clampBrightness(MinBrightness + (offset / travel) * (MaxBrightness - MinBrightness));
}
