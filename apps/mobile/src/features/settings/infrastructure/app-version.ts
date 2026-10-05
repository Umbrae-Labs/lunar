import Constants from 'expo-constants';

export function getAppVersionLabel(): string | undefined {
  const config = Constants.expoConfig;
  const version = config?.version;
  if (!version || config.extra?.buildVariant !== 'nightly') return version;

  const commit: unknown = config.extra.buildCommit;
  const shortCommit = typeof commit === 'string' && /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 7) : undefined;
  return shortCommit ? `${version} Nightly · ${shortCommit}` : `${version} Nightly`;
}
