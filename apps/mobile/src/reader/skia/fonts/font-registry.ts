import {
  FontSlant,
  FontWidth,
  Skia,
  type FontStyle,
  type SkFont,
  type SkFontMgr,
  type SkTypeface,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

import type { ReaderFontFace, ReaderFontFeature, ReaderFontRegistry, ReaderFontShorthand } from '../../contracts';
import { LUNAR_READER_FONT_FAMILY } from '../../typography';
import { createSystemFontMgr, disposeSystemFontMgr, hasSystemReaderFontFamily } from './system-fonts';

export interface SkiaFontRegistry extends ReaderFontRegistry {
  readonly readerFontProvider: SkTypefaceFontProvider;
  readonly generation: number;
  /**
   * Registers the bundled face under its stable reader name, and under
   * `alias` when the pinned policy names it by an alias too.
   */
  loadBuiltinFont(bytes: Uint8Array, alias?: string): void;
  /**
   * Registers a resolved face so paragraphs and chrome text can paint with it.
   * `alias` is the name a paginated body paints the face under — Rito rewrites
   * every painted family stack to its pinned aliases, so a body face is only
   * reachable through this alias, never through `face.family`. Chrome text is
   * drawn by this app instead, and resolves `face.family` directly.
   */
  registerFontFace(face: ReaderFontFace, alias?: string): void;
  registerChromeFontFace(face: ReaderFontFace): void;
  /**
   * Registers the face already known as `baseFamily` again under `family`,
   * painting with `features` on: Rito's vertical and combined-forms families
   * are the same bytes with an OpenType feature. False when `baseFamily` is
   * not registered.
   */
  registerFontVariant(family: string, baseFamily: string, features: readonly ReaderFontFeature[]): boolean;
  /** The OpenType features a family paints with; empty for an ordinary face. */
  getFontFeatures(family: string): readonly ReaderFontFeature[];
  getFontFamilies(family: string): readonly string[];
  getParagraphProvider(family: string): SkTypefaceFontProvider;
  resolveFont(font: ReaderFontShorthand): SkFont;
  dispose(): void;
}

const SYSTEM_FONT_STYLE: FontStyle = {
  weight: 400,
  width: FontWidth.Normal,
  slant: FontSlant.Upright,
};

export class LunarSkiaFontRegistry implements SkiaFontRegistry {
  readonly readerFontProvider = Skia.TypefaceFontProvider.Make();
  private fontGeneration = 0;

  get generation(): number {
    return this.fontGeneration;
  }

  private readonly typefaces: SkTypeface[] = [];
  /** The decoded face behind each registered name, so a variant reuses it. */
  private readonly typefaceByFamily = new Map<string, SkTypeface>();
  /** Decoded faces by their source identity, so one file is decoded once whatever names it arrives under. */
  private readonly typefaceBySource = new Map<string, SkTypeface>();
  private readonly familyFeatures = new Map<string, readonly ReaderFontFeature[]>();
  private readonly fonts = new Map<string, SkFont>();
  private readonly registrations = new Map<string, Promise<void>>();
  private readonly registeredLengths = new Map<string, number>();
  private readonly registeredFamilies = new Set<string>();
  private readonly systemFamilies = new Set<string>();
  private systemFontMgr?: SkFontMgr;
  private builtinLoaded = false;
  private disposed = false;

  loadBuiltinFont(bytes: Uint8Array, alias?: string): void {
    this.assertActive();
    if (this.builtinLoaded) {
      return;
    }
    this.registerBytes([LUNAR_READER_FONT_FAMILY, alias], bytes, 'the bundled Lunar reader font');
    this.builtinLoaded = true;
  }

  async loadFont(resource: Parameters<ReaderFontRegistry['loadFont']>[0]): Promise<void> {
    this.assertActive();
    if (!resource.family || resource.bytes.byteLength === 0) {
      throw new Error('Reader font registration requires a family and bytes.');
    }
    if (resource.byteLength !== undefined && resource.byteLength !== resource.bytes.byteLength) {
      throw new Error(`Font ${resource.family} byte length does not match its declaration.`);
    }
    const fingerprint = resource.fingerprint ?? hashBytes(resource.bytes);
    const key = `${resource.family}|${resource.weight ?? '400'}|${resource.style ?? 'normal'}|${fingerprint}`;
    const knownLength = this.registeredLengths.get(key);
    if (knownLength !== undefined && knownLength !== resource.bytes.byteLength) {
      throw new Error(`Font ${resource.family} has conflicting byte lengths.`);
    }
    const existing = this.registrations.get(key);
    if (existing) {
      await existing;
      return;
    }
    const operation = this.registerFont(key, resource);
    this.registrations.set(key, operation);
    try {
      await operation;
    } catch (error) {
      this.registrations.delete(key);
      throw error;
    }
  }

  registerFontFace(face: ReaderFontFace, alias?: string): void {
    this.registerFace(face, alias, true);
  }

  registerChromeFontFace(face: ReaderFontFace): void {
    // Body paragraphs use pinned aliases; adding a chrome family leaves those
    // aliases and their shaped glyphs intact.
    this.registerFace(face, undefined, false);
  }

  private registerFace(face: ReaderFontFace, alias: string | undefined, affectsParagraphs: boolean): void {
    this.assertActive();
    // A blank name is accepted by the provider and then never matches, so it
    // would surface as text quietly painted in the bundled face.
    if (!face.family.trim()) {
      throw new Error('Reader font registration requires a family.');
    }
    if (face.source === 'system') {
      this.registerSystemFamily(face.family, affectsParagraphs);
      return;
    }
    if (!face.bytes || face.bytes.byteLength === 0) {
      throw new Error(`Reader font ${face.family} requires bytes.`);
    }
    this.registerBytes([face.family, alias], face.bytes, `reader font ${face.family}`, affectsParagraphs);
  }

  registerFontVariant(family: string, baseFamily: string, features: readonly ReaderFontFeature[]): boolean {
    this.assertActive();
    if (this.registeredFamilies.has(family)) return true;
    const typeface = this.typefaceByFamily.get(baseFamily);
    if (!typeface) return false;
    this.registerTypeface(typeface, [family], true);
    this.recordFeatures(family, features);
    return true;
  }

  getFontFeatures(family: string): readonly ReaderFontFeature[] {
    return this.familyFeatures.get(family) ?? NO_FEATURES;
  }

  getFontFamilies(family: string): readonly string[] {
    this.assertActive();
    const families = splitFontFamilyStack(family).filter((name) => this.registeredFamilies.has(name));
    return [...families, LUNAR_READER_FONT_FAMILY];
  }

  getParagraphProvider(_family: string): SkTypefaceFontProvider {
    this.assertActive();
    this.assertBuiltinLoaded();
    return this.readerFontProvider;
  }

  resolveFont(font: ReaderFontShorthand): SkFont {
    this.assertActive();
    const key = `${font.family}|${font.sizePx}|${font.weight}|${font.style}`;
    const cached = this.fonts.get(key);
    if (cached) {
      return cached;
    }

    const style: FontStyle = {
      weight: Math.max(100, Math.min(900, Math.round(font.weight))),
      width: FontWidth.Normal,
      slant: font.style === 'italic' ? FontSlant.Italic : FontSlant.Upright,
    };
    this.assertBuiltinLoaded();
    const family =
      splitFontFamilyStack(font.family).find((name) => this.registeredFamilies.has(name)) ?? LUNAR_READER_FONT_FAMILY;
    const typeface = this.readerFontProvider.matchFamilyStyle(family, style);
    const skFont = Skia.Font(typeface, font.sizePx);
    this.fonts.set(key, skFont);
    return skFont;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const font of this.fonts.values()) {
      font.dispose();
    }
    this.fonts.clear();
    this.registrations.clear();
    this.registeredLengths.clear();
    this.registeredFamilies.clear();
    this.typefaceByFamily.clear();
    this.typefaceBySource.clear();
    this.familyFeatures.clear();
    this.systemFamilies.clear();
    for (const typeface of this.typefaces) {
      typeface.dispose();
    }
    this.typefaces.length = 0;
    disposeSystemFontMgr(this.systemFontMgr);
    this.systemFontMgr = undefined;
    this.readerFontProvider.dispose();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('The Skia font registry is disposed.');
    }
  }

  private assertBuiltinLoaded(): void {
    if (!this.builtinLoaded) {
      throw new Error('The bundled Lunar reader font is unavailable.');
    }
  }

  /**
   * Decodes a font file once and registers the resulting face under every name
   * the kernel may request it by. One body face needs two: Rito rewrites every
   * painted stack to the pinned aliases, so the alias is the only name a
   * paginated paragraph can reach it through, while chrome text and the
   * provider's fallback tail ask for the plain family.
   */
  private registerBytes(
    names: readonly (string | undefined)[],
    bytes: Uint8Array,
    label: string,
    affectsParagraphs = true,
    source?: string,
  ): void {
    const targets = [...new Set(names.filter((name): name is string => Boolean(name)))];
    if (targets.length === 0) {
      throw new Error(`Skia cannot register ${label} without a family name.`);
    }
    // The same face legitimately arrives twice — chrome reusing the body face,
    // or a re-registration after a reload — and every name being known means it
    // is already live: decoding again would only duplicate the typeface and the
    // memory behind it, which for an imported CJK face is tens of megabytes.
    if (targets.every((name) => this.registeredFamilies.has(name))) {
      return;
    }
    if (bytes.byteLength === 0) {
      throw new Error(`Skia could not decode ${label}: the file is empty.`);
    }
    const decoded = source === undefined ? undefined : this.typefaceBySource.get(source);
    if (decoded) {
      this.registerTypeface(decoded, targets, affectsParagraphs);
      return;
    }
    const data = Skia.Data.fromBytes(bytes);
    let typeface: SkTypeface | undefined;
    try {
      typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data) ?? undefined;
      if (!typeface) {
        throw new Error(`Skia could not decode ${label}.`);
      }
      this.assertActive();
      this.typefaces.push(typeface);
      if (source !== undefined) this.typefaceBySource.set(source, typeface);
      this.registerTypeface(typeface, targets, affectsParagraphs);
      typeface = undefined;
    } finally {
      typeface?.dispose();
      data.dispose();
    }
  }

  /** Registers a decoded face under more names; the registry already owns it. */
  private registerTypeface(typeface: SkTypeface, names: readonly string[], affectsParagraphs: boolean): void {
    for (const name of names) {
      if (this.registeredFamilies.has(name)) continue;
      this.readerFontProvider.registerFont(typeface, name);
      this.registeredFamilies.add(name);
      this.typefaceByFamily.set(name, typeface);
    }
    if (affectsParagraphs) this.fontGeneration += 1;
  }

  private recordFeatures(family: string, features: readonly ReaderFontFeature[] | undefined): void {
    if (features && features.length > 0) this.familyFeatures.set(family, features);
  }

  /**
   * Adopts a platform face into the paragraph provider. The family must exist
   * in the platform's enumeration: `matchFamilyStyle` yields an unusable face
   * for an unknown name, and every call on that face would abort the process.
   */
  private registerSystemFamily(family: string, affectsParagraphs: boolean): void {
    if (this.systemFamilies.has(family) || this.registeredFamilies.has(family)) {
      return;
    }
    if (!hasSystemReaderFontFamily(family)) {
      throw new Error(`The system font family ${family} is unavailable.`);
    }
    this.systemFontMgr ??= createSystemFontMgr();
    if (!this.systemFontMgr) {
      throw new Error('The platform font manager is unavailable.');
    }
    const typeface = this.systemFontMgr.matchFamilyStyle(family, SYSTEM_FONT_STYLE);
    this.assertActive();
    this.readerFontProvider.registerFont(typeface, family);
    this.typefaces.push(typeface);
    this.systemFamilies.add(family);
    this.registeredFamilies.add(family);
    this.typefaceByFamily.set(family, typeface);
    if (affectsParagraphs) this.fontGeneration += 1;
  }

  private async registerFont(key: string, resource: Parameters<ReaderFontRegistry['loadFont']>[0]): Promise<void> {
    this.assertActive();
    // A feature variant is the same file under another family; its source
    // identity finds the face its base family already decoded.
    const source = `${resource.src}|${resource.fingerprint ?? hashBytes(resource.bytes)}|${resource.bytes.byteLength}`;
    this.registerBytes([resource.family], resource.bytes, `reader font ${resource.src}`, true, source);
    this.recordFeatures(resource.family, resource.features);
    this.registeredLengths.set(key, resource.bytes.byteLength);
  }
}

const NO_FEATURES: readonly ReaderFontFeature[] = [];

function hashBytes(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}

function splitFontFamilyStack(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote = '';
  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char;
      continue;
    }
    if (char === ',' && !quote) {
      const name = current.trim();
      if (name) result.push(name);
      current = '';
      continue;
    }
    current += char;
  }
  const name = current.trim();
  if (name) result.push(name);
  return result;
}
