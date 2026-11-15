import { useFocusEffect, useRouter } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Menu, type MenuKey } from 'heroui-native/menu';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_TAB_BAR_HEIGHT } from '@/components/ui/app-tabs';
import { Icon } from '@/components/ui/icon';
import { readingDateKey } from '@/features/reader';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import {
  durationParts,
  periodBounds,
  selectPeriod,
  type DateRange,
  type StatisticsDimension,
} from '../domain/statistics';
import { loadStatistics } from '../repositories/statistics-repository';
import { DailyReadingSheet } from '../components/daily-reading-sheet';
import { ReadingCalendarSheet } from '../components/reading-calendar-sheet';
import { ReadingTrend } from '../components/reading-trend';
import { PeriodRanking } from '../components/period-ranking';
import { PeriodNavigator } from '../components/period-navigator';
import { DateRangeSheet } from '../components/date-range-sheet';

type Dimension = StatisticsDimension | 'custom';
const DIMENSIONS: readonly Dimension[] = ['week', 'month', 'year', 'custom'];

const NO_DAYS: readonly { date: string; milliseconds: number }[] = [];

const currentDateKey = () => readingDateKey(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

export function StatisticsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const iconColor = useThemeColor('foreground');
  const [data, setData] = useState<Awaited<ReturnType<typeof loadStatistics>>>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [dayOpen, setDayOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [today, setToday] = useState(currentDateKey);
  const notifyError = useEffectEvent(() => toast.show({ variant: 'danger', label: t('statistics.error') }));
  useEffect(() => {
    if (error) notifyError();
  }, [error]);
  useMarkInitialContentReady(Boolean(data) || error);
  useFocusEffect(
    useCallback(() => {
      void revision; // A retry restarts the focused subscription.
      let active = true;
      let request = 0;
      const refresh = async () => {
        const current = ++request;
        setToday(currentDateKey());
        try {
          const next = await loadStatistics();
          if (active && current === request) {
            setData(next);
            setError(false);
          }
        } catch {
          if (active && current === request) {
            setError(true);
          }
        }
      };
      void refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      // Records only change while reading, so a visible screen just follows the date across midnight.
      const timer = setInterval(() => setToday(currentDateKey()), 60_000);
      return () => {
        active = false;
        setDayOpen(false);
        setCalendarOpen(false);
        subscription.remove();
        clearInterval(timer);
      };
    }, [revision]),
  );
  const [dimension, setDimension] = useState<Dimension>('month');
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState<DateRange>();
  const [rangeOpen, setRangeOpen] = useState(false);
  const bounds = useMemo(
    () =>
      dimension === 'custom' && custom
        ? custom
        : periodBounds(dimension === 'custom' ? 'month' : dimension, today, offset),
    [custom, dimension, offset, today],
  );
  // The current period ends today, so its daily average ignores days that have not happened yet.
  const range = useMemo(() => ({ start: bounds.start, end: bounds.end < today ? bounds.end : today }), [bounds, today]);
  const period = useMemo(() => (data ? selectPeriod(data, range) : undefined), [data, range]);
  const earliest = data?.daily.at(-1)?.date;
  const selectedDimension = useMemo<ReadonlySet<MenuKey>>(() => new Set([dimension]), [dimension]);
  const changeDimension = useCallback(
    (keys: Set<MenuKey>) => {
      const next = keys.values().next().value as Dimension | undefined;
      if (!next) return;
      if (next === 'custom') {
        setCustom((previous) => previous ?? range);
        setRangeOpen(true);
      } else setOffset(0);
      setDimension(next);
    },
    [range],
  );
  const closeRange = useCallback(() => setRangeOpen(false), []);
  const duration = (milliseconds: number) => {
    const parts = durationParts(milliseconds);
    return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
  };
  const periodLabel = () => {
    const year = Number(bounds.start.slice(0, 4));
    const month = Number(bounds.start.slice(5, 7)) - 1;
    const short = (date: string) =>
      t('statistics.shortDate', {
        month: t('statistics.monthsShort').split(',')[Number(date.slice(5, 7)) - 1],
        day: Number(date.slice(8)),
      });
    switch (dimension) {
      case 'year':
        return t('statistics.yearTitle', { year });
      case 'month':
        return t('statistics.monthTitle', { year, month: t('statistics.monthsLong').split(',')[month] });
      case 'week':
        return t('statistics.weekTitle', { start: short(bounds.start), end: short(bounds.end) });
      case 'custom':
        return `${bounds.start} — ${bounds.end}`;
    }
  };
  const openBook = (bookId: string) => router.push({ pathname: '/reader/[bookId]', params: { bookId } });
  // Keep the selected day's content mounted throughout the sheet's closing animation.
  const closeDay = useCallback(() => setDayOpen(false), []);
  const openDay = useCallback((date: string) => {
    setSelected(date);
    setDayOpen(true);
  }, []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openCalendarDay = useCallback(
    (date: string) => {
      setCalendarOpen(false);
      openDay(date);
    },
    [openDay],
  );
  const openMonth = (date: string) => {
    const months = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
    setDimension('month');
    setOffset(months(date) - months(today));
  };
  const dimensionLabel = t(`statistics.dimension.${dimension}`);
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View className="w-full max-w-[800px] flex-row items-center gap-2 self-center px-4 pt-1 pb-2">
        <Text accessibilityRole="header" className="min-w-0 flex-1 px-1 text-2xl font-semibold text-foreground">
          {t('statistics.title')}
        </Text>
        <Button
          accessibilityLabel={t('statistics.posterEntry')}
          className="h-9 rounded-full"
          hitSlop={4}
          isDisabled={!period?.books.length}
          isIconOnly
          onPress={() =>
            router.push({ pathname: '/statistics-poster', params: { start: range.start, end: range.end } })
          }
          size="sm"
          variant="secondary">
          <Icon name="export" size={18} color={iconColor} />
        </Button>
        <Menu>
          <Menu.Trigger asChild>
            <Button
              accessibilityLabel={t('statistics.dimensionMenu', { dimension: dimensionLabel })}
              className="h-9 gap-1 rounded-full"
              hitSlop={4}
              size="sm"
              variant="secondary">
              <Button.Label>{dimensionLabel}</Button.Label>
              <Icon name="chevronDown" size={14} color={iconColor} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Overlay />
            <Menu.Content align="end" placement="bottom" presentation="popover" width={200}>
              <Menu.Group
                disallowEmptySelection
                onSelectionChange={changeDimension}
                selectedKeys={selectedDimension}
                selectionMode="single">
                {DIMENSIONS.map((item) => (
                  <Menu.Item key={item} id={item}>
                    <Menu.ItemIndicator />
                    <Menu.ItemTitle>{t(`statistics.dimension.${item}`)}</Menu.ItemTitle>
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow px-4 pt-2"
        contentContainerStyle={{ paddingBottom: APP_TAB_BAR_HEIGHT + insets.bottom + 32 }}>
        <View className="w-full max-w-[800px] self-center gap-4">
          {error ? (
            <View className="gap-3 rounded-3xl bg-surface p-5">
              <Text className="text-foreground">{t('statistics.error')}</Text>
              <Button variant="secondary" onPress={() => setRevision((value) => value + 1)}>
                {t('statistics.retry')}
              </Button>
            </View>
          ) : null}
          {!data && !error ? <ActivityIndicator accessibilityLabel={t('statistics.loading')} /> : null}
          {data && period ? (
            <>
              <PeriodNavigator
                label={periodLabel()}
                onPrevious={
                  dimension !== 'custom' && earliest && bounds.start > earliest
                    ? () => setOffset((value) => value - 1)
                    : undefined
                }
                onNext={dimension !== 'custom' && offset < 0 ? () => setOffset((value) => value + 1) : undefined}
                onEdit={dimension === 'custom' ? () => setRangeOpen(true) : undefined}
              />
              <View className="flex-row flex-wrap gap-3">
                {[
                  [t('statistics.total'), duration(period.total)],
                  [t('statistics.average'), duration(period.average)],
                  [t('statistics.books'), t('statistics.count', { count: period.books.length })],
                  [t('statistics.readingDays'), t('statistics.daysCount', { count: period.readingDays })],
                ].map(([label, value]) => (
                  <View key={label} className="min-w-[120px] flex-1 basis-[45%] gap-3 rounded-3xl bg-surface p-4">
                    <Text className="text-xs text-muted">{label}</Text>
                    <Text className="text-lg font-semibold text-foreground">{value}</Text>
                  </View>
                ))}
              </View>
              <ReadingTrend
                key={`trend:${range.start}:${range.end}`}
                daily={period.daily}
                onOpenDay={openDay}
                onOpenMonth={openMonth}
                onOpenCalendar={() => setCalendarOpen(true)}
              />
              <PeriodRanking key={`ranking:${range.start}:${range.end}`} period={period} onOpenBook={openBook} />
              {!data.books.length ? (
                <View className="gap-3 rounded-3xl bg-surface p-5">
                  <Text className="text-sm text-muted">{t('statistics.empty')}</Text>
                  <Button variant="secondary" onPress={() => router.navigate('/library')}>
                    {t('tabs.library')}
                  </Button>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
      <ReadingCalendarSheet
        focus={range.end}
        initialMode={dimension === 'year' ? 'year' : 'month'}
        today={today}
        daily={data?.daily ?? NO_DAYS}
        isOpen={calendarOpen}
        onClose={closeCalendar}
        onOpenDay={openCalendarDay}
      />
      <DailyReadingSheet
        date={selected}
        isOpen={dayOpen}
        books={selected ? (data?.dayBooks[selected] ?? []) : []}
        onClose={closeDay}
        onOpenBook={openBook}
      />
      <DateRangeSheet
        range={range}
        today={today}
        isOpen={rangeOpen}
        onClose={closeRange}
        onApply={(next) => {
          setCustom(next);
          setDimension('custom');
          setRangeOpen(false);
        }}
      />
    </View>
  );
}
