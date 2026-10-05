import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { ScrollView } from 'react-native';
import { MarkdownFormats, type MarkdownFormat } from './markdown-edit';

export type MarkdownToolbarLabels = Readonly<Record<MarkdownFormat, string>>;
export interface MarkdownToolbarProps {
  readonly labels: MarkdownToolbarLabels;
  readonly disabled?: boolean;
  readonly onFormat: (format: MarkdownFormat) => void;
}
const Icons: Record<MarkdownFormat, SymbolViewProps['name']> = {
  bold: { ios: 'bold', android: 'format_bold', web: 'format_bold' },
  italic: { ios: 'italic', android: 'format_italic', web: 'format_italic' },
  strikethrough: { ios: 'strikethrough', android: 'strikethrough_s', web: 'strikethrough_s' },
  code: { ios: 'chevron.left.forwardslash.chevron.right', android: 'code', web: 'code' },
  heading: { ios: 'textformat.size', android: 'title', web: 'title' },
  quote: { ios: 'text.quote', android: 'format_quote', web: 'format_quote' },
  codeBlock: { ios: 'curlybraces', android: 'data_object', web: 'data_object' },
  link: { ios: 'link', android: 'link', web: 'link' },
};

export function MarkdownToolbar({ labels, disabled, onFormat }: MarkdownToolbarProps) {
  const foreground = useThemeColor('foreground');
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      showsHorizontalScrollIndicator={false}
      className="max-h-11 grow-0 border-b border-border dark:border-muted/40"
      contentContainerClassName="items-center gap-1">
      {MarkdownFormats.map((format) => (
        <Button
          key={format}
          isIconOnly
          size="sm"
          variant="ghost"
          className="size-10"
          accessibilityLabel={labels[format]}
          isDisabled={disabled}
          onPress={() => onFormat(format)}>
          <SymbolView name={Icons[format]} size={20} tintColor={foreground} />
        </Button>
      ))}
    </ScrollView>
  );
}
