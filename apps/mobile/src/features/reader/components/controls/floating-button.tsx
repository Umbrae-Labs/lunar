import { useThemeColor } from 'heroui-native/hooks';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/ui/icon';
import type { ReaderFloatingButtonPosition } from '@/stores';
import type { ReaderExtensionFloatingAction } from '../../extensions/reader-extensions';

const ButtonSize = 48;
const EdgeMargin = 12;
const Spring = { damping: 20, stiffness: 220 } as const;

interface ReaderFloatingButtonProps {
  readonly actions: readonly ReaderExtensionFloatingAction[];
  /** Size of the reader surface the button floats over. */
  readonly width: number;
  readonly height: number;
  /** Space covered by system bars and visible reader controls; the button stays clear of it. */
  readonly insets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly position: ReaderFloatingButtonPosition;
  readonly onPositionChange: (position: ReaderFloatingButtonPosition) => void;
  /** Names the button when it opens a list of several entries. */
  readonly menuLabel: string;
  readonly closeMenuLabel: string;
}

/**
 * The reader's floating button. One entry runs on press; several open a list beside the button.
 * Dragging moves the button, which then settles at the nearer side edge.
 */
export const ReaderFloatingButton = memo(function ReaderFloatingButton({
  actions,
  width,
  height,
  insets,
  position,
  onPositionChange,
  menuLabel,
  closeMenuLabel,
}: ReaderFloatingButtonProps) {
  const [open, setOpen] = useState(false);
  const foreground = useThemeColor('foreground');
  const single = actions.length === 1 ? actions[0] : undefined;
  const badge = single ? single.badge : actions.some((action) => action.badge) ? '' : undefined;

  const minY = insets.top + EdgeMargin;
  const maxY = Math.max(minY, height - insets.bottom - EdgeMargin - ButtonSize);
  const leftX = insets.left + EdgeMargin;
  const rightX = Math.max(leftX, width - insets.right - EdgeMargin - ButtonSize);
  const restX = position.side === 'left' ? leftX : rightX;
  const restY = minY + position.offset * (maxY - minY);

  const x = useSharedValue(restX);
  const y = useSharedValue(restY);
  const origin = useSharedValue({ x: restX, y: restY });
  // Controls showing or the screen turning moves the resting place; the button follows.
  useEffect(() => {
    x.set(withSpring(restX, Spring));
    y.set(withSpring(restY, Spring));
  }, [restX, restY, x, y]);

  const press = useCallback(() => {
    if (single) single.onPress();
    else setOpen((current) => !current);
  }, [single]);
  const settle = useCallback(
    (side: 'left' | 'right', top: number) => {
      onPositionChange({ side, offset: maxY > minY ? (top - minY) / (maxY - minY) : 0 });
    },
    [maxY, minY, onPositionChange],
  );

  const gesture = useMemo(() => {
    const drag = Gesture.Pan()
      .minDistance(8)
      .maxPointers(1)
      .onStart(() => {
        'worklet';
        origin.set({ x: x.value, y: y.value });
      })
      .onUpdate((event) => {
        'worklet';
        x.set(Math.min(Math.max(origin.value.x + event.translationX, leftX), rightX));
        y.set(Math.min(Math.max(origin.value.y + event.translationY, minY), maxY));
      })
      .onEnd(() => {
        'worklet';
        const side = x.value + ButtonSize / 2 < width / 2 ? 'left' : 'right';
        x.set(withSpring(side === 'left' ? leftX : rightX, Spring));
        scheduleOnRN(settle, side, y.value);
      });
    const tap = Gesture.Tap()
      .maxDuration(400)
      .onEnd((_event, success) => {
        'worklet';
        if (success) scheduleOnRN(press);
      });
    return Gesture.Exclusive(drag, tap);
  }, [leftX, maxY, minY, origin, press, rightX, settle, width, x, y]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  // The list opens toward the middle of the screen, away from the edge the button rests on.
  const menuSide = position.side === 'left' ? 'left-14' : 'right-14';
  const menuVertical = restY > height / 2 ? 'bottom-0' : 'top-0';

  return (
    <View className="absolute inset-0" pointerEvents="box-none">
      {open && !single ? (
        <Pressable
          accessibilityLabel={closeMenuLabel}
          accessibilityRole="button"
          className="absolute inset-0"
          onPress={() => setOpen(false)}
        />
      ) : null}
      <Animated.View className="absolute left-0 top-0" pointerEvents="box-none" style={style}>
        <GestureDetector gesture={gesture}>
          <Animated.View
            accessible
            accessibilityActions={[{ name: 'activate' }]}
            accessibilityLabel={single?.accessibilityLabel ?? menuLabel}
            accessibilityRole="button"
            accessibilityState={single ? undefined : { expanded: open }}
            accessibilityValue={single?.badge ? { text: single.badge } : undefined}
            className="size-12 items-center justify-center rounded-full border border-border bg-surface"
            onAccessibilityAction={press}>
            <Icon name={single?.name ?? 'extension'} size={22} color={foreground} />
            {badge !== undefined ? <Badge text={badge} /> : null}
          </Animated.View>
        </GestureDetector>
        {open && !single ? (
          <Animated.View
            accessibilityRole="menu"
            className={`absolute ${menuSide} ${menuVertical} w-56 gap-1 rounded-3xl border border-border bg-surface p-1`}
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(120)}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                accessibilityLabel={action.accessibilityLabel}
                accessibilityRole="menuitem"
                accessibilityValue={action.badge ? { text: action.badge } : undefined}
                className="min-h-12 flex-row items-center gap-3 rounded-full px-3 active:bg-surface-secondary"
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}>
                <Icon name={action.name} size={20} color={foreground} />
                <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                  {action.accessibilityLabel}
                </Text>
                {action.badge ? (
                  <Text className="text-xs font-semibold text-accent" numberOfLines={1}>
                    {action.badge}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
});

/** A count next to the button, or a dot when several entries have something to show. */
function Badge({ text }: { readonly text: string }) {
  return (
    <View
      className={
        text
          ? 'absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1'
          : 'absolute right-0 top-0 size-3 rounded-full bg-accent'
      }
      importantForAccessibility="no-hide-descendants">
      {text ? (
        <Text className="text-[11px] font-semibold leading-4 text-accent-foreground" numberOfLines={1}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}
