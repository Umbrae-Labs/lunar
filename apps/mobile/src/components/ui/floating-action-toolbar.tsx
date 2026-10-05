import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { View } from 'react-native';

const MAX_ACTIONS_PER_ROW = 5;

export interface FloatingToolbarAction {
  readonly key: string;
  readonly label: string;
  readonly icon: SymbolViewProps['name'];
  readonly isDisabled?: boolean;
  readonly isDestructive?: boolean;
  readonly onPress: () => void;
}

interface FloatingActionToolbarProps {
  readonly accessibilityLabel: string;
  readonly actions: readonly FloatingToolbarAction[];
  readonly bottom: number;
}

export function FloatingActionToolbar({ accessibilityLabel, actions, bottom }: FloatingActionToolbarProps) {
  const [foreground, danger] = useThemeColor(['foreground', 'danger']);
  const rows = chunkActions(actions);

  return (
    <View className="absolute inset-x-3 z-20 items-center" pointerEvents="box-none" style={{ bottom }}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="toolbar"
        className="w-full max-w-[440px] rounded-[32px] border border-border bg-surface p-1">
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} className="min-h-14 flex-row items-center">
            {row.map((action) => {
              const color = action.isDestructive ? danger : foreground;
              return (
                <Button
                  key={action.key}
                  accessibilityLabel={action.label}
                  className="h-14 min-w-0 flex-1 rounded-full px-1"
                  isDisabled={action.isDisabled}
                  onPress={action.onPress}
                  size="sm"
                  variant="ghost">
                  <View className="items-center justify-center gap-px">
                    <SymbolView name={action.icon} size={21} tintColor={color} />
                    <Button.Label
                      adjustsFontSizeToFit
                      className={
                        action.isDestructive
                          ? 'text-[11px] leading-4 text-danger'
                          : 'text-[11px] leading-4 text-foreground'
                      }
                      minimumFontScale={0.75}
                      numberOfLines={1}>
                      {action.label}
                    </Button.Label>
                  </View>
                </Button>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function chunkActions(actions: readonly FloatingToolbarAction[]): readonly (readonly FloatingToolbarAction[])[] {
  const rows: FloatingToolbarAction[][] = [];
  for (let index = 0; index < actions.length; index += MAX_ACTIONS_PER_ROW) {
    rows.push(actions.slice(index, index + MAX_ACTIONS_PER_ROW));
  }
  return rows;
}
