import type { ComponentType, ReactNode } from 'react';
import type { ImageStyle, StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { IconSpec } from './manifest.js';

// Lunar supplies these components when it executes a plugin; plugin bundles
// keep `@umbrae-labs/lunar-plugin-sdk/ui` external. Every prop is semantic so that the
// host maps it onto its own theme, spacing, font scaling and accessibility.

export type Space = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type TextTone = 'default' | 'muted' | 'accent' | 'danger' | 'success';
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface StackProps {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
  readonly justify?: 'start' | 'center' | 'end' | 'between';
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}

export interface RowProps extends StackProps {
  readonly wrap?: boolean;
}

export interface SurfaceProps {
  readonly padding?: Space;
  readonly tone?: 'default' | 'secondary';
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}

export interface ScrollAreaProps {
  readonly gap?: Space;
  readonly padding?: Space;
  readonly children?: ReactNode;
}

export interface TextProps {
  readonly size?: TextSize;
  readonly tone?: TextTone;
  readonly weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  readonly align?: 'start' | 'center' | 'end';
  readonly numberOfLines?: number;
  readonly selectable?: boolean;
  readonly style?: StyleProp<TextStyle>;
  readonly children?: ReactNode;
}

export interface HeadingProps {
  readonly level?: 1 | 2 | 3;
  readonly children?: ReactNode;
}

export interface ButtonProps {
  readonly children: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly icon?: IconSpec;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly accessibilityLabel?: string;
}

export interface IconButtonProps {
  readonly icon: IconSpec;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly variant?: 'ghost' | 'secondary';
  readonly disabled?: boolean;
}

export interface IconProps {
  readonly name: IconSpec;
  readonly size?: number;
  readonly tone?: TextTone;
}

/**
 * A tappable area for composite content such as a cover card. The host applies
 * its own press feedback and accessibility role; the plugin supplies layout.
 */
export interface PressableProps {
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}

export interface ImageProps {
  /** An HTTPS URL the host loads, caches and decodes on the plugin's behalf. */
  readonly source: { readonly uri: string };
  readonly accessibilityLabel?: string;
  /** Box aspect ratio (width / height). Defaults to 1. */
  readonly aspectRatio?: number;
  readonly rounded?: 'none' | 'sm' | 'md' | 'lg';
  readonly style?: StyleProp<ImageStyle>;
}

export interface TextFieldProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly label?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly disabled?: boolean;
  /** Keyboard suited to the expected input; the host maps it onto the platform keyboards. */
  readonly keyboardType?: 'text' | 'number';
  readonly onSubmit?: () => void;
}

export interface SwitchProps {
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface SpinnerProps {
  readonly size?: 'sm' | 'md' | 'lg';
}

/** A ring that shows how far a bounded task has progressed. */
export interface ProgressCircleProps {
  /** Completion from 0 to 1; values outside the range are clamped. */
  readonly value: number;
  /** Diameter in points. Defaults to 28. */
  readonly size?: number;
  readonly accessibilityLabel?: string;
}

export interface EmptyStateProps {
  readonly icon?: IconSpec;
  readonly title: string;
  readonly description?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export interface PanelHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly trailing?: ReactNode;
}

export interface ListProps {
  readonly children?: ReactNode;
}

export interface ListItemProps {
  readonly title: string;
  readonly description?: string;
  readonly detail?: string;
  readonly icon?: IconSpec;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
}

export declare const Stack: ComponentType<StackProps>;
export declare const Row: ComponentType<RowProps>;
export declare const Surface: ComponentType<SurfaceProps>;
export declare const ScrollArea: ComponentType<ScrollAreaProps>;
export declare const Divider: ComponentType<object>;
export declare const Text: ComponentType<TextProps>;
export declare const Heading: ComponentType<HeadingProps>;
export declare const Button: ComponentType<ButtonProps>;
export declare const IconButton: ComponentType<IconButtonProps>;
export declare const Icon: ComponentType<IconProps>;
export declare const Pressable: ComponentType<PressableProps>;
export declare const Image: ComponentType<ImageProps>;
export declare const TextField: ComponentType<TextFieldProps>;
export declare const Switch: ComponentType<SwitchProps>;
export declare const Spinner: ComponentType<SpinnerProps>;
export declare const ProgressCircle: ComponentType<ProgressCircleProps>;
export declare const EmptyState: ComponentType<EmptyStateProps>;
export declare const PanelHeader: ComponentType<PanelHeaderProps>;
export declare const List: ComponentType<ListProps>;
export declare const ListItem: ComponentType<ListItemProps>;
