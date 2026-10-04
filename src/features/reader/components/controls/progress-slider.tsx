import { memo } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { WorkletSlider } from '@/components/ui/worklet-slider';

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
  return (
    <WorkletSlider
      accessibilityLabel={accessibilityLabel}
      fillClassName={null}
      isDisabled={isDisabled}
      maxValue={maxValue}
      minValue={0}
      onChangeEnd={onChangeEnd}
      onDragBegin={onDragBegin}
      onDragCancel={onDragCancel}
      previewValue={previewPage}
      step={1}
      thumbClassName="size-7 border border-border bg-surface dark:border-0 dark:bg-accent"
      value={value}
    />
  );
});
