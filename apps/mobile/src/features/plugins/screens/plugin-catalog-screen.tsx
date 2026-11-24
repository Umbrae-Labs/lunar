import { Image as ExpoImage } from 'expo-image';
import { type Href } from 'expo-router';
import { Input } from 'heroui-native/input';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Spinner } from 'heroui-native/spinner';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { Icon } from '@/components/ui/icon';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import { pluginIconSource } from '../domain/plugin-icons';
import { PluginInstallDialog } from '../components/plugin-install-dialog';
import { PluginScreenHeader } from '../components/plugin-screen-header';
import { downloadGithub, downloadOffer, usePluginCatalogs } from '../hooks/use-plugin-catalogs';
import { usePluginInstall } from '../hooks/use-plugin-install';
import { localizeCatalogEntry, type CatalogOffer } from '../services/plugin-catalog';

const Image = withUniwind(ExpoImage);

const PLUGINS_TAB = '/(tabs)/plugins' as Href;
const STATE_ORDER: Record<CatalogOffer['state'], number> = { update: 0, install: 1, installed: 2, incompatible: 3 };

/** Browse reviewed releases or inspect a GitHub download. */
export function PluginCatalogScreen() {
  const { t } = useTranslation();
  const [githubUrl, setGithubUrl] = useState('');
  const insets = useSafeAreaInsets();
  useMarkInitialContentReady(true);
  const { error, offers, refresh, isRefreshing } = usePluginCatalogs();
  const { inspect, dialogProps } = usePluginInstall();
  const [downloading, setDownloading] = useState<string>();
  const sorted = [...offers].sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.entry.name.localeCompare(right.entry.name),
  );
  const install = async (offer: CatalogOffer) => {
    setDownloading(offer.entry.id);
    try {
      await inspect(downloadOffer(offer));
    } finally {
      setDownloading(undefined);
    }
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <PluginScreenHeader title={t('plugins.catalog.title')} fallback={PLUGINS_TAB} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow px-4 pt-2"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh(true)} />}>
        <View className="w-full max-w-[800px] grow gap-4 self-center">
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">{t('plugins.catalog.github')}</Text>
            <Input
              accessibilityLabel={t('plugins.catalog.github')}
              placeholder="https://github.com/owner/plugin"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={githubUrl}
              onChangeText={setGithubUrl}
            />
            <Button
              variant="secondary"
              isDisabled={!githubUrl.trim() || downloading !== undefined}
              onPress={async () => {
                setDownloading('github');
                try {
                  await inspect(downloadGithub(githubUrl));
                } finally {
                  setDownloading(undefined);
                }
              }}>
              {downloading === 'github' ? <Spinner size="sm" /> : t('plugins.catalog.githubDownload')}
            </Button>
          </View>
          {!isRefreshing && !error && sorted.length === 0 ? (
            <Text className="text-sm text-muted">{t('plugins.catalog.empty')}</Text>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" className="text-sm text-danger">
              {error}
            </Text>
          ) : null}

          {sorted.length === 0 && isRefreshing ? (
            <View className="items-center py-8">
              <Spinner />
            </View>
          ) : null}

          {sorted.length > 0 ? (
            <View className="gap-1">
              {sorted.map((offer) => (
                <OfferRow
                  key={offer.entry.id}
                  offer={offer}
                  isDownloading={downloading === offer.entry.id}
                  isDisabled={downloading !== undefined}
                  onInstall={() => void install(offer)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
      <PluginInstallDialog {...dialogProps} />
    </View>
  );
}

function OfferRow({
  offer,
  isDownloading,
  isDisabled,
  onInstall,
}: {
  readonly offer: CatalogOffer;
  readonly isDownloading: boolean;
  readonly isDisabled: boolean;
  readonly onInstall: () => void;
}) {
  const { t, i18n } = useTranslation();
  const foreground = useThemeColor('foreground');
  const { name, description } = localizeCatalogEntry(offer.entry, i18n.language);
  const iconUri = offer.entry.icon;
  const detail = [
    offer.state === 'update' && offer.installedVersion
      ? `${offer.installedVersion} → ${offer.entry.version}`
      : offer.entry.version,
    offer.entry.author ?? offer.entry.package.split('/')[3],
    offer.state === 'incompatible' ? t('plugins.catalog.needsSdk', { sdk: offer.entry.sdk }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const actionable = offer.state === 'install' || offer.state === 'update';

  return (
    <View className="flex-row items-center gap-4 rounded-3xl px-2 py-3">
      <View className="size-14 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface">
        {iconUri ? (
          <Image className="absolute inset-0 h-full w-full" contentFit="cover" source={{ uri: iconUri }} />
        ) : (
          <Icon name={pluginIconSource(undefined)} size={26} color={foreground} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {name}
        </Text>
        {description ? (
          <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <Text className="text-xs leading-4 text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Button
        accessibilityLabel={`${t(`plugins.catalog.action.${offer.state}`)} ${name}`}
        isDisabled={!actionable || isDisabled}
        onPress={onInstall}
        size="sm"
        variant={offer.state === 'update' ? 'primary' : 'secondary'}>
        {isDownloading ? <Spinner size="sm" /> : t(`plugins.catalog.action.${offer.state}`)}
      </Button>
    </View>
  );
}
