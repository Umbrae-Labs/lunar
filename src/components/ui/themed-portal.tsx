import { Portal } from 'heroui-native/portal';
import type { ComponentProps } from 'react';
import { ScopedTheme, useUniwind } from 'uniwind';

/** Restore the caller's theme after HeroUI moves the subtree to its host. */
export function ThemedPortal({ children, ...props }: ComponentProps<typeof Portal>) {
  const { theme } = useUniwind();

  return (
    <Portal {...props}>
      <ScopedTheme theme={theme}>{children}</ScopedTheme>
    </Portal>
  );
}
