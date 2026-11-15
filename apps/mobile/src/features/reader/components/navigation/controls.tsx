import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { memo, type RefObject } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { FrostedBackground } from '@/components/ui/frosted-background';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';

const ControlHorizontalPadding = 12;

/** A trailing toolbar button; built-in and extension actions share this shape. */
export interface ReaderToolbarAction {
  readonly key: string;
  readonly accessibilityLabel: string;
  readonly name: SymbolViewProps['name'];
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
}

interface ControlsProps {
  readonly bookTitle: string;
  readonly onBack: () => void;
  readonly actions?: readonly ReaderToolbarAction[];
  readonly safeAreaInsets?: EdgeInsets;
  /** Reader content blurred beneath the toolbar. */
  readonly blurTarget?: RefObject<View | null>;
}

const EmptyActions: readonly ReaderToolbarAction[] = [];

export const Controls = memo(function Controls({
  bookTitle,
  onBack,
  actions = EmptyActions,
  safeAreaInsets,
  blurTarget,
}: ControlsProps) {
  const { t } = useTranslation();
  const contextInsets = useSafeAreaInsets();
  const insets = safeAreaInsets ?? contextInsets;

  return (
    <View className="absolute inset-0 overflow-hidden" pointerEvents="box-none">
      <View
        className="w-full self-stretch overflow-hidden pb-2"
        style={{
          paddingTop: insets.top,
          paddingLeft: Math.max(insets.left, ControlHorizontalPadding),
          paddingRight: Math.max(insets.right, ControlHorizontalPadding),
        }}>
        <FrostedBackground blurTarget={blurTarget} />
        <View className="h-12 w-full flex-row items-center gap-2">
          <IconButton
            accessibilityLabel={t('reader.backToLibrary')}
            name={{ ios: 'chevron.backward', android: 'arrow_back', web: 'arrow_back' }}
            onPress={onBack}
          />
          {/* Balance the trailing actions so the title stays centred. */}
          {actions.slice(1).map((action) => (
            <View key={action.key} className="size-10" />
          ))}
          <Text className="min-w-0 flex-1 text-center text-base font-semibold text-foreground" numberOfLines={1}>
            {bookTitle}
          </Text>
          {actions.length === 0 ? (
            <View className="size-10" />
          ) : (
            actions.map((action) => (
              <IconButton
                key={action.key}
                accessibilityLabel={action.accessibilityLabel}
                isDisabled={action.isDisabled}
                name={action.name}
                onPress={action.onPress}
              />
            ))
          )}
        </View>
      </View>
    </View>
  );
});

interface IconButtonProps {
  readonly accessibilityLabel: string;
  readonly name: SymbolViewProps['name'];
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
}

function IconButton({ accessibilityLabel, name, onPress, isDisabled }: IconButtonProps) {
  const theme = useTheme();
  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      className="size-10 rounded-full"
      isDisabled={isDisabled}
      isIconOnly
      onPress={onPress}
      size="sm"
      variant="ghost">
      <SymbolView name={name} size={20} tintColor={theme.text} />
    </Button>
  );
}
