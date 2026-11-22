import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon, type IconSource } from '@/components/ui/icon';

/** A round icon action with a caption, matching the excerpt sharing drawer. */
export function PosterAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconSource;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Button
      accessibilityLabel={label}
      className="h-24 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-1 py-2"
      isDisabled={disabled}
      onPress={onPress}
      size="sm"
      variant="ghost">
      <View className="size-11 items-center justify-center rounded-full bg-surface-secondary dark:bg-surface-tertiary">
        <Icon name={icon} size={23} color={foreground} />
      </View>
      <Button.Label className="text-center text-xs leading-4 text-muted" numberOfLines={2}>
        {label}
      </Button.Label>
    </Button>
  );
}

export function PosterOptionSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="px-1 text-sm font-semibold text-muted">{label}</Text>
      {children}
    </View>
  );
}

export function PosterOptionRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-3 px-1">
      {children}
    </ScrollView>
  );
}

export function PosterOption({
  label,
  selected = false,
  disabled,
  onPress,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityState={{ selected, disabled }}
      className={`h-12 min-w-24 rounded-xl border bg-surface px-4 dark:bg-surface-secondary ${selected ? 'border-navigation-active' : 'border-border'}`}
      isDisabled={disabled}
      onPress={onPress}
      size="sm"
      variant="ghost">
      <Button.Label className={selected ? 'text-navigation-active' : undefined}>{label}</Button.Label>
    </Button>
  );
}
