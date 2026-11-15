import { Button } from 'heroui-native/button';
import { memo, type RefObject } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { FrostedBackground } from '@/components/ui/frosted-background';
import { Icon, type IconSource } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

// Keep the reader's bottom navigation compact while retaining a consistent
// interactive target for each tab.
export const TabBarContentHeight = 40;
export const TabBarTopPadding = 4;
export const TabBarBottomPadding = 4;
export const TabBarHeight = TabBarTopPadding + TabBarContentHeight + TabBarBottomPadding;

export interface TabBarItem {
  readonly key: string;
  readonly accessibilityLabel: string;
  readonly name: IconSource;
  readonly isDisabled?: boolean;
}

interface TabBarProps {
  readonly items: readonly TabBarItem[];
  readonly activeKey?: string;
  readonly onSelect: (key: string) => void;
  readonly safeAreaInsets?: EdgeInsets;
  /** Reader content blurred beneath the bar. */
  readonly blurTarget?: RefObject<View | null>;
}

export const TabBar = memo(function TabBar({ items, activeKey, onSelect, safeAreaInsets, blurTarget }: TabBarProps) {
  const contextInsets = useSafeAreaInsets();
  const insets = safeAreaInsets ?? contextInsets;
  const theme = useTheme();
  const activeColor = useCSSVariable('--color-navigation-active') as string;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-50 overflow-hidden px-3"
      pointerEvents="box-none"
      style={{
        paddingTop: TabBarTopPadding,
        paddingBottom: insets.bottom + TabBarBottomPadding,
      }}>
      <FrostedBackground blurTarget={blurTarget} />
      <View className="w-full flex-row items-center" style={{ height: TabBarContentHeight }}>
        {items.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <Button
              key={item.key}
              accessibilityLabel={item.accessibilityLabel}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              className="h-10 flex-1 rounded-lg px-0"
              isDisabled={item.isDisabled}
              onPress={() => onSelect(item.key)}
              size="sm"
              variant="ghost">
              <Icon name={item.name} size={22} color={isActive ? activeColor : theme.textSecondary} />
            </Button>
          );
        })}
      </View>
    </View>
  );
});
