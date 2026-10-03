import { BottomSheet } from 'heroui-native/bottom-sheet';
import type { ComponentProps } from 'react';
import { ScopedTheme, useUniwind } from 'uniwind';

/** Keep sheet surfaces, hooks and nested controls in the caller's theme. */
export function ThemedBottomSheetPortal({ children, ...props }: ComponentProps<typeof BottomSheet.Portal>) {
  const { theme } = useUniwind();

  return (
    <BottomSheet.Portal {...props}>
      <ScopedTheme theme={theme}>{children}</ScopedTheme>
    </BottomSheet.Portal>
  );
}
