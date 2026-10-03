import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useToast } from 'heroui-native/toast';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type View as ViewType,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind, withUniwind } from 'uniwind';

import { useTranslation } from '@/i18n';
import {
  ExcerptBackgrounds,
  ExcerptThemes,
  type ReaderExcerptPreferences,
  useFontStore,
  useReaderStore,
} from '@/stores';
import type { ReaderExcerpt } from '../domain/reader-excerpt';
import { normalizeReaderDisplayText } from '../domain/reader-display-text';
import {
  ReaderExcerptPermissionError,
  saveReaderExcerptToLibrary,
  shareReaderExcerpt,
} from '../infrastructure/reader-excerpt-image';

const SettingsScrollView = withUniwind(BottomSheetScrollView);
const ExcerptBlur = withUniwind(BlurView);
const Entering = FadeIn.duration(180);
const Exiting = FadeOut.duration(140);
const HANDLE_HEIGHT = 24;
const ACTION_SHEET_HEIGHT = 208;

interface ReaderExcerptSheetProps {
  readonly excerpt: ReaderExcerpt | undefined;
  readonly blurTarget: RefObject<View | null>;
  readonly onOpenChange: (open: boolean) => void;
}

const backgroundValues: Record<(typeof ExcerptBackgrounds)[number], { readonly fill: string; readonly text: string }> =
  {
    ink: { fill: '#1b1d1c', text: '#efe2ba' },
    paper: { fill: '#f3ead9', text: '#302e29' },
    white: { fill: '#ffffff', text: '#242424' },
    navy: { fill: '#29365b', text: '#f1f2f5' },
    sage: { fill: '#dfe6dc', text: '#28332d' },
    rose: { fill: '#f1e1de', text: '#482f2e' },
  };

const themeLabelKeys: Record<
  (typeof ExcerptThemes)[number],
  'reader.excerptThemeClassic' | 'reader.excerptThemeCalendar' | 'reader.excerptThemeLetter'
> = {
  calendar: 'reader.excerptThemeCalendar',
  letter: 'reader.excerptThemeLetter',
  classic: 'reader.excerptThemeClassic',
};

const fontOptions = [
  { key: 'builtin' as const, family: 'LunarWenKai' },
  { key: 'system' as const, family: 'serif' },
];

export function ReaderExcerptSheet({ excerpt, blurTarget, onOpenChange }: ReaderExcerptSheetProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { theme } = useUniwind();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const foreground = useThemeColor('foreground');
  const storedPreferences = useReaderStore((state) => state.excerptPreferences);
  const setExcerptPreferences = useReaderStore((state) => state.setExcerptPreferences);
  const importedFonts = useFontStore((state) => state.fonts);
  const open = Boolean(excerpt);
  const [mode, setMode] = useState<'preview' | 'settings'>('preview');
  const [draft, setDraft] = useState<ReaderExcerptPreferences>(storedPreferences);
  const [busy, setBusy] = useState<'save' | 'share' | undefined>();
  const [wasOpen, setWasOpen] = useState(open);
  const [settingsHeight, setSettingsHeight] = useState(400);
  const cardRef = useRef<ViewType>(null);
  const cardLayout = useRef<
    { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined
  >(undefined);
  const previewScrollOffset = useRef(0);
  const previewTouch = useRef<{ readonly x: number; readonly y: number; moved: boolean } | undefined>(undefined);

  // Reset the draft only when a new preview session opens. Edits stay local until
  // the user confirms the template drawer.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setMode('preview');
      setDraft(storedPreferences);
      setBusy(undefined);
      setSettingsHeight(400);
    }
  }

  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'settings') setMode('preview');
      else onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [mode, onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    previewScrollOffset.current = 0;
    previewTouch.current = undefined;
  }, [open]);

  const selectedFont = useMemo(() => {
    if (draft.font === 'system') return { family: 'serif' };
    if (draft.font === 'builtin') return fontOptions[0];
    const imported = importedFonts.find((font) => `imported:${font.id}` === draft.font);
    return imported ? { family: imported.family } : fontOptions[0];
  }, [draft.font, importedFonts]);

  const availableHeight = Math.max(1, height - insets.top - insets.bottom - 16);
  const drawerHeight =
    mode === 'settings' ? Math.min(settingsHeight + HANDLE_HEIGHT, availableHeight) : ACTION_SHEET_HEIGHT;
  const previewHeight = Math.max(1, height - drawerHeight - insets.bottom);
  const cardWidth = Math.min(width - 24, 560);

  const updateDraft = <K extends keyof ReaderExcerptPreferences>(key: K, value: ReaderExcerptPreferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveToAlbum = async () => {
    if (busy) return;
    setBusy('save');
    try {
      await saveReaderExcerptToLibrary(cardRef);
      toast.show({ variant: 'success', label: t('reader.excerptSaved') });
    } catch (error) {
      toast.show({
        variant: 'danger',
        label:
          error instanceof ReaderExcerptPermissionError
            ? t('reader.excerptPermissionDenied')
            : t('reader.excerptSaveFailed'),
      });
    } finally {
      setBusy(undefined);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      await shareReaderExcerpt(cardRef, t('reader.shareExcerpt'));
    } catch {
      toast.show({ variant: 'danger', label: t('reader.excerptShareFailed') });
    } finally {
      setBusy(undefined);
    }
  };

  const applySettings = () => {
    setExcerptPreferences(draft);
    setMode('preview');
  };

  const handlePreviewTouchStart = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    previewTouch.current = {
      x: locationX,
      y: locationY,
      moved: false,
    };
  };

  const handlePreviewTouchMove = (event: GestureResponderEvent) => {
    const touch = previewTouch.current;
    if (!touch || touch.moved) return;
    const { locationX, locationY } = event.nativeEvent;
    if (Math.hypot(locationX - touch.x, locationY - touch.y) > 8) touch.moved = true;
  };

  const handlePreviewTouchEnd = (event: GestureResponderEvent) => {
    const touch = previewTouch.current;
    previewTouch.current = undefined;
    if (!touch || touch.moved) return;

    const layout = cardLayout.current;
    if (!layout) {
      onOpenChange(false);
      return;
    }

    const { locationX, locationY } = event.nativeEvent;
    const cardTop = layout.y - previewScrollOffset.current;
    const isInsideCard =
      locationX >= layout.x &&
      locationX <= layout.x + layout.width &&
      locationY >= cardTop &&
      locationY <= cardTop + layout.height;
    if (!isInsideCard) onOpenChange(false);
  };

  const handleCardLayout = (event: LayoutChangeEvent) => {
    const { x, y, width: cardLayoutWidth, height: cardLayoutHeight } = event.nativeEvent.layout;
    cardLayout.current = { x, y, width: cardLayoutWidth, height: cardLayoutHeight };
  };

  return (
    <BottomSheet isOpen={open} onOpenChange={onOpenChange}>
      <BottomSheet.Portal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: insets.bottom }} />
        {open && excerpt ? (
          <Animated.View
            entering={Entering}
            exiting={Exiting}
            accessibilityViewIsModal
            className="absolute inset-0"
            pointerEvents="box-none"
            onAccessibilityEscape={() => onOpenChange(false)}>
            <ExcerptBlur
              pointerEvents="none"
              blurTarget={blurTarget}
              blurMethod="dimezisBlurView"
              intensity={42}
              blurReductionFactor={2}
              tint={theme === 'dark' ? 'dark' : 'light'}
              className="absolute inset-0"
            />
            <View pointerEvents="none" className="absolute inset-0 bg-background/65" />
            <Pressable
              accessibilityLabel={t('action.close')}
              accessibilityRole="button"
              className="absolute inset-x-0 top-0"
              style={{ bottom: drawerHeight + insets.bottom }}
              onPress={() => onOpenChange(false)}
            />
            <ScrollView
              className="absolute inset-x-0 top-0"
              contentContainerClassName="items-center justify-center px-3"
              contentContainerStyle={{
                minHeight: previewHeight,
                paddingBottom: 24,
                paddingTop: insets.top + 12,
              }}
              style={{ bottom: drawerHeight + insets.bottom }}
              onScroll={(event) => {
                previewScrollOffset.current = event.nativeEvent.contentOffset.y;
              }}
              onScrollBeginDrag={() => {
                if (previewTouch.current) previewTouch.current.moved = true;
              }}
              onTouchCancel={() => {
                previewTouch.current = undefined;
              }}
              onTouchEnd={handlePreviewTouchEnd}
              onTouchMove={handlePreviewTouchMove}
              onTouchStart={handlePreviewTouchStart}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}>
              <ExcerptCard
                ref={cardRef}
                excerpt={excerpt}
                background={draft.background}
                cardWidth={cardWidth}
                fontFamily={selectedFont.family}
                locale={i18n.language}
                onLayout={handleCardLayout}
                theme={draft.theme}
              />
            </ScrollView>
          </Animated.View>
        ) : null}
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={insets.bottom}
          contentContainerClassName="h-full flex-1 p-0"
          detached
          enableDynamicSizing={false}
          enableOverDrag={false}
          snapPoints={[drawerHeight]}>
          {excerpt &&
            (mode === 'settings' ? (
              <SettingsContent
                draft={draft}
                importedFonts={importedFonts}
                onBack={() => setMode('preview')}
                onChange={updateDraft}
                onConfirm={applySettings}
                onContentSizeChange={(_width, contentHeight) => setSettingsHeight(Math.ceil(contentHeight))}
              />
            ) : (
              <View className="flex-1 flex-row items-center">
                <ExcerptAction
                  icon={{ ios: 'paintbrush', android: 'edit', web: 'edit' }}
                  foreground={foreground}
                  label={t('reader.changeExcerptTemplate')}
                  onPress={() => setMode('settings')}
                />
                <ExcerptAction
                  icon={{ ios: 'arrow.down', android: 'file_download', web: 'file_download' }}
                  foreground={foreground}
                  label={busy === 'save' ? t('reader.excerptSaving') : t('reader.saveExcerpt')}
                  onPress={() => void saveToAlbum()}
                  disabled={Boolean(busy)}
                />
                <ExcerptAction
                  icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
                  foreground={foreground}
                  label={busy === 'share' ? t('reader.excerptSharing') : t('reader.shareExcerpt')}
                  onPress={() => void share()}
                  disabled={Boolean(busy)}
                />
              </View>
            ))}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

const ExcerptCard = ({
  ref,
  excerpt,
  background,
  cardWidth,
  fontFamily,
  locale,
  onLayout,
  theme,
}: {
  readonly ref: RefObject<ViewType | null>;
  readonly excerpt: ReaderExcerpt;
  readonly background: ReaderExcerptPreferences['background'];
  readonly cardWidth: number;
  readonly fontFamily: string;
  readonly locale: string;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly theme: ReaderExcerptPreferences['theme'];
}) => {
  const colors = backgroundValues[background];
  const borderColor = `${colors.text}55`;
  return (
    <View
      ref={ref}
      collapsable={false}
      className={theme === 'letter' ? 'overflow-hidden border px-1 py-1 shadow-lg' : 'overflow-hidden shadow-lg'}
      onLayout={onLayout}
      pointerEvents="none"
      style={{ backgroundColor: colors.fill, borderColor, width: cardWidth }}>
      {theme === 'letter' ? (
        <View className="border px-5 py-4" style={{ borderColor, backgroundColor: colors.fill }}>
          <ExcerptCardContent
            excerpt={excerpt}
            fontFamily={fontFamily}
            locale={locale}
            textColor={colors.text}
            theme={theme}
          />
        </View>
      ) : (
        <ExcerptCardContent
          excerpt={excerpt}
          fontFamily={fontFamily}
          locale={locale}
          textColor={colors.text}
          theme={theme}
        />
      )}
    </View>
  );
};

function ExcerptCardContent({
  excerpt,
  fontFamily,
  locale,
  textColor,
  theme,
}: {
  readonly excerpt: ReaderExcerpt;
  readonly fontFamily: string;
  readonly locale: string;
  readonly textColor: string;
  readonly theme: ReaderExcerptPreferences['theme'];
}) {
  if (theme === 'calendar') {
    return (
      <View className="px-7 pb-8 pt-10">
        <CalendarHeader createdAt={excerpt.createdAt} locale={locale} textColor={textColor} />
        <ExcerptBody align="left" compact fontFamily={fontFamily} text={excerpt.text} textColor={textColor} />
        <ExcerptMeta centered excerpt={excerpt} fontFamily={fontFamily} textColor={textColor} />
      </View>
    );
  }

  return (
    <View className={theme === 'letter' ? 'px-5 py-2' : 'px-7 py-5'}>
      <ExcerptBody align="left" compact fontFamily={fontFamily} text={excerpt.text} textColor={textColor} />
      <ExcerptMeta excerpt={excerpt} fontFamily={fontFamily} textColor={textColor} />
    </View>
  );
}

function CalendarHeader({
  createdAt,
  locale,
  textColor,
}: {
  readonly createdAt: number;
  readonly locale: string;
  readonly textColor: string;
}) {
  const date = new Date(createdAt);
  const validDate = Number.isFinite(date.getTime()) ? date : new Date();
  const weekdayLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  const monthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
    .format(validDate)
    .toUpperCase();
  const weekday = new Intl.DateTimeFormat(weekdayLocale, { weekday: 'long' }).format(validDate);

  return (
    <View className="items-center">
      <Text className="text-8xl font-bold leading-none" style={{ color: textColor, fontSize: 96, lineHeight: 104 }}>
        {validDate.getDate()}
      </Text>
      <Text className="mt-2 text-2xl font-bold tracking-[1px]" style={{ color: textColor }}>
        {monthYear}
      </Text>
      <Text className="mt-2 text-sm" style={{ color: textColor }}>
        {weekday}
      </Text>
      <View className="mt-10 h-0.5 w-12" style={{ backgroundColor: textColor, opacity: 0.25 }} />
    </View>
  );
}

function ExcerptBody({
  align,
  compact = false,
  fontFamily,
  text,
  textColor,
}: {
  readonly align: 'left' | 'center';
  readonly compact?: boolean;
  readonly fontFamily: string;
  readonly text: string;
  readonly textColor: string;
}) {
  const paragraphs = normalizeReaderDisplayText(text)
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <View className={compact ? 'mt-4' : 'mt-8'}>
      {paragraphs.map((paragraph, index) => (
        <Text
          key={`${paragraph}-${index}`}
          className={`text-xl leading-8 ${align === 'center' ? 'text-center' : ''} ${index < paragraphs.length - 1 ? 'mb-5' : ''}`}
          style={{ color: textColor, fontFamily }}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

function ExcerptMeta({
  centered = false,
  excerpt,
  fontFamily,
  textColor,
}: {
  readonly centered?: boolean;
  readonly excerpt: ReaderExcerpt;
  readonly fontFamily: string;
  readonly textColor: string;
}) {
  return (
    <View className={`mt-8 gap-1 ${centered ? 'items-center' : 'items-start'}`}>
      <Text className={`${centered ? 'text-base' : 'text-sm'} font-semibold`} style={{ color: textColor, fontFamily }}>
        {excerpt.bookTitle}
      </Text>
      {excerpt.chapterTitle ? (
        <Text className="text-xs opacity-70" style={{ color: textColor, fontFamily }}>
          {excerpt.chapterTitle}
        </Text>
      ) : null}
      {excerpt.author ? (
        <Text className="text-xs opacity-70" style={{ color: textColor, fontFamily }}>
          {excerpt.author}
        </Text>
      ) : null}
    </View>
  );
}

function SettingsContent({
  draft,
  importedFonts,
  onBack,
  onChange,
  onConfirm,
  onContentSizeChange,
}: {
  readonly draft: ReaderExcerptPreferences;
  readonly importedFonts: ReturnType<typeof useFontStore.getState>['fonts'];
  readonly onBack: () => void;
  readonly onChange: <K extends keyof ReaderExcerptPreferences>(key: K, value: ReaderExcerptPreferences[K]) => void;
  readonly onConfirm: () => void;
  readonly onContentSizeChange: (width: number, height: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsScrollView
      className="flex-1"
      contentContainerClassName="gap-5 px-5 pb-6 pt-3"
      onContentSizeChange={onContentSizeChange}
      showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center justify-between">
        <Button accessibilityLabel={t('reader.backToExcerpt')} isIconOnly onPress={onBack} size="sm" variant="ghost">
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} />
        </Button>
        <BottomSheet.Title className="text-xl text-foreground">{t('reader.excerptTemplate')}</BottomSheet.Title>
        <Button accessibilityLabel={t('reader.confirmExcerptTemplate')} onPress={onConfirm} size="sm" variant="ghost">
          <Button.Label className="text-navigation-active">{t('action.confirm')}</Button.Label>
        </Button>
      </View>
      <ExcerptOptionSection label={t('reader.excerptTheme')}>
        <OptionRow>
          {ExcerptThemes.map((theme) => (
            <OptionButton
              key={theme}
              label={t(themeLabelKeys[theme])}
              selected={draft.theme === theme}
              onPress={() => onChange('theme', theme)}
            />
          ))}
        </OptionRow>
      </ExcerptOptionSection>
      <ExcerptOptionSection label={t('reader.excerptFont')}>
        <OptionRow>
          {fontOptions.map((font) => (
            <OptionButton
              key={font.key}
              label={t(font.key === 'builtin' ? 'reader.excerptFontBuiltin' : 'reader.excerptFontSerif')}
              selected={draft.font === font.key}
              onPress={() => onChange('font', font.key)}
            />
          ))}
          {importedFonts.map((font) => (
            <OptionButton
              key={font.id}
              label={font.family}
              selected={draft.font === `imported:${font.id}`}
              onPress={() => onChange('font', `imported:${font.id}`)}
            />
          ))}
        </OptionRow>
      </ExcerptOptionSection>
      <ExcerptOptionSection label={t('reader.excerptBackground')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-1">
          {ExcerptBackgrounds.map((background) => (
            <Button
              key={background}
              accessibilityLabel={background}
              accessibilityState={{ selected: draft.background === background }}
              className={`size-12 rounded-full border-2 p-0 ${draft.background === background ? 'border-navigation-active' : 'border-transparent'}`}
              onPress={() => onChange('background', background)}
              isIconOnly
              size="sm"
              variant="ghost">
              <View className="size-9 rounded-full" style={{ backgroundColor: backgroundValues[background].fill }} />
            </Button>
          ))}
        </ScrollView>
      </ExcerptOptionSection>
    </SettingsScrollView>
  );
}

function ExcerptOptionSection({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="px-1 text-sm font-semibold text-muted">{label}</Text>
      {children}
    </View>
  );
}

function OptionRow({ children }: { readonly children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-1">
      {children}
    </ScrollView>
  );
}

function OptionButton({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Button
      accessibilityState={{ selected }}
      className={`h-12 min-w-28 rounded-xl border bg-surface px-4 ${selected ? 'border-navigation-active' : 'border-border'}`}
      onPress={onPress}
      size="sm"
      variant="ghost">
      <Button.Label className={selected ? 'text-navigation-active' : undefined}>{label}</Button.Label>
    </Button>
  );
}

function ExcerptAction({
  icon,
  foreground,
  label,
  onPress,
  disabled,
}: {
  readonly icon: SymbolViewProps['name'];
  readonly foreground: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Button
      accessibilityLabel={label}
      accessibilityState={{ busy: disabled }}
      className="h-24 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-1 py-2"
      isDisabled={disabled}
      onPress={onPress}
      size="sm"
      variant="ghost">
      <View className="size-11 items-center justify-center rounded-full bg-surface-secondary dark:bg-surface-tertiary">
        <SymbolView name={icon} size={23} tintColor={foreground} />
      </View>
      <Button.Label className="text-center text-xs leading-4 text-muted" numberOfLines={2}>
        {label}
      </Button.Label>
    </Button>
  );
}
