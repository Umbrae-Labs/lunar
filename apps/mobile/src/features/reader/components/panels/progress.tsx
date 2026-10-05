import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useToast } from 'heroui-native/toast';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isUIRuntime } from 'react-native-worklets';

import type { ReaderSnapshot } from '@/reader';
import type { LunarReaderRuntime } from '@/reader/native';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { readingDateKey, summarizeReadingTime, type ReadingSession } from '../../domain/reading-time';
import { listReadingSessions } from '../../services/reading-time-service';
import { getBarInset } from '../navigation/layout';
import { createProgressNavigationController } from '../../services/progress-navigation';
import { ProgressSlider } from '../controls/progress-slider';

const AnimatedProgressText = Animated.createAnimatedComponent(TextInput);

interface ProgressProps {
  readonly bookId: string;
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
}

function ProgressContent({ bookId, isOpen, onOpenChange, runtime, snapshot }: ProgressProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const bottomInset = getBarInset(insets.bottom);
  const total = snapshot.totalSpreads;
  const currentPage = snapshot.bookSpreadIndex;
  const hasAbsolutePosition = currentPage !== undefined && total !== undefined;
  const sliderValue = currentPage ?? 0;
  const sliderMax = Math.max(0, (total ?? 1) - 1);
  const onNavigationFailure = useCallback(() => {
    toast.show({ variant: 'danger', label: t('reader.pageNavigationFailed') });
  }, [t, toast]);
  const progressNavigation = useMemo(
    () =>
      createProgressNavigationController(async (page) => {
        const current = runtime.getSnapshot();
        if (current.bookId !== bookId || current.revisionId !== snapshot.revisionId) {
          throw new Error('Reading session changed before progress navigation');
        }
        return (await runtime.goToSpread(page)).bookSpreadIndex;
      }, onNavigationFailure),
    [bookId, runtime, snapshot.revisionId, onNavigationFailure],
  );
  const { draftPage, isNavigating } = useSyncExternalStore(
    progressNavigation.subscribe,
    progressNavigation.getSnapshot,
    progressNavigation.getSnapshot,
  );
  useEffect(() => {
    progressNavigation.activate();
    return () => progressNavigation.dispose();
  }, [progressNavigation]);
  useEffect(() => {
    progressNavigation.observe(currentPage);
  }, [currentPage, progressNavigation]);
  useEffect(() => {
    if (!isOpen) progressNavigation.dismiss();
  }, [isOpen, progressNavigation]);
  const [readingSessions, setReadingSessions] = useState<readonly ReadingSession[]>([]);
  const [readingTimeError, setReadingTimeError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isOpen || !bookId) return;
    let active = true;
    const refresh = () => {
      void listReadingSessions(bookId)
        .then((sessions) => {
          if (active) {
            setReadingSessions(sessions);
            setReadingTimeError(false);
            setNow(Date.now());
          }
        })
        .catch(() => {
          if (active) setReadingTimeError(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bookId, isOpen]);
  const dailyReading = useMemo(() => summarizeReadingTime(readingSessions), [readingSessions]);
  const today = readingDateKey(now, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const todayMilliseconds = dailyReading.find((day) => day.date === today)?.milliseconds ?? 0;
  const totalMilliseconds = dailyReading.reduce((sum, day) => sum + day.milliseconds, 0);
  const displayedPage = draftPage ?? sliderValue;
  const previewPage = useSharedValue(displayedPage);
  const percentage = total === undefined ? undefined : Math.round((displayedPage / Math.max(total - 1, 1)) * 100);
  const progressLabel = t('reader.readingProgressLabel');
  const progressTextProps = useAnimatedProps<TextInputProps & { text: string }>(() => {
    const page = isUIRuntime() ? previewPage.value : displayedPage;
    const text = total === undefined ? '—' : `${Math.round((page / Math.max(sliderMax, 1)) * 100)}%`;
    return { text, accessibilityLabel: `${progressLabel}: ${text}` };
  });
  const goToPage = useCallback(
    (target: number) => {
      if (!hasAbsolutePosition) return;
      progressNavigation.request(Math.min(Math.max(target, 0), sliderMax));
    },
    [hasAbsolutePosition, progressNavigation, sliderMax],
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(value) => {
        if (!value) progressNavigation.dismiss();
        onOpenChange(value);
      }}>
      <BottomSheet.Portal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: bottomInset }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={bottomInset}
          contentContainerClassName="px-0 pb-0!"
          detached
          enableOverDrag={false}>
          <View className="gap-5 px-5 pb-4 pt-5">
            <View className="flex-row items-center">
              <View className="min-w-0 flex-1 items-center gap-1">
                <AnimatedProgressText
                  accessibilityRole="text"
                  animatedProps={progressTextProps}
                  className="w-full p-0 text-center text-2xl font-semibold text-foreground"
                  defaultValue={percentage === undefined ? '—' : `${percentage}%`}
                  editable={false}
                  caretHidden
                  pointerEvents="none"
                  underlineColorAndroid="transparent"
                />
                <BottomSheet.Title className="text-center text-xs font-normal text-muted">
                  {t('reader.readingProgressLabel')}
                </BottomSheet.Title>
              </View>
              <View className="h-10 w-px bg-border" />
              <View className="min-w-0 flex-1 items-center gap-1">
                <Text className="text-2xl font-semibold text-foreground" numberOfLines={1} adjustsFontSizeToFit>
                  {readingTimeError ? '—' : formatDuration(todayMilliseconds, t)}
                </Text>
                <Text className="text-center text-xs text-muted">{t('reader.todayReadingTime')}</Text>
              </View>
              <View className="h-10 w-px bg-border" />
              <View className="min-w-0 flex-1 items-center gap-1">
                <Text className="text-2xl font-semibold text-foreground" numberOfLines={1} adjustsFontSizeToFit>
                  {readingTimeError ? '—' : formatDuration(totalMilliseconds, t)}
                </Text>
                <Text className="text-center text-xs text-muted">{t('reader.totalReadingTime')}</Text>
              </View>
            </View>

            <View className="rounded-full px-4 py-3">
              <ProgressSlider
                accessibilityLabel={t('reader.choosePage')}
                isDisabled={isNavigating || !hasAbsolutePosition || total <= 1}
                maxValue={sliderMax}
                onDragBegin={progressNavigation.beginDrag}
                previewPage={previewPage}
                onDragCancel={progressNavigation.cancelDrag}
                onChangeEnd={goToPage}
                value={displayedPage}
              />
            </View>

            <View className="flex-row items-center justify-between">
              <ProgressAction
                accessibilityLabel={t('reader.firstPage')}
                isDisabled={isNavigating || !hasAbsolutePosition || displayedPage === 0}
                name={{ ios: 'backward.end.fill', android: 'first_page', web: 'first_page' }}
                onPress={() => goToPage(0)}
              />
              <ProgressAction
                accessibilityLabel={t('reader.previousTenPages')}
                isDisabled={isNavigating || !hasAbsolutePosition || displayedPage === 0}
                name={{ ios: 'gobackward.10', android: 'replay_10', web: 'replay_10' }}
                onPress={() => goToPage((progressNavigation.getSnapshot().draftPage ?? sliderValue) - 10)}
              />
              <ProgressAction
                accessibilityLabel={t('reader.nextTenPages')}
                isDisabled={isNavigating || !hasAbsolutePosition || displayedPage >= sliderMax}
                name={{ ios: 'goforward.10', android: 'forward_10', web: 'forward_10' }}
                onPress={() => goToPage((progressNavigation.getSnapshot().draftPage ?? sliderValue) + 10)}
              />
              <ProgressAction
                accessibilityLabel={t('reader.lastPage')}
                isDisabled={isNavigating || !hasAbsolutePosition || displayedPage >= sliderMax}
                name={{ ios: 'forward.end.fill', android: 'last_page', web: 'last_page' }}
                onPress={() => total !== undefined && goToPage(total - 1)}
              />
            </View>
            {readingTimeError && (
              <Text className="text-center text-xs text-muted">{t('reader.readingTimeLoadFailed')}</Text>
            )}
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

interface ProgressActionProps {
  readonly accessibilityLabel: string;
  readonly isDisabled: boolean;
  readonly name: SymbolViewProps['name'];
  readonly onPress: () => void;
}

function ProgressAction({ accessibilityLabel, isDisabled, name, onPress }: ProgressActionProps) {
  const theme = useTheme();
  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      className="size-11 rounded-full dark:bg-transparent"
      isDisabled={isDisabled}
      isIconOnly
      onPress={onPress}
      size="sm"
      variant="ghost">
      <SymbolView name={name} size={22} tintColor={theme.text} />
    </Button>
  );
}

function formatDuration(milliseconds: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (milliseconds > 0 && milliseconds < 60_000) return t('reader.lessThanMinute');
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return t('reader.readingMinutes', { minutes });
  if (minutes % 60 === 0) return t('reader.readingHours', { hours: Math.floor(minutes / 60) });
  return t('reader.readingDuration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Keep the closing view mounted while settled-page updates stay outside it. */
export const Progress = memo(
  ProgressContent,
  (previous, next) =>
    previous.bookId === next.bookId &&
    previous.isOpen === next.isOpen &&
    previous.runtime === next.runtime &&
    previous.onOpenChange === next.onOpenChange &&
    (!next.isOpen || previous.snapshot === next.snapshot),
);
