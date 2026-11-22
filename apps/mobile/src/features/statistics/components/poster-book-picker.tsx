import { Image as ExpoImage } from 'expo-image';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useCSSVariable, withUniwind } from 'uniwind';
import { Icon } from '@/components/ui/icon';
import { useTranslation } from '@/i18n';
import type { StatisticsBook } from '../domain/statistics';

const Image = withUniwind(ExpoImage);

/** Picks the books shown on the poster; changes apply only on confirmation. */
export function PosterBookPicker({
  books,
  excluded,
  maxHeight,
  onBack,
  onApply,
}: {
  books: readonly StatisticsBook[];
  excluded: ReadonlySet<string>;
  maxHeight: number;
  onBack: () => void;
  onApply: (excluded: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const iconColor = useThemeColor('foreground');
  const [draft, setDraft] = useState(() => new Set(excluded));
  const shown = books.length - draft.size;
  const toggle = useCallback((id: string) => {
    setDraft((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return (
    <View style={{ maxHeight }}>
      <View className="flex-row items-center justify-between px-3 pb-1">
        <Button
          accessibilityLabel={t('statistics.posterBackToSettings')}
          isIconOnly
          onPress={onBack}
          size="sm"
          variant="ghost">
          <Icon name="back" size={21} color={iconColor} />
        </Button>
        <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">
          {t('statistics.posterChooseBooks')}
        </Text>
        <Button isDisabled={!shown} onPress={() => onApply(draft)} size="sm" variant="ghost">
          <Button.Label className={shown ? 'text-navigation-active' : undefined}>
            {t('statistics.posterCropApply')}
          </Button.Label>
        </Button>
      </View>
      <View className="flex-row items-center justify-between px-6 pb-2">
        <Text className={`text-sm ${shown ? 'text-muted' : 'text-danger'}`}>
          {shown
            ? t('statistics.posterSelected', { selected: shown, total: books.length })
            : t('statistics.posterEmptySelection')}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => setDraft(draft.size ? new Set() : new Set(books.map((book) => book.id)))}>
          <Button.Label className="text-navigation-active">
            {t(draft.size ? 'statistics.posterAll' : 'statistics.posterNone')}
          </Button.Label>
        </Button>
      </View>
      <FlatList
        data={books}
        keyExtractor={(book) => book.id}
        extraData={draft}
        initialNumToRender={8}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-5 pb-4"
        renderItem={({ item: book }) => <BookRow book={book} checked={!draft.has(book.id)} onToggle={toggle} />}
      />
    </View>
  );
}

function BookRow({
  book,
  checked,
  onToggle,
}: {
  book: StatisticsBook;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const activeColor = useCSSVariable('--color-navigation-active') as string;
  const mutedColor = useThemeColor('muted');
  return (
    <PressableFeedback
      accessibilityRole="checkbox"
      accessibilityLabel={book.title}
      accessibilityState={{ checked }}
      className="flex-row items-center gap-3 rounded-2xl px-2 py-2.5"
      onPress={() => onToggle(book.id)}>
      {book.coverUri ? (
        <Image source={book.coverUri} contentFit="cover" className="h-14 w-10 rounded-md" accessible={false} />
      ) : (
        <View className="h-14 w-10 items-center justify-center rounded-md bg-default">
          <Text className="text-muted">{book.title.slice(0, 1)}</Text>
        </View>
      )}
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={2} className="text-sm font-medium text-foreground">
          {book.title}
        </Text>
        <Text numberOfLines={1} className="text-xs text-muted">
          {book.author || t('statistics.posterUnknownAuthor')}
        </Text>
      </View>
      <Icon name={checked ? 'checkCircle' : 'circle'} size={24} color={checked ? activeColor : mutedColor} />
    </PressableFeedback>
  );
}
