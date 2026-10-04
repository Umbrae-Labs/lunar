import { Slider } from 'heroui-native/slider';
import { memo, useEffect, useMemo } from 'react';
import { I18nManager, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { isUIRuntime, runOnUI, scheduleOnRN } from 'react-native-worklets';

const AnimatedFill = Animated.createAnimatedComponent(Slider.Fill);
const AnimatedThumb = Animated.createAnimatedComponent(Slider.Thumb);
const ThumbSize = 28;
const DefaultFillClassName = 'rounded-full bg-accent';
const DefaultThumbClassName = 'size-7 border border-border bg-surface dark:border-0 dark:bg-surface-tertiary';

export interface WorkletSliderProps {
  readonly accessibilityLabel: string;
  readonly value: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly step: number;
  readonly isDisabled?: boolean;
  readonly className?: string;
  readonly fillClassName?: string | null;
  readonly thumbClassName?: string;
  readonly previewValue?: SharedValue<number>;
  readonly onDragBegin?: () => void;
  readonly onDragCancel?: () => void;
  readonly onChangeEnd: (value: number) => void;
}

/** Keeps slider movement and preview updates on the UI runtime until release. */
export const WorkletSlider = memo(function WorkletSlider({
  accessibilityLabel,
  value,
  minValue,
  maxValue,
  step,
  isDisabled = false,
  className,
  fillClassName = DefaultFillClassName,
  thumbClassName = DefaultThumbClassName,
  previewValue,
  onDragBegin,
  onDragCancel,
  onChangeEnd,
}: WorkletSliderProps) {
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const initialOffset = useSharedValue(0);
  const initialValue = useSharedValue(value);
  const localPreviewValue = useSharedValue(value);
  const preview = previewValue ?? localPreviewValue;
  const dragging = useSharedValue(false);
  const direction = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    runOnUI((nextValue: number, min: number, max: number, stepSize: number) => {
      'worklet';
      if (!dragging.value) {
        const range = max - min;
        const finiteValue = Number.isFinite(nextValue) ? nextValue : min;
        const clampedValue = Math.min(max, Math.max(min, finiteValue));
        const steppedValue =
          min + Math.round((clampedValue - min) / Math.max(1e-7, stepSize)) * Math.max(1e-7, stepSize);
        const normalizedValue = Math.min(max, Math.max(min, steppedValue));
        const travel = Math.max(0, width.value - ThumbSize);
        offset.set(range > 0 ? travel * ((normalizedValue - min) / range) : 0);
        preview.set(normalizedValue);
      }
    })(value, minValue, maxValue, step);
  }, [dragging, maxValue, minValue, offset, preview, step, value, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    runOnUI((next: number, nextValue: number, min: number, max: number, stepSize: number) => {
      'worklet';
      width.set(next);
      if (!dragging.value) {
        const range = max - min;
        const finiteValue = Number.isFinite(nextValue) ? nextValue : min;
        const clampedValue = Math.min(max, Math.max(min, finiteValue));
        const stepValue = Math.max(1e-7, stepSize);
        const steppedValue = min + Math.round((clampedValue - min) / stepValue) * stepValue;
        const normalizedValue = Math.min(max, Math.max(min, steppedValue));
        const travel = Math.max(0, next - ThumbSize);
        offset.set(range > 0 ? travel * ((normalizedValue - min) / range) : 0);
        preview.set(normalizedValue);
      }
    })(nextWidth, value, minValue, maxValue, step);
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
          initialValue.set(preview.value);
          dragging.set(true);
          if (onDragBegin) scheduleOnRN(onDragBegin);
        })
        .onUpdate((event) => {
          'worklet';
          const travel = Math.max(0, width.value - ThumbSize);
          const nextOffset = Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction));
          offset.set(nextOffset);
          const range = maxValue - minValue;
          const rawValue = travel > 0 && range > 0 ? minValue + (nextOffset / travel) * range : minValue;
          const stepValue = Math.max(1e-7, step);
          const steppedValue = minValue + Math.round((rawValue - minValue) / stepValue) * stepValue;
          preview.set(Math.min(maxValue, Math.max(minValue, steppedValue)));
        })
        .onEnd((event, success) => {
          'worklet';
          if (!success) return;
          const travel = Math.max(0, width.value - ThumbSize);
          const finalOffset = Math.min(travel, Math.max(0, initialOffset.value + event.translationX * direction));
          const range = maxValue - minValue;
          const rawValue = travel > 0 && range > 0 ? minValue + (finalOffset / travel) * range : minValue;
          const stepValue = Math.max(1e-7, step);
          const steppedValue = minValue + Math.round((rawValue - minValue) / stepValue) * stepValue;
          const nextValue = Math.min(maxValue, Math.max(minValue, steppedValue));
          offset.set(range > 0 ? travel * ((nextValue - minValue) / range) : 0);
          preview.set(nextValue);
          scheduleOnRN(onChangeEnd, nextValue);
        })
        .onFinalize((_event, success) => {
          'worklet';
          dragging.set(false);
          if (!success) {
            offset.set(initialOffset.value);
            preview.set(initialValue.value);
            if (onDragCancel) scheduleOnRN(onDragCancel);
          }
        }),
    [
      direction,
      dragging,
      initialOffset,
      initialValue,
      isDisabled,
      maxValue,
      minValue,
      offset,
      onChangeEnd,
      onDragBegin,
      onDragCancel,
      preview,
      step,
      width,
    ],
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
      className={className}
      isDisabled={isDisabled}
      minValue={minValue}
      maxValue={maxValue}
      step={step}
      value={value}
      onChangeEnd={(next) => {
        const nextValue = Array.isArray(next) ? (next[0] ?? minValue) : next;
        onChangeEnd(normalizeValue(nextValue, minValue, maxValue, step));
      }}>
      <Slider.Track className="h-2 rounded-full bg-surface-tertiary" onLayout={onLayout}>
        <AnimatedFill className={fillClassName ?? undefined} style={fillStyle} />
        <GestureDetector gesture={gesture}>
          <AnimatedThumb className={thumbClassName} isDisabled style={thumbStyle} />
        </GestureDetector>
      </Slider.Track>
    </Slider>
  );
});

function normalizeValue(value: number, minValue: number, maxValue: number, step: number): number {
  const stepSize = Math.max(1e-7, step);
  const finiteValue = Number.isFinite(value) ? value : minValue;
  const clamped = Math.min(maxValue, Math.max(minValue, finiteValue));
  const stepped = minValue + Math.round((clamped - minValue) / stepSize) * stepSize;
  return Math.min(maxValue, Math.max(minValue, stepped));
}
