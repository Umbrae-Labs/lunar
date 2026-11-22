import { useThemeColor } from 'heroui-native/hooks';
import { Switch, type SwitchProps } from 'heroui-native/switch';
import { useMemo } from 'react';
import { useCSSVariable } from 'uniwind';

export type ToggleSwitchProps = Omit<SwitchProps, 'children' | 'animation'>;

/** Switch whose selected track uses the shared activation blue. */
export function ToggleSwitch({ className = 'h-7 w-12', ...props }: ToggleSwitchProps) {
  const trackColor = useThemeColor('default');
  const [activeColor, thumbColor] = useCSSVariable([
    '--color-navigation-active',
    '--color-navigation-active-foreground',
  ]) as [string, string];
  const trackAnimation = useMemo(
    () => ({ backgroundColor: { value: [trackColor, activeColor] as [string, string] } }),
    [activeColor, trackColor],
  );
  const thumbAnimation = useMemo(
    () => ({ backgroundColor: { value: [thumbColor, thumbColor] as [string, string] } }),
    [thumbColor],
  );

  return (
    <Switch {...props} animation={trackAnimation} className={className}>
      <Switch.Thumb animation={thumbAnimation} className="size-5" />
    </Switch>
  );
}
