import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { useTranslation } from '@/i18n';
import { durationParts, trendBuckets, type TrendBucket } from '../domain/statistics';

const CHART_HEIGHT = 140;
const BUBBLE_SPACE = 56;

/** Bars per day or month; tapping one raises a bubble that leads to that day's or month's details. */
export function ReadingTrend({
  daily,
  onOpenDay,
  onOpenMonth,
  onOpenCalendar,
}: {
  daily: { date: string; milliseconds: number }[];
  onOpenDay: (date: string) => void;
  onOpenMonth: (date: string) => void;
  onOpenCalendar: () => void;
}) {
  const { t } = useTranslation();
  const iconColor = useThemeColor('foreground');
  const { fontScale } = useWindowDimensions();
  const buckets = useMemo(() => trendBuckets(daily), [daily]);
  const [active, setActive] = useState<number>();
  const [width, setWidth] = useState(0);
  const [bubbleWidth, setBubbleWidth] = useState(0);
  const maximum = Math.max(30 * 60_000, ...buckets.map((bucket) => bucket.milliseconds));
  const unit = buckets[0]?.unit ?? 'day';
  const step = buckets.length <= 12 ? 1 : Math.ceil(buckets.length / 7);
  const duration = (milliseconds: number) => {
    const parts = durationParts(milliseconds);
    return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
  };
  const title = (bucket: TrendBucket) => {
    const year = Number(bucket.date.slice(0, 4));
    const month = t('statistics.monthsLong').split(',')[Number(bucket.date.slice(5, 7)) - 1];
    return bucket.unit === 'month'
      ? t('statistics.monthTitle', { year, month })
      : t('statistics.dateTitle', { year, month, day: Number(bucket.date.slice(8)) });
  };
  const tick = (bucket: TrendBucket) =>
    bucket.unit === 'month'
      ? t('statistics.monthsShort').split(',')[Number(bucket.date.slice(5, 7)) - 1]
      : String(Number(bucket.date.slice(8)));
  const current = active === undefined ? undefined : buckets[active];
  const center = active === undefined ? 0 : ((active + 0.5) * width) / buckets.length;
  return (
    <View className="gap-3 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-semibold text-foreground">{t('statistics.trend')}</Text>
          <Text className="text-xs text-muted">
            {t(unit === 'month' ? 'statistics.monthlyTime' : 'statistics.dailyTime')}
          </Text>
        </View>
        <Button
          accessibilityLabel={t('statistics.openCalendar')}
          className="h-9 rounded-full"
          hitSlop={4}
          isIconOnly
          onPress={onOpenCalendar}
          size="sm"
          variant="secondary">
          <Icon name="calendar" size={18} color={iconColor} />
        </Button>
      </View>
      <View
        style={{ height: CHART_HEIGHT + BUBBLE_SPACE }}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
        {[0, 0.5, 1].map((ratio) => (
          <View
            key={ratio}
            className="absolute left-0 right-0 h-px bg-default"
            style={{ top: BUBBLE_SPACE + CHART_HEIGHT * ratio }}
          />
        ))}
        <Text className="absolute right-0 text-[10px] text-muted" style={{ top: BUBBLE_SPACE - 16 }}>
          {duration(maximum)}
        </Text>
        <View className="absolute bottom-0 left-0 right-0 flex-row items-end" style={{ height: CHART_HEIGHT }}>
          {buckets.map((bucket, index) => {
            const selected = index === active;
            return (
              <Pressable
                key={bucket.date}
                accessibilityRole="button"
                accessibilityLabel={`${title(bucket)}, ${duration(bucket.milliseconds)}`}
                accessibilityState={{ selected }}
                className="h-full min-w-0 flex-1 items-center justify-end"
                onPress={() => setActive(selected ? undefined : index)}>
                <View
                  className={`w-3/5 max-w-6 ${
                    bucket.milliseconds > 0
                      ? `rounded-t-md ${selected ? 'bg-navigation-active' : 'bg-navigation-active/50'}`
                      : 'rounded-full bg-default'
                  }`}
                  style={{ height: Math.max(3, (bucket.milliseconds / maximum) * CHART_HEIGHT) }}
                />
              </Pressable>
            );
          })}
        </View>
        {current ? (
          <>
            <View
              className="absolute size-2 rotate-45 bg-navigation-active"
              style={{ left: center - 4, top: BUBBLE_SPACE - 12, opacity: bubbleWidth ? 1 : 0 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(current.unit === 'month' ? 'statistics.monthDetails' : 'statistics.dayDetails', {
                date: title(current),
              })}
              className="absolute top-0 gap-0.5 rounded-lg bg-navigation-active px-2.5 py-1.5 active:opacity-80"
              style={{
                left: Math.max(0, Math.min(width - bubbleWidth, center - bubbleWidth / 2)),
                opacity: bubbleWidth ? 1 : 0,
              }}
              onLayout={({ nativeEvent }) => setBubbleWidth(nativeEvent.layout.width)}
              onPress={() => (current.unit === 'month' ? onOpenMonth(current.date) : onOpenDay(current.date))}>
              <Text className="text-xs text-accent-foreground" numberOfLines={1}>
                {title(current)} ›
              </Text>
              <Text className="text-sm font-semibold text-accent-foreground" numberOfLines={1}>
                {duration(current.milliseconds)}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {/* Absolute ticks do not size their row, so it follows the system font scale explicitly. */}
      <View style={{ height: Math.ceil(16 * fontScale) }}>
        {buckets.map((bucket, index) =>
          index % step === 0 ? (
            <Text
              key={bucket.date}
              className="absolute top-0 w-10 text-center text-[10px] text-muted"
              numberOfLines={1}
              style={{ left: ((index + 0.5) * width) / buckets.length - 20 }}>
              {tick(bucket)}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  );
}
