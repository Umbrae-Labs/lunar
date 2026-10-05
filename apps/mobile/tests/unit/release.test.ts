import { describe, expect, it, vi } from 'vitest';

import { preflight, publish } from '../../../../scripts/release.mjs';

const repository = 'owner/lunar';
const base = `/repos/${repository}`;
const commit = 'a'.repeat(40);
const release = { tag: 'v0.3.0', version: '0.3.0', prerelease: false };
const asset = { name: 'app.apk', data: Buffer.from('apk'), contentType: 'application/octet-stream' };

function fixture() {
  const state = {
    refs: [] as { ref: string; object: { type: string; sha: string } }[],
    releases: [] as any[],
    uploadFails: false,
    moveTagOnUpload: false,
  };
  const api = vi.fn(async (method: string, endpoint: string, body?: any): Promise<any> => {
    if (method === 'GET' && endpoint === `${base}/git/matching-refs/tags/${release.tag}`) return state.refs;
    if (method === 'GET' && endpoint === `${base}/git/tags/annotated`) {
      return { object: { type: 'commit', sha: commit } };
    }
    if (method === 'GET' && endpoint === `${base}/releases?per_page=100&page=1`) return state.releases;
    if (method === 'POST' && endpoint === `${base}/releases`) {
      const draft = { ...body, id: 1, upload_url: 'https://uploads.github.com/assets{?name}', assets: [] };
      state.releases.push(draft);
      return draft;
    }
    if (method === 'POST' && endpoint.startsWith('https://uploads.github.com/assets?')) {
      if (state.moveTagOnUpload) {
        state.refs = [{ ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: 'b'.repeat(40) } }];
      }
      return { state: 'uploaded', size: state.uploadFails ? 0 : body.length };
    }
    if (method === 'PATCH' && endpoint === `${base}/releases/1`) return body;
    throw new Error(`Unexpected request: ${method} ${endpoint}`);
  });
  return { api, state };
}

describe('manual release publishing', () => {
  it('allows a new tag and ignores other tags sharing its prefix', async () => {
    const { api, state } = fixture();
    state.refs.push({ ref: 'refs/tags/v0.3.0-rc.1', object: { type: 'commit', sha: 'other' } });
    await expect(preflight(api, repository, release, commit)).resolves.toMatchObject({ existing: undefined });
    expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('publishes only after uploads and pins tag creation to the build commit', async () => {
    const { api } = fixture();
    await publish(api, repository, release, commit, [asset], 'Release notes');
    expect(api).toHaveBeenCalledWith(
      'POST',
      `${base}/releases`,
      expect.objectContaining({
        draft: true,
        tag_name: release.tag,
        target_commitish: commit,
      }),
    );
    expect(api.mock.calls.at(-1)).toEqual([
      'PATCH',
      `${base}/releases/1`,
      expect.objectContaining({
        draft: false,
        tag_name: release.tag,
        target_commitish: commit,
      }),
    ]);
    expect(api.mock.calls.some(([method, endpoint]) => method === 'POST' && endpoint.endsWith('/git/refs'))).toBe(
      false,
    );
  });

  it('keeps failed uploads as a draft and resumes that draft on retry', async () => {
    const { api, state } = fixture();
    state.uploadFails = true;
    await expect(publish(api, repository, release, commit, [asset], 'Notes')).rejects.toThrow('full upload');
    expect(api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
    expect(state.releases[0].draft).toBe(true);
    state.uploadFails = false;
    api.mockClear();
    await publish(api, repository, release, commit, [asset], 'Notes');
    expect(api.mock.calls.some(([method, endpoint]) => method === 'POST' && endpoint === `${base}/releases`)).toBe(
      false,
    );
    expect(api.mock.calls.at(-1)?.[0]).toBe('PATCH');
  });

  it.each([false, true])('rejects a conflicting release with draft=%s', async (draft) => {
    const { api, state } = fixture();
    state.releases.push({ tag_name: release.tag, draft, body: `<!-- lunar-release:${draft ? 'other' : commit} -->` });
    await expect(publish(api, repository, release, commit, [asset], 'Notes')).rejects.toThrow(
      'published or managed elsewhere',
    );
    expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it.each(['commit', 'tag'])('accepts an existing matching %s tag for shared Nightly publishing', async (type) => {
    const { api, state } = fixture();
    state.refs.push({ ref: `refs/tags/${release.tag}`, object: { type, sha: type === 'tag' ? 'annotated' : commit } });
    await expect(preflight(api, repository, release, commit)).resolves.toMatchObject({ base });
  });

  it('rejects an existing tag targeting another commit before any upload', async () => {
    const { api, state } = fixture();
    state.refs.push({ ref: `refs/tags/${release.tag}`, object: { type: 'commit', sha: 'other' } });
    await expect(publish(api, repository, release, commit, [asset], 'Notes')).rejects.toThrow('same commit');
    expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('rechecks tag conflicts after uploading and keeps the release private', async () => {
    const { api, state } = fixture();
    state.moveTagOnUpload = true;
    await expect(publish(api, repository, release, commit, [asset], 'Notes')).rejects.toThrow('same commit');
    expect(api.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
  });

  it('propagates GitHub errors before creating a draft', async () => {
    const { api } = fixture();
    api.mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(publish(api, repository, release, commit, [asset], 'Notes')).rejects.toThrow('HTTP 403');
    expect(api).toHaveBeenCalledTimes(1);
  });
});
