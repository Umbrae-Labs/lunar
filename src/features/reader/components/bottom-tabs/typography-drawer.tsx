import { ThemedBottomSheetPortal } from '@/components/ui/themed-bottom-sheet-portal';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Slider } from 'heroui-native/slider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { type ReaderFontRef, type ReaderFontRole, type ReaderTypography } from '@/reader';
import type { ReaderPageAnimationStyle } from '@/reader/native';
import { useTranslation } from '@/i18n';
import { type ImportedReaderFont, useFontStore, useReaderStore } from '@/stores';
import { FontPickerContent } from '../font-picker-content';
import { getReaderBottomTabBarInset } from './constants';
import { createTypographyCommitScheduler, stepTypographyValue } from '../../services/typography-adjustment';

interface TypographyDrawerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
}

type TypographyKey = 'fontSize' | 'marginHorizontal' | 'lineHeight';

const SettingsScrollView = withUniwind(BottomSheetScrollView);
const HANDLE_HEIGHT = 24;

interface TypographySliderProps {
  readonly accessibilityLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  readonly value: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly onChangeEnd: (value: number) => void;
  readonly onStep: (direction: -1 | 1) => void;
}

interface CompactTypographySliderProps extends TypographySliderProps {
  readonly label: string;
  readonly stacked: boolean;
}

export function TypographyDrawer({ isOpen, onOpenChange }: TypographyDrawerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const compactSlidersStacked = width < 360 || fontScale > 1.3;
  const bottomInset = getReaderBottomTabBarInset(insets.bottom);
  const typography = useReaderStore((state) => state.typography);
  const updateTypography = useReaderStore((state) => state.updateTypography);
  const animationStyle = useReaderStore((state) => state.animationStyle);
  const setAnimationStyle = useReaderStore((state) => state.setAnimationStyle);
  const fonts = useFontStore((state) => state.fonts);
  const [draft, setDraft] = useState<ReaderTypography>(typography);
  const draftRef = useRef(draft);
  const commitScheduler = useMemo(() => createTypographyCommitScheduler(updateTypography), [updateTypography]);
  const [pickerRole, setPickerRole] = useState<ReaderFontRole | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [settingsHeight, setSettingsHeight] = useState(400);
  // Start each opening at the settings page, including when the tab bar closed
  // the drawer externally. Keep the outgoing page intact during dismissal.
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPickerRole(null);
      setDraft(typography);
    }
  }
  const availableHeight = Math.max(1, height - insets.top - bottomInset - 16);
  const sheetHeight = Math.min(
    pickerRole ? Math.max(settingsHeight + HANDLE_HEIGHT, height * 0.65) : settingsHeight + HANDLE_HEIGHT,
    availableHeight,
  );
  const bodyFontLabel = describeReaderFont(typography.fonts.body, fonts, t);
  const chromeFontLabel = describeReaderFont(typography.fonts.chrome, fonts, t);
  const animationOptions: readonly {
    readonly style: ReaderPageAnimationStyle;
    readonly label: string;
  }[] = [
    { style: 'none', label: t('reader.transitionNone') },
    { style: 'page', label: t('reader.transitionPage') },
    { style: 'slide', label: t('reader.transitionSlide') },
  ];

  const updateDraft = (key: TypographyKey, value: number) => {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const commit = (key: TypographyKey, value: number) => {
    commitScheduler.commit(key, value);
  };

  const adjust = (key: TypographyKey, direction: -1 | 1, step: number, min: number, max: number) => {
    const value = stepTypographyValue(draftRef.current[key], direction, step, min, max);
    if (value === draftRef.current[key]) return;
    updateDraft(key, value);
    commitScheduler.schedule(key, value);
  };

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!isOpen) commitScheduler.flush();
    return () => commitScheduler.flush();
  }, [commitScheduler, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      if (pickerRole) {
        setPickerRole(null);
      } else {
        onOpenChange(false);
      }
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onOpenChange, pickerRole]);

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      commitScheduler.flush();
      Keyboard.dismiss();
    }
    onOpenChange(value);
  };

  const returnToSettings = () => {
    Keyboard.dismiss();
    setPickerRole(null);
  };

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <ThemedBottomSheetPortal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: bottomInset }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={bottomInset}
          contentContainerClassName="h-full flex-1 p-0"
          detached
          enableDynamicSizing={false}
          enableOverDrag={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          enableBlurKeyboardOnGesture
          snapPoints={[sheetHeight]}>
          {pickerRole ? (
            <FontPickerContent key={pickerRole} role={pickerRole} onBack={returnToSettings} />
          ) : (
            <SettingsScrollView
              className="flex-1"
              contentContainerClassName="gap-5 px-5 pb-5 pt-3"
              onContentSizeChange={(_width, contentHeight) => setSettingsHeight(Math.ceil(contentHeight))}
              showsVerticalScrollIndicator={false}>
              <View className="gap-1">
                <BottomSheet.Title className="text-xl text-foreground">{t('reader.typography')}</BottomSheet.Title>
              </View>
              <View className="gap-2">
                <View className="flex-row gap-2">
                  {animationOptions.map((option) => {
                    const selected = animationStyle === option.style;
                    return (
                      <Button
                        key={option.style}
                        accessibilityLabel={t('reader.transition', { style: option.label })}
                        accessibilityState={{ selected }}
                        className="min-w-0 flex-1 rounded-xl bg-surface px-2 dark:bg-surface-secondary"
                        onPress={() => setAnimationStyle(option.style)}
                        size="sm"
                        variant="ghost">
                        <Button.Label className={selected ? 'text-navigation-active' : undefined} numberOfLines={1}>
                          {option.label}
                        </Button.Label>
                      </Button>
                    );
                  })}
                </View>
              </View>
              <View className="gap-2">
                <Text className="px-1 text-sm text-muted">{t('reader.fontSize')}</Text>
                <TypographySlider
                  accessibilityLabel={t('reader.adjustFontSize')}
                  decreaseLabel={t('reader.decreaseFontSize')}
                  increaseLabel={t('reader.increaseFontSize')}
                  maxValue={32}
                  minValue={12}
                  onChange={(value) => updateDraft('fontSize', value)}
                  onChangeEnd={(value) => commit('fontSize', value)}
                  onStep={(direction) => adjust('fontSize', direction, 1, 12, 32)}
                  step={1}
                  value={draft.fontSize}
                />
              </View>
              <View className={compactSlidersStacked ? 'gap-4' : 'flex-row gap-4'}>
                <CompactTypographySlider
                  accessibilityLabel={t('reader.adjustMargins')}
                  decreaseLabel={t('reader.decreaseMargins')}
                  increaseLabel={t('reader.increaseMargins')}
                  label={t('reader.margin')}
                  stacked={compactSlidersStacked}
                  maxValue={56}
                  minValue={8}
                  onChange={(value) => updateDraft('marginHorizontal', value)}
                  onChangeEnd={(value) => commit('marginHorizontal', value)}
                  onStep={(direction) => adjust('marginHorizontal', direction, 4, 8, 56)}
                  step={4}
                  value={draft.marginHorizontal}
                />
                <CompactTypographySlider
                  accessibilityLabel={t('reader.adjustLineHeight')}
                  decreaseLabel={t('reader.decreaseLineHeight')}
                  increaseLabel={t('reader.increaseLineHeight')}
                  label={t('reader.lineHeight')}
                  stacked={compactSlidersStacked}
                  maxValue={2.4}
                  minValue={1.1}
                  onChange={(value) => updateDraft('lineHeight', value)}
                  onChangeEnd={(value) => commit('lineHeight', value)}
                  onStep={(direction) => adjust('lineHeight', direction, 0.05, 1.1, 2.4)}
                  step={0.05}
                  value={draft.lineHeight}
                />
              </View>
              <View className="overflow-hidden rounded-2xl bg-surface dark:bg-surface-secondary">
                <FontRow label={t('reader.bodyFont')} onPress={() => setPickerRole('body')} value={bodyFontLabel} />
                <View className="mx-4 h-px bg-border" />
                <FontRow label={t('reader.uiFont')} onPress={() => setPickerRole('chrome')} value={chromeFontLabel} />
              </View>
            </SettingsScrollView>
          )}
        </BottomSheet.Content>
      </ThemedBottomSheetPortal>
    </BottomSheet>
  );
}

/**
 * The stored family for a role, preferring the catalog's name for the file —
 * a persisted name can outlive a rename of the file it points at, and the
 * catalog is what the reader will actually load.
 */
function describeReaderFont(
  ref: ReaderFontRef,
  fonts: readonly ImportedReaderFont[],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (ref.source) {
    case 'system':
      return ref.family;
    case 'imported':
      return fonts.find((font) => font.id === ref.importedFontId)?.family ?? ref.family;
    default:
      return t('reader.builtinFont');
  }
}

interface FontRowProps {
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
}

function FontRow({ label, value, onPress }: FontRowProps) {
  const mutedColor = useThemeColor('muted');
  return (
    <Button
      accessibilityLabel={`${label}: ${value}`}
      className="h-auto min-h-14 flex-row items-center gap-3 rounded-none px-4 py-3"
      onPress={onPress}
      variant="ghost">
      <Text className="text-sm text-muted">{label}</Text>
      <Button.Label className="min-w-0 flex-1 text-right text-sm" numberOfLines={1}>
        {value}
      </Button.Label>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={18}
        tintColor={mutedColor}
      />
    </Button>
  );
}

function TypographySlider({
  accessibilityLabel,
  decreaseLabel,
  increaseLabel,
  value,
  minValue,
  maxValue,
  step,
  onChange,
  onChangeEnd,
  onStep,
}: TypographySliderProps) {
  return (
    <View className="h-14 flex-row items-center rounded-2xl bg-surface px-1 dark:bg-surface-secondary">
      <Button
        accessibilityLabel={decreaseLabel}
        className="size-11 min-w-0 shrink-0 rounded-full px-0"
        isIconOnly
        isDisabled={value <= minValue}
        onPress={() => onStep(-1)}
        size="sm"
        variant="ghost">
        <Button.Label className="text-sm">A</Button.Label>
      </Button>
      <Slider
        accessibilityLabel={accessibilityLabel}
        className="min-w-0 flex-1"
        maxValue={maxValue}
        minValue={minValue}
        onChange={(next) => onChange(toSliderValue(next))}
        onChangeEnd={(next) => onChangeEnd(toSliderValue(next))}
        step={step}
        value={value}>
        <Slider.Track className="h-2 rounded-full bg-surface-tertiary">
          <Slider.Fill className="rounded-full bg-accent" />
          <Slider.Thumb className="size-11 rounded-full bg-transparent! p-0!">
            <View className="size-11 items-center justify-center rounded-full border border-border bg-surface dark:border-0 dark:bg-surface-tertiary">
              <Text className="text-base tabular-nums text-foreground">{formatValue(value)}</Text>
            </View>
          </Slider.Thumb>
        </Slider.Track>
      </Slider>
      <Button
        accessibilityLabel={increaseLabel}
        className="size-11 min-w-0 shrink-0 rounded-full px-0"
        isIconOnly
        isDisabled={value >= maxValue}
        onPress={() => onStep(1)}
        size="sm"
        variant="ghost">
        <Button.Label className="text-xl">A</Button.Label>
      </Button>
    </View>
  );
}

function CompactTypographySlider({
  accessibilityLabel,
  decreaseLabel,
  increaseLabel,
  label,
  stacked,
  value,
  minValue,
  maxValue,
  step,
  onChange,
  onChangeEnd,
  onStep,
}: CompactTypographySliderProps) {
  return (
    <View className={stacked ? 'w-full gap-2' : 'min-w-0 flex-1 gap-2'}>
      <Text className="px-1 text-sm text-muted">{label}</Text>
      <View className="h-14 flex-row items-center rounded-2xl bg-surface px-1 dark:bg-surface-secondary">
        <Button
          accessibilityLabel={decreaseLabel}
          className="h-11 w-8 min-w-0 shrink-0 rounded-full px-0"
          hitSlop={{ left: 6, right: 6 }}
          isIconOnly
          isDisabled={value <= minValue}
          onPress={() => onStep(-1)}
          size="sm"
          variant="ghost">
          <Button.Label className="text-base">−</Button.Label>
        </Button>
        <Slider
          accessibilityLabel={accessibilityLabel}
          className="min-w-0 flex-1"
          maxValue={maxValue}
          minValue={minValue}
          onChange={(next) => onChange(toSliderValue(next))}
          onChangeEnd={(next) => onChangeEnd(toSliderValue(next))}
          step={step}
          value={value}>
          <Slider.Track className="h-2 rounded-full bg-surface-tertiary">
            <Slider.Fill className="rounded-full bg-accent" />
            <Slider.Thumb className="size-11 rounded-full bg-transparent! p-0!">
              <View className="size-11 items-center justify-center rounded-full border border-border bg-surface dark:border-0 dark:bg-surface-tertiary">
                <Text className="text-sm tabular-nums text-foreground">{formatValue(value)}</Text>
              </View>
            </Slider.Thumb>
          </Slider.Track>
        </Slider>
        <Button
          accessibilityLabel={increaseLabel}
          className="h-11 w-8 min-w-0 shrink-0 rounded-full px-0"
          hitSlop={{ left: 6, right: 6 }}
          isIconOnly
          isDisabled={value >= maxValue}
          onPress={() => onStep(1)}
          size="sm"
          variant="ghost">
          <Button.Label className="text-base">+</Button.Label>
        </Button>
      </View>
    </View>
  );
}

function toSliderValue(value: number | number[]): number {
  return Array.isArray(value) ? (value[0] ?? 0) : value;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
