import { Slider } from 'heroui-native/slider';
import { memo, useEffect, useMemo } from 'react';
import { I18nManager, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { isUIRuntime, runOnUI, scheduleOnRN } from 'react-native-worklets';

const AnimatedFill = Animated.createAnimatedComponent(Slider.Fill);
const AnimatedThumb = Animated.createAnimatedComponent(Slider.Thumb);
const ThumbSize = 28;

interface ProgressSliderProps {
  readonly accessibilityLabel: string;
  readonly value: number;
  readonly maxValue: number;
  readonly isDisabled: boolean;
  readonly previewPage: SharedValue<number>;
  readonly onDragBegin: () => void;
  readonly onDragCancel: () => void;
  readonly onChangeEnd: (value: number) => void;
}

/** UI-thread movement; React only receives interaction boundaries. */
export const ProgressSlider = memo(function ProgressSlider({
  accessibilityLabel,
  value,
  maxValue,
  isDisabled,
  previewPage,
  onDragBegin,
  onDragCancel,
  onChangeEnd,
}: ProgressSliderProps) {
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const initialOffset = useSharedValue(0);
  const initialPage = useSharedValue(value);
  const dragging = useSharedValue(false);
  const direction = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    runOnUI((page: number, max: number) => {
      'worklet';
      if (!dragging.value) {
        offset.set(max > 0 ? (page / max) * Math.max(0, width.value - ThumbSize) : 0);
        previewPage.set(page);
      }
    })(value, maxValue);
  }, [dragging, maxValue, offset, previewPage, value, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    runOnUI((next: number, page: number, max: number) => {
      'worklet';
      width.set(next);
      if (!dragging.value) {
        offset.set(max > 0 ? (page / max) * Math.max(0, next - ThumbSize) : 0);
        previewPage.set(page);
      }
    })(nextWidth, value, maxValue);
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isDisabled)
        .activeOffsetX([-2, 2])
        .failOffsetY([-8, 8])
        .maxPointers(1)
        .onBegin(() => {
          'worklet';
          initialOffset.set(offset.value);
          initialPage.set(previewPage.value);
          dragging.set(true);
          scheduleOnRN(onDragBegin);
        })
        .onUpdate((event) => {
          'worklet';
          const travel = Math.max(0, width.value - ThumbSize);
          offset.set(Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction)));
          previewPage.set(travel > 0 ? Math.round((offset.value / travel) * maxValue) : 0);
        })
        .onEnd((event, success) => {
          'worklet';
          if (!success) return;
          const travel = Math.max(0, width.value - ThumbSize);
          const finalOffset = Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction));
          const page = travel > 0 ? Math.round((finalOffset / travel) * maxValue) : 0;
          offset.set(maxValue > 0 ? (page / maxValue) * travel : 0);
          previewPage.set(page);
          scheduleOnRN(onChangeEnd, page);
        })
        .onFinalize((_event, success) => {
          'worklet';
          dragging.set(false);
          if (!success) {
            offset.set(initialOffset.value);
            previewPage.set(initialPage.value);
            scheduleOnRN(onDragCancel);
          }
        }),
    [
      direction,
      dragging,
      initialOffset,
      initialPage,
      isDisabled,
      maxValue,
      offset,
      onChangeEnd,
      onDragBegin,
      onDragCancel,
      previewPage,
      width,
    ],
  );

  const fillStyle = useAnimatedStyle(() => {
    // Reanimated also evaluates initial styles during React rendering.
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
      isDisabled={isDisabled}
      minValue={0}
      maxValue={maxValue}
      step={1}
      value={value}
      onChangeEnd={(next) => {
        onChangeEnd(Math.round(Array.isArray(next) ? (next[0] ?? 0) : next));
      }}>
      <Slider.Track className="h-2 rounded-full bg-surface-tertiary" onLayout={onLayout}>
        <AnimatedFill style={fillStyle} />
        <GestureDetector gesture={gesture}>
          <AnimatedThumb
            className="size-7 border border-border bg-surface dark:border-0 dark:bg-accent"
            isDisabled
            style={thumbStyle}
          />
        </GestureDetector>
      </Slider.Track>
    </Slider>
  );
});
