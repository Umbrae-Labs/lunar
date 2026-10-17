import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useToast } from 'heroui-native/toast';
import { Button } from 'heroui-native/button';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useTranslation } from '@/i18n';
import type { PosterDocument, PosterLabels } from '../domain/poster';
import { renderPoster } from '../infrastructure/poster-renderer';
import { removePosterImage, writePosterImage } from '../infrastructure/poster-image';
export type { PosterLabels } from '../domain/poster';
export interface PosterCanvasHandle {
  page: number;
  snapshot: () => Promise<string>;
}
export const PosterCanvas = forwardRef<
  PosterCanvasHandle,
  {
    document: PosterDocument;
    page: number;
    width: number;
    labels: PosterLabels;
    onOpen: (uri: string, origin: { x: number; y: number; width: number; height: number }) => void;
  }
>(function PosterCanvas({ document, page: pageIndex, width, labels, onOpen }, ref) {
  const page = document.pages[pageIndex],
    labelKey = JSON.stringify(labels);
  const [result, setResult] = useState<{ uri?: string; error?: boolean }>({});
  const [revision, setRevision] = useState(0);
  const rendering = useRef<Promise<string> | null>(null);
  const view = useRef<View>(null);
  const { t } = useTranslation();
  const { toast } = useToast();
  const notifyError = useEffectEvent(() =>
    toast.show({ variant: 'danger', label: t('statistics.posterRenderFailed') }),
  );
  useEffect(() => {
    const signal = { aborted: false };
    let uri: string | undefined;
    const task = async () => {
      try {
        const base64 = await renderPoster(page, JSON.parse(labelKey) as PosterLabels, signal);
        if (signal.aborted) throw Error('Poster cancelled');
        uri = await writePosterImage(base64, pageIndex + 1);
        if (signal.aborted) {
          await removePosterImage(uri);
          throw Error('Poster cancelled');
        }
        setResult({ uri });
        return base64;
      } catch (error) {
        if (!signal.aborted) {
          setResult({ error: true });
          notifyError();
        }
        throw error;
      }
    };
    rendering.current = task();
    void rendering.current.catch(() => {});
    return () => {
      signal.aborted = true;
      if (uri) void removePosterImage(uri).catch(() => {});
    };
  }, [page, pageIndex, labelKey, revision]);
  useImperativeHandle(
    ref,
    () => ({
      page: pageIndex,
      snapshot: async () => {
        if (!rendering.current) throw Error('Poster is not ready');
        return rendering.current;
      },
    }),
    [pageIndex],
  );
  return (
    <View
      ref={view}
      collapsable={false}
      style={{ width, height: (width * page.height) / page.width }}
      className="items-center justify-center bg-surface">
      {result.uri ? (
        <PressableFeedback
          accessibilityRole="button"
          accessibilityLabel={t('statistics.posterPreview')}
          onPress={() => {
            const uri = result.uri;
            if (uri) view.current?.measureInWindow((x, y, width, height) => onOpen(uri, { x, y, width, height }));
          }}>
          <Image
            source={{ uri: result.uri }}
            style={{ width, height: (width * page.height) / page.width }}
            contentFit="contain"
            cachePolicy="none"
            accessibilityLabel={t('statistics.posterEditor')}
          />
        </PressableFeedback>
      ) : result.error ? (
        <View className="gap-2 p-4">
          <Text className="text-sm text-danger">{t('statistics.posterRenderFailed')}</Text>
          <Button
            variant="ghost"
            onPress={() => {
              setResult({});
              setRevision((v) => v + 1);
            }}>
            {t('statistics.retry')}
          </Button>
        </View>
      ) : (
        <ActivityIndicator accessibilityLabel={t('statistics.posterPreparing')} />
      )}
    </View>
  );
});
