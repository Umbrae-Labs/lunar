import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { Button } from 'heroui-native/button';
import { useTranslation } from '@/i18n';
import type { PosterLabels, PosterPage } from '../domain/poster';
import {
  posterLayers,
  posterLayerAt,
  posterLayerContains,
  posterLayerPoint,
  posterLayerDelta,
  type PosterLayer,
} from '../domain/poster-depth';
import {
  DEFAULT_POSTER_CROP,
  panPosterCrop,
  posterCoverFrame,
  zoomPosterCrop,
  type PosterCrop,
} from '../domain/poster-crop';
import { clampPosterCamera, fitPosterCamera } from '../domain/poster-camera';
import { renderPoster } from '../infrastructure/poster-renderer';
import { removePosterImage, writePosterImage } from '../infrastructure/poster-image';

const StyledGestureRoot = withUniwind(GestureHandlerRootView);
type Cover = { tile: PosterLayer; width: number; height: number; overlay: string };
const CAMERA_TRANSITION = { duration: 240, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.System };
const SELECTION_TRANSITION = { duration: 120, reduceMotion: ReduceMotion.System };

// The live cover replaces only its own rectangle. Its gradient, title and author
// are drawn by the export renderer, so the editor shows the actual composition.
function LiveCover({ cover, edits }: { cover: Cover; edits: SharedValue<Record<string, PosterCrop>> }) {
  const { tile, width, height } = cover;
  const style = useAnimatedStyle(() => {
    const frame = posterCoverFrame(width, height, tile.width, tile.height, edits.get()[tile.book.id]);
    return { width: frame.width, height: frame.height, left: frame.left, top: frame.top };
  });
  return (
    <View
      pointerEvents="none"
      className="absolute overflow-hidden"
      style={{
        left: tile.x,
        top: tile.y,
        width: tile.width,
        height: tile.height,
        transform: [{ rotate: `${tile.rotation}deg` }],
      }}>
      <Animated.View className="absolute" style={style}>
        <Image
          source={{ uri: tile.book.coverUri! }}
          className="h-full w-full"
          resizeMode="stretch"
          resizeMethod="scale"
        />
      </Animated.View>
      <Image
        source={{ uri: cover.overlay }}
        className="absolute h-full w-full"
        resizeMode="stretch"
        resizeMethod="scale"
      />
    </View>
  );
}

function PosterScene({
  page,
  labels,
  uri,
  crops,
  initialId,
  width,
  height: initialHeight,
  onApply,
  onCancel,
}: {
  page: PosterPage;
  labels: PosterLabels;
  uri: string;
  crops: Record<string, PosterCrop>;
  initialId?: string;
  width: number;
  height: number;
  onApply: (value: Record<string, PosterCrop>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const desired = useRef(initialId);
  const [height, setHeight] = useState(initialHeight);
  const layers = useMemo(() => posterLayers(page), [page]);
  const [failed, setFailed] = useState(false);

  const [covers, setCovers] = useState<Cover[]>([]);
  const [active, setActive] = useState<Cover>();
  const [loading, setLoading] = useState(false);
  const request = useRef({
    version: 0,
    alive: true,
    signal: { aborted: false },
    files: new Set<string>(),
    cache: new Map<string, Cover>(),
  });
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShowLoading(true), 120);
    return () => clearTimeout(timer);
  }, [loading]);
  const edits = useSharedValue<Record<string, PosterCrop>>({ ...crops });
  const selected = useSharedValue<Cover | null>(null);
  const outline = useSharedValue<PosterLayer | null>(null);
  const outlineOpacity = useSharedValue(0);
  const camera = useSharedValue(fitPosterCamera(page.width, page.height, width, height));
  const owner = useSharedValue<'idle' | 'pan' | 'pinch'>('idle');
  const target = useSharedValue<'cover' | 'page'>('page');
  const previous = useSharedValue({ x: 0, y: 0, scale: 1, pointers: 0 });
  useEffect(() => {
    camera.set(withTiming(fitPosterCamera(page.width, page.height, width, height), CAMERA_TRANSITION));
  }, [camera, page.width, page.height, width, height]);
  useEffect(() => {
    const state = request.current;
    state.alive = true;
    return () => {
      state.alive = false;
      state.version++;
      state.signal.aborted = true;
      for (const file of state.files) void removePosterImage(file).catch(() => {});
    };
  }, []);
  const cancelPending = () => {
    request.current.version++;
    request.current.signal.aborted = true;
    setLoading(false);
  };
  const select = async (id: string, focus: boolean) => {
    const tile = layers.find((v) => v.book.id === id && v.book.coverUri);
    if (!tile) return;
    const state = request.current;
    desired.current = id;
    state.signal.aborted = true;
    const signal = { aborted: false };
    state.signal = signal;
    const version = ++state.version;
    setShowLoading(false);
    setLoading(true);
    setFailed(false);
    try {
      let cover = state.cache.get(id);
      if (!cover) {
        const dimensions = await Image.getSize(tile.book.coverUri!);
        await Image.prefetch(tile.book.coverUri!);
        if (signal.aborted || !state.alive) return;
        const png = await renderPoster(page, labels, signal, undefined, true, id);
        if (signal.aborted || !state.alive) return;
        const overlay = await writePosterImage(png, 0);
        if (signal.aborted || !state.alive) {
          await removePosterImage(overlay);
          return;
        }
        state.files.add(overlay);
        await Image.prefetch(overlay);
        if (signal.aborted || !state.alive) return;
        cover = { tile, ...dimensions, overlay };
        state.cache.set(id, cover);
      }
      if (version !== state.version || !state.alive) return;
      const ready = cover;
      setCovers((items) =>
        items.some((v) => v.tile.book.id === id) ? items : [...items, ready].sort((a, b) => a.tile.lift - b.tile.lift),
      );
      if (!edits.get()[id]) edits.set({ ...edits.get(), [id]: tile.book.crop ?? { ...DEFAULT_POSTER_CROP } });
      selected.set(cover);
      outlineOpacity.set(0);
      outline.set(tile);
      outlineOpacity.set(withTiming(1, SELECTION_TRANSITION));
      setActive(cover);
      if (focus) {
        const fit = fitPosterCamera(page.width, page.height, width, height);
        const scale = Math.max(fit.scale, Math.min((width * 0.52) / tile.width, (height * 0.62) / tile.height));
        const next = clampPosterCamera(
          {
            scale,
            x: width / 2 - (tile.x + tile.width / 2) * scale,
            y: height / 2 - (tile.y + tile.height / 2) * scale,
          },
          page.width,
          page.height,
          width,
          height,
        );
        camera.set(withTiming(next, CAMERA_TRANSITION));
      }
    } catch {
      if (version === state.version && state.alive && !signal.aborted) setFailed(true);
    } finally {
      if (version === state.version && state.alive) setLoading(false);
    }
  };
  const initialSelection = useRef(false);
  useEffect(() => {
    if (!initialId || initialSelection.current) return;
    initialSelection.current = true;
    // Selecting is asynchronous, just like tapping a cover once the overlay is ready.
    void select(initialId, false);
  });
  const selectAt = (x: number, y: number) => {
    const c = camera.get();
    const px = (x - c.x) / c.scale,
      py = (y - c.y) / c.scale;
    const tile = posterLayerAt(layers, px, py);
    if (tile?.book.coverUri) void select(tile.book.id, true);
  };
  const isCover = (x: number, y: number) => {
    'worklet';
    const cover = selected.get();
    if (!cover) return false;
    const c = camera.get();
    const px = (x - c.x) / c.scale,
      py = (y - c.y) / c.scale;
    const tile = cover.tile;
    return posterLayerAt(layers, px, py)?.book.id === tile.book.id && posterLayerContains(tile, px, py);
  };
  const pan = Gesture.Pan()
    .enabled(true)
    .maxPointers(1)
    .minDistance(3)
    // Registered gesture callback runs on touch, not during render.
    // eslint-disable-next-line react-hooks/refs
    .onStart((e) => {
      if (owner.get() === 'pinch') return;
      cancelAnimation(camera);
      scheduleOnRN(cancelPending);
      owner.set('pan');
      target.set(isCover(e.x, e.y) ? 'cover' : 'page');
      previous.set({ x: e.translationX, y: e.translationY, scale: 1, pointers: 1 });
    })
    .onUpdate((e) => {
      if (owner.get() !== 'pan' || e.numberOfPointers !== 1) return;
      const dx = e.translationX - previous.get().x,
        dy = e.translationY - previous.get().y;
      const c = camera.get(),
        cover = selected.get();
      if (target.get() === 'cover' && cover) {
        const id = cover.tile.book.id;
        const delta = posterLayerDelta(cover.tile, dx / c.scale, dy / c.scale);
        edits.set({
          ...edits.get(),
          [id]: panPosterCrop(
            edits.get()[id],
            delta.x,
            delta.y,
            cover.width,
            cover.height,
            cover.tile.width,
            cover.tile.height,
          ),
        });
      } else camera.set(clampPosterCamera({ ...c, x: c.x + dx, y: c.y + dy }, page.width, page.height, width, height));
      previous.set({ ...previous.get(), x: e.translationX, y: e.translationY });
    })
    .onFinalize(() => {
      if (owner.get() === 'pan') owner.set('idle');
    });
  const pinch = Gesture.Pinch()
    .enabled(true)
    // Registered gesture callback runs on touch, not during render.
    // eslint-disable-next-line react-hooks/refs
    .onStart((e) => {
      cancelAnimation(camera);
      scheduleOnRN(cancelPending);
      owner.set('pinch');
      target.set(isCover(e.focalX, e.focalY) ? 'cover' : 'page');
      previous.set({ x: e.focalX, y: e.focalY, scale: e.scale, pointers: e.numberOfPointers });
    })
    .onUpdate((e) => {
      if (owner.get() !== 'pinch') return;
      const p = previous.get(),
        c = camera.get(),
        cover = selected.get();
      if (p.pointers === e.numberOfPointers) {
        const ratio = e.scale / p.scale;
        if (target.get() === 'cover' && cover) {
          const tile = cover.tile,
            id = tile.book.id,
            crop = edits.get()[id];
          const before = posterLayerPoint(tile, (p.x - c.x) / c.scale, (p.y - c.y) / c.scale);
          const after = posterLayerPoint(tile, (e.focalX - c.x) / c.scale, (e.focalY - c.y) / c.scale);
          edits.set({
            ...edits.get(),
            [id]: zoomPosterCrop(
              crop,
              crop.zoom * ratio,
              before.x,
              before.y,
              cover.width,
              cover.height,
              tile.width,
              tile.height,
              after.x,
              after.y,
            ),
          });
        } else {
          const scale = clampPosterCamera(
            { ...c, scale: c.scale * ratio },
            page.width,
            page.height,
            width,
            height,
          ).scale;
          camera.set(
            clampPosterCamera(
              { scale, x: e.focalX - ((p.x - c.x) * scale) / c.scale, y: e.focalY - ((p.y - c.y) * scale) / c.scale },
              page.width,
              page.height,
              width,
              height,
            ),
          );
        }
      }
      previous.set({ x: e.focalX, y: e.focalY, scale: e.scale, pointers: e.numberOfPointers });
    })
    .onFinalize(() => {
      if (owner.get() === 'pinch') owner.set('idle');
    });
  const tap = Gesture.Tap()
    .onBegin(() => {
      cancelAnimation(camera);
    })
    .maxDistance(8)
    // Gesture callbacks execute on touch events, outside React rendering.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((e, success) => {
      if (success) scheduleOnRN(selectAt, e.x, e.y);
    });
  const sceneStyle = useAnimatedStyle(() => ({
    transformOrigin: 'top left',
    transform: [{ translateX: camera.get().x }, { translateY: camera.get().y }, { scale: camera.get().scale }],
  }));
  const borderStyle = useAnimatedStyle(() => {
    const tile = outline.get();
    return {
      opacity: outlineOpacity.get(),
      transform: [{ rotate: `${tile?.rotation ?? 0}deg` }],
      left: tile?.x ?? 0,
      top: tile?.y ?? 0,
      width: tile?.width ?? 0,
      height: tile?.height ?? 0,
      borderWidth: 1.5 / camera.get().scale,
    };
  });
  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-3 py-2">
        <Button size="sm" variant="ghost" onPress={onCancel}>
          {t('action.cancel')}
        </Button>
        <Text className="text-base font-semibold text-foreground">{t('statistics.posterCropTitle')}</Text>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={() => onApply({ ...edits.get() })}>
          {t('statistics.posterCropApply')}
        </Button>
      </View>
      <View
        className="flex-1"
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          setHeight((old) => (Math.abs(old - next) > 1 ? next : old));
        }}>
        <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, tap)}>
          <View
            collapsable={false}
            className="overflow-hidden bg-default"
            style={{ width, height }}
            accessibilityLabel={t('statistics.posterCropCanvas')}>
            <Animated.View className="absolute" style={[{ width: page.width, height: page.height }, sceneStyle]}>
              <Image source={{ uri }} className="h-full w-full" resizeMode="stretch" resizeMethod="scale" />
              {covers.map((cover) => (
                <LiveCover key={cover.tile.book.id} cover={cover} edits={edits} />
              ))}
              <Animated.View pointerEvents="none" className="absolute border-navigation-active" style={borderStyle} />
            </Animated.View>
            {loading && showLoading && (
              <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                <ActivityIndicator />
              </View>
            )}
          </View>
        </GestureDetector>
      </View>
      <View className="gap-2 px-4 py-3">
        <Text
          numberOfLines={1}
          className="text-center text-sm font-medium text-foreground"
          style={{ minHeight: 24 * fontScale }}>
          {active?.tile.book.title ?? t('statistics.posterCropSelect')}
        </Text>
        <Text numberOfLines={2} className="text-center text-xs text-muted" style={{ minHeight: 32 * fontScale }}>
          {t(active ? 'statistics.posterCropGesture' : 'statistics.posterCropBrowse')}
        </Text>
        <View className="flex-row gap-3">
          <Button
            className="flex-1"
            variant="secondary"
            onPress={() => {
              selected.set(null);
              setActive(undefined);
              cancelPending();
              outlineOpacity.set(withTiming(0, SELECTION_TRANSITION));
              camera.set(withTiming(fitPosterCamera(page.width, page.height, width, height), CAMERA_TRANSITION));
            }}>
            {t('statistics.posterCropOverview')}
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            isDisabled={!active}
            onPress={() => {
              if (active) edits.set({ ...edits.get(), [active.tile.book.id]: { ...DEFAULT_POSTER_CROP } });
            }}>
            {t('statistics.posterCropReset')}
          </Button>
        </View>
        {failed && (
          <Button
            variant="ghost"
            onPress={() => {
              setFailed(false);
              if (desired.current) void select(desired.current, false);
            }}>
            {t('statistics.retry')}
          </Button>
        )}
      </View>
    </View>
  );
}

export function PosterCoverEditor(props: {
  page: PosterPage;
  labels: PosterLabels;
  uri: string;
  initialId?: string;
  crops: Record<string, PosterCrop>;
  onCancel: () => void;
  onApply: (crops: Record<string, PosterCrop>) => void;
}) {
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState<{ width: number; height: number }>();
  return (
    <Modal visible animationType="slide" onRequestClose={props.onCancel}>
      <StyledGestureRoot
        unstable_forceActive
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View
          className="flex-1"
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setViewport((old) => (old?.width === width && old.height === height ? old : { width, height }));
          }}>
          {viewport && <PosterScene {...props} width={viewport.width} height={Math.max(120, viewport.height - 204)} />}
        </View>
      </StyledGestureRoot>
    </Modal>
  );
}
