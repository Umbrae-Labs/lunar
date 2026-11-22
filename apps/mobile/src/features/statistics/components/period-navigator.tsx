import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { Text, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { useTranslation } from '@/i18n';

/** Steps through calendar periods; a custom range instead reopens its date picker from the label. */
export function PeriodNavigator({
  label,
  onPrevious,
  onNext,
  onEdit,
}: {
  label: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const iconColor = useThemeColor('foreground');
  if (onEdit)
    return (
      <PressableFeedback
        accessibilityRole="button"
        accessibilityLabel={`${t('statistics.customRange')}, ${label}`}
        className="min-h-11 flex-row items-center justify-center gap-1 rounded-2xl px-3"
        onPress={onEdit}>
        <Text className="text-base font-semibold text-foreground">{label}</Text>
        <Icon name="calendar" size={16} color={iconColor} />
      </PressableFeedback>
    );
  return (
    <View className="flex-row items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        accessibilityLabel={t('statistics.previousPeriod')}
        isDisabled={!onPrevious}
        onPress={onPrevious}>
        <Icon name="chevronLeft" size={18} color={iconColor} />
      </Button>
      <Text
        accessibilityRole="header"
        className="min-w-0 flex-1 text-center text-base font-semibold text-foreground"
        numberOfLines={1}>
        {label}
      </Text>
      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        accessibilityLabel={t('statistics.nextPeriod')}
        isDisabled={!onNext}
        onPress={onNext}>
        <Icon name="chevronRight" size={18} color={iconColor} />
      </Button>
    </View>
  );
}
