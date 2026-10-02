import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useToast } from 'heroui-native/toast';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, Text, View, type View as ViewType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { useTranslation } from '@/i18n';
import {
  ExcerptBackgrounds,
  ExcerptThemes,
  type ReaderExcerptPreferences,
  useFontStore,
  useReaderStore,
} from '@/stores';
import type { ReaderExcerpt } from '../domain/reader-excerpt';
import { saveReaderExcerptToLibrary, shareReaderExcerpt } from '../infrastructure/reader-excerpt-image';

const SettingsScrollView = withUniwind(BottomSheetScrollView);

interface ReaderExcerptSheetProps {
  readonly excerpt: ReaderExcerpt | undefined;
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

const themeDecorations: Record<(typeof ExcerptThemes)[number], { readonly mark: string; readonly footer: string }> = {
  classic: { mark: '“', footer: 'LUNAR · 书摘' },
  calendar: { mark: '✦', footer: '今日阅读' },
  minimal: { mark: '—', footer: '摘录' },
  letter: { mark: '❧', footer: 'From the page' },
};

const themeLabelKeys: Record<
  (typeof ExcerptThemes)[number],
  | 'reader.excerptThemeClassic'
  | 'reader.excerptThemeCalendar'
  | 'reader.excerptThemeMinimal'
  | 'reader.excerptThemeLetter'
> = {
  classic: 'reader.excerptThemeClassic',
  calendar: 'reader.excerptThemeCalendar',
  minimal: 'reader.excerptThemeMinimal',
  letter: 'reader.excerptThemeLetter',
};

const fontOptions = [
  { key: 'builtin' as const, family: 'LunarWenKai' },
  { key: 'system' as const, family: 'serif' },
];

export function ReaderExcerptSheet({ excerpt, onOpenChange }: ReaderExcerptSheetProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const storedPreferences = useReaderStore((state) => state.excerptPreferences);
  const setExcerptPreferences = useReaderStore((state) => state.setExcerptPreferences);
  const importedFonts = useFontStore((state) => state.fonts);
  const open = Boolean(excerpt);
  const [mode, setMode] = useState<'preview' | 'settings'>('preview');
  const [draft, setDraft] = useState<ReaderExcerptPreferences>(storedPreferences);
  const [busy, setBusy] = useState<'save' | 'share' | undefined>();
  const [wasOpen, setWasOpen] = useState(open);
  const cardRef = useRef<ViewType>(null);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setMode('preview');
      setDraft(storedPreferences);
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

  const selectedFont = useMemo(() => {
    if (draft.font === 'system') return { family: 'serif' };
    if (draft.font === 'builtin') return fontOptions[0];
    const imported = importedFonts.find((font) => `imported:${font.id}` === draft.font);
    return imported ? { family: imported.family } : fontOptions[0];
  }, [draft.font, importedFonts]);

  const updateDraft = <K extends keyof ReaderExcerptPreferences>(key: K, value: ReaderExcerptPreferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveToAlbum = async () => {
    if (busy) return;
    setBusy('save');
    try {
      await saveReaderExcerptToLibrary(cardRef);
      toast.show({ variant: 'success', label: t('reader.excerptSaved') });
    } catch {
      toast.show({ variant: 'danger', label: t('reader.excerptSaveFailed') });
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

  return (
    <BottomSheet isOpen={open} onOpenChange={onOpenChange}>
      <BottomSheet.Portal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: insets.bottom }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={insets.bottom}
          contentContainerClassName="h-full flex-1 p-0"
          detached
          enableDynamicSizing={false}
          enableOverDrag={false}
          snapPoints={[mode === 'settings' ? 490 : 590]}>
          {excerpt &&
            (mode === 'settings' ? (
              <SettingsScrollView
                className="flex-1"
                contentContainerClassName="gap-5 px-5 pb-6 pt-3"
                showsVerticalScrollIndicator={false}>
                <View className="flex-row items-center justify-between">
                  <Button
                    accessibilityLabel={t('reader.backToExcerpt')}
                    isIconOnly
                    onPress={() => setMode('preview')}
                    size="sm"
                    variant="ghost">
                    <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} />
                  </Button>
                  <BottomSheet.Title className="text-xl text-foreground">
                    {t('reader.excerptTemplate')}
                  </BottomSheet.Title>
                  <Button
                    accessibilityLabel={t('reader.confirmExcerptTemplate')}
                    onPress={applySettings}
                    size="sm"
                    variant="ghost">
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
                        onPress={() => updateDraft('theme', theme)}
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
                        onPress={() => updateDraft('font', font.key)}
                      />
                    ))}
                    {importedFonts.map((font) => (
                      <OptionButton
                        key={font.id}
                        label={font.family}
                        selected={draft.font === `imported:${font.id}`}
                        onPress={() => updateDraft('font', `imported:${font.id}`)}
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
                        onPress={() => updateDraft('background', background)}
                        isIconOnly
                        size="sm"
                        variant="ghost">
                        <View
                          className="size-9 rounded-full"
                          style={{ backgroundColor: backgroundValues[background].fill }}
                        />
                      </Button>
                    ))}
                  </ScrollView>
                </ExcerptOptionSection>
              </SettingsScrollView>
            ) : (
              <SettingsScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pb-6 pt-3"
                showsVerticalScrollIndicator={false}>
                <BottomSheet.Title className="text-xl text-foreground">{t('reader.excerptTitle')}</BottomSheet.Title>
                <View
                  ref={cardRef}
                  collapsable={false}
                  className="overflow-hidden rounded-[28px] px-7 py-8"
                  style={{ backgroundColor: backgroundValues[draft.background].fill }}>
                  <Text
                    className="mb-3 text-3xl"
                    style={{ color: backgroundValues[draft.background].text, fontFamily: selectedFont.family }}>
                    {themeDecorations[draft.theme].mark}
                  </Text>
                  <Text
                    className="text-xl leading-8"
                    style={{ color: backgroundValues[draft.background].text, fontFamily: selectedFont.family }}>
                    {excerpt.text}
                  </Text>
                  <View className="mt-7 gap-1">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: backgroundValues[draft.background].text, fontFamily: selectedFont.family }}>
                      {excerpt.bookTitle}
                    </Text>
                    {excerpt.chapterTitle ? (
                      <Text
                        className="text-xs opacity-70"
                        style={{ color: backgroundValues[draft.background].text, fontFamily: selectedFont.family }}>
                        {excerpt.chapterTitle}
                      </Text>
                    ) : null}
                    {excerpt.author ? (
                      <Text
                        className="text-xs opacity-70"
                        style={{ color: backgroundValues[draft.background].text, fontFamily: selectedFont.family }}>
                        {excerpt.author}
                      </Text>
                    ) : null}
                    <Text
                      className="mt-3 text-[10px] tracking-[2px] opacity-60"
                      style={{ color: backgroundValues[draft.background].text }}>
                      {themeDecorations[draft.theme].footer}
                    </Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <ExcerptAction
                    icon={{ ios: 'paintbrush', android: 'edit', web: 'edit' }}
                    label={t('reader.changeExcerptTemplate')}
                    onPress={() => setMode('settings')}
                  />
                  <ExcerptAction
                    icon={{ ios: 'arrow.down', android: 'file_download', web: 'file_download' }}
                    label={busy === 'save' ? t('reader.excerptSaving') : t('reader.saveExcerpt')}
                    onPress={() => void saveToAlbum()}
                    disabled={Boolean(busy)}
                  />
                  <ExcerptAction
                    icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
                    label={busy === 'share' ? t('reader.excerptSharing') : t('reader.shareExcerpt')}
                    onPress={() => void share()}
                    disabled={Boolean(busy)}
                  />
                </View>
                <Button className="mt-1 h-12 rounded-2xl" onPress={() => onOpenChange(false)} variant="tertiary">
                  <Button.Label>{t('action.close')}</Button.Label>
                </Button>
              </SettingsScrollView>
            ))}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
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
  label,
  onPress,
  disabled,
}: {
  readonly icon: SymbolViewProps['name'];
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Button
      accessibilityLabel={label}
      className="h-auto min-h-20 flex-1 rounded-2xl bg-surface px-1 py-2 dark:bg-surface-secondary"
      isDisabled={disabled}
      onPress={onPress}
      size="sm"
      variant="ghost">
      <SymbolView name={icon} size={23} />
      <Button.Label className="mt-1 text-[11px]" numberOfLines={2}>
        {label}
      </Button.Label>
    </Button>
  );
}
