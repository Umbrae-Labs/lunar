import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  // A real digest proves nothing here: the tests only care that the alias is
  // derived from whatever the digest returns, and that it is stable.
  digest: async (_algorithm: string, bytes: Uint8Array) => {
    const buffer = new ArrayBuffer(32);
    new Uint8Array(buffer).fill(bytes.byteLength % 251);
    return buffer;
  },
}));
vi.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => undefined,
      uri: 'asset://bundled.ttf',
      localUri: null,
    }),
  },
}));
vi.mock('expo-file-system', () => ({
  File: class {
    readonly exists = false;
    async arrayBuffer() {
      return new ArrayBuffer(0);
    }
  },
}));

import {
  createLunarRitoPinnedFonts,
  pinnedFontAlias,
} from '../../src/reader/rito/pinned-font';

const BUNDLED_BYTES = new Uint8Array([1, 2, 3, 4]);
const IMPORTED_BYTES = new Uint8Array([9, 8, 7]);

describe('Rito pinned fonts', () => {
  it('pins only the bundled face when the body uses it', async () => {
    const pinned = await createLunarRitoPinnedFonts({
      body: { family: 'LunarWenKai', source: 'builtin' },
      loadFontBytes: async () => BUNDLED_BYTES,
    });

    expect(pinned.faces).toHaveLength(1);
    expect(pinned.faces[0]).toMatchObject({ genericRole: 'serif', language: 'und' });
    expect(pinned.faces[0]!.bytes).toBe(BUNDLED_BYTES);
    expect(pinned.registrations).toHaveLength(1);
    expect(pinned.registrations[0]!.bundled).toBe(true);
    expect(pinned.bodyAlias).toBe(pinned.registrations[0]!.alias);
  });

  // Rito installs every pinned face as a fallback for every generic family and
  // orders them by role, so the body face only leads the chain while it holds the
  // earlier role. Swap the two and the reader silently measures with 霞鹭文楷.
  it('orders the imported body ahead of the bundled fallback', async () => {
    const pinned = await createLunarRitoPinnedFonts({
      body: {
        family: 'Source Han Serif',
        source: 'imported',
        bytes: IMPORTED_BYTES,
        sha256: 'ab'.repeat(32),
      },
      loadFontBytes: async () => BUNDLED_BYTES,
    });

    expect(pinned.faces.map((face) => face.genericRole)).toEqual(['serif', 'sansSerif']);
    expect(pinned.faces[0]!.bytes).toBe(IMPORTED_BYTES);
    expect(pinned.faces[0]!.expectedSha256).toBe('ab'.repeat(32));
    expect(pinned.faces[1]!.bytes).toBe(BUNDLED_BYTES);
    expect(pinned.registrations.map((entry) => entry.bundled)).toEqual([false, true]);
    expect(pinned.bodyAlias).toBe(pinnedFontAlias('ab'.repeat(32)));
    // The two faces must stay distinguishable to Rito, which rejects duplicates.
    expect(pinned.faces[0]!.genericRole).not.toBe(pinned.faces[1]!.genericRole);
  });

  it('digests an imported face that arrives without one', async () => {
    const pinned = await createLunarRitoPinnedFonts({
      body: { family: 'Imported', source: 'imported', bytes: IMPORTED_BYTES },
      loadFontBytes: async () => BUNDLED_BYTES,
    });

    const expected = pinnedFontAlias(pinned.faces[0]!.expectedSha256);
    expect(pinned.faces[0]!.expectedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pinned.registrations[0]!.alias).toBe(expected);
  });

  it('never pins a system face, which carries no bytes to measure with', async () => {
    const pinned = await createLunarRitoPinnedFonts({
      body: { family: 'Noto Sans', source: 'system' },
      loadFontBytes: async () => BUNDLED_BYTES,
    });

    expect(pinned.faces).toHaveLength(1);
    expect(pinned.registrations[0]!.face.source).toBe('builtin');
  });

  it('names every alias after the lowercase digest', () => {
    expect(pinnedFontAlias('AABB')).toBe('__RitoPinned_aabb');
  });
});
