import type { PropsWithChildren } from 'react';
import { HeroUINativeProvider, type HeroUINativeConfig } from 'heroui-native/provider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const HERO_UI_CONFIG: HeroUINativeConfig = {
  textProps: {
    allowFontScaling: true,
    maxFontSizeMultiplier: 1.6,
  },
  textInputProps: {
    allowFontScaling: true,
    maxFontSizeMultiplier: 1.6,
  },
  devInfo: {
    stylingPrinciples: false,
  },
};

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={HERO_UI_CONFIG}>{children}</HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
