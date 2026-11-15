import { Image as ExpoImage } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
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
import { downloadOffer, usePluginCatalogs } from '../hooks/use-plugin-catalogs';
import { usePluginInstall } from '../hooks/use-plugin-install';
import { localizeCatalogEntry, resolveCatalogUrl, type CatalogOffer } from '../services/plugin-catalog';

const Image = withUniwind(ExpoImage);

const PLUGINS_TAB = '/(tabs)/plugins' as Href;
// Catalogs are added and removed in plugin settings.
const CATALOGS_ROUTE = '/settings/plugins' as Href;
const STATE_ORDER: Record<CatalogOffer['state'], number> = { update: 0, install: 1, installed: 2, incompatible: 3 };

const offerKey = (offer: CatalogOffer) => `${offer.catalogUrl}\u0000${offer.entry.id}`;

/** Plugins offered by the catalogs the user added. */
export function PluginCatalogScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useMarkInitialContentReady(true);
  const foreground = useThemeColor('foreground');
  const { subscriptions, statuses, offers, refresh, isRefreshing } = usePluginCatalogs();
  const { inspect, dialogProps } = usePluginInstall();
  const [downloading, setDownloading] = useState<string>();
  const sorted = [...offers].sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.entry.name.localeCompare(right.entry.name),
  );
  const failures = subscriptions.flatMap((catalog) => {
    const status = statuses.get(catalog.url);
    return status?.state === 'failed'
      ? [{ catalog, message: status.keyChanged ? t('plugins.catalog.keyChanged') : status.error }]
      : [];
  });

  const install = async (offer: CatalogOffer) => {
    setDownloading(offerKey(offer));
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
      <PluginScreenHeader
        title={t('plugins.catalog.title')}
        fallback={PLUGINS_TAB}
        trailing={
          <Button
            isIconOnly
            accessibilityLabel={t('plugins.catalog.manage')}
            className="size-12 rounded-full"
            variant="ghost"
            onPress={() => router.push(CATALOGS_ROUTE)}>
            <Icon name="settings" size={22} color={foreground} />
          </Button>
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow px-4 pt-2"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={
          subscriptions.length > 0 ? (
            <RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh(true)} />
          ) : undefined
        }>
        <View className="w-full max-w-[800px] grow gap-4 self-center">
          {subscriptions.length === 0 ? (
            <View className="grow items-center justify-center gap-3 px-6 pb-16">
              <View className="size-16 items-center justify-center rounded-3xl border border-border bg-surface">
                <Icon name={pluginIconSource(undefined)} size={30} color={foreground} />
              </View>
              <Text className="text-base font-semibold text-foreground">{t('plugins.catalog.empty')}</Text>
              <Button variant="primary" onPress={() => router.push(CATALOGS_ROUTE)}>
                {t('plugins.catalog.add')}
              </Button>
            </View>
          ) : null}

          {failures.map(({ catalog, message }) => (
            <View key={catalog.url} className="gap-1 rounded-3xl bg-surface p-4">
              <Text className="text-sm font-semibold text-foreground">{catalog.name}</Text>
              <Text className="text-sm leading-5 text-danger">{message}</Text>
            </View>
          ))}

          {subscriptions.length > 0 && sorted.length === 0 && isRefreshing ? (
            <View className="items-center py-8">
              <Spinner />
            </View>
          ) : null}

          {sorted.length > 0 ? (
            <View className="gap-1">
              {sorted.map((offer) => (
                <OfferRow
                  key={offerKey(offer)}
                  offer={offer}
                  isDownloading={downloading === offerKey(offer)}
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
  let iconUri: string | undefined;
  try {
    iconUri = offer.entry.icon ? resolveCatalogUrl(offer.catalogUrl, offer.entry.icon) : undefined;
  } catch {
    iconUri = undefined;
  }
  const detail = [
    offer.state === 'update' && offer.installedVersion
      ? `${offer.installedVersion} → ${offer.entry.version}`
      : offer.entry.version,
    offer.badge ?? offer.catalogName,
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
