import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useBottomSheetAwareHandlers, useThemeColor } from 'heroui-native/hooks';
import { SearchField } from 'heroui-native/search-field';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { withUniwind } from 'uniwind';

import { SelectItem, SelectRoot } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { LUNAR_READER_BUILTIN_FONT_REF, type ReaderFontRef, type ReaderFontRole } from '@/reader';
import { listSystemReaderFontFamilies } from '@/reader/native';
import { type ImportedReaderFont, useFontStore, useReaderStore } from '@/stores';

interface FontPickerProps {
  readonly role: ReaderFontRole;
  readonly onBack: () => void;
}

type FontPickerItem =
  | { readonly kind: 'header'; readonly key: string; readonly title: string }
  | { readonly kind: 'note'; readonly key: string; readonly text: string }
  | {
      readonly kind: 'option';
      readonly key: string;
      readonly ref: ReaderFontRef;
      readonly title: string;
      /**
       * Renders the row's own name in the candidate face. Only system families
       * can do this — React Native cannot reach a file this app owns — and the
       * name is what the user is judging, so it doubles as the preview.
       */
      readonly previewFamily?: string;
    };

/** The selectable half of the list; a section is built from these alone. */
type FontOption = Extract<FontPickerItem, { kind: 'option' }>;

const FontList = withUniwind(BottomSheetFlatList<FontPickerItem>);

/**
 * Picks the font for one reader role.
 *
 * The offered sources differ per role: body text is measured by the kernel, which
 * only accepts font bytes, so a system family could never be laid out and is not
 * offered there. Chrome is drawn by this app and can use anything the platform
 * font manager resolves.
 */
export function FontPicker({ role, onBack }: FontPickerProps) {
  const { t } = useTranslation();
  const foreground = useThemeColor('foreground');
  const keyboardHandlers = useBottomSheetAwareHandlers();
  const typography = useReaderStore((state) => state.typography);
  const updateTypography = useReaderStore((state) => state.updateTypography);
  const fonts = useFontStore((state) => state.fonts);
  const [query, setQuery] = useState('');
  const allowsSystem = role === 'chrome';

  const items = useMemo<readonly FontPickerItem[]>(() => {
    // Enumerating the platform's families crosses the JSI boundary once per
    // family, so it only happens for a role that can actually offer them.
    const systemFamilies = allowsSystem ? listSystemReaderFontFamilies() : [];
    const trimmedQuery = query.trim().toLocaleLowerCase();
    const sections: readonly {
      readonly id: string;
      readonly title: string;
      readonly options: readonly FontOption[];
      /** Shown in place of the options when the catalog itself is empty. */
      readonly emptyNote?: string;
    }[] = [
      {
        id: 'builtin',
        title: t('reader.fontSourceBuiltin'),
        options: [builtinOption(t('reader.builtinFont'))],
      },
      {
        id: 'imported',
        title: t('reader.importedFonts'),
        options: importedOptions(fonts),
        emptyNote: t('reader.noImportedFonts'),
      },
      {
        id: 'system',
        title: t('reader.systemFonts'),
        options: systemFamilies.map((family) => systemOption(family)),
      },
    ];

    const resolved: FontPickerItem[] = [];
    for (const section of sections) {
      const options = section.options.filter(
        (option) => trimmedQuery === '' || option.title.toLocaleLowerCase().includes(trimmedQuery),
      );
      if (options.length === 0 && !(section.emptyNote && trimmedQuery === '')) {
        continue;
      }
      resolved.push({ kind: 'header', key: `h:${section.id}`, title: section.title });
      if (options.length > 0) {
        resolved.push(...options);
      } else {
        resolved.push({ kind: 'note', key: `n:${section.id}`, text: section.emptyNote ?? '' });
      }
    }
    return resolved;
  }, [allowsSystem, fonts, query, t]);

  const selected = typography.fonts[role];
  return (
    <SelectRoot
      className="flex-1 gap-3 px-5 pb-5 pt-3"
      value={{ value: fontSelectionValue(selected), label: selected.family }}
      onValueChange={(option) => {
        const font = items.find(
          (item): item is FontOption => item.kind === 'option' && fontSelectionValue(item.ref) === option?.value,
        );
        if (font) {
          updateTypography({ fonts: { ...typography.fonts, [role]: font.ref } });
          onBack();
        }
      }}>
      <View className="flex-row items-center gap-2">
        <Button
          isIconOnly
          accessibilityLabel={t('reader.backToTypography')}
          className="size-12 rounded-full"
          onPress={onBack}
          variant="ghost">
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
            tintColor={foreground}
          />
        </Button>
        <BottomSheet.Title className="min-w-0 flex-1 text-xl text-foreground">
          {t(role === 'body' ? 'reader.bodyFont' : 'reader.uiFont')}
        </BottomSheet.Title>
      </View>
      {allowsSystem ? (
        <SearchField value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              {...keyboardHandlers}
              accessibilityLabel={t('reader.searchFonts')}
              className="min-w-0 flex-1 rounded-2xl border border-field-border bg-surface focus:border-navigation-active dark:bg-surface-secondary"
              placeholder={t('reader.searchFonts')}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      ) : null}
      <FontList
        className="flex-1"
        contentContainerClassName="pb-4"
        data={items}
        extraData={selected}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text className="py-8 text-center text-sm text-muted">{t('reader.noMatchingFonts')}</Text>}
        renderItem={({ item, index }) => {
          if (item.kind === 'header') {
            return (
              <Text
                accessibilityRole="header"
                className={
                  index === 0
                    ? 'px-4 pb-2 pt-2 text-sm font-medium text-muted'
                    : 'px-4 pb-2 pt-6 text-sm font-medium text-muted'
                }>
                {item.title}
              </Text>
            );
          }
          if (item.kind === 'note') {
            return (
              <View className="rounded-2xl bg-surface px-4 py-4 dark:bg-surface-secondary">
                <Text className="text-sm leading-6 text-muted">{item.text}</Text>
              </View>
            );
          }
          const isFirst = items[index - 1]?.kind !== 'option';
          const isLast = items[index + 1]?.kind !== 'option';
          return (
            <SelectItem
              accessibilityLabel={item.title}
              closeOnPress={false}
              label={item.title}
              value={fontSelectionValue(item.ref)}
              showSeparator={!isLast}
              groupPosition={isFirst ? (isLast ? 'single' : 'first') : isLast ? 'last' : 'middle'}
              labelProps={{
                numberOfLines: 1,
                style: item.previewFamily ? { fontFamily: item.previewFamily } : undefined,
              }}
            />
          );
        }}
        showsVerticalScrollIndicator={false}
      />
    </SelectRoot>
  );
}

function builtinOption(title: string): FontOption {
  return {
    kind: 'option',
    key: `builtin:${LUNAR_READER_BUILTIN_FONT_REF.family}`,
    ref: LUNAR_READER_BUILTIN_FONT_REF,
    title,
  };
}

function importedOptions(fonts: readonly ImportedReaderFont[]): readonly FontOption[] {
  // The catalog id is the file's digest, so selecting a font whose bytes changed
  // selects different bytes — and Rito's pinned set is rebuilt to match.
  return fonts.map((font) => ({
    kind: 'option',
    key: `imported:${font.id}`,
    ref: { source: 'imported', family: font.family, importedFontId: font.id },
    title: font.family,
  }));
}

function systemOption(family: string): FontOption {
  return {
    kind: 'option',
    key: `system:${family}`,
    ref: { source: 'system', family },
    title: family,
    previewFamily: family,
  };
}

function fontSelectionValue(ref: ReaderFontRef): string {
  return JSON.stringify([ref.source, ref.family, ref.importedFontId ?? '']);
}
