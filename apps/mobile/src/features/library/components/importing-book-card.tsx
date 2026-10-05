import Svg, { Circle } from 'react-native-svg';
import { Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';

const RING_SIZE = 54;
const RING_STROKE_WIDTH = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type ImportingBookCardProps = {
  title: string;
  progress: number;
  isWaiting: boolean;
};

export function ImportingBookCard({ title, progress, isWaiting }: ImportingBookCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const percentage = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const progressOffset = RING_CIRCUMFERENCE * (1 - percentage / 100);
  const status = isWaiting ? t('library.waitingImport') : t('library.importing');

  return (
    <View
      accessibilityLabel={t('library.importingProgress', { progress: percentage, status, title })}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percentage }}
      className="mb-6 w-1/3 px-[6px]">
      <View className="w-full aspect-[2/3] items-center justify-center rounded border border-border bg-surface">
        <View accessible={false} className="items-center justify-center">
          <Svg height={RING_SIZE} width={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              fill="none"
              r={RING_RADIUS}
              stroke={theme.backgroundElement}
              strokeWidth={RING_STROKE_WIDTH}
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              fill="none"
              r={RING_RADIUS}
              stroke={theme.accent}
              strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              strokeDashoffset={progressOffset}
              strokeLinecap="round"
              strokeWidth={RING_STROKE_WIDTH}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </Svg>
          <Text className="absolute text-[11px] font-semibold text-foreground">{percentage}%</Text>
        </View>
        <Text className="mt-2 text-[11px] text-muted">{status}</Text>
      </View>
      <Text className="mt-[7px] text-xs font-semibold leading-4 text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <Text className="mt-px text-[10px] leading-[14px] text-muted" numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
}
