import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { memo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';

// Keep the reader's bottom navigation compact while retaining a consistent
// interactive target for each tab.
export const IconTabBarContentHeight = 40;
export const IconTabBarTopPadding = 4;
export const IconTabBarBottomPadding = 4;
export const IconTabBarHeight = IconTabBarTopPadding + IconTabBarContentHeight + IconTabBarBottomPadding;

export interface IconTabBarItem {
  readonly key: string;
  readonly accessibilityLabel: string;
  readonly name: SymbolViewProps['name'];
  readonly isDisabled?: boolean;
}

interface IconTabBarProps {
  readonly items: readonly IconTabBarItem[];
  readonly activeKey?: string;
  readonly onSelect: (key: string) => void;
  readonly safeAreaInsets?: EdgeInsets;
}

export const IconTabBar = memo(function IconTabBar({ items, activeKey, onSelect, safeAreaInsets }: IconTabBarProps) {
  const contextInsets = useSafeAreaInsets();
  const insets = safeAreaInsets ?? contextInsets;
  const theme = useTheme();
  const activeColor = useCSSVariable('--color-navigation-active') as string;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-50 bg-surface px-3"
      pointerEvents="box-none"
      style={{
        paddingTop: IconTabBarTopPadding,
        paddingBottom: insets.bottom + IconTabBarBottomPadding,
      }}>
      <View className="w-full flex-row items-center" style={{ height: IconTabBarContentHeight }}>
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
              <SymbolView name={item.name} size={22} tintColor={isActive ? activeColor : theme.textSecondary} />
            </Button>
          );
        })}
      </View>
    </View>
  );
});
