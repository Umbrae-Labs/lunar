import { describe, expect, it } from 'vitest';

import {
  credentialHeaders,
  isUnderBaseUrl,
  normalizeCredentialBaseUrl,
  planCredentialSave,
} from '../../src/features/plugins/services/plugin-credentials';
import { memoryCredentials, manifest } from './plugin-test-support';

const definition = { id: 'api', title: 'API key', header: 'Authorization', prefix: 'Bearer ' };

describe('plugin credentials', () => {
  it('normalizes the address the user enters', () => {
    expect(normalizeCredentialBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(normalizeCredentialBaseUrl('https://api.example.com/?q=1#x')).toBe('https://api.example.com');
    expect(() => normalizeCredentialBaseUrl('http://api.example.com')).toThrow();
    expect(() => normalizeCredentialBaseUrl('https://192.168.1.2')).toThrow();
  });

  it('matches whole path segments under the base address', () => {
    const base = 'https://api.example.com/v1';
    expect(isUnderBaseUrl(new URL('https://api.example.com/v1'), base)).toBe(true);
    expect(isUnderBaseUrl(new URL('https://api.example.com/v1/chat/completions'), base)).toBe(true);
    expect(isUnderBaseUrl(new URL('https://api.example.com/v10/chat'), base)).toBe(false);
    expect(isUnderBaseUrl(new URL('https://api.example.com.evil.net/v1'), base)).toBe(false);
    expect(isUnderBaseUrl(new URL('https://api.example.com:8443/v1'), base)).toBe(false);
    expect(isUnderBaseUrl(new URL('https://api.example.com/anything'), 'https://api.example.com')).toBe(true);
  });

  it('adds the header only for configured credentials and URLs under their address', async () => {
    const access = memoryCredentials();
    const header = (url: string) => credentialHeaders(access, 'org.example.test', definition, url);
    await expect(header('https://api.example.com/v1/chat')).rejects.toMatchObject({ code: 'CREDENTIAL_REQUIRED' });
    access.set('org.example.test', 'api', { baseUrl: 'https://api.example.com/v1', updatedAt: 1 }, 'sk-1');
    await expect(header('https://api.example.com/v1/chat')).resolves.toEqual({ Authorization: 'Bearer sk-1' });
    await expect(header('https://attacker.example.net/v1/chat')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(header('http://api.example.com/v1/chat')).rejects.toMatchObject({ code: 'NETWORK_DENIED' });
  });

  it('keeps the stored key only while the address stays on the same host', () => {
    const current = { baseUrl: 'https://api.example.com/v1', updatedAt: 1 };
    expect(planCredentialSave(undefined, { baseUrl: 'https://api.example.com', secret: '' })).toEqual({
      ok: false,
      problem: 'secretRequired',
    });
    expect(planCredentialSave(current, { baseUrl: 'https://api.example.com/v2', secret: '' })).toEqual({
      ok: true,
      baseUrl: 'https://api.example.com/v2',
    });
    expect(planCredentialSave(current, { baseUrl: 'https://other.example.com/v1', secret: '' })).toMatchObject({
      problem: 'secretRequired',
    });
    expect(planCredentialSave(current, { baseUrl: 'ftp://x', secret: 'k' })).toMatchObject({ problem: 'invalidUrl' });
    expect(planCredentialSave(current, { baseUrl: current.baseUrl, secret: 'a\nb' })).toMatchObject({
      problem: 'invalidSecret',
    });
    expect(planCredentialSave(undefined, { baseUrl: current.baseUrl, secret: ' sk-2 ' })).toEqual({
      ok: true,
      baseUrl: current.baseUrl,
      secret: 'sk-2',
    });
  });

  it('is declared in manifests that request network access', () => {
    const declared = manifest({
      permissions: [{ name: 'network', reason: 'AI' }],
      contributes: { credentials: [definition] },
    });
    expect(declared.contributes.credentials).toEqual([{ ...definition }]);
  });
});
