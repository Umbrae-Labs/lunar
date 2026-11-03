import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Button as HeroButton } from 'heroui-native/button';
import { ControlField } from 'heroui-native/control-field';
import { Description } from 'heroui-native/description';
import { useBottomSheetAwareHandlers, useThemeColor } from 'heroui-native/hooks';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { ListGroup } from 'heroui-native/list-group';
import { Separator } from 'heroui-native/separator';
import { Spinner as HeroSpinner } from 'heroui-native/spinner';
import { Switch as HeroSwitch } from 'heroui-native/switch';
import { TextField as HeroTextField } from 'heroui-native/text-field';
import { Children, Fragment, useContext } from 'react';
import { Pressable as NativePressable, ScrollView, Text as NativeText, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useCSSVariable, withUniwind } from 'uniwind';
import type * as Ui from '@umbrae-labs/lunar-plugin-sdk/ui';
import { hasNetworkAccess } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import { MarkdownView } from '@/components/markdown';
import { pluginSymbolName } from '../domain/plugin-icons';
import { assertRequestAllowed } from '../services/plugin-network';
import { PluginScopeContext, type PluginScopeValue } from './plugin-scope';

// Class names are complete literals so that the host's style scan includes them.
const Gap: Record<Ui.Space, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
};
const Padding: Record<Ui.Space, string> = { none: 'p-0', xs: 'p-1', sm: 'p-2', md: 'p-3', lg: 'p-4', xl: 'p-6' };
const Align = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const;
const Justify = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const;
const TextSize: Record<Ui.TextSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};
const TextTone: Record<Ui.TextTone, string> = {
  default: 'text-foreground',
  muted: 'text-muted',
  accent: 'text-navigation-active',
  danger: 'text-danger',
  success: 'text-success',
};
const Weight = { regular: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' } as const;
const TextAlign = { start: 'text-left', center: 'text-center', end: 'text-right' } as const;
const HeadingSize = { 1: 'text-2xl', 2: 'text-xl', 3: 'text-lg' } as const;
const ButtonVariant = { primary: 'primary', secondary: 'secondary', ghost: 'ghost', danger: 'danger' } as const;
const Rounded = { none: '', sm: 'rounded', md: 'rounded-lg', lg: 'rounded-2xl' } as const;
const PressedStyle = { opacity: 0.6 };
const StyledImage = withUniwind(ExpoImage);

function layout(props: Ui.StackProps, direction: 'flex-col' | 'flex-row', extra = '') {
  return [
    direction,
    Gap[props.gap ?? 'none'],
    Padding[props.padding ?? 'none'],
    props.align ? Align[props.align] : '',
    props.justify ? Justify[props.justify] : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function Stack(props: Ui.StackProps) {
  return (
    <View className={layout(props, 'flex-col')} style={props.style}>
      {props.children}
    </View>
  );
}

function Row(props: Ui.RowProps) {
  return (
    <View
      className={layout({ align: 'center', ...props }, 'flex-row', props.wrap ? 'flex-wrap' : '')}
      style={props.style}>
      {props.children}
    </View>
  );
}

function Surface({ padding = 'lg', tone = 'default', style, children }: Ui.SurfaceProps) {
  return (
    <View
      className={`rounded-2xl ${tone === 'secondary' ? 'bg-surface-secondary' : 'bg-surface'} ${Padding[padding]}`}
      style={style}>
      {children}
    </View>
  );
}

function ScrollArea({ gap = 'none', padding = 'none', children }: Ui.ScrollAreaProps) {
  return (
    <ScrollView contentContainerClassName={`${Gap[gap]} ${Padding[padding]}`} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

function Divider() {
  return <Separator />;
}

function Text({
  size = 'md',
  tone = 'default',
  weight = 'regular',
  align = 'start',
  numberOfLines,
  selectable,
  style,
  children,
}: Ui.TextProps) {
  return (
    <NativeText
      className={`${TextSize[size]} ${TextTone[tone]} ${Weight[weight]} ${TextAlign[align]}`}
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={style}>
      {children}
    </NativeText>
  );
}

function Heading({ level = 2, children }: Ui.HeadingProps) {
  return (
    <NativeText accessibilityRole="header" className={`${HeadingSize[level]} font-semibold text-foreground`}>
      {children}
    </NativeText>
  );
}

/** Standard Markdown from a plugin; images stay off so its text cannot load remote resources. */
function Markdown({ children }: Ui.MarkdownProps) {
  return <MarkdownView value={typeof children === 'string' ? children : ''} syntax="commonmark" images={false} />;
}

function Icon({ name, size = 20, tone = 'default' }: Ui.IconProps) {
  const [foreground, muted, danger, success] = useThemeColor(['foreground', 'muted', 'danger', 'success']);
  const accent = useCSSVariable('--color-navigation-active') as string;
  const color = { default: foreground, muted, accent, danger, success }[tone];
  return <SymbolView name={pluginSymbolName(name)} size={size} tintColor={color} />;
}

function Pressable({ onPress, accessibilityLabel, disabled, style, children }: Ui.PressableProps) {
  return (
    <NativePressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true || !onPress}
      onPress={onPress}
      style={(state) => [style, state.pressed && disabled !== true ? PressedStyle : null]}>
      {children}
    </NativePressable>
  );
}

function Image({ source, accessibilityLabel, aspectRatio = 1, rounded = 'md', style }: Ui.ImageProps) {
  const scope = useContext(PluginScopeContext);
  const uri = permittedImageUri(scope, source.uri);
  const className = `bg-surface-secondary ${Rounded[rounded]}`.trim();
  if (!uri)
    return <View accessibilityLabel={accessibilityLabel} className={className} style={[{ aspectRatio }, style]} />;
  return (
    <StyledImage
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      cachePolicy="memory-disk"
      className={className}
      contentFit="cover"
      source={uri}
      style={[{ aspectRatio }, style]}
      transition={120}
    />
  );
}

/** Images need the `network` permission and follow the same public-HTTPS rules as `ctx.network`. */
function permittedImageUri(scope: PluginScopeValue | undefined, uri: string): string | undefined {
  const manifest = scope && scope.host.getEntry(scope.pluginId)?.plugin.manifest;
  if (!manifest || !hasNetworkAccess(manifest)) return undefined;
  try {
    return assertRequestAllowed({ url: uri }).href;
  } catch {
    return undefined;
  }
}

function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  accessibilityLabel,
}: Ui.ButtonProps) {
  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel ?? children}
      isDisabled={disabled || loading}
      onPress={onPress}
      size={size}
      variant={ButtonVariant[variant]}>
      {loading ? <HeroSpinner size="sm" /> : icon ? <Icon name={icon} size={18} /> : null}
      <HeroButton.Label>{children}</HeroButton.Label>
    </HeroButton>
  );
}

function IconButton({ icon, accessibilityLabel, onPress, variant = 'ghost', disabled }: Ui.IconButtonProps) {
  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel}
      className="size-10 rounded-full"
      isDisabled={disabled}
      isIconOnly
      onPress={onPress}
      size="sm"
      variant={variant}>
      <Icon name={icon} />
    </HeroButton>
  );
}

function TextField({
  value,
  onChangeText,
  label,
  description,
  placeholder,
  multiline,
  disabled,
  keyboardType,
  onSubmit,
}: Ui.TextFieldProps) {
  // Panels are bottom sheets; outside one these handlers do nothing.
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();
  return (
    <HeroTextField isDisabled={disabled}>
      {label ? <Label>{label}</Label> : null}
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        keyboardType={keyboardType === 'number' ? 'number-pad' : 'default'}
        onSubmitEditing={onSubmit}
        onFocus={onFocus}
        onBlur={onBlur}
        accessibilityLabel={label ?? placeholder}
      />
      {description ? <Description>{description}</Description> : null}
    </HeroTextField>
  );
}

function Switch({ value, onValueChange, label, description, disabled }: Ui.SwitchProps) {
  return (
    <ControlField
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      className="min-h-14 py-2"
      isDisabled={disabled}
      isSelected={value}
      onSelectedChange={onValueChange}>
      <View className="flex-1 pr-4">
        <Label className="text-base font-medium text-foreground">{label}</Label>
        {description ? <Description className="mt-0.5 text-sm leading-5 text-muted">{description}</Description> : null}
      </View>
      <ControlField.Indicator>
        <HeroSwitch className="h-7 w-12" accessibilityElementsHidden>
          <HeroSwitch.Thumb className="size-5" />
        </HeroSwitch>
      </ControlField.Indicator>
    </ControlField>
  );
}

function Spinner({ size = 'md' }: Ui.SpinnerProps) {
  return <HeroSpinner size={size} />;
}

function ProgressCircle({ value, size = 28, accessibilityLabel }: Ui.ProgressCircleProps) {
  const muted = useThemeColor('muted');
  const accent = useCSSVariable('--color-navigation-active') as string;
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const stroke = Math.max(2, Math.round(size / 9));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      style={{ width: size, height: size }}>
      <Svg height={size} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={muted}
          strokeOpacity={0.3}
          strokeWidth={stroke}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={accent}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}

function EmptyState({ icon, title, description, action }: Ui.EmptyStateProps) {
  return (
    <View className="items-center gap-2 px-4 py-8">
      {icon ? <Icon name={icon} size={32} tone="muted" /> : null}
      <NativeText className="text-center text-base font-medium text-foreground">{title}</NativeText>
      {description ? <NativeText className="text-center text-sm text-muted">{description}</NativeText> : null}
      {action ? (
        <Button onPress={action.onPress} variant="secondary" size="sm">
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

function PanelHeader({ title, subtitle, trailing }: Ui.PanelHeaderProps) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <NativeText accessibilityRole="header" className="text-lg font-semibold text-foreground" numberOfLines={1}>
          {title}
        </NativeText>
        {subtitle ? (
          <NativeText className="text-sm text-muted" numberOfLines={2}>
            {subtitle}
          </NativeText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

function List({ children }: Ui.ListProps) {
  const items = Children.toArray(children);
  return (
    <ListGroup className="overflow-hidden rounded-2xl bg-surface">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? <Separator className="mx-4" /> : null}
          {item}
        </Fragment>
      ))}
    </ListGroup>
  );
}

function ListItem({ title, description, detail, icon, onPress, trailing }: Ui.ListItemProps) {
  return (
    <ListGroup.Item
      accessibilityRole={onPress ? 'button' : 'text'}
      className="min-h-14 px-4 py-3 active:bg-surface-secondary"
      disabled={!onPress}
      onPress={onPress}>
      {icon ? (
        <View className="mr-3">
          <Icon name={icon} />
        </View>
      ) : null}
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="text-base text-foreground">{title}</ListGroup.ItemTitle>
        {description ? (
          <ListGroup.ItemDescription className="mt-0.5 text-sm text-muted">{description}</ListGroup.ItemDescription>
        ) : null}
      </ListGroup.ItemContent>
      {detail ? <NativeText className="ml-3 text-sm text-muted">{detail}</NativeText> : null}
      {trailing}
      {onPress && !trailing ? <ListGroup.ItemSuffix className="ml-2" iconProps={{ size: 16 }} /> : null}
    </ListGroup.Item>
  );
}

export const uiModule = {
  Stack,
  Row,
  Surface,
  ScrollArea,
  Divider,
  Text,
  Heading,
  Markdown,
  Button,
  IconButton,
  Icon,
  Pressable,
  Image,
  TextField,
  Switch,
  Spinner,
  ProgressCircle,
  EmptyState,
  PanelHeader,
  List,
  ListItem,
} satisfies typeof Ui;
