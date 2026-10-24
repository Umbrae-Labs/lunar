import { useState } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Text, View } from 'react-native';
import { layoutMonthLabels, monthLabelOpacity } from '../domain/month-labels';

export function HeatmapMonthLabels({
  starts,
  cellSize,
  fontScale,
  columns = 53,
  offset,
  viewportWidth,
}: {
  starts: { date: string; column: number; text: string }[];
  cellSize: number;
  fontScale: number;
  columns?: number;
  offset: SharedValue<number>;
  viewportWidth: SharedValue<number>;
}) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const gridWidth = cellSize * columns + 2 * (columns - 1);
  const keyFor = (text: string) => `${fontScale}:${text}`;
  const labels = layoutMonthLabels(
    starts.map((start) => ({ ...start, width: widths[keyFor(start.text)] ?? 0 })),
    cellSize + 2,
    gridWidth,
    8,
  );
  return (
    <View className="relative" style={{ width: gridWidth, height: Math.ceil(20 * fontScale) }}>
      {starts.map(({ date, text }) => (
        <Text
          key={`${date}:${fontScale}:${text}`}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          className="absolute left-0 top-0 text-[10px] text-muted opacity-0"
          onLayout={({ nativeEvent }) => {
            const width = nativeEvent.layout.width;
            const key = keyFor(text);
            setWidths((previous) => (previous[key] === width ? previous : { ...previous, [key]: width }));
          }}>
          {text}
        </Text>
      ))}
      {labels.map(({ date, left, width }) => (
        <MonthLabel
          key={date}
          left={left}
          width={width}
          gridWidth={gridWidth}
          offset={offset}
          viewportWidth={viewportWidth}
          text={starts.find((start) => start.date === date)!.text}
        />
      ))}
    </View>
  );
}

function MonthLabel({
  left,
  width,
  gridWidth,
  offset,
  viewportWidth,
  text,
}: {
  left: number;
  width: number;
  gridWidth: number;
  offset: SharedValue<number>;
  viewportWidth: SharedValue<number>;
  text: string;
}) {
  // Position-driven opacity has no queued animations or JS renders on scroll.
  const style = useAnimatedStyle(() => ({
    opacity: monthLabelOpacity(left, width, offset.value, viewportWidth.value, gridWidth),
  }));
  return (
    <Animated.Text className="absolute top-0 text-[10px] text-muted" style={[{ left, width }, style]}>
      {text}
    </Animated.Text>
  );
}
