import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Fragment, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { ReaderSelectionDragController } from '../../hooks/selection/use-reader-selection-drag';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { Icon, type IconSource } from '@/components/ui/icon';
import type { ReaderRect } from '@/reader';
import {
  ReaderHighlightColors,
  ReaderHighlightStyles,
  type ReaderHighlightColor,
  type ReaderHighlightStyle,
} from '../../domain/reader-highlight';
export const SelectionToolbarWidth = 320;
export const SelectionToolbarHeight = 108;

const ToolbarGap = 12;
const ViewportPadding = 12;
const ToolbarFadeInDuration = 180;
const ToolbarFadeOutDuration = 140;
const ToolbarEntering = FadeIn.duration(ToolbarFadeInDuration);
const ToolbarExiting = FadeOut.duration(ToolbarFadeOutDuration);

const HandleTouchSize = 48;
const HandleVisualOffsetY = 8;
const HighlightColorClasses: Record<ReaderHighlightColor, string> = {
  yellow: 'bg-reader-highlight-fill',
  pink: 'bg-reader-highlight-pink',
  purple: 'bg-reader-highlight-purple',
  blue: 'bg-reader-highlight-blue',
  green: 'bg-reader-highlight-green',
};

export interface SelectionControlsLayout {
  readonly toolbar: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly placement: 'above' | 'below';
    readonly compact: boolean;
    readonly arrowLeft: number;
  };
  readonly startHandle: { readonly x: number; readonly y: number };
  readonly endHandle: { readonly x: number; readonly y: number };
}

export function computeSelectionLayout(
  rects: readonly ReaderRect[],
  viewportWidth: number,
  viewportHeight: number,
  safeAreaInsets: EdgeInsets,
  measuredHeight?: number,
): SelectionControlsLayout | undefined {
  const first = rects[0];
  const last = rects.at(-1);
  if (!first || !last || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  const minimumTop = safeAreaInsets.top + ViewportPadding;
  const width = Math.min(
    SelectionToolbarWidth,
    viewportWidth - safeAreaInsets.left - safeAreaInsets.right - ViewportPadding * 2,
  );
  if (width <= 0) return undefined;
  const compact = width < SelectionToolbarWidth;
  const height = measuredHeight ?? (compact ? 156 : SelectionToolbarHeight);
  const maximumTop = Math.max(minimumTop, viewportHeight - safeAreaInsets.bottom - ViewportPadding - height);
  const aboveTop = minY - ToolbarGap - height;
  const belowTop = maxY + ToolbarGap;
  const placement =
    aboveTop >= minimumTop || (belowTop > maximumTop && minY - minimumTop > maximumTop + height - maxY)
      ? 'above'
      : 'below';
  const top = Math.max(minimumTop, Math.min(maximumTop, placement === 'above' ? aboveTop : belowTop));
  const centerX = (minX + maxX) / 2;
  const left = Math.min(
    viewportWidth - safeAreaInsets.right - ViewportPadding - width,
    Math.max(safeAreaInsets.left + ViewportPadding, centerX - width / 2),
  );
  return {
    toolbar: {
      left,
      top,
      width,
      placement,
      compact,
      arrowLeft: Math.max(20, Math.min(width - 30, centerX - left - 5)),
    },
    startHandle: { x: first.x, y: first.y + first.height },
    endHandle: { x: last.x + last.width, y: last.y + last.height },
  };
}

/** A selection toolbar command; built-in and extension actions share this shape. */
export interface ReaderSelectionAction {
  readonly key: string;
  readonly label: string;
  readonly name: IconSource;
  readonly onPress: () => void;
  readonly isDisabled?: boolean;
}

const MaxActionsPerRow = 4;

/** Rows of at most four actions, keeping a five-action toolbar on one row. */
export function arrangeSelectionActions<T>(actions: readonly T[]): readonly (readonly T[])[] {
  if (actions.length <= MaxActionsPerRow + 1) return actions.length > 0 ? [actions] : [];
  const rows: T[][] = [];
  for (let index = 0; index < actions.length; index += MaxActionsPerRow) {
    rows.push(actions.slice(index, index + MaxActionsPerRow));
  }
  return rows;
}

interface SelectionControlsProps {
  readonly actions: readonly ReaderSelectionAction[];
  readonly selectionLabel: string;
  readonly startHandleLabel: string;
  readonly endHandleLabel: string;
  readonly isHighlightDisabled?: boolean;
  readonly selectedColor: ReaderHighlightColor;
  readonly colorLabels: Readonly<Record<ReaderHighlightColor, string>>;
  readonly onColorChange: (color: ReaderHighlightColor) => void;
  readonly selectedStyle: ReaderHighlightStyle;
  readonly styleLabels: Readonly<Record<ReaderHighlightStyle, string>>;
  readonly onStyleChange: (style: ReaderHighlightStyle) => void;
  readonly rects: readonly ReaderRect[];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly safeAreaInsets: EdgeInsets;
  readonly drag?: ReaderSelectionDragController;
}

export function SelectionControls({
  actions,
  selectionLabel,
  startHandleLabel,
  endHandleLabel,
  isHighlightDisabled = false,
  selectedColor,
  colorLabels,
  onColorChange,
  selectedStyle,
  styleLabels,
  onStyleChange,
  rects,
  viewportWidth,
  viewportHeight,
  safeAreaInsets,
  drag,
}: SelectionControlsProps) {
  const foreground = useThemeColor('foreground');
  const [measuredHeight, setMeasuredHeight] = useState<number>();
  const selectionColor = useCSSVariable('--color-navigation-active') as string;
  const dragging = drag?.binding.dragging;
  const toolbarStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging?.value ? 0 : 1, {
      duration: dragging?.value ? ToolbarFadeOutDuration : ToolbarFadeInDuration,
    }),
  }));
  const layout = computeSelectionLayout(rects, viewportWidth, viewportHeight, safeAreaInsets, measuredHeight);
  if (!layout) return null;

  return (
    <Fragment>
      <Animated.View
        entering={ToolbarEntering}
        exiting={ToolbarExiting}
        accessibilityLabel={selectionLabel}
        accessibilityRole="toolbar"
        pointerEvents="box-none"
        className="absolute z-30"
        style={{
          left: layout.toolbar.left,
          top: layout.toolbar.top,
          width: layout.toolbar.width,
        }}>
        {/* Keep drag opacity separate from the mount and unmount animations. */}
        <Animated.View
          pointerEvents="box-none"
          onLayout={(event) => setMeasuredHeight(event.nativeEvent.layout.height)}
          className={`gap-2 ${layout.toolbar.placement === 'above' ? 'flex-col-reverse' : 'flex-col'}`}
          style={toolbarStyle}>
          <View className="rounded-2xl border border-border bg-surface px-1.5 py-0.5 shadow-lg">
            <View
              pointerEvents="none"
              className={`absolute size-2.5 rotate-45 bg-surface ${layout.toolbar.placement === 'above' ? '-bottom-1.5 border-b border-r border-border' : '-top-1.5 border-l border-t border-border'}`}
              style={{ left: layout.toolbar.arrowLeft }}
            />
            {arrangeSelectionActions(actions).map((row, rowIndex) => (
              <View
                key={row[0]?.key ?? rowIndex}
                className={`min-h-14 flex-row items-center ${rowIndex > 0 ? 'border-t border-border' : ''}`}>
                {row.map((action, index) => (
                  <Fragment key={action.key}>
                    {index > 0 ? <View className="h-6 w-px bg-border" /> : null}
                    <Button
                      accessibilityLabel={action.label}
                      className="h-auto min-h-12 flex-1 flex-col gap-0.5 rounded-xl px-2 py-1"
                      isDisabled={action.isDisabled}
                      onPress={action.onPress}
                      size="sm"
                      variant="ghost">
                      <Icon name={action.name} size={20} color={foreground} />
                      <Button.Label className="text-xs" numberOfLines={1}>
                        {action.label}
                      </Button.Label>
                    </Button>
                  </Fragment>
                ))}
              </View>
            ))}
          </View>
          <View
            pointerEvents="box-none"
            className={layout.toolbar.compact ? 'items-center gap-2' : 'h-11 flex-row items-center gap-2'}>
            <View className="h-11 flex-row items-center gap-1">
              {ReaderHighlightStyles.map((style) => (
                <Button
                  key={style}
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  accessibilityLabel={styleLabels[style]}
                  accessibilityState={{ selected: selectedStyle === style }}
                  isDisabled={isHighlightDisabled}
                  onPress={() => onStyleChange(style)}
                  hitSlop={{ top: 2, bottom: 2 }}
                  className={`size-10 rounded-full border bg-surface p-0 shadow-sm ${selectedStyle === style ? 'border-navigation-active' : 'border-border'}`}>
                  <View pointerEvents="none" className="items-center justify-center">
                    <Text
                      className={`text-lg leading-5 ${style === 'highlight' ? 'rounded bg-default px-1' : ''} ${selectedStyle === style ? 'text-navigation-active' : 'text-foreground'}`}>
                      A
                    </Text>
                    {style !== 'highlight' && (
                      <Svg width={20} height={5} viewBox="0 0 22 5">
                        <Path
                          d={
                            style === 'underline' ? 'M1 2.5 H21' : 'M1 2.5 Q3 -0.5 5 2.5 T9 2.5 T13 2.5 T17 2.5 T21 2.5'
                          }
                          fill="none"
                          stroke={selectedStyle === style ? selectionColor : foreground}
                          strokeWidth={1.5}
                        />
                      </Svg>
                    )}
                  </View>
                </Button>
              ))}
            </View>
            <View className="h-10 flex-row items-center rounded-full bg-surface px-0.5 shadow-sm">
              {ReaderHighlightColors.map((color) => (
                <Button
                  key={color}
                  accessibilityLabel={colorLabels[color]}
                  accessibilityState={{ selected: selectedColor === color }}
                  className="h-10 w-9 rounded-full p-0"
                  size="sm"
                  variant="ghost"
                  isDisabled={isHighlightDisabled}
                  onPress={() => onColorChange(color)}>
                  <View className={`size-5.5 items-center justify-center rounded-full ${HighlightColorClasses[color]}`}>
                    {selectedColor === color && <Icon name="check" size={14} color={foreground} />}
                  </View>
                </Button>
              ))}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
      {drag && (
        <Fragment>
          <SelectionHandle boundary="start" label={startHandleLabel} drag={drag} />
          <SelectionHandle boundary="end" label={endHandleLabel} drag={drag} />
        </Fragment>
      )}
    </Fragment>
  );
}

interface SelectionHandleProps {
  readonly boundary: 'start' | 'end';
  readonly label: string;
  readonly drag: ReaderSelectionDragController;
}

function SelectionHandle({ boundary, label, drag }: SelectionHandleProps) {
  const { begin, moveHandle, finish, binding } = drag;
  const position = boundary === 'start' ? binding.startHandle : binding.endHandle;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: position.value.x - HandleTouchSize / 2 },
      { translateY: position.value.y - HandleVisualOffsetY },
    ],
  }));
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          begin(boundary);
        })
        .onUpdate((event) => {
          'worklet';
          moveHandle(boundary, event.translationX, event.translationY);
        })
        .onEnd((event, success) => {
          'worklet';
          moveHandle(boundary, event.translationX, event.translationY);
          finish(!success);
        })
        .onFinalize((_event, success) => {
          'worklet';
          if (!success) finish(true);
        }),
    [begin, boundary, finish, moveHandle],
  );

  // Transparent native targets retain touch capture and accessibility. The
  // knob and stem are painted with the selection in the reader's Skia Canvas.
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        collapsable={false}
        className="absolute left-0 top-0 z-30 h-12 w-12"
        style={style}
      />
    </GestureDetector>
  );
}
