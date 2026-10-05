import { ListGroup } from 'heroui-native/list-group';
import { Separator } from 'heroui-native/separator';
import { Children, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SettingRow } from './setting-row';

type SettingSectionProps = {
  title: string;
} & (
  | { children: ReactNode; onPress?: never; description?: never }
  | { children?: never; onPress: () => void; description?: string }
);

export function SettingSection({ title, children, onPress, description }: SettingSectionProps) {
  if (onPress) {
    return (
      <ListGroup className="overflow-hidden rounded-3xl bg-surface">
        <SettingRow variant="action" title={title} description={description} onPress={onPress} />
      </ListGroup>
    );
  }
  const rows = Children.toArray(children);

  return (
    <View>
      <Text className="mb-2 ml-3 text-sm font-medium text-muted">{title}</Text>
      <ListGroup className="overflow-hidden rounded-3xl bg-surface">
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 ? <Separator className="mx-5" /> : null}
            {row}
          </View>
        ))}
      </ListGroup>
    </View>
  );
}
