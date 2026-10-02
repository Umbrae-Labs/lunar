import type { ConfigContext, ExpoConfig } from 'expo/config';

const SUPPORTED_ANDROID_ABIS = new Set(['arm64-v8a']);

function getAndroidAbis(value: string | undefined): string[] | undefined {
  const abis = value
    ?.split(',')
    .map((abi) => abi.trim())
    .filter((abi) => SUPPORTED_ANDROID_ABIS.has(abi));

  return abis?.length ? abis : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const isDevelopment = process.env.APP_VARIANT === 'development';
  const isNightly = process.env.APP_VARIANT === 'nightly';
  const buildCommit = process.env.LUNAR_BUILD_COMMIT ?? process.env.LUNAR_SOURCE_COMMIT;
  const name = config.name ?? 'lunar';
  const androidPackage = config.android?.package ?? 'com.lunarain_079.lunar';
  const compactAndroidDevBuild = process.env.LUNAR_ANDROID_COMPACT_DEV_BUILD === 'true';
  const compactAndroidApk = compactAndroidDevBuild || process.env.LUNAR_ANDROID_COMPACT_APK === 'true';
  const buildArchs = getAndroidAbis(process.env.LUNAR_ANDROID_ABIS);

  return {
    ...config,
    name: isDevelopment ? `${name} Dev` : name,
    slug: config.slug ?? 'lunar',
    scheme: isDevelopment ? 'lunar-dev' : isNightly ? 'lunar-nightly' : config.scheme,
    extra: {
      ...config.extra,
      buildVariant: isDevelopment ? 'development' : isNightly ? 'nightly' : 'production',
      buildCommit: buildCommit && /^[0-9a-f]{40}$/i.test(buildCommit) ? buildCommit : undefined,
    },
    android: {
      ...config.android,
      package: isDevelopment ? `${androidPackage}.dev` : androidPackage,
      intentFilters: [
        ...(config.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          category: ['DEFAULT', 'BROWSABLE'],
          data: [
            { scheme: 'content', mimeType: 'application/epub+zip' },
            { scheme: 'file', mimeType: 'application/epub+zip' },
          ],
        },
        ...['SEND', 'SEND_MULTIPLE'].map((action) => ({
          action,
          category: ['DEFAULT'],
          data: [{ mimeType: 'application/epub+zip' }],
        })),
      ],
    },
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDocumentTypes: [
          ...(config.ios?.infoPlist?.CFBundleDocumentTypes ?? []),
          {
            CFBundleTypeName: 'EPUB',
            CFBundleTypeRole: 'Viewer',
            LSHandlerRank: 'Alternate',
            LSItemContentTypes: ['org.idpf.epub-container'],
          },
        ],
        UTImportedTypeDeclarations: [
          ...(config.ios?.infoPlist?.UTImportedTypeDeclarations ?? []),
          {
            UTTypeIdentifier: 'org.idpf.epub-container',
            UTTypeDescription: 'EPUB document',
            UTTypeConformsTo: ['public.data'],
            UTTypeTagSpecification: {
              'public.filename-extension': ['epub'],
              'public.mime-type': 'application/epub+zip',
            },
          },
        ],
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: isDevelopment }],
      '@umbrae-labs/rito-rn',
      'expo-localization',
      [
        'expo-media-library',
        {
          photosPermission: false,
          savePhotosPermission: '允许 Lunar 将书摘图片保存到相册。',
          granularPermissions: ['photo'],
          isAccessMediaLocationEnabled: false,
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            buildArchs,
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            // Compress standalone APK downloads; keep AAB packaging defaults.
            ...(compactAndroidApk && {
              enableBundleCompression: true,
              useLegacyPackaging: true,
            }),
            ...(compactAndroidDevBuild && { networkInspector: false }),
          },
        },
      ],
      './plugins/with-android-build-memory',
      'expo-asset',
    ],
  };
};
