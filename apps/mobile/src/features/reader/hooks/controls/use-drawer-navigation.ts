import { useCallback, useEffect, useRef, useState } from 'react';

interface DrawerNavigationOptions {
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onFailure: () => void;
  readonly onNavigated?: () => void;
}

interface PendingNavigation {
  readonly navigate: () => Promise<unknown>;
}

export function useDrawerNavigation({ onOpenChange, onFailure, onNavigated }: DrawerNavigationOptions) {
  const pending = useRef<PendingNavigation | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      pending.current = undefined;
    },
    [],
  );

  const isPending = useCallback(() => pending.current !== undefined, []);

  const requestNavigation = useCallback(
    (navigate: () => Promise<unknown>) => {
      if (pending.current) return;
      const operation: PendingNavigation = { navigate };
      pending.current = operation;
      setBusy(true);

      void (async () => {
        try {
          await operation.navigate();
          if (pending.current !== operation) return;
          onNavigated?.();
          onOpenChange(false);
        } catch {
          if (pending.current === operation) onFailure();
        } finally {
          if (pending.current === operation) {
            pending.current = undefined;
            setBusy(false);
          }
        }
      })();
    },
    [onFailure, onNavigated, onOpenChange],
  );

  return { busy, isPending, requestNavigation };
}
