import { Tabs, TabList, TabSlot, TabTrigger, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import type { Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useResolveClassNames } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';

type TabType = 'library' | 'statistics' | 'plugins' | 'settings';

type TabButtonProps = TabTriggerSlotProps & {
  label: string;
  type: TabType;
};

const TAB_ICONS: Record<TabType, { readonly ios: string; readonly iosFocused: string; readonly android: string }> = {
  library: { ios: 'books.vertical', iosFocused: 'books.vertical.fill', android: 'menu_book' },
  statistics: { ios: 'chart.bar', iosFocused: 'chart.bar.fill', android: 'bar_chart' },
  plugins: { ios: 'puzzlepiece.extension', iosFocused: 'puzzlepiece.extension.fill', android: 'extension' },
  settings: { ios: 'gearshape', iosFocused: 'gearshape.fill', android: 'settings' },
};

export const APP_TAB_BAR_HEIGHT = 58;

export default function AppTabs() {
  const { t } = useTranslation();
  const tabsStyle = useResolveClassNames('flex-1');
  const tabSlotStyle = useResolveClassNames('h-full');

  return (
    <Tabs style={tabsStyle}>
      <TabSlot style={tabSlotStyle} />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="library" href={'/library' as Href} asChild>
            <TabButton label={t('tabs.library')} type="library" />
          </TabTrigger>
          <TabTrigger name="statistics" href={'/statistics' as Href} asChild>
            <TabButton label={t('tabs.statistics')} type="statistics" />
          </TabTrigger>
          <TabTrigger name="plugins" href={'/plugins' as Href} asChild>
            <TabButton label={t('tabs.plugins')} type="plugins" />
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton label={t('tabs.settings')} type="settings" />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

function TabButton({ isFocused, label, type, ...props }: TabButtonProps) {
  const theme = useTheme();
  const activeColor = useCSSVariable('--color-navigation-active') as string;
  const tabButtonStyle = useResolveClassNames('h-[58px] flex-1 items-center justify-center gap-0.5');
  const pressedTabButtonStyle = useResolveClassNames('opacity-[0.58]');
  const color = isFocused ? activeColor : theme.textSecondary;
  const icon = TAB_ICONS[type];
  const iconName = {
    ios: isFocused ? icon.iosFocused : icon.ios,
    android: icon.android,
    web: icon.android,
  } as SymbolViewProps['name'];

  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [tabButtonStyle, pressed && pressedTabButtonStyle]}>
      <SymbolView name={iconName} size={24} tintColor={color} />
      <Text
        className={
          isFocused
            ? 'text-[10px] font-medium leading-[13px] text-navigation-active'
            : 'text-[10px] font-medium leading-[13px] text-muted'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

function TabBar({ style, ...props }: TabListProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      {...props}
      className="absolute inset-x-0 bottom-0 flex-row items-start bg-surface"
      style={[{ height: APP_TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }, style]}>
      {props.children}
    </View>
  );
}
