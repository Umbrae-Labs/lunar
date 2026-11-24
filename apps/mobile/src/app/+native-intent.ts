import { redirectExternalEpub } from '@/features/library';
import { redirectExternalPluginPackage } from '@/features/plugins';

export async function redirectSystemPath(event: { path: string; initial: boolean }): Promise<string> {
  return (await redirectExternalPluginPackage(event)) ?? redirectExternalEpub(event);
}
