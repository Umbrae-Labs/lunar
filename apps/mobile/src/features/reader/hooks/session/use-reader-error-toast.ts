import { useEffect, useEffectEvent, useRef } from 'react';
import { useToast } from 'heroui-native/toast';

interface ReaderErrorToastOptions {
  readonly bookId: string;
  readonly error: unknown;
  readonly label: string;
  readonly description?: string;
}

export function useReaderErrorToast({ bookId, error, label, description }: ReaderErrorToastOptions) {
  const { toast } = useToast();
  const notified = useRef<{ bookId: string; error: unknown } | undefined>(undefined);
  // HeroUI recreates its toast API when the toast list changes. Read the latest
  // API and message without making those changes trigger another notification.
  const showError = useEffectEvent(() => {
    toast.show({ variant: 'danger', label, ...(description === undefined ? {} : { description }) });
  });

  useEffect(() => {
    if (!error) {
      notified.current = undefined;
      return;
    }
    if (notified.current?.bookId === bookId && Object.is(notified.current.error, error)) return;
    // Record before showing: a toast update or Strict Mode effect replay must
    // never notify twice for the same error.
    notified.current = { bookId, error };
    showError();
  }, [bookId, error]);
}
