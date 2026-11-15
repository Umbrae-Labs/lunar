import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { ScrollView } from 'react-native';

import { Icon, type IconSource } from '@/components/ui/icon';
import { MarkdownFormats, type MarkdownFormat } from './markdown-edit';

export type MarkdownToolbarLabels = Readonly<Record<MarkdownFormat, string>>;
export interface MarkdownToolbarProps {
  readonly labels: MarkdownToolbarLabels;
  readonly disabled?: boolean;
  readonly onFormat: (format: MarkdownFormat) => void;
}
const Icons: Record<MarkdownFormat, IconSource> = {
  bold: 'bold',
  italic: 'italic',
  strikethrough: 'strikethrough',
  code: 'code',
  heading: 'heading',
  quote: 'quoteBlock',
  codeBlock: 'codeBlock',
  link: 'link',
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
          <Icon name={Icons[format]} size={20} color={foreground} />
        </Button>
      ))}
    </ScrollView>
  );
}
