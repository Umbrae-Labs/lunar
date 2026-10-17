import { memo, useCallback, useMemo, useRef } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useScrollOffset, useSharedValue } from 'react-native-reanimated';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useTranslation } from '@/i18n';
import { buildHeatmap, durationParts } from '../domain/statistics';
import { heatmapDimensions } from '../domain/month-labels';
import { HeatmapMonthLabels } from './heatmap-month-labels';

const levels = [
  'bg-default',
  'bg-navigation-active/20',
  'bg-navigation-active/40',
  'bg-navigation-active/70',
  'bg-navigation-active',
] as const;

export function YearHeatmap({
  today,
  daily,
  selected,
  onSelect,
}: {
  today: string;
  daily: { date: string; milliseconds: number }[];
  selected?: string;
  onSelect: (date: string) => void;
}) {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const { weekdayWidth, cellSize } = heatmapDimensions(0, fontScale);
  const weeks = useMemo(() => buildHeatmap(today, daily), [today, daily]);
  const scroll = useAnimatedRef<ScrollView>();
  const offset = useScrollOffset(scroll);
  const viewportWidth = useSharedValue(0);
  const initialized = useRef(false);
  const dragging = useRef(false);
  const pressIn = useCallback(() => {
    dragging.current = false;
  }, []);
  const pressDate = useCallback(
    (date: string) => {
      if (!dragging.current) onSelect(date);
    },
    [onSelect],
  );
  const months = t('statistics.monthsShort').split(',');
  const weekdays = t('statistics.weekdaysShort').split(',');
  return (
    <View className="gap-4 rounded-3xl bg-surface p-5">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-base font-semibold text-foreground">{t('statistics.activity')}</Text>
        <Text className="text-xs text-muted">{t('statistics.year')}</Text>
      </View>
      <View className="flex-row gap-2">
        <View className="gap-0.5" style={{ width: weekdayWidth, paddingTop: Math.ceil(20 * fontScale) + 2 }}>
          {weekdays.map((day) => (
            <View key={day} className="justify-center" style={{ height: cellSize }}>
              <Text className="text-[10px] text-muted">{day}</Text>
            </View>
          ))}
        </View>
        <Animated.ScrollView
          ref={scroll}
          horizontal
          className="min-w-0 flex-1"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          accessibilityLabel={t('statistics.yearScroll')}
          onLayout={({ nativeEvent }) => {
            viewportWidth.value = nativeEvent.layout.width;
            if (!initialized.current) scroll.current?.scrollToEnd({ animated: false });
          }}
          onContentSizeChange={() => {
            if (!initialized.current) scroll.current?.scrollToEnd({ animated: false });
          }}
          onScrollBeginDrag={() => {
            dragging.current = true;
            initialized.current = true;
          }}
          onMomentumScrollEnd={() => {
            dragging.current = false;
          }}>
          <View className="gap-0.5">
            <HeatmapMonthLabels
              offset={offset}
              viewportWidth={viewportWidth}
              cellSize={cellSize}
              fontScale={fontScale}
              columns={weeks.length}
              starts={weeks.flatMap((week, column) => {
                const first = week.find((day) => day.date.endsWith('-01') && !day.future);
                return first ? [{ date: first.date, column, text: months[Number(first.date.slice(5, 7)) - 1] }] : [];
              })}
            />
            <View className="flex-row gap-0.5">
              {weeks.map((week) => (
                <View key={week[0].date} className="gap-0.5">
                  {week.map((day) => {
                    const parts = durationParts(day.milliseconds);
                    return (
                      <HeatmapCell
                        key={day.date}
                        day={day}
                        size={cellSize}
                        selected={selected === day.date}
                        label={`${day.date}, ${parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts)}`}
                        onPressIn={pressIn}
                        onSelect={pressDate}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </Animated.ScrollView>
      </View>
      <View className="flex-row items-center justify-end">
        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted">{t('statistics.less')}</Text>
          {levels.map((level) => (
            <View key={level} className={`h-2.5 w-2.5 rounded-[2px] ${level}`} />
          ))}
          <Text className="text-xs text-muted">{t('statistics.more')}</Text>
        </View>
      </View>
    </View>
  );
}

const HeatmapCell = memo(function HeatmapCell({
  day,
  size,
  selected,
  label,
  onPressIn,
  onSelect,
}: {
  day: ReturnType<typeof buildHeatmap>[number][number];
  size: number;
  selected: boolean;
  label: string;
  onPressIn: () => void;
  onSelect: (date: string) => void;
}) {
  return (
    <PressableFeedback
      isDisabled={day.future}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: day.future }}
      animation={{ scale: { value: 0.96, ignoreScaleCoefficient: true, timingConfig: { duration: 120 } } }}
      onPressIn={onPressIn}
      onPress={() => onSelect(day.date)}
      onLongPress={() => onSelect(day.date)}
      style={{ width: size, height: size }}
      className={`rounded-[3px] ${day.future ? 'opacity-0' : levels[day.level]} ${selected ? 'border-2 border-navigation-active' : ''}`}
    />
  );
});
