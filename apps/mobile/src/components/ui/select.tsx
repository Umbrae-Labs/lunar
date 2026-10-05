import { Select, type SelectItemLabelProps, type SelectItemProps as HeroSelectItemProps } from 'heroui-native/select';
import { Separator } from 'heroui-native/separator';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useCSSVariable } from 'uniwind';

/** Selection context for lists embedded in an existing surface. */
export const SelectRoot = Select;

type SelectGroupPosition = 'single' | 'first' | 'middle' | 'last';

const GROUP_CORNERS: Record<SelectGroupPosition, string> = {
  single: 'rounded-2xl',
  first: 'rounded-t-2xl',
  middle: '',
  last: 'rounded-b-2xl',
};

export type SelectItemProps = Omit<HeroSelectItemProps, 'children' | 'asChild'> & {
  readonly labelProps?: Pick<SelectItemLabelProps, 'style' | 'numberOfLines'>;
  readonly showSeparator?: boolean;
  /** Adjacent virtualized rows form one continuous group surface. */
  readonly groupPosition?: SelectGroupPosition;
};

export function SelectItem({
  labelProps,
  showSeparator = false,
  groupPosition = 'single',
  className,
  ...props
}: SelectItemProps) {
  const activeColor = useCSSVariable('--color-navigation-active') as string;

  return (
    <View className={twMerge('overflow-hidden bg-surface dark:bg-surface-secondary', GROUP_CORNERS[groupPosition])}>
      <Select.Item
        {...props}
        className={twMerge(
          'min-h-14 px-4 py-4 active:bg-surface-secondary dark:active:bg-surface-tertiary',
          className,
        )}>
        {({ isSelected }) => (
          <>
            <Select.ItemLabel
              {...labelProps}
              className={isSelected ? 'min-w-0 text-navigation-active' : 'min-w-0 text-foreground'}
            />
            <Select.ItemIndicator iconProps={{ color: activeColor }} />
          </>
        )}
      </Select.Item>
      {showSeparator ? <Separator className="mx-4 bg-border dark:bg-surface-tertiary/60" /> : null}
    </View>
  );
}

export interface SelectOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
}

export interface SelectSheetProps<Value extends string> {
  readonly title: string;
  readonly options: readonly SelectOption<Value>[];
  readonly value: Value;
  readonly isOpen: boolean;
  readonly onValueChange: (value: Value) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** A short single-choice list presented as a bottom sheet. */
export function SelectSheet<Value extends string>({
  title,
  options,
  value,
  isOpen,
  onValueChange,
  onOpenChange,
}: SelectSheetProps<Value>) {
  return (
    <Select
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onValueChange={(selected) => {
        const option = options.find((item) => item.value === selected?.value);
        if (option) onValueChange(option.value);
      }}
      presentation="bottom-sheet"
      value={options.find((option) => option.value === value)}>
      <Select.Portal unstable_accessibilityContainerViewIsModal>
        <Select.Overlay />
        <Select.Content
          backgroundClassName="bg-background dark:bg-surface"
          contentContainerClassName="px-6 pb-8"
          presentation="bottom-sheet"
          snapPoints={['35%']}>
          <Select.ListLabel className="mb-2 text-xl text-foreground">{title}</Select.ListLabel>
          {options.map((option, index) => (
            <SelectItem
              key={option.value}
              label={option.label}
              value={option.value}
              showSeparator={index < options.length - 1}
              groupPosition={
                options.length === 1
                  ? 'single'
                  : index === 0
                    ? 'first'
                    : index === options.length - 1
                      ? 'last'
                      : 'middle'
              }
            />
          ))}
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
