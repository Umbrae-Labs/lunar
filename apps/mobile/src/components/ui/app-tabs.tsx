import { BlurTargetView } from 'expo-blur';
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import type { Href } from 'expo-router';
import { useRef, type RefObject } from 'react';
import { Pressable, Text, View, type PressableProps, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useResolveClassNames, withUniwind } from 'uniwind';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { FrostedBackground } from './frosted-background';
import { Icon, type IconSource } from './icon';

/** A bottom navigation entry contributed next to the built-in tabs. */
export interface AppTabItem {
  /** Unique trigger name. */
  readonly name: string;
  /** A route inside the tabs group. */
  readonly href: Href;
  readonly label: string;
  readonly icon: IconSource;
}

interface AppTabsProps {
  /** Entries placed between the built-in content tabs and the management tabs. */
  readonly extraTabs?: readonly AppTabItem[];
}

const TAB_ICONS = {
  library: 'library',
  statistics: 'chart',
  plugins: 'extension',
  settings: 'settings',
} as const satisfies Record<string, IconSource>;

export const APP_TAB_BAR_HEIGHT = 58;

const TabContentBlurTarget = withUniwind(BlurTargetView);

export default function AppTabs({ extraTabs = [] }: AppTabsProps) {
  const { t } = useTranslation();
  const tabsStyle = useResolveClassNames('flex-1');
  const tabSlotStyle = useResolveClassNames('h-full');
  const contentRef = useRef<View>(null);
  const leading: AppTabItem[] = [
    { name: 'library', href: '/library' as Href, label: t('tabs.library'), icon: TAB_ICONS.library },
    { name: 'statistics', href: '/statistics' as Href, label: t('tabs.statistics'), icon: TAB_ICONS.statistics },
  ];
  const trailing: AppTabItem[] = [
    { name: 'plugins', href: '/plugins' as Href, label: t('tabs.plugins'), icon: TAB_ICONS.plugins },
    { name: 'settings', href: '/settings', label: t('tabs.settings'), icon: TAB_ICONS.settings },
  ];

  return (
    <Tabs style={tabsStyle}>
      <TabContentBlurTarget ref={contentRef} className="flex-1 bg-background">
        <TabSlot style={tabSlotStyle} />
      </TabContentBlurTarget>
      <TabList asChild>
        <AppTabBar blurTarget={contentRef}>
          {[...leading, ...extraTabs, ...trailing].map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TriggerButton label={tab.label} icon={tab.icon} />
            </TabTrigger>
          ))}
        </AppTabBar>
      </TabList>
    </Tabs>
  );
}

function TriggerButton({ isFocused = false, ...props }: TabTriggerSlotProps & { label: string; icon: IconSource }) {
  return <AppTabButton {...props} isFocused={isFocused} />;
}

type AppTabButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  readonly isFocused: boolean;
  readonly label: string;
  readonly icon: IconSource;
};

/** A bottom bar button; also used by screens that draw their own tab bar. */
export function AppTabButton({ isFocused, label, icon, ...props }: AppTabButtonProps) {
  const theme = useTheme();
  const activeColor = useCSSVariable('--color-navigation-active') as string;
  const tabButtonStyle = useResolveClassNames('h-[58px] flex-1 items-center justify-center gap-0.5');
  const pressedTabButtonStyle = useResolveClassNames('opacity-[0.58]');
  const color = isFocused ? activeColor : theme.textSecondary;

  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      hitSlop={6}
      style={({ pressed }) => [tabButtonStyle, pressed && pressedTabButtonStyle]}>
      <Icon name={icon} size={24} color={color} strokeWidth={isFocused ? 2 : undefined} />
      <Text
        numberOfLines={1}
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

type AppTabBarProps = ViewProps & {
  /**
   * Content that scrolls beneath the bar. Android only blurs a registered
   * `BlurTargetView`; without one the bar falls back to a translucent tint.
   */
  readonly blurTarget?: RefObject<View | null>;
};

/** The frosted bottom bar surface, pinned to the screen edge above the safe area. */
export function AppTabBar({ style, blurTarget, children, ...props }: AppTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      accessibilityRole="tablist"
      className="absolute inset-x-0 bottom-0 flex-row items-start overflow-hidden border-t border-border/40"
      style={[{ height: APP_TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }, style]}>
      <FrostedBackground blurTarget={blurTarget} />
      {children}
    </View>
  );
}
