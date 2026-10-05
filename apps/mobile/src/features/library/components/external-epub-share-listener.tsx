import { type Href, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { subscribeToEpubShares } from '../infrastructure/external-epub-receiver';
import { createExternalImport } from '../services/external-import-service';

export function ExternalEpubShareListener() {
  const router = useRouter();
  const navigation = useRootNavigationState();
  const ready = Boolean(navigation?.key);

  useEffect(() => {
    if (!ready) return;
    return subscribeToEpubShares((uris) => {
      router.push(createExternalImport(uris) as Href);
    });
  }, [ready, router]);

  return null;
}
