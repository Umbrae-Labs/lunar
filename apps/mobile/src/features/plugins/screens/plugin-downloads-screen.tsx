import { Image as ExpoImage } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Spinner } from 'heroui-native/spinner';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, withUniwind } from 'uniwind';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Icon, type IconSource } from '@/components/ui/icon';
import { findLibraryBookById } from '@/features/library';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { Fonts } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { FILE_DOWNLOAD_KIND } from '../domain/plugin-download';
import type { HostDownload } from '../services/plugin-download-queue';
import type { PluginHost } from '../services/plugin-host';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';
import { ProgressCircle } from '../components/progress-circle';

type Translate = ReturnType<typeof useTranslation>['t'];

const CoverImage = withUniwind(ExpoImage);
const COVER_ASPECT_RATIO = 2 / 3;
const RING_SIZE = 30;

/** Every plugin download with its progress, and the controls to pause, resume, retry or remove it. */
export function PluginDownloadsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useMarkInitialContentReady(true);
  const host = usePluginRuntime().host;
  const downloads = useSyncExternalStore(host.downloads.subscribe, host.downloads.getSnapshot);
  // The host's plugin list changes names and enabled state shown in each row.
  useSyncExternalStore(host.subscribe, host.getVersion);
  const [removing, setRemoving] = useState<HostDownload>();
  const [libraryCovers, setLibraryCovers] = useState<Readonly<Record<string, string | undefined>>>({});
  const lookedUpBookIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const foreground = useThemeColor('foreground');
  const hasFinished = downloads.some((download) => download.status === 'completed' || download.status === 'failed');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Hydrate covers from the library for completed records that predate persisted coverUri.
  useEffect(() => {
    const missingBookIds = [
      ...new Set(
        downloads
          .map((download) => (!download.coverUri && download.bookId ? download.bookId : undefined))
          .filter((bookId): bookId is string => bookId !== undefined && !lookedUpBookIdsRef.current.has(bookId)),
      ),
    ];
    if (missingBookIds.length === 0) return;

    for (const bookId of missingBookIds) lookedUpBookIdsRef.current.add(bookId);
    void Promise.all(
      missingBookIds.map(async (bookId) => {
        try {
          const book = await findLibraryBookById(bookId);
          return [bookId, book?.coverUri] as const;
        } catch {
          return [bookId, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (!mountedRef.current) return;
      const found = entries.filter(([, coverUri]) => Boolean(coverUri));
      if (found.length === 0) return;
      setLibraryCovers((current) => ({ ...current, ...Object.fromEntries(found) }));
    });
  }, [downloads]);

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader title={t('plugins.downloads.title')} fallback={'/(tabs)/plugins' as Href} />
      <FlatList
        data={downloads}
        keyExtractor={(download) => download.id}
        contentContainerClassName="grow px-4 pt-2"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        ListEmptyComponent={
          <View className="grow items-center justify-center gap-3 px-6 pb-16">
            <View className="size-16 items-center justify-center rounded-3xl border border-border bg-surface">
              <Icon name="download" size={28} color={foreground} />
            </View>
            <Text className="text-base font-semibold text-foreground">{t('plugins.downloads.empty')}</Text>
            <Text className="text-center text-sm leading-5 text-muted">{t('plugins.downloads.emptyHint')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <DownloadRow
            coverSource={item.coverUri ?? (item.bookId ? libraryCovers[item.bookId] : undefined) ?? item.coverUrl}
            download={item}
            pluginName={pluginName(host, item.pluginId)}
            onRead={(bookId) => router.push({ pathname: '/reader/[bookId]', params: { bookId } } as unknown as Href)}
            onRemove={() => setRemoving(item)}
          />
        )}
      />
      <ConfirmModal
        isOpen={Boolean(removing)}
        title={t('plugins.downloads.removeTitle', { title: removing?.title ?? '' })}
        description={
          removing?.status === 'completed' || removing?.status === 'failed'
            ? t('plugins.downloads.removeFinished')
            : t('plugins.downloads.removeRunning')
        }
        confirmLabel={t('plugins.downloads.remove')}
        isDestructive
        onConfirm={() => {
          if (removing) void host.downloads.remove(removing.id);
          setRemoving(undefined);
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      />
    </View>
  );
}

function DownloadCover({ title, uri }: { readonly title: string; readonly uri?: string }) {
  const { t } = useTranslation();
  const [failedUri, setFailedUri] = useState<string>();
  const showImage = Boolean(uri) && failedUri !== uri;
  const mark = Array.from(title.trim())[0] ?? t('library.fallbackBookMark');

  return (
    <View
      className="w-11 items-center justify-center overflow-hidden rounded bg-surface-secondary"
      style={{ aspectRatio: COVER_ASPECT_RATIO }}>
      {showImage ? (
        <CoverImage
          accessible={false}
          cachePolicy="memory-disk"
          className="h-full w-full"
          contentFit="cover"
          onError={() => setFailedUri(uri)}
          source={uri}
          transition={120}
        />
      ) : (
        <Text className="text-xl font-normal text-muted" style={{ fontFamily: Fonts.serif }}>
          {mark}
        </Text>
      )}
    </View>
  );
}

function DownloadRow({
  coverSource,
  download,
  pluginName,
  onRead,
  onRemove,
}: {
  readonly coverSource?: string;
  readonly download: HostDownload;
  readonly pluginName: string;
  readonly onRead: (bookId: string) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const host = usePluginRuntime().host;
  const [foreground, danger] = useThemeColor(['foreground', 'danger']);
  const accent = useCSSVariable('--color-navigation-active') as string;
  const progress = progressText(download, t);
  const status = statusText(download, t, Boolean(progress));
  const fraction =
    download.progress?.total && download.progress.total > 0
      ? Math.min(1, download.progress.completed / download.progress.total)
      : undefined;
  const active = download.status === 'running' || download.status === 'queued';
  const action = secondaryAction(download, t);
  const showError = download.error && (download.status === 'failed' || download.status === 'queued');

  return (
    <View className="w-full max-w-[800px] flex-row items-center gap-3 self-center border-b border-border py-3">
      <DownloadCover title={download.title} uri={coverSource} />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
          {download.title}
        </Text>
        <Text
          className={`text-xs leading-4 ${download.status === 'failed' ? 'text-danger' : 'text-muted'}`}
          numberOfLines={2}>
          {[pluginName, status, progress].filter(Boolean).join(' · ')}
        </Text>
        {showError ? (
          <Text selectable className="text-xs leading-4 text-danger" numberOfLines={3}>
            {download.error}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-1">
        {active ? (
          download.phase === 'importing' ? (
            <View className="size-10 items-center justify-center">
              <Spinner size="sm" />
            </View>
          ) : (
            <Button
              isIconOnly
              accessibilityLabel={`${t('plugins.downloads.pause')} ${download.title}`}
              accessibilityValue={
                fraction === undefined ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) }
              }
              className="size-10 rounded-full"
              onPress={() => host.downloads.pause(download.id)}
              size="sm"
              variant="ghost">
              <ProgressCircle size={RING_SIZE} value={fraction ?? 0}>
                <Icon name="pause" size={12} color={accent} />
              </ProgressCircle>
            </Button>
          )
        ) : action ? (
          <Button
            isIconOnly
            accessibilityLabel={`${action.label} ${download.title}`}
            className="size-10 rounded-full"
            onPress={() => {
              if (action.kind === 'resume') host.downloads.resume(download.id);
              else if (download.bookId) onRead(download.bookId);
            }}
            size="sm"
            variant="ghost">
            <Icon name={action.icon} size={18} color={foreground} />
          </Button>
        ) : null}
        <Button
          isIconOnly
          accessibilityLabel={`${t('plugins.downloads.remove')} ${download.title}`}
          className="size-10 rounded-full"
          onPress={onRemove}
          size="sm"
          variant="ghost">
          <Icon name="delete" size={18} color={danger} />
        </Button>
      </View>
    </View>
  );
}

function pluginName(host: PluginHost, pluginId: string): string {
  const entry = host.getEntry(pluginId);
  return entry ? host.localize(pluginId, entry.plugin.manifest.name) : pluginId;
}

function statusText(download: HostDownload, t: Translate, hasProgress: boolean): string | undefined {
  switch (download.status) {
    case 'queued':
      return download.error
        ? t('plugins.downloads.waitingRetry', { attempt: download.attempts })
        : t('plugins.downloads.queued');
    case 'running':
      if (download.phase === 'importing') return t('plugins.downloads.importing');
      return hasProgress ? undefined : t('plugins.downloads.downloading');
    case 'paused':
      return download.pauseReason === 'interrupted'
        ? t('plugins.downloads.interrupted')
        : download.pauseReason === 'disabled'
          ? t('plugins.downloads.disabled')
          : t('plugins.downloads.paused');
    case 'failed':
      return t('plugins.downloads.failed');
    case 'completed':
      return undefined;
  }
}

function progressText(download: HostDownload, t: Translate): string | undefined {
  const progress = download.progress;
  if (download.status !== 'running' || !progress || download.phase === 'importing') return undefined;
  if (download.kind === FILE_DOWNLOAD_KIND) {
    return progress.total
      ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}`
      : formatBytes(progress.completed);
  }
  const counted =
    progress.total !== undefined
      ? t('plugins.downloads.progress', { completed: progress.completed, total: progress.total })
      : undefined;
  return [counted, progress.label].filter(Boolean).join(' · ') || undefined;
}

function secondaryAction(
  download: HostDownload,
  t: Translate,
): { readonly kind: 'resume' | 'read'; readonly label: string; readonly icon: IconSource } | undefined {
  switch (download.status) {
    case 'queued':
    case 'running':
      return undefined;
    case 'paused':
      return { kind: 'resume', label: t('plugins.downloads.resume'), icon: 'play' };
    case 'failed':
      return { kind: 'resume', label: t('plugins.downloads.retry'), icon: 'retry' };
    case 'completed':
      return download.bookId ? { kind: 'read', label: t('plugins.downloads.read'), icon: 'book' } : undefined;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
