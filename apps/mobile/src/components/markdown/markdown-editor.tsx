import { MarkdownTextInput, type MarkdownStyle } from '@expensify/react-native-live-markdown';
import { useThemeColor } from 'heroui-native/hooks';
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
} from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useCSSVariable, withUniwind } from 'uniwind';
import { parseLiveMarkdown } from './live-markdown-parser';
import { formatMarkdown, formatMarkdownSelection, type MarkdownFormat, type MarkdownSelection } from './markdown-edit';
import { MarkdownToolbar, type MarkdownToolbarLabels } from './markdown-toolbar';

const LiveMarkdownInput = withUniwind(MarkdownTextInput);

export type MarkdownEditorProps = Omit<
  ComponentProps<typeof LiveMarkdownInput>,
  'parser' | 'markdownStyle' | 'selection' | 'formatSelection'
> & {
  readonly toolbarLabels?: MarkdownToolbarLabels;
};

/** Controlled Markdown input; the caller owns the draft, persistence and container. */
export function MarkdownEditor({
  className,
  maxLength,
  toolbarLabels,
  ref,
  onChangeText,
  onSelectionChange,
  ...props
}: MarkdownEditorProps) {
  const inputRef = useRef<ComponentRef<typeof LiveMarkdownInput>>(null);
  const [selection, setSelection] = useState<MarkdownSelection>({ start: 0, end: 0 });
  useImperativeHandle(ref, () => inputRef.current!, []);
  const handleFormatSelection = useCallback(
    (text: string, start: number, end: number, command: string) =>
      formatMarkdownSelection(text, start, end, command, maxLength),
    [maxLength],
  );
  function applyFormat(format: MarkdownFormat) {
    if (props.editable === false || typeof props.value !== 'string' || !onChangeText) return;
    // Native toolbar actions and the library's Web format commands share the
    // same bold/italic callback. Other toolbar formats use the same edit helper.
    const result =
      format === 'bold' || format === 'italic'
        ? handleFormatSelection(
            props.value,
            selection.start,
            selection.end,
            format === 'bold' ? 'formatBold' : 'formatItalic',
          )
        : undefined;
    const edit = result
      ? { value: result.updatedText, selection: result.selection }
      : formatMarkdown(props.value, selection, format, maxLength);
    if (edit.value === props.value) return;
    inputRef.current?.focus();
    onChangeText(edit.value);
    setSelection(edit.selection);
  }
  const [foreground, muted, background, border] = useThemeColor(['foreground', 'muted', 'default', 'border']);
  const link = useCSSVariable('--color-navigation-active') as string;
  const parser = useCallback(
    (input: string) => {
      'worklet';
      return parseLiveMarkdown(input, maxLength);
    },
    [maxLength],
  );
  const markdownStyle = useMemo<MarkdownStyle>(
    () => ({
      syntax: { color: muted },
      link: { color: link },
      blockquote: { borderColor: border },
      code: { color: foreground, backgroundColor: background, borderColor: border },
      pre: { color: foreground, backgroundColor: background, borderColor: border },
    }),
    [background, border, foreground, link, muted],
  );
  const input = (
    <LiveMarkdownInput
      multiline
      textAlignVertical="top"
      placeholderTextColorClassName="accent-muted"
      selectionColorClassName="accent-navigation-active"
      {...props}
      ref={inputRef}
      onChangeText={onChangeText}
      selection={selection}
      formatSelection={handleFormatSelection}
      onSelectionChange={(event) => {
        const next = event.nativeEvent.selection;
        setSelection((current) => (current.start === next.start && current.end === next.end ? current : next));
        onSelectionChange?.(event);
      }}
      className={twMerge('bg-transparent text-base leading-6 text-foreground', className)}
      maxLength={maxLength}
      parser={parser}
      markdownStyle={markdownStyle}
    />
  );
  return toolbarLabels ? (
    <View className="min-h-0 flex-1">
      <MarkdownToolbar
        labels={toolbarLabels}
        disabled={props.editable === false || typeof props.value !== 'string' || !onChangeText}
        onFormat={applyFormat}
      />
      {input}
    </View>
  ) : (
    input
  );
}
