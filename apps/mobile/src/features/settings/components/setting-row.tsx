import { ControlField } from 'heroui-native/control-field';
import { Description } from 'heroui-native/description';
import { Label } from 'heroui-native/label';
import { ListGroup } from 'heroui-native/list-group';
import { Switch } from 'heroui-native/switch';
import { Text, View } from 'react-native';

type SettingRowBaseProps = {
  title: string;
  description?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  isDisabled?: boolean;
};

type SettingSwitchRowProps = SettingRowBaseProps & {
  variant: 'switch';
  isSelected: boolean;
  onSelectedChange: (isSelected: boolean) => void;
};

type SettingActionRowProps = SettingRowBaseProps & {
  variant: 'action';
  value?: string;
  onPress: () => void;
};

/**
 * A row that acts on the item it names rather than leading anywhere, so it
 * carries no chevron — the trailing affordance would promise a screen that does
 * not exist.
 */
type SettingDestructiveRowProps = SettingRowBaseProps & {
  variant: 'destructive';
  onPress: () => void;
};

export type SettingRowProps = SettingSwitchRowProps | SettingActionRowProps | SettingDestructiveRowProps;

export function SettingRow(props: SettingRowProps) {
  if (props.variant === 'switch') {
    const {
      title,
      description,
      accessibilityLabel = title,
      accessibilityHint,
      isDisabled,
      isSelected,
      onSelectedChange,
    } = props;

    return (
      <ControlField
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="switch"
        accessibilityState={{ checked: isSelected, disabled: isDisabled }}
        className="min-h-[72px] px-5 py-4 active:bg-surface-secondary"
        isDisabled={isDisabled}
        isSelected={isSelected}
        onSelectedChange={onSelectedChange}>
        <View className="flex-1 pr-4">
          <Label className="text-base font-medium text-foreground">{title}</Label>
          {description ? (
            <Description className="mt-0.5 text-sm leading-5 text-muted">{description}</Description>
          ) : null}
        </View>
        <ControlField.Indicator>
          <Switch className="h-7 w-12" accessibilityElementsHidden>
            <Switch.Thumb className="size-5" />
          </Switch>
        </ControlField.Indicator>
      </ControlField>
    );
  }

  const { title, description, accessibilityLabel = title, accessibilityHint, isDisabled, onPress } = props;
  const isDestructive = props.variant === 'destructive';
  const value = props.variant === 'action' ? props.value : undefined;

  return (
    <ListGroup.Item
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      className="min-h-[72px] px-5 py-4 active:bg-surface-secondary"
      disabled={isDisabled}
      onPress={onPress}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className={`text-base font-medium ${isDestructive ? 'text-danger' : 'text-foreground'}`}>
          {title}
        </ListGroup.ItemTitle>
        {description ? (
          <ListGroup.ItemDescription className="mt-0.5 text-sm leading-5 text-muted">
            {description}
          </ListGroup.ItemDescription>
        ) : null}
      </ListGroup.ItemContent>
      {value ? <Text className="ml-4 text-sm text-muted">{value}</Text> : null}
      {isDestructive ? null : <ListGroup.ItemSuffix className="ml-2" iconProps={{ size: 18 }} />}
    </ListGroup.Item>
  );
}
