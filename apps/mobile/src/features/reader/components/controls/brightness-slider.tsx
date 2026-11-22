import { memo } from 'react';

import { WorkletSlider } from '@/components/ui/worklet-slider';
import { MAX_READER_BRIGHTNESS, MIN_READER_BRIGHTNESS } from '@/stores';

interface BrightnessSliderProps {
  readonly accessibilityLabel: string;
  readonly value: number;
  readonly isDisabled?: boolean;
  readonly onChangeEnd: (value: number) => void;
}

export const BrightnessSlider = memo(function BrightnessSlider({
  accessibilityLabel,
  value,
  isDisabled,
  onChangeEnd,
}: BrightnessSliderProps) {
  return (
    <WorkletSlider
      accessibilityLabel={accessibilityLabel}
      className="min-w-0 flex-1 px-2"
      isDisabled={isDisabled}
      fillClassName="rounded-full bg-navigation-active"
      maxValue={MAX_READER_BRIGHTNESS}
      minValue={MIN_READER_BRIGHTNESS}
      onChangeEnd={onChangeEnd}
      step={0.01}
      thumbClassName="size-7 border border-border bg-surface dark:border-0 dark:bg-surface-tertiary"
      value={value}
    />
  );
});
