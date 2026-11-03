import { strFromU8 } from 'fflate';
import type { NetworkRequest, NetworkResponse } from '@umbrae-labs/lunar-plugin-sdk';
import { LunarPluginError } from '../domain/plugin-error';

export const NETWORK_LIMITS = {
  timeoutMs: 30_000,
  responseBytes: 16 * 1024 * 1024,
  requestBodyCharacters: 1024 * 1024,
  concurrentRequests: 4,
} as const;

const ForbiddenHeaders = new Set([
  'host',
  'cookie',
  'cookie2',
  'origin',
  'referer',
  'connection',
  'content-length',
  'transfer-encoding',
  'proxy-authorization',
]);

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Checks that a request goes to a public HTTPS host. Name resolution happens in the platform
 * network stack, so addresses are checked as written; literal private and loopback hosts are refused.
 * Which hosts a plugin talks to is not restricted: a `full` plugin can reach the global `fetch`
 * anyway, so the `network` permission states the purpose rather than drawing a boundary.
 */
export function assertRequestAllowed(request: NetworkRequest): URL {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new LunarPluginError('INVALID_ARGUMENT', 'The request URL is invalid');
  }
  if (url.protocol !== 'https:') throw new LunarPluginError('NETWORK_DENIED', 'Only HTTPS requests are allowed');
  if (url.username || url.password) throw new LunarPluginError('NETWORK_DENIED', 'URLs must not embed credentials');
  if (isPrivateHost(url.hostname)) throw new LunarPluginError('NETWORK_DENIED', 'Local network hosts are not allowed');
  return url;
}

export function createPluginNetwork(fetchImpl: FetchLike) {
  const active = new Map<string, number>();

  return async function request(
    pluginId: string,
    request: NetworkRequest,
    lifetime: AbortSignal,
  ): Promise<NetworkResponse> {
    const url = assertRequestAllowed(request);
    const method = request.method ?? 'GET';
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new LunarPluginError('INVALID_ARGUMENT', `Method ${String(method)} is not supported`);
    }
    const responseType = request.responseType ?? 'text';
    if (responseType !== 'text' && responseType !== 'bytes') {
      throw new LunarPluginError('INVALID_ARGUMENT', 'The response type must be text or bytes');
    }
    if (request.body !== undefined && request.body.length > NETWORK_LIMITS.requestBodyCharacters) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'The request body is too large');
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (ForbiddenHeaders.has(name.toLowerCase()) || name.toLowerCase().startsWith('sec-')) {
        throw new LunarPluginError('INVALID_ARGUMENT', `Header ${name} cannot be set by plugins`);
      }
      headers[name] = String(value);
    }
    if ((active.get(pluginId) ?? 0) >= NETWORK_LIMITS.concurrentRequests) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'Too many concurrent requests');
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(
      abort,
      Math.min(request.timeoutMs ?? NETWORK_LIMITS.timeoutMs, NETWORK_LIMITS.timeoutMs),
    );
    lifetime.addEventListener('abort', abort);
    request.signal?.addEventListener('abort', abort);
    active.set(pluginId, (active.get(pluginId) ?? 0) + 1);
    try {
      const response = await fetchImpl(url.href, {
        method,
        headers,
        body: request.body,
        signal: controller.signal,
        credentials: 'omit',
      });
      // React Native follows redirects itself; a redirect to plain HTTP or a local host is withheld.
      if (response.url && response.url !== url.href) assertRequestAllowed({ url: response.url });
      const bytes = await readResponseBytes(response, NETWORK_LIMITS.responseBytes);
      const body = responseType === 'bytes' ? '' : strFromU8(bytes);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'set-cookie') responseHeaders[name.toLowerCase()] = value;
      });
      return {
        status: response.status,
        headers: responseHeaders,
        body,
        bytes,
        json<T>() {
          try {
            return JSON.parse(body) as T;
          } catch {
            throw new LunarPluginError('INVALID_ARGUMENT', 'The response is not valid JSON');
          }
        },
      };
    } catch (error) {
      if (error instanceof LunarPluginError) throw error;
      if (controller.signal.aborted) {
        throw request.signal?.aborted || lifetime.aborted
          ? new LunarPluginError('CANCELLED', 'The request was cancelled')
          : new LunarPluginError('TIMEOUT', 'The request timed out');
      }
      throw new LunarPluginError('NETWORK_DENIED', 'The request failed', true);
    } finally {
      clearTimeout(timeout);
      lifetime.removeEventListener('abort', abort);
      request.signal?.removeEventListener('abort', abort);
      active.set(pluginId, (active.get(pluginId) ?? 1) - 1);
    }
  };
}

export type PluginNetwork = ReturnType<typeof createPluginNetwork>;

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new LunarPluginError('QUOTA_EXCEEDED', 'The response is too large');
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new LunarPluginError('QUOTA_EXCEEDED', 'The response is too large');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new LunarPluginError('QUOTA_EXCEEDED', 'The response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (host.includes(':')) {
    return (
      host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
    );
  }
  return false;
}
