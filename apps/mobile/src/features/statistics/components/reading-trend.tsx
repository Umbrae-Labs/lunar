import { useCallback, useMemo, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Button } from 'heroui-native/button';
import { useResolveClassNames } from 'uniwind';
import { useTranslation } from '@/i18n';
import { durationParts } from '../domain/statistics';
import { readingCurve } from '../domain/curve';

export function ReadingTrend({
  daily,
  onSelect,
}: {
  daily: { date: string; milliseconds: number }[];
  onSelect: (date: string) => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(240);
  const [index, setIndex] = useState(daily.length - 1);
  const active = Math.max(0, Math.min(index, daily.length - 1));
  const accent = useResolveClassNames('text-navigation-active').color as string;
  const neutral = useResolveClassNames('text-default').color as string;
  const maximum = Math.max(30 * 60_000, ...daily.map((day) => day.milliseconds));
  const plotWidth = Math.max(1, width - 16);
  const { points, path } = readingCurve(
    daily.map((day) => day.milliseconds),
    plotWidth,
    140,
    maximum,
  );
  const choose = useCallback(
    (x: number) =>
      setIndex(Math.max(0, Math.min(daily.length - 1, Math.round(((x - 8) / plotWidth) * (daily.length - 1))))),
    [daily.length, plotWidth],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event) => choose(event.nativeEvent.locationX),
        onPanResponderMove: (event) => choose(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => true,
      }),
    [choose],
  );
  const duration = (value: number) => {
    const parts = durationParts(value);
    return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
  };
  const current = daily[active];
  const point = points[active];
  return (
    <View className="gap-3 rounded-3xl bg-surface p-5">
      <Text className="text-base font-semibold text-foreground">{t('statistics.trend')}</Text>
      <View className="flex-row flex-wrap justify-between gap-1">
        <Text className="text-xs text-muted">{t('statistics.dailyTime')}</Text>
        <Text className="text-xs text-muted">{duration(maximum)}</Text>
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        {...responder.panHandlers}
        onTouchEnd={(event) => choose(event.nativeEvent.locationX)}
        accessibilityLabel={t('statistics.chartHint')}>
        <Svg width="100%" height={164} viewBox={`-8 -12 ${width} 164`} accessible={false}>
          {[0, 70, 140].map((y) => (
            <Line key={y} x1={0} x2={plotWidth} y1={y} y2={y} stroke={neutral} strokeWidth={1} />
          ))}
          {points.length > 1 ? <Path d={`${path} L ${plotWidth} 140 L 0 140 Z`} fill={accent} opacity={0.07} /> : null}
          <Path d={path} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" />
          {point ? (
            <>
              <Line x1={point.x} x2={point.x} y1={0} y2={140} stroke={accent} opacity={0.3} strokeDasharray="3 4" />
              <Circle cx={point.x} cy={point.y} r={4} fill={accent} />
            </>
          ) : null}
        </Svg>
      </View>
      <View className="flex-row justify-between gap-2">
        <Text className="text-[10px] text-muted">{daily[0]?.date}</Text>
        <Text className="text-[10px] text-muted">{daily.at(-1)?.date}</Text>
      </View>
      {current ? (
        <View className="gap-2 rounded-2xl bg-background p-3 dark:bg-surface-secondary">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm text-foreground">{current.date}</Text>
            <Text className="text-sm font-semibold text-navigation-active">{duration(current.milliseconds)}</Text>
          </View>
          <View className="flex-row items-center justify-between gap-1">
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel={t('statistics.previousDay')}
              isDisabled={active === 0}
              onPress={() => setIndex(active - 1)}>
              ‹
            </Button>
            <Button size="sm" variant="ghost" onPress={() => onSelect(current.date)}>
              {t('statistics.dayDetails')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel={t('statistics.nextDay')}
              isDisabled={active === daily.length - 1}
              onPress={() => setIndex(active + 1)}>
              ›
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
