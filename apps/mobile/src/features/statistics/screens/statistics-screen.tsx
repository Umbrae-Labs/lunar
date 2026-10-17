import { useFocusEffect, useRouter } from 'expo-router';
import { Button } from 'heroui-native/button';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readingDateKey } from '@/features/reader';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { durationParts, selectPeriod, shiftDate, type DateRange } from '../domain/statistics';
import { loadStatistics } from '../repositories/statistics-repository';
import { DailyReadingSheet } from '../components/daily-reading-sheet';
import { YearHeatmap } from '../components/year-heatmap';
import { ReadingTrend } from '../components/reading-trend';
import { PeriodBooks } from '../components/period-books';
import { DateRangeSheet } from '../components/date-range-sheet';

export function StatisticsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadStatistics>>>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [dayOpen, setDayOpen] = useState(false);
  const [today, setToday] = useState(() =>
    readingDateKey(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  );
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
        setToday(readingDateKey(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
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
      const timer = setInterval(() => void refresh(), 60_000);
      return () => {
        active = false;
        setDayOpen(false);
        subscription.remove();
        clearInterval(timer);
      };
    }, [revision]),
  );
  const [mode, setMode] = useState<'activity' | 'period'>('activity');
  const [preset, setPreset] = useState<number | undefined>(30);
  const [custom, setCustom] = useState<DateRange>({ start: shiftDate(today, -29), end: today });
  const [rangeOpen, setRangeOpen] = useState(false);
  const range = useMemo(
    () => (preset ? { start: shiftDate(today, 1 - preset), end: today } : custom),
    [preset, today, custom],
  );
  const period = useMemo(() => (data ? selectPeriod(data, range) : undefined), [data, range]);
  const year = useMemo(
    () => (data ? selectPeriod(data, { start: shiftDate(today, -364), end: today }) : undefined),
    [data, today],
  );
  const closeRange = useCallback(() => setRangeOpen(false), []);
  const duration = (milliseconds: number) => {
    const parts = durationParts(milliseconds);
    return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
  };
  const openBook = (bookId: string) => router.push({ pathname: '/reader/[bookId]', params: { bookId } });
  // Keep the selected day's content mounted throughout the sheet's closing animation.
  const closeDay = useCallback(() => setDayOpen(false), []);
  const openDay = useCallback((date: string) => {
    setSelected(date);
    setDayOpen(true);
  }, []);
  const summary = mode === 'activity' ? year : period;
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <ScrollView
        contentContainerClassName="grow px-4 pt-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
        <View className="w-full max-w-[800px] self-center gap-5">
          <View className="gap-1">
            <Text accessibilityRole="header" className="text-3xl font-semibold text-foreground">
              {t('statistics.title')}
            </Text>
            <Text className="text-sm text-muted">{t('statistics.subtitle')}</Text>
          </View>
          <View className="flex-row gap-1 rounded-2xl bg-default p-1">
            {(['activity', 'period'] as const).map((item) => (
              <PressableFeedback
                key={item}
                accessibilityRole="tab"
                accessibilityLabel={t(`statistics.${item}`)}
                accessibilityState={{ selected: mode === item }}
                onPress={() => setMode(item)}
                className={`min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl px-2 py-3 ${mode === item ? 'bg-surface' : ''}`}>
                <Text className={mode === item ? 'text-sm font-semibold text-navigation-active' : 'text-sm text-muted'}>
                  {t(`statistics.${item}`)}
                </Text>
              </PressableFeedback>
            ))}
          </View>
          {error ? (
            <View className="gap-3 rounded-3xl bg-surface p-5">
              <Text className="text-foreground">{t('statistics.error')}</Text>
              <Button variant="secondary" onPress={() => setRevision((value) => value + 1)}>
                {t('statistics.retry')}
              </Button>
            </View>
          ) : null}
          {!data && !error ? <ActivityIndicator accessibilityLabel={t('statistics.loading')} /> : null}
          {data && summary ? (
            <>
              {mode === 'activity' ? (
                <YearHeatmap
                  today={today}
                  daily={data.daily}
                  selected={dayOpen ? selected : undefined}
                  onSelect={openDay}
                />
              ) : (
                <View className="gap-3 rounded-3xl bg-surface p-5">
                  <Text className="text-base font-semibold text-foreground">{t('statistics.dateRange')}</Text>
                  <View className="flex-row gap-1">
                    {[7, 30, 90, 365].map((days) => (
                      <Button
                        key={days}
                        size="sm"
                        className="min-w-0 flex-1 px-1"
                        variant={preset === days ? 'secondary' : 'ghost'}
                        accessibilityLabel={t('statistics.lastDays', { count: days })}
                        accessibilityState={{ selected: preset === days }}
                        onPress={() => setPreset(days)}>
                        <Button.Label
                          className={preset === days ? 'text-xs text-navigation-active' : 'text-xs text-muted'}>
                          {days === 365 ? t('statistics.oneYear') : t('statistics.shortDays', { count: days })}
                        </Button.Label>
                      </Button>
                    ))}
                  </View>
                  <PressableFeedback
                    accessibilityRole="button"
                    accessibilityLabel={t('statistics.customRange')}
                    className="gap-1 rounded-2xl bg-background p-3 dark:bg-surface-secondary"
                    onPress={() => {
                      setRangeOpen(true);
                    }}>
                    <Text className="text-xs text-muted">{t('statistics.customRange')}</Text>
                    <Text className="text-sm font-medium text-foreground">
                      {range.start} → {range.end}
                    </Text>
                  </PressableFeedback>
                </View>
              )}
              <View className="gap-3">
                <Text className="text-xs text-muted">
                  {mode === 'activity' ? t('statistics.yearSummary') : t('statistics.periodSummary')} ·{' '}
                  {summary.range.start} — {summary.range.end}
                </Text>
                <View className="flex-row flex-wrap gap-3">
                  {[
                    [t('statistics.total'), duration(summary.total)],
                    [t('statistics.average'), duration(summary.average)],
                    [t('statistics.books'), t('statistics.count', { count: summary.books.length })],
                    [t('statistics.readingDays'), t('statistics.daysCount', { count: summary.readingDays })],
                  ].map(([label, value]) => (
                    <View key={label} className="min-w-[120px] flex-1 basis-[45%] gap-3 rounded-3xl bg-surface p-4">
                      <Text className="text-xs text-muted">{label}</Text>
                      <Text className="text-lg font-semibold text-foreground">{value}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {mode === 'period' && period ? (
                <>
                  <Button
                    variant="secondary"
                    isDisabled={!period.books.length}
                    onPress={() =>
                      router.push({ pathname: '/statistics-poster', params: { start: range.start, end: range.end } })
                    }>
                    {t('statistics.posterEntry')}
                  </Button>
                  <ReadingTrend key={`${range.start}:${range.end}`} daily={period.daily} onSelect={openDay} />
                  <PeriodBooks period={period} onOpenBook={openBook} />
                </>
              ) : null}
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
          setPreset(undefined);
          setRangeOpen(false);
        }}
      />
    </View>
  );
}
