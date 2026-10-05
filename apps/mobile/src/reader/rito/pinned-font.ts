import * as Crypto from 'expo-crypto';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import type { ReaderFontFace } from '../contracts';
import { LUNAR_READER_FONT_FAMILY } from '../typography';
import type { RitoNativePinnedFontFace } from './rito-native';

/** One pinned face, paired with the name it is reachable by. */
export interface LunarRitoPinnedRegistration {
  /** The name Rito paints this face under. Skia has to register the same bytes under it. */
  readonly alias: string;
  /** The resolved face; `bytes` and `sha256` are always present here. */
  readonly face: ReaderFontFace & { readonly bytes: Uint8Array; readonly sha256: string };
  /** The bundled coverage fallback, which also keeps its stable reader name. */
  readonly bundled: boolean;
}

/** The pinned faces to hand the Rito backend, plus the names Skia must register them under. */
export interface LunarRitoPinnedFonts {
  readonly faces: readonly RitoNativePinnedFontFace[];
  readonly registrations: readonly LunarRitoPinnedRegistration[];
  /** Alias of the face body text measures with. */
  readonly bodyAlias: string;
}

/**
 * Rito's stable name for a pinned face, derived from its SHA-256.
 *
 * A pinned face is never reachable by the family the host knows it by: Rito
 * registers each blob under the family name inside the font file, then rewrites
 * every painted `font-family` to these aliases (see `paint_family_stack` in
 * `crates/rito-core/src/fragment_paint/family.rs`, which drops any named family
 * the engine did not itself register). Skia therefore has to register the same
 * bytes under the same alias, or layout would measure with one face while paint
 * drew another — different line breaks in a picture that still looks plausible.
 */
export function pinnedFontAlias(sha256Hex: string): string {
  return `__RitoPinned_${sha256Hex.toLowerCase()}`;
}

/**
 * Builds the pinned measurement faces used by Rito Rust and Lunar Skia.
 *
 * Rito installs every pinned face as a fallback for every generic family and
 * every script, and orders them by generic role (`serif` < `sansSerif` <
 * `monospace` — see `face_sort_key` in Rito's pinned font policy). The chosen
 * body face therefore takes the `serif` role so it precedes the bundled face,
 * which keeps 霞鹭文楷 as the coverage fallback rather than the primary.
 *
 * That ordering is an internal Rito behaviour rather than part of its published
 * font API, so it is pinned by a test on both sides: change `face_sort_key` or
 * the role enum order and the body face silently falls back to the bundled one.
 */
export async function createLunarRitoPinnedFonts(
  options: {
    readonly body?: ReaderFontFace;
    readonly loadFontBytes?: () => Promise<Uint8Array>;
  } = {},
): Promise<LunarRitoPinnedFonts> {
  const body = options.body;
  const bundled = await loadBundledFace(options.loadFontBytes);
  const bundledRegistration: LunarRitoPinnedRegistration = {
    alias: pinnedFontAlias(bundled.sha256),
    face: {
      family: LUNAR_READER_FONT_FAMILY,
      source: 'builtin',
      bytes: bundled.bytes,
      sha256: bundled.sha256,
    },
    bundled: true,
  };

  if (body?.source !== 'imported' || !body.bytes) {
    return {
      faces: [{ bytes: bundled.bytes, expectedSha256: bundled.sha256, genericRole: 'serif', language: 'und' }],
      registrations: [bundledRegistration],
      bodyAlias: bundledRegistration.alias,
    };
  }

  const sha256 = body.sha256 ?? (await digestFontBytes(body.bytes));
  const bodyRegistration: LunarRitoPinnedRegistration = {
    alias: pinnedFontAlias(sha256),
    face: { ...body, bytes: body.bytes, sha256 },
    bundled: false,
  };
  return {
    faces: [
      { bytes: body.bytes, expectedSha256: sha256, genericRole: 'serif', language: 'und' },
      { bytes: bundled.bytes, expectedSha256: bundled.sha256, genericRole: 'sansSerif', language: 'und' },
    ],
    registrations: [bodyRegistration, bundledRegistration],
    bodyAlias: bodyRegistration.alias,
  };
}

export const LUNAR_RITO_PINNED_FONT_FAMILY = LUNAR_READER_FONT_FAMILY;

export async function loadBundledLunarFontBytes(): Promise<Uint8Array> {
  bundledFontBytesPromise ??= (async () => {
    const asset = Asset.fromModule(require('../../../assets/fonts/LXGWWenKai-Regular.ttf'));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    return new Uint8Array(await new File(uri).arrayBuffer());
  })();
  return bundledFontBytesPromise;
}

async function loadBundledFace(
  loadFontBytes: (() => Promise<Uint8Array>) | undefined,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const bytes = loadFontBytes ? await loadFontBytes() : await loadBundledLunarFontBytes();
  const sha256 = loadFontBytes ? await digestFontBytes(bytes) : await loadBundledLunarFontSha256(bytes);
  return { bytes, sha256 };
}

let bundledFontBytesPromise: Promise<Uint8Array> | undefined;
let bundledFontSha256Promise: Promise<string> | undefined;

async function loadBundledLunarFontSha256(bytes: Uint8Array): Promise<string> {
  bundledFontSha256Promise ??= digestFontBytes(bytes);
  return bundledFontSha256Promise;
}

async function digestFontBytes(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
