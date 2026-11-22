import { describe, expect, it, vi } from 'vitest';

import { createPluginNetwork, NETWORK_LIMITS } from '../../src/features/plugins/services/plugin-network';

describe('plugin network responses', () => {
  it('exposes UTF-8 text and the original binary bytes', async () => {
    const bytes = new TextEncoder().encode('文学少女');
    const fetchImpl = vi.fn(
      async () => new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const request = createPluginNetwork(fetchImpl).request;
    const response = await request(
      'org.example.test',
      { url: 'https://example.com/book' },
      new AbortController().signal,
    );
    expect(response.body).toBe('文学少女');
    expect(response.bytes).toEqual(bytes);
  });

  it('enforces the binary response quota', async () => {
    const bytes = new Uint8Array(NETWORK_LIMITS.responseBytes + 1);
    const request = createPluginNetwork(async () => new Response(bytes)).request;
    await expect(
      request('org.example.test', { url: 'https://example.com/large' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('does not allocate a UTF-8 string in binary mode', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const request = createPluginNetwork(async () => new Response(bytes)).request;
    const response = await request(
      'org.example.test',
      { url: 'https://example.com/image', responseType: 'bytes' },
      new AbortController().signal,
    );
    expect(response.body).toBe('');
    expect(response.bytes).toEqual(bytes);
  });

  it('rejects an oversized declared response before reading its body', async () => {
    const arrayBuffer = vi.fn();
    const response = {
      headers: new Headers({ 'content-length': String(NETWORK_LIMITS.responseBytes + 1) }),
      body: null,
      arrayBuffer,
    } as unknown as Response;
    const request = createPluginNetwork(async () => response).request;
    await expect(
      request(
        'org.example.test',
        { url: 'https://example.com/large', responseType: 'bytes' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('follows redirects to other public HTTPS hosts but not to plain HTTP', async () => {
    const redirected = (url: string) => {
      const response = new Response('ok');
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
    const toCdn = createPluginNetwork(async () => redirected('https://cdn.example.net/a.jpg')).request;
    const response = await toCdn(
      'org.example.test',
      { url: 'https://example.com/a.jpg' },
      new AbortController().signal,
    );
    expect(response.body).toBe('ok');
    const toHttp = createPluginNetwork(async () => redirected('http://cdn.example.net/a.jpg')).request;
    await expect(
      toHttp('org.example.test', { url: 'https://example.com/a.jpg' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'NETWORK_DENIED' });
  });
});

describe('plugin network streams', () => {
  const lifetime = () => new AbortController().signal;
  const chunked = (chunks: readonly Uint8Array[], init?: ResponseInit) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      }),
      init,
    );

  it('delivers the head first, then text as it arrives, keeping split characters whole', async () => {
    const bytes = new TextEncoder().encode('月光');
    const events: string[] = [];
    const streamingFetch = vi.fn(async () =>
      chunked([bytes.slice(0, 2), bytes.slice(2, 4), bytes.slice(4)], { status: 200 }),
    );
    const plainFetch = vi.fn();
    const { stream } = createPluginNetwork(plainFetch, streamingFetch);
    const head = await stream(
      'org.example.test',
      {
        url: 'https://example.com/sse',
        method: 'POST',
        onResponse: (value) => events.push(`status ${value.status}`),
        onText: (text) => events.push(text),
      },
      lifetime(),
    );
    expect(head.status).toBe(200);
    expect(events[0]).toBe('status 200');
    expect(events.slice(1).join('')).toBe('月光');
    expect(events.slice(1).every((text) => !text.includes('�'))).toBe(true);
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('rejects with the error a plugin callback throws', async () => {
    const { stream } = createPluginNetwork(vi.fn(), async () => chunked([new TextEncoder().encode('data')]));
    const failure = new Error('parser failed');
    await expect(
      stream(
        'org.example.test',
        {
          url: 'https://example.com/sse',
          onText: () => {
            throw failure;
          },
        },
        lifetime(),
      ),
    ).rejects.toBe(failure);
  });

  it('times out when no data arrives within the wait', async () => {
    const { stream } = createPluginNetwork(vi.fn(), async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body);
    });
    await expect(
      stream('org.example.test', { url: 'https://example.com/sse', timeoutMs: 20, onText: vi.fn() }, lifetime()),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('sends credential headers without following redirects and keeps plugins from overriding them', async () => {
    const plainFetch = vi.fn();
    const streamingFetch = vi.fn(async () => new Response('{}'));
    const { request } = createPluginNetwork(plainFetch, streamingFetch);
    await request('org.example.test', { url: 'https://api.example.com/v1/models' }, lifetime(), {
      Authorization: 'Bearer sk-1',
    });
    expect(plainFetch).not.toHaveBeenCalled();
    expect(streamingFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer sk-1' } }),
    );
    await expect(
      request(
        'org.example.test',
        { url: 'https://api.example.com/v1/models', headers: { authorization: 'Bearer other' } },
        lifetime(),
        { Authorization: 'Bearer sk-1' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
