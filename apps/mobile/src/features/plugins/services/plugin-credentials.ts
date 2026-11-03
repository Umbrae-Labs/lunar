import type { CredentialStatus } from '@umbrae-labs/lunar-plugin-sdk';
import type { PluginCredentialContribution } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import { LunarPluginError } from '../domain/plugin-error';
import { assertRequestAllowed, type HostHeaders } from './plugin-network';

/** What the app keeps about a configured credential outside the secure store; never the key. */
export interface PluginCredentialRecord {
  /** Normalized HTTPS address; the key is only sent to URLs under it. */
  readonly baseUrl: string;
  readonly updatedAt: number;
}

export interface PluginCredentialAccess {
  get(pluginId: string, credentialId: string): PluginCredentialRecord | undefined;
  subscribe(listener: () => void): () => void;
  readSecret(pluginId: string, credentialId: string): Promise<string | undefined>;
}

export const CREDENTIAL_LIMITS = {
  secretCharacters: 4_096,
} as const;

/**
 * Reduces user input to `https://host[:port][/path]` without a trailing slash, query or fragment.
 * Throws for addresses the network layer would refuse.
 */
export function normalizeCredentialBaseUrl(input: string): string {
  const url = assertRequestAllowed({ url: input.trim() });
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Whether `url` is the base address or lies below it, path segment by path segment. */
export function isUnderBaseUrl(url: URL, baseUrl: string): boolean {
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return false;
  const prefix = base.pathname.replace(/\/+$/, '');
  return prefix === '' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

export function credentialStatus(id: string, record: PluginCredentialRecord | undefined): CredentialStatus {
  return record ? { id, configured: true, baseUrl: record.baseUrl } : { id, configured: false };
}

export type CredentialSavePlan =
  | { readonly ok: true; readonly baseUrl: string; readonly secret?: string }
  | { readonly ok: false; readonly problem: 'invalidUrl' | 'secretRequired' | 'invalidSecret' };

/**
 * Decides what saving the credential form writes. An empty key keeps the stored one, unless the
 * address moves to another host: a key entered for one service is not handed to a different one.
 */
export function planCredentialSave(
  current: PluginCredentialRecord | undefined,
  input: { readonly baseUrl: string; readonly secret: string },
): CredentialSavePlan {
  let baseUrl: string;
  try {
    baseUrl = normalizeCredentialBaseUrl(input.baseUrl);
  } catch {
    return { ok: false, problem: 'invalidUrl' };
  }
  const secret = input.secret.trim();
  if (secret) {
    // The key becomes a header value: line breaks or control characters would split the header.
    if (secret.length > CREDENTIAL_LIMITS.secretCharacters || /[\u0000-\u001f\u007f]/.test(secret)) {
      return { ok: false, problem: 'invalidSecret' };
    }
    return { ok: true, baseUrl, secret };
  }
  if (!current || new URL(current.baseUrl).origin !== new URL(baseUrl).origin) {
    return { ok: false, problem: 'secretRequired' };
  }
  return { ok: true, baseUrl };
}

/** The header a request that names this credential carries; refuses URLs outside its address. */
export async function credentialHeaders(
  access: PluginCredentialAccess,
  pluginId: string,
  definition: PluginCredentialContribution,
  requestUrl: string,
): Promise<HostHeaders> {
  const url = assertRequestAllowed({ url: requestUrl });
  const record = access.get(pluginId, definition.id);
  if (!record) {
    throw new LunarPluginError('CREDENTIAL_REQUIRED', `Credential "${definition.id}" has not been set up`);
  }
  if (!isUnderBaseUrl(url, record.baseUrl)) {
    throw new LunarPluginError(
      'PERMISSION_DENIED',
      `Credential "${definition.id}" may only be sent to ${record.baseUrl}`,
    );
  }
  const secret = await access.readSecret(pluginId, definition.id);
  if (!secret) {
    throw new LunarPluginError('CREDENTIAL_REQUIRED', `Credential "${definition.id}" has not been set up`);
  }
  return { [definition.header]: `${definition.prefix}${secret}` };
}
