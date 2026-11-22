import { useRouter, type Href } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useState, useSyncExternalStore } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Icon, type IconSource } from '@/components/ui/icon';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { FILE_DOWNLOAD_KIND } from '../domain/plugin-download';
import type { HostDownload } from '../services/plugin-download-queue';
import type { PluginHost } from '../services/plugin-host';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { PluginScreenHeader } from '../components/plugin-screen-header';

type Translate = ReturnType<typeof useTranslation>['t'];

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
  const foreground = useThemeColor('foreground');
  const hasFinished = downloads.some((download) => download.status === 'completed' || download.status === 'failed');

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader
        title={t('plugins.downloads.title')}
        fallback={'/plugins' as Href}
        trailing={
          hasFinished ? (
            <Button
              accessibilityLabel={t('plugins.downloads.clearFinished')}
              className="h-9 rounded-full"
              onPress={() => void host.downloads.clearFinished()}
              size="sm"
              variant="secondary">
              <Button.Label>{t('plugins.downloads.clearFinished')}</Button.Label>
            </Button>
          ) : null
        }
      />
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

function DownloadRow({
  download,
  pluginName,
  onRead,
  onRemove,
}: {
  readonly download: HostDownload;
  readonly pluginName: string;
  readonly onRead: (bookId: string) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const host = usePluginRuntime().host;
  const [foreground, danger] = useThemeColor(['foreground', 'danger']);
  const status = statusText(download, t);
  const progress = progressText(download, t);
  const fraction =
    download.progress?.total && download.progress.total > 0
      ? Math.min(1, download.progress.completed / download.progress.total)
      : undefined;
  const active = download.status === 'running' || download.status === 'queued';
  const action = primaryAction(download, t);
  const showError = download.error && (download.status === 'failed' || download.status === 'queued');

  return (
    <View className="w-full max-w-[800px] flex-row items-start gap-3 self-center border-b border-border py-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
          {download.title}
        </Text>
        {download.subtitle ? (
          <Text className="text-sm text-muted" numberOfLines={1}>
            {download.subtitle}
          </Text>
        ) : null}
        <Text
          className={`text-xs leading-4 ${download.status === 'failed' ? 'text-danger' : 'text-muted'}`}
          numberOfLines={2}>
          {[pluginName, status, progress].filter(Boolean).join(' · ')}
        </Text>
        {active ? (
          <View
            accessibilityRole="progressbar"
            accessibilityValue={
              fraction === undefined ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) }
            }
            className="mt-1 h-1 overflow-hidden rounded-full bg-surface-secondary">
            {/* Unknown totals show a short bar rather than a misleading fraction. */}
            <View className="h-full rounded-full bg-accent" style={{ width: `${(fraction ?? 0.08) * 100}%` }} />
          </View>
        ) : null}
        {showError ? (
          <Text selectable className="text-xs leading-4 text-danger" numberOfLines={3}>
            {download.error}
          </Text>
        ) : null}
        {download.warnings.length > 0 ? (
          <Text selectable className="text-xs leading-4 text-muted" numberOfLines={3}>
            {`${t('plugins.downloads.warnings', { count: download.warnings.length })}: ${download.warnings.join('；')}`}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-1">
        {action ? (
          <Button
            isIconOnly
            accessibilityLabel={`${action.label} ${download.title}`}
            className="size-10 rounded-full"
            onPress={() => {
              if (action.kind === 'pause') host.downloads.pause(download.id);
              else if (action.kind === 'resume') host.downloads.resume(download.id);
              else if (download.bookId) onRead(download.bookId);
            }}
            size="sm"
            variant="secondary">
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
          <Icon name="delete" size={18} color={download.status === 'failed' ? danger : foreground} />
        </Button>
      </View>
    </View>
  );
}

function pluginName(host: PluginHost, pluginId: string): string {
  const entry = host.getEntry(pluginId);
  return entry ? host.localize(pluginId, entry.plugin.manifest.name) : pluginId;
}

function statusText(download: HostDownload, t: Translate): string {
  switch (download.status) {
    case 'queued':
      return download.error
        ? t('plugins.downloads.waitingRetry', { attempt: download.attempts })
        : t('plugins.downloads.queued');
    case 'running':
      return download.phase === 'importing' ? t('plugins.downloads.importing') : t('plugins.downloads.downloading');
    case 'paused':
      return download.pauseReason === 'interrupted'
        ? t('plugins.downloads.interrupted')
        : download.pauseReason === 'disabled'
          ? t('plugins.downloads.disabled')
          : t('plugins.downloads.paused');
    case 'failed':
      return t('plugins.downloads.failed');
    case 'completed':
      return t('plugins.downloads.completed');
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

function primaryAction(
  download: HostDownload,
  t: Translate,
): { readonly kind: 'pause' | 'resume' | 'read'; readonly label: string; readonly icon: IconSource } | undefined {
  switch (download.status) {
    case 'queued':
    case 'running':
      // An import under way finishes regardless; pausing it would do nothing.
      return download.phase === 'importing'
        ? undefined
        : { kind: 'pause', label: t('plugins.downloads.pause'), icon: 'pause' };
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
