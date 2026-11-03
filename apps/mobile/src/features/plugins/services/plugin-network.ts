import { DecodeUTF8, strFromU8 } from 'fflate';
import type {
  NetworkRequest,
  NetworkResponse,
  NetworkResponseHead,
  NetworkStreamRequest,
} from '@umbrae-labs/lunar-plugin-sdk';
import { isForbiddenRequestHeader } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { LunarPluginError } from '../domain/plugin-error';

export const NETWORK_LIMITS = {
  timeoutMs: 30_000,
  /** A stream may stay open this long in total; `timeoutMs` bounds each wait for data. */
  streamMs: 10 * 60_000,
  responseBytes: 16 * 1024 * 1024,
  requestBodyCharacters: 1024 * 1024,
  concurrentRequests: 4,
} as const;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Headers the host adds on the plugin's behalf, such as a credential. */
export type HostHeaders = Readonly<Record<string, string>>;

/**
 * Checks that a request goes to a public HTTPS host. Name resolution happens in the platform
 * network stack, so addresses are checked as written; literal private and loopback hosts are refused.
 * Which hosts a plugin talks to is not restricted: a `full` plugin can reach the global `fetch`
 * anyway, so the `network` permission states the purpose rather than drawing a boundary.
 */
export function assertRequestAllowed(request: Pick<NetworkRequest, 'url'>): URL {
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

/**
 * `streamingFetch` must deliver the body while it arrives and honour `redirect: 'error'`. It serves
 * streams and requests that carry a credential, which must not follow a redirect to another host.
 */
export function createPluginNetwork(fetchImpl: FetchLike, streamingFetch: FetchLike = fetchImpl) {
  const active = new Map<string, number>();

  /** Validates a request, then runs it inside the plugin's concurrency slot and abort wiring. */
  async function run<T>(
    pluginId: string,
    request: NetworkRequest | NetworkStreamRequest,
    lifetime: AbortSignal,
    options: { readonly hostHeaders?: HostHeaders; readonly streaming: boolean },
    read: (response: Response, timers: RequestTimers) => Promise<T>,
  ): Promise<T> {
    const url = assertRequestAllowed(request);
    const method = request.method ?? 'GET';
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new LunarPluginError('INVALID_ARGUMENT', `Method ${String(method)} is not supported`);
    }
    if (request.body !== undefined && request.body.length > NETWORK_LIMITS.requestBodyCharacters) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'The request body is too large');
    }
    const { hostHeaders } = options;
    const reserved = new Set(Object.keys(hostHeaders ?? {}).map((name) => name.toLowerCase()));
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (isForbiddenRequestHeader(name) || reserved.has(name.toLowerCase())) {
        throw new LunarPluginError('INVALID_ARGUMENT', `Header ${name} cannot be set by plugins`);
      }
      headers[name] = String(value);
    }
    Object.assign(headers, hostHeaders);
    if ((active.get(pluginId) ?? 0) >= NETWORK_LIMITS.concurrentRequests) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'Too many concurrent requests');
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const timers = new RequestTimers(
      abort,
      Math.min(request.timeoutMs ?? NETWORK_LIMITS.timeoutMs, NETWORK_LIMITS.timeoutMs),
    );
    lifetime.addEventListener('abort', abort);
    request.signal?.addEventListener('abort', abort);
    active.set(pluginId, (active.get(pluginId) ?? 0) + 1);
    try {
      const response = await (options.streaming || hostHeaders ? streamingFetch : fetchImpl)(url.href, {
        method,
        headers,
        body: request.body,
        signal: controller.signal,
        credentials: 'omit',
        // A credential goes only to the address the user confirmed, not to wherever that redirects.
        redirect: hostHeaders ? 'error' : 'follow',
      });
      // React Native follows redirects itself; a redirect to plain HTTP or a local host is withheld.
      if (response.url && response.url !== url.href) assertRequestAllowed({ url: response.url });
      return await read(response, timers);
    } catch (error) {
      if (timers.failure !== undefined) throw timers.failure;
      if (error instanceof LunarPluginError) throw error;
      if (controller.signal.aborted) {
        throw request.signal?.aborted || lifetime.aborted
          ? new LunarPluginError('CANCELLED', 'The request was cancelled')
          : new LunarPluginError('TIMEOUT', 'The request timed out');
      }
      throw new LunarPluginError('NETWORK_DENIED', 'The request failed', true);
    } finally {
      timers.clear();
      lifetime.removeEventListener('abort', abort);
      request.signal?.removeEventListener('abort', abort);
      active.set(pluginId, (active.get(pluginId) ?? 1) - 1);
    }
  }

  return {
    async request(
      pluginId: string,
      request: NetworkRequest,
      lifetime: AbortSignal,
      hostHeaders?: HostHeaders,
    ): Promise<NetworkResponse> {
      const responseType = request.responseType ?? 'text';
      if (responseType !== 'text' && responseType !== 'bytes') {
        throw new LunarPluginError('INVALID_ARGUMENT', 'The response type must be text or bytes');
      }
      return run(pluginId, request, lifetime, { hostHeaders, streaming: false }, async (response) => {
        const bytes = await readResponseBytes(response, NETWORK_LIMITS.responseBytes);
        const body = responseType === 'bytes' ? '' : strFromU8(bytes);
        return {
          ...responseHead(response),
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
      });
    },

    async stream(
      pluginId: string,
      request: NetworkStreamRequest,
      lifetime: AbortSignal,
      hostHeaders?: HostHeaders,
    ): Promise<NetworkResponseHead> {
      if (
        typeof request.onText !== 'function' ||
        (request.onResponse !== undefined && typeof request.onResponse !== 'function')
      ) {
        throw new LunarPluginError('INVALID_ARGUMENT', 'onText and onResponse must be functions');
      }
      return run(pluginId, request, lifetime, { hostHeaders, streaming: true }, async (response, timers) => {
        timers.limitTotal(NETWORK_LIMITS.streamMs);
        const head = responseHead(response);
        timers.deliver(() => request.onResponse?.(head));
        // The decoder holds back a character split across chunks until its remaining bytes arrive.
        const decoder = new DecodeUTF8((text) => {
          if (text) timers.deliver(() => request.onText(text));
        });
        if (!response.body?.getReader) {
          decoder.push(await readResponseBytes(response, NETWORK_LIMITS.responseBytes), true);
          return timers.settle(head);
        }
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > NETWORK_LIMITS.responseBytes) {
          throw new LunarPluginError('QUOTA_EXCEEDED', 'The response is too large');
        }
        const reader = response.body.getReader();
        let total = 0;
        try {
          while (timers.failure === undefined) {
            timers.restartWait();
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > NETWORK_LIMITS.responseBytes) {
              throw new LunarPluginError('QUOTA_EXCEEDED', 'The response is too large');
            }
            decoder.push(value);
          }
          decoder.push(new Uint8Array(0), true);
          return timers.settle(head);
        } catch (error) {
          void reader.cancel().catch(() => undefined);
          throw error;
        }
      });
    },
  };
}

export type PluginNetwork = ReturnType<typeof createPluginNetwork>;

/** The wait for data, a stream's total duration, and the first failure thrown by a plugin callback. */
class RequestTimers {
  failure: unknown;
  private wait?: ReturnType<typeof setTimeout>;
  private total?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly abort: () => void,
    private readonly waitMs: number,
  ) {
    this.restartWait();
  }

  restartWait(): void {
    clearTimeout(this.wait);
    this.wait = setTimeout(this.abort, this.waitMs);
  }

  limitTotal(milliseconds: number): void {
    this.total = setTimeout(this.abort, milliseconds);
  }

  /** Runs a plugin callback; when it throws, the request stops and rejects with that error. */
  deliver(callback: () => void): void {
    if (this.failure !== undefined) return;
    try {
      callback();
    } catch (error) {
      this.failure = error ?? new Error('A network callback failed');
      this.abort();
    }
  }

  settle<T>(value: T): T {
    if (this.failure !== undefined) throw this.failure;
    return value;
  }

  clear(): void {
    clearTimeout(this.wait);
    clearTimeout(this.total);
  }
}

function responseHead(response: Response): NetworkResponseHead {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') headers[name.toLowerCase()] = value;
  });
  return { status: response.status, headers };
}

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
