import { useThemeColor } from 'heroui-native/hooks';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

export interface ProgressCircleProps {
  readonly value: number;
  readonly size?: number;
  readonly accessibilityLabel?: string;
  readonly children?: ReactNode;
}

/** Circular progress ring shared by plugin surfaces and Lunar's downloads list. */
export function ProgressCircle({ value, size = 28, accessibilityLabel, children }: ProgressCircleProps) {
  const muted = useThemeColor('muted');
  const accent = useCSSVariable('--color-navigation-active') as string;
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const stroke = Math.max(2, Math.round(size / 9));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
      accessibilityValue={accessibilityLabel ? { min: 0, max: 100, now: Math.round(ratio * 100) } : undefined}
      className="items-center justify-center"
      style={{ width: size, height: size }}>
      <Svg height={size} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={muted}
          strokeOpacity={0.3}
          strokeWidth={stroke}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={accent}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children ? <View className="absolute inset-0 items-center justify-center">{children}</View> : null}
    </View>
  );
}
