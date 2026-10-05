import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from 'heroui-native/button';
import { Spinner } from 'heroui-native/spinner';
import { useToast } from 'heroui-native/toast';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { getExternalImport, releaseExternalImport } from '../services/external-import-service';

export default function ExternalImportScreen() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [failedRequest, setFailedRequest] = useState<string>();
  const failed = failedRequest === (requestId ?? '');
  useMarkInitialContentReady(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const task =
        (requestId ? getExternalImport(requestId) : undefined) ??
        Promise.reject(new Error(t('library.externalImportUnavailable')));
      void task
        .then((results) => {
          if (!active) return;
          let succeeded = false;
          for (const result of results) {
            if (result.book) {
              succeeded = true;
            } else {
              toast.show({
                variant: 'danger',
                label: t('library.importFailed'),
                description: result.error instanceof Error ? result.error.message : t('library.unknownError'),
              });
            }
          }
          if (succeeded) {
            releaseExternalImport(requestId!);
            router.replace('/library');
          } else {
            setFailedRequest(requestId ?? '');
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setFailedRequest(requestId ?? '');
          toast.show({
            variant: 'danger',
            label: t('library.importFailed'),
            description: error instanceof Error ? error.message : t('library.unknownError'),
          });
        });
      return () => {
        active = false;
      };
    }, [requestId, router, t, toast]),
  );

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
      {failed ? (
        <>
          <Text accessibilityRole="header" className="text-lg text-foreground">
            {t('library.importFailed')}
          </Text>
          <Button
            onPress={() => {
              if (requestId) releaseExternalImport(requestId);
              router.replace('/library');
            }}>
            <Button.Label>{t('reader.backToLibrary')}</Button.Label>
          </Button>
        </>
      ) : (
        <>
          <Spinner size="lg" />
          <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite" className="text-base text-foreground">
            {t('library.importing')}
          </Text>
        </>
      )}
    </View>
  );
}
