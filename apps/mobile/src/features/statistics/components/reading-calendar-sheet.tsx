import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Tabs } from 'heroui-native/tabs';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { durationParts, monthCalendars } from '../domain/statistics';

const calendarSnapPoints = ['85%'];
const levels = [
  'bg-default',
  'bg-navigation-active/20',
  'bg-navigation-active/40',
  'bg-navigation-active/70',
  'bg-navigation-active',
] as const;

export type CalendarMode = 'month' | 'year';
type MonthCalendar = ReturnType<typeof monthCalendars>[number];
type YearCalendar = { year: string; months: MonthCalendar[]; readingDays: number };

/*
 * Block heights are derived rather than measured so the list can open directly on its target
 * and render only the blocks around it. Every text box below is given one of these fixed heights.
 */
const BLOCK_SPACING = 32;
const HEADER_GAP = 12;
const DAY_GAP = 8;
const DAY_LABEL_GAP = 4;
const MINI_GAP = 3;
const MINI_ROW_GAP = 20;
const MINI_LABEL_GAP = 8;
/** `-mx-1.5` on the month grid and `px-1.5` on each of its three columns. */
const MINI_COLUMN_INSET = 6;

function blockMetrics(width: number, fontScale: number) {
  const header = Math.ceil(24 * fontScale);
  const dayLabel = Math.ceil(14 * fontScale);
  const miniLabel = Math.ceil(20 * fontScale);
  const day = (width - 6 * DAY_GAP) / 7;
  const column = (width + 2 * MINI_COLUMN_INSET) / 3 - 2 * MINI_COLUMN_INSET;
  const mini = (column - 6 * MINI_GAP) / 7;
  const miniMonth = (month: MonthCalendar) =>
    miniLabel + MINI_LABEL_GAP + month.weeks.length * (mini + MINI_GAP) - MINI_GAP;
  return {
    header,
    dayLabel,
    miniLabel,
    month: (month: MonthCalendar) =>
      header + month.weeks.length * (HEADER_GAP + dayLabel + DAY_LABEL_GAP + day) + BLOCK_SPACING,
    year: (year: YearCalendar) => {
      let height = header + HEADER_GAP + BLOCK_SPACING;
      for (let row = 0; row < year.months.length; row += 3)
        height += Math.max(...year.months.slice(row, row + 3).map(miniMonth)) + (row ? MINI_ROW_GAP : 0);
      return height;
    },
  };
}

type Metrics = ReturnType<typeof blockMetrics>;

/**
 * Scrolls through every month (or year) from the year of the first reading record to today,
 * opening on the one that contains `focus`. Nothing is rendered while the sheet is closed.
 */
export function ReadingCalendarSheet({
  focus,
  initialMode,
  today,
  daily,
  isOpen,
  onClose,
  onOpenDay,
}: {
  focus: string;
  initialMode: CalendarMode;
  today: string;
  daily: readonly { date: string; milliseconds: number }[];
  isOpen: boolean;
  onClose: () => void;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(initialMode);
  const [target, setTarget] = useState(focus);
  const [wasOpen, setWasOpen] = useState(isOpen);
  // Content stays mounted from opening until the closing animation finishes.
  const [rendered, setRendered] = useState(isOpen);
  // Kept here rather than in the list, which remounts per target and would lose the measurement.
  const [width, setWidth] = useState(0);
  /*
   * Gorhom pins a scrollable to the top until the sheet reaches its highest snap point, which
   * would undo the list's initial scroll during the opening animation; the list mounts after it.
   */
  const [settled, setSettled] = useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setMode(initialMode);
      setTarget(focus);
      setRendered(true);
    }
  }
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onClose]);
  const switchMode = useCallback((next: CalendarMode, date: string) => {
    setTarget(date);
    setMode(next);
  }, []);
  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-surface"
          contentContainerClassName="h-full px-5"
          snapPoints={calendarSnapPoints}
          enableDynamicSizing={false}
          enableOverDrag={false}
          onChange={(index: number) => {
            setSettled(index >= 0);
            if (index === -1 && !isOpen) setRendered(false);
          }}>
          <View className="gap-3 pb-3">
            <View className="flex-row items-center justify-between gap-3">
              <BottomSheet.Title className="min-w-0 flex-1 text-xl font-semibold text-foreground">
                {t('statistics.activity')}
              </BottomSheet.Title>
              <Tabs value={mode} onValueChange={(value) => switchMode(value as CalendarMode, focus)} variant="primary">
                <Tabs.List>
                  <Tabs.Indicator />
                  {(['month', 'year'] as const).map((item) => (
                    <Tabs.Trigger key={item} value={item}>
                      <Tabs.Label>{t(`statistics.dimension.${item}`)}</Tabs.Label>
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs>
            </View>
            {mode === 'month' ? (
              <View className="flex-row gap-2">
                {t('statistics.weekdaysShort')
                  .split(',')
                  .map((day) => (
                    <Text key={day} className="min-w-0 flex-1 text-center text-[10px] text-muted">
                      {day}
                    </Text>
                  ))}
              </View>
            ) : null}
          </View>
          {rendered ? (
            // Remounting on every target lets the new list open straight onto it.
            <CalendarList
              key={`${mode}:${target}`}
              mode={mode}
              target={target}
              today={today}
              daily={daily}
              width={width}
              settled={settled}
              onWidth={setWidth}
              onOpenDay={onOpenDay}
              onOpenMonth={switchMode}
            />
          ) : null}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

function CalendarList({
  mode,
  target,
  today,
  daily,
  width,
  settled,
  onWidth,
  onOpenDay,
  onOpenMonth,
}: {
  mode: CalendarMode;
  target: string;
  today: string;
  daily: readonly { date: string; milliseconds: number }[];
  width: number;
  settled: boolean;
  onWidth: (width: number) => void;
  onOpenDay: (date: string) => void;
  onOpenMonth: (mode: CalendarMode, date: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // `daily` is sorted newest first, so its last entry is the first reading record.
  const firstYear = Number((daily.at(-1)?.date ?? today).slice(0, 4));
  const months = useMemo(
    () => (mode === 'month' ? monthCalendars({ start: `${firstYear}-01-01`, end: today }, today, daily) : []),
    [daily, firstYear, mode, today],
  );
  const years = useMemo<YearCalendar[]>(() => {
    if (mode !== 'year') return [];
    return Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, index) => {
      const year = String(firstYear + index);
      const calendars = monthCalendars({ start: `${year}-01-01`, end: `${year}-12-31` }, today, daily);
      return { year, months: calendars, readingDays: calendars.reduce((sum, month) => sum + month.readingDays, 0) };
    });
  }, [daily, firstYear, mode, today]);
  const metrics = useMemo(() => blockMetrics(width, fontScale), [fontScale, width]);
  const offsets = useMemo(() => {
    const heights = mode === 'month' ? months.map(metrics.month) : years.map(metrics.year);
    const layouts: { length: number; offset: number }[] = [];
    for (const [index, length] of heights.entries())
      layouts.push({ length, offset: index ? layouts[index - 1].offset + layouts[index - 1].length : 0 });
    return layouts;
  }, [metrics, mode, months, years]);
  const getItemLayout = useCallback((_: unknown, index: number) => ({ ...offsets[index], index }), [offsets]);
  const targetIndex = Math.max(
    0,
    mode === 'month'
      ? months.findIndex((month) => month.month.slice(0, 7) === target.slice(0, 7))
      : years.findIndex((year) => year.year === target.slice(0, 4)),
  );
  const renderMonth = useCallback(
    ({ item }: { item: MonthCalendar }) => (
      <MonthBlock month={item} today={today} metrics={metrics} onOpenDay={onOpenDay} />
    ),
    [metrics, onOpenDay, today],
  );
  const renderYear = useCallback(
    ({ item }: { item: YearCalendar }) => (
      <YearBlock year={item} today={today} metrics={metrics} onOpenMonth={onOpenMonth} />
    ),
    [metrics, onOpenMonth, today],
  );
  const listProps = {
    style: { flex: 1 },
    showsVerticalScrollIndicator: false,
    contentContainerStyle: { paddingBottom: insets.bottom + 24 },
    getItemLayout,
    initialScrollIndex: targetIndex,
    initialNumToRender: 2,
    maxToRenderPerBatch: 2,
    windowSize: 5,
  };
  // Every block height depends on the measured width, so the list waits for the first layout
  // as well as for the sheet to finish opening.
  return (
    <View className="flex-1" onLayout={({ nativeEvent }) => onWidth(nativeEvent.layout.width)}>
      {!width || !settled ? null : mode === 'month' ? (
        <BottomSheetFlatList<MonthCalendar>
          {...listProps}
          data={months}
          keyExtractor={(month: MonthCalendar) => month.month}
          renderItem={renderMonth}
        />
      ) : (
        <BottomSheetFlatList<YearCalendar>
          {...listProps}
          data={years}
          keyExtractor={(year: YearCalendar) => year.year}
          renderItem={renderYear}
        />
      )}
    </View>
  );
}

function useCalendarLabels(today: string) {
  const { t } = useTranslation();
  return useMemo(() => {
    const months = t('statistics.monthsLong').split(',');
    const monthName = (month: string) => months[Number(month.slice(5, 7)) - 1];
    return {
      t,
      monthName,
      monthTitle: (month: string) =>
        month.slice(0, 4) === today.slice(0, 4)
          ? monthName(month)
          : t('statistics.monthTitle', { year: Number(month.slice(0, 4)), month: monthName(month) }),
      duration: (milliseconds: number) => {
        const parts = durationParts(milliseconds);
        return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
      },
    };
  }, [t, today]);
}

const MonthBlock = memo(function MonthBlock({
  month,
  today,
  metrics,
  onOpenDay,
}: {
  month: MonthCalendar;
  today: string;
  metrics: Metrics;
  onOpenDay: (date: string) => void;
}) {
  const { t, monthTitle, duration } = useCalendarLabels(today);
  return (
    <View className="gap-3" style={{ paddingBottom: BLOCK_SPACING }}>
      <Text className="text-base font-semibold text-foreground" numberOfLines={1} style={{ height: metrics.header }}>
        {monthTitle(month.month)} · {t('statistics.daysCount', { count: month.readingDays })}
      </Text>
      {month.weeks.map((week) => (
        <View key={week[0].date} className="flex-row gap-2">
          {week.map((day) =>
            day.outside ? (
              <View key={day.date} className="min-w-0 flex-1" />
            ) : (
              <Pressable
                key={day.date}
                disabled={day.future}
                accessibilityRole="button"
                accessibilityLabel={`${day.date}, ${duration(day.milliseconds)}`}
                accessibilityState={{ disabled: day.future }}
                className="min-w-0 flex-1 items-center gap-1 active:opacity-60"
                onPress={() => onOpenDay(day.date)}>
                <Text className="text-[10px] text-muted" numberOfLines={1} style={{ height: metrics.dayLabel }}>
                  {Number(day.date.slice(8))}
                </Text>
                <View
                  className={`aspect-square w-full rounded-lg ${day.future ? 'bg-default opacity-40' : levels[day.level]}`}
                />
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
});

const YearBlock = memo(function YearBlock({
  year,
  today,
  metrics,
  onOpenMonth,
}: {
  year: YearCalendar;
  today: string;
  metrics: Metrics;
  onOpenMonth: (mode: CalendarMode, date: string) => void;
}) {
  const { t, monthName, monthTitle } = useCalendarLabels(today);
  return (
    <View className="gap-3" style={{ paddingBottom: BLOCK_SPACING }}>
      <Text className="text-base font-semibold text-foreground" numberOfLines={1} style={{ height: metrics.header }}>
        {t('statistics.yearTitle', { year: Number(year.year) })} ·{' '}
        {t('statistics.daysCount', { count: year.readingDays })}
      </Text>
      <View className="-mx-1.5 flex-row flex-wrap gap-y-5">
        {year.months.map((month) => {
          const future = month.month > today;
          return (
            <Pressable
              key={month.month}
              disabled={future}
              accessibilityRole="button"
              accessibilityLabel={`${monthTitle(month.month)}, ${t('statistics.daysCount', { count: month.readingDays })}`}
              accessibilityState={{ disabled: future }}
              className="w-1/3 gap-2 px-1.5 active:opacity-60"
              onPress={() => onOpenMonth('month', month.month)}>
              <Text
                numberOfLines={1}
                style={{ height: metrics.miniLabel }}
                className={`text-sm font-semibold ${
                  month.month.slice(0, 7) === today.slice(0, 7)
                    ? 'text-navigation-active'
                    : future
                      ? 'text-muted'
                      : 'text-foreground'
                }`}>
                {monthName(month.month)}
              </Text>
              <View className="gap-[3px]">
                {month.weeks.map((week) => (
                  <View key={week[0].date} className="flex-row gap-[3px]">
                    {week.map((day) => (
                      <View
                        key={day.date}
                        className={`aspect-square min-w-0 flex-1 rounded-[2px] ${day.outside ? '' : day.future ? 'bg-default opacity-40' : levels[day.level]}`}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});
