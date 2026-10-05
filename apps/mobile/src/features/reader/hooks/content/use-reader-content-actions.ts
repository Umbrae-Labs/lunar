import * as Linking from 'expo-linking';
import { useToast } from 'heroui-native/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useTranslation } from '@/i18n';
import {
  findReaderHitIndex,
  type ReaderRuntime,
  type ReaderSnapshot,
  type ReaderFootnote,
  type ReaderHitEntry,
} from '@/reader';
import type { ReaderSurfaceTransform } from '@/reader/native';
import { createReaderImageFile, deleteReaderImageFile } from '../../infrastructure/reader-image-file';

interface ReaderContentActionsOptions {
  readonly runtime: ReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly surfaceTransform?: ReaderSurfaceTransform;
  readonly imageInteractionEnabled: boolean;
}

export function useReaderContentActions({
  runtime,
  snapshot,
  surfaceTransform,
  imageInteractionEnabled,
}: ReaderContentActionsOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [footnote, setFootnote] = useState<ReaderFootnote>();
  const [isFootnoteOpen, setIsFootnoteOpen] = useState(false);
  const [imageViewer, setImageViewer] = useState<{
    uri: string;
    description: string;
    origin: { x: number; y: number; width: number; height: number };
    revisionId: number;
    renderId?: number;
  }>();
  const pendingImageLinkPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const footnoteRequestRef = useRef(0);
  const activeImageViewer =
    imageViewer?.revisionId === snapshot.revisionId && imageViewer.renderId === snapshot.renderId
      ? imageViewer
      : undefined;
  useEffect(
    () => () => {
      if (activeImageViewer) deleteReaderImageFile(activeImageViewer.uri);
    },
    [activeImageViewer],
  );

  useEffect(
    () => () => {
      if (pendingImageLinkPress.current) clearTimeout(pendingImageLinkPress.current);
    },
    [],
  );

  const displayPoint = useCallback(
    (x: number, y: number) => {
      return surfaceTransform?.toDisplayPoint(x, y) ?? { x, y };
    },
    [surfaceTransform],
  );

  const handleReadingDoubleTap = useCallback(
    (x: number, y: number) => {
      if (!imageInteractionEnabled) return;
      const hitMap = runtime.getCurrentHitMap();
      const point = displayPoint(x, y);
      const hitIndex = hitMap ? findReaderHitIndex(hitMap.entries, point.x, point.y) : undefined;
      const hit = hitIndex === undefined ? undefined : hitMap?.entries[hitIndex];
      if (!hit?.imageSource) return;
      if (pendingImageLinkPress.current) {
        clearTimeout(pendingImageLinkPress.current);
        pendingImageLinkPress.current = undefined;
      }
      const bytes = runtime.getCurrentImageBytes(hit.imageSource);
      if (!bytes) {
        toast.show({ variant: 'danger', label: t('reader.imageUnavailable') });
        return;
      }
      try {
        const origin = surfaceTransform?.toViewportPoint(hit.bounds.x, hit.bounds.y) ?? {
          x: hit.bounds.x,
          y: hit.bounds.y,
        };
        setImageViewer({
          uri: createReaderImageFile(hit.imageSource, bytes),
          description: hit.imageAlt || t('reader.imageViewer'),
          origin: {
            x: origin.x,
            y: origin.y,
            width: hit.bounds.width * (surfaceTransform?.scale ?? 1),
            height: hit.bounds.height * (surfaceTransform?.scale ?? 1),
          },
          revisionId: snapshot.revisionId,
          renderId: snapshot.renderId,
        });
      } catch {
        toast.show({ variant: 'danger', label: t('reader.imageUnavailable') });
      }
    },
    [
      imageInteractionEnabled,
      displayPoint,
      runtime,
      snapshot.renderId,
      snapshot.revisionId,
      surfaceTransform,
      t,
      toast,
    ],
  );
  /* eslint-disable react-hooks/refs */
  const imageDoubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(imageInteractionEnabled)
        .numberOfTaps(2)
        .maxDistance(24)
        .runOnJS(true)
        .onEnd((event, success) => {
          if (success) handleReadingDoubleTap(event.x, event.y);
        }),
    [handleReadingDoubleTap, imageInteractionEnabled],
  );
  /* eslint-enable react-hooks/refs */
  const openFootnote = useCallback(
    async (key: string, pending = false) => {
      const request = footnoteRequestRef.current + 1;
      footnoteRequestRef.current = request;
      setFootnote(undefined);
      setIsFootnoteOpen(true);
      let lastError: unknown;
      try {
        const attempts = pending ? 8 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const nextFootnote = await runtime.readFootnote(key);
            if (nextFootnote) {
              if (footnoteRequestRef.current === request) setFootnote(nextFootnote);
              return;
            }
          } catch (error) {
            lastError = error;
          }
          if (attempt + 1 < attempts) await delay(160);
        }
        throw lastError ?? new Error(t('reader.footnoteUnavailable'));
      } catch (error) {
        if (footnoteRequestRef.current !== request) return;
        setIsFootnoteOpen(false);
        toast.show({
          variant: 'danger',
          label: t('reader.footnoteUnavailable'),
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [runtime, t, toast],
  );

  const openHyperlink = useCallback(
    async (href: string) => {
      try {
        if (isExternalHref(href)) {
          const externalUrl = href.startsWith('//') ? `https:${href}` : href;
          const scheme = externalUrl.slice(0, externalUrl.indexOf(':')).toLowerCase();
          if (!AllowedExternalLinkSchemes.has(scheme) || !(await Linking.canOpenURL(externalUrl))) {
            throw new Error(t('reader.linkSchemeUnsupported'));
          }
          await Linking.openURL(externalUrl);
        } else {
          await runtime.goToToc(href);
        }
      } catch (error) {
        toast.show({
          variant: 'danger',
          label: t('reader.linkOpenFailed'),
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [runtime, t, toast],
  );

  const handleFootnoteOpenChange = useCallback((value: boolean) => {
    setIsFootnoteOpen(value);
    if (!value) footnoteRequestRef.current += 1;
  }, []);

  const openContentHit = useCallback(
    (hit: ReaderHitEntry | undefined) => {
      if (hit?.footnoteKey) {
        void openFootnote(hit.footnoteKey, hit.footnotePending);
        return true;
      }
      if (hit?.imageSource) {
        if (hit.href) {
          if (pendingImageLinkPress.current) clearTimeout(pendingImageLinkPress.current);
          pendingImageLinkPress.current = setTimeout(() => {
            pendingImageLinkPress.current = undefined;
            void openHyperlink(hit.href!);
          }, 300);
        }
        return true;
      }
      if (hit?.href) {
        void openHyperlink(hit.href);
        return true;
      }
      return false;
    },
    [openFootnote, openHyperlink],
  );
  const closeImageViewer = useCallback(() => setImageViewer(undefined), []);
  const handleImageError = useCallback(() => {
    setImageViewer(undefined);
    toast.show({ variant: 'danger', label: t('reader.imageUnavailable') });
  }, [t, toast]);

  return {
    footnote,
    isFootnoteOpen,
    handleFootnoteOpenChange,
    activeImageViewer,
    hasImageViewer: Boolean(imageViewer),
    imageDoubleTapGesture,
    openContentHit,
    openFootnote,
    openHyperlink,
    closeImageViewer,
    handleImageError,
  };
}

function isExternalHref(href: string): boolean {
  if (href.startsWith('//')) return true;
  const pathEnd = Math.min(...[href.indexOf('?'), href.indexOf('#')].filter((index) => index >= 0), href.length);
  const colon = href.slice(0, pathEnd).indexOf(':');
  return colon > 0 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(href.slice(0, colon));
}

const AllowedExternalLinkSchemes = new Set(['http', 'https', 'mailto', 'tel', 'sms']);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
