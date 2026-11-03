// Shared by the Lunar host and the plugin CLI. Keep this module free of
// runtime relative imports: Node runs the CLI from TypeScript source directly.
import { z } from 'zod';

export const SDK_VERSION = '0.1.5';
export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = 1;

export const PLUGIN_SLOTS = [
  'reader.toolbar',
  'reader.panel',
  'reader.overlay',
  'app.route',
  'app.tab',
  'settings.plugin',
] as const;
export type PluginSlot = (typeof PLUGIN_SLOTS)[number];
/** Slots whose entries are React components registered by plugin code. */
export type PluginComponentSlot = Exclude<PluginSlot, 'reader.toolbar' | 'app.route' | 'app.tab'>;

export const PLUGIN_PERMISSIONS = [
  'reader.events',
  'reader.selection.read',
  'reader.content.read',
  'reader.navigate',
  'reader.decorations',
  'library.import',
  /** HTTPS requests and images from any public host through `ctx.network` and `Image`. */
  'network',
] as const;
export type PluginPermissionName = (typeof PLUGIN_PERMISSIONS)[number];

/** Eager activation triggers. Using any contributed entry activates its plugin implicitly. */
export const PLUGIN_ACTIVATION_EVENTS = ['onStartup', 'onReaderOpen'] as const;
export type PluginActivationEvent = (typeof PLUGIN_ACTIVATION_EVENTS)[number];

export const ICON_NAMES = [
  'book',
  'bookmark',
  'chart',
  'edit',
  'extension',
  'headphones',
  'info',
  'list',
  'pause',
  'play',
  'search',
  'settings',
  'sparkles',
  'star',
  'stop',
  'text',
  'timer',
  'translate',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
export type IconSpec = IconName | { readonly android: string; readonly ios: string };
/** A PNG inside the package's `assets` directory, such as `assets/icon.png`. */
export type PackageIconPath = `assets/${string}.png`;
/** The plugin's own icon: a host symbol or a packaged image. */
export type PluginIcon = IconSpec | PackageIconPath;

const PACKAGE_ICON = /^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.png$/;

export function isPackageIcon(icon: PluginIcon | undefined): icon is PackageIconPath {
  return typeof icon === 'string' && PACKAGE_ICON.test(icon);
}

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const LOCAL_ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
/**
 * Per-origin network permissions from SDK 0.1.1 and earlier. Installed manifests keep loading and
 * count as `network`; the CLI no longer builds them.
 */
export const LEGACY_NETWORK_PERMISSION = /^network:https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const SETTING_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Request headers the host controls; neither plugin requests nor credentials can set them. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
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

export function isForbiddenRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_REQUEST_HEADERS.has(lower) || lower.startsWith('sec-');
}

const localId = z.string().regex(LOCAL_ID, 'must be lowercase letters, digits, "-" or "."').max(64);
const text = z.string().min(1).max(120);
const iconSpec = z.union([
  z.enum(ICON_NAMES),
  z.strictObject({ android: z.string().min(1).max(64), ios: z.string().min(1).max(64) }),
]);

const packageIcon = z
  .templateLiteral(['assets/', z.string(), '.png'])
  .refine((path) => PACKAGE_ICON.test(path), 'must be a PNG file under assets/');

const permission = z.strictObject({
  name: z
    .string()
    .refine(
      (name) => (PLUGIN_PERMISSIONS as readonly string[]).includes(name) || LEGACY_NETWORK_PERMISSION.test(name),
      'unknown permission',
    ),
  reason: z.string().min(1).max(200),
});

const command = z.strictObject({ id: localId, title: text, icon: iconSpec.optional() });
const toolbarItem = z.strictObject({
  id: localId,
  command: localId,
  title: text.optional(),
  icon: iconSpec.optional(),
});
const panel = z.strictObject({ id: localId, title: text, icon: iconSpec });
const componentEntry = z.strictObject({ id: localId, title: text.optional() });
/**
 * A service key the user enters in Lunar. Plugin code never reads the key: a request names the
 * credential and the host adds `header: prefix + key` when the URL lies under the address the
 * user confirmed. `baseUrl` is the address suggested to the user.
 */
const credential = z.strictObject({
  id: localId,
  title: text,
  description: z.string().max(300).optional(),
  header: z
    .string()
    .regex(HEADER_NAME, 'must be an HTTP header name')
    .max(64)
    .refine((name) => !isForbiddenRequestHeader(name), 'is controlled by Lunar')
    .default('Authorization'),
  prefix: z.string().max(32).default(''),
  baseUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional(),
});
/**
 * `hidden` keeps nested routes such as a detail page out of the plugin's entry list and page tabs.
 * `icon` labels the route in the page tab bar shown when a plugin has several entry routes.
 */
const route = z.strictObject({
  id: localId,
  title: text,
  icon: iconSpec.optional(),
  hidden: z.boolean().default(false),
});
/** An entry in the app's bottom navigation that opens one of the plugin's entry routes. */
const tab = z.strictObject({ id: localId, route: localId, title: text.optional(), icon: iconSpec.optional() });

const settingBase = { key: z.string().regex(SETTING_KEY), title: text, description: z.string().max(300).optional() };
const setting = z.discriminatedUnion('type', [
  z.strictObject({ ...settingBase, type: z.literal('boolean'), default: z.boolean() }),
  z.strictObject({
    ...settingBase,
    type: z.literal('number'),
    default: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
  }),
  z.strictObject({
    ...settingBase,
    type: z.literal('string'),
    default: z.string().max(2000),
    maxLength: z.number().int().positive().max(2000).optional(),
  }),
  z.strictObject({
    ...settingBase,
    type: z.literal('select'),
    default: z.string(),
    options: z
      .array(z.strictObject({ value: z.string().min(1).max(64), label: text }))
      .min(1)
      .max(32),
  }),
]);

export const pluginManifestSchema = z
  .strictObject({
    manifestVersion: z.literal(MANIFEST_VERSION),
    id: z.string().regex(PLUGIN_ID, 'must be a lowercase reverse-domain identifier').max(128),
    name: text,
    version: z.string().regex(SEMVER, 'must be a semantic version'),
    sdk: z.string().min(1).max(64),
    trust: z.enum(['full', 'sandboxed']),
    main: z.literal('main.js'),
    description: z.string().max(500).optional(),
    author: z.string().max(120).optional(),
    homepage: z.url({ protocol: /^https$/ }).optional(),
    license: z.string().max(64).optional(),
    icon: z.union([iconSpec, packageIcon]).optional(),
    platforms: z
      .array(z.enum(['android', 'ios']))
      .min(1)
      .optional(),
    publisherKeyId: z.string().max(200).optional(),
    defaultLocale: z.string().max(16).optional(),
    /** Version of the plugin's stored data format; raising it runs the plugin's `migrate`. */
    dataVersion: z.number().int().min(1).max(1_000_000).default(1),
    activationEvents: z.array(z.enum(PLUGIN_ACTIVATION_EVENTS)).max(PLUGIN_ACTIVATION_EVENTS.length).default([]),
    permissions: z.array(permission).max(32).default([]),
    contributes: z
      .strictObject({
        commands: z.array(command).max(64).default([]),
        slots: z
          .strictObject({
            'reader.toolbar': z.array(toolbarItem).max(4).default([]),
            'reader.panel': z.array(panel).max(4).default([]),
            'reader.overlay': z.array(componentEntry).max(4).default([]),
            'app.route': z.array(route).max(16).default([]),
            'app.tab': z.array(tab).max(1).default([]),
            'settings.plugin': z.array(componentEntry).max(1).default([]),
          })
          .prefault({}),
        settings: z.array(setting).max(64).default([]),
        credentials: z.array(credential).max(8).default([]),
      })
      .prefault({}),
  })
  .superRefine((manifest, context) => {
    const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
    const { commands, slots, settings, credentials } = manifest.contributes;
    const commandIds = new Set<string>();
    commands.forEach((item, index) => {
      if (commandIds.has(item.id)) issue(['contributes', 'commands', index, 'id'], 'duplicate command id');
      commandIds.add(item.id);
    });
    for (const slot of PLUGIN_SLOTS) {
      const seen = new Set<string>();
      slots[slot].forEach((item, index) => {
        if (seen.has(item.id)) issue(['contributes', 'slots', slot, index, 'id'], 'duplicate slot id');
        seen.add(item.id);
      });
    }
    slots['reader.toolbar'].forEach((item, index) => {
      if (!commandIds.has(item.command)) {
        issue(['contributes', 'slots', 'reader.toolbar', index, 'command'], 'refers to an undeclared command');
      }
    });
    slots['app.tab'].forEach((item, index) => {
      const route = slots['app.route'].find((candidate) => candidate.id === item.route);
      if (!route) issue(['contributes', 'slots', 'app.tab', index, 'route'], 'refers to an undeclared route');
      else if (route.hidden) issue(['contributes', 'slots', 'app.tab', index, 'route'], 'refers to a hidden route');
    });
    const keys = new Set<string>();
    settings.forEach((item, index) => {
      if (keys.has(item.key)) issue(['contributes', 'settings', index, 'key'], 'duplicate setting key');
      keys.add(item.key);
      if (item.type === 'number') {
        if (item.min !== undefined && item.max !== undefined && item.min > item.max) {
          issue(['contributes', 'settings', index, 'min'], 'must not exceed max');
        }
        if (
          (item.min !== undefined && item.default < item.min) ||
          (item.max !== undefined && item.default > item.max)
        ) {
          issue(['contributes', 'settings', index, 'default'], 'must be within min and max');
        }
      }
      if (item.type === 'select' && !item.options.some((option) => option.value === item.default)) {
        issue(['contributes', 'settings', index, 'default'], 'must be one of the options');
      }
    });
    const permissions = new Set<string>();
    manifest.permissions.forEach((item, index) => {
      if (permissions.has(item.name)) issue(['permissions', index, 'name'], 'duplicate permission');
      permissions.add(item.name);
    });
    const credentialIds = new Set<string>();
    credentials.forEach((item, index) => {
      if (credentialIds.has(item.id)) issue(['contributes', 'credentials', index, 'id'], 'duplicate credential id');
      credentialIds.add(item.id);
    });
    if (credentials.length > 0 && !permissions.has('network')) {
      issue(['contributes', 'credentials'], 'credentials need the "network" permission');
    }
    if (!parseVersionRange(manifest.sdk)) issue(['sdk'], 'must be a version range such as ^0.1.0');
  });

export type PluginManifest = z.output<typeof pluginManifestSchema>;
export type PluginManifestInput = z.input<typeof pluginManifestSchema>;
export type PluginCommandContribution = PluginManifest['contributes']['commands'][number];
export type PluginSettingContribution = PluginManifest['contributes']['settings'][number];
export type PluginCredentialContribution = PluginManifest['contributes']['credentials'][number];
export type PluginPanelContribution = PluginManifest['contributes']['slots']['reader.panel'][number];
export type PluginToolbarContribution = PluginManifest['contributes']['slots']['reader.toolbar'][number];
export type PluginRouteContribution = PluginManifest['contributes']['slots']['app.route'][number];
export type PluginTabContribution = PluginManifest['contributes']['slots']['app.tab'][number];

export type ManifestParseResult =
  { readonly ok: true; readonly manifest: PluginManifest } | { readonly ok: false; readonly issues: readonly string[] };

export function parsePluginManifest(input: unknown): ManifestParseResult {
  const result = pluginManifestSchema.safeParse(input);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}

export function hasPermission(manifest: PluginManifest, name: PluginPermissionName): boolean {
  return manifest.permissions.some((item) => item.name === name);
}

/** Whether the plugin may use the network, through `network` or a legacy per-origin permission. */
export function hasNetworkAccess(manifest: PluginManifest): boolean {
  return manifest.permissions.some((item) => item.name === 'network' || LEGACY_NETWORK_PERMISSION.test(item.name));
}

/** Resolves `%key%` manifest text against a locale table, keeping the text when the key is missing. */
export function localizeManifestText(value: string, messages: Readonly<Record<string, string>> | undefined): string {
  const match = /^%([^%]+)%$/.exec(value);
  return match ? (messages?.[match[1]] ?? match[1]) : value;
}

// Catalogs
//
// A catalog is a static index of signed packages published by one signing key. Lunar ships with no
// catalog; users add catalog URLs themselves. Unknown fields are ignored so catalogs can grow.

export const CATALOG_FORMAT = 1;
/** Conventional file name of a catalog index; any HTTPS URL to the index works. */
export const CATALOG_FILE = 'index.json';

/** 32 bytes as unpadded base64url: 42 free characters and a last one whose two spare bits are zero. */
const BASE64URL_32 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const LOCALE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

const catalogUrl = z.string().min(1).max(2000);
const catalogLocale = z.object({ name: text.optional(), description: z.string().max(500).optional() });
const catalogPlugin = z.object({
  id: z.string().regex(PLUGIN_ID).max(128),
  name: text,
  version: z.string().regex(SEMVER),
  sdk: z.string().refine((range) => parseVersionRange(range) !== undefined, 'must be a version range'),
  description: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
  /** Package and icon locations, relative to the index URL or absolute HTTPS URLs. */
  package: catalogUrl,
  icon: catalogUrl.optional(),
  sha256: z.string().regex(SHA256_HEX),
  size: z.number().int().positive(),
  permissions: z.array(z.string().max(200)).max(32).default([]),
  /** Name and description per locale, used before the package's own locale files are available. */
  locales: z.record(z.string().regex(LOCALE), catalogLocale).optional(),
});

export const pluginCatalogSchema = z
  .object({
    format: z.literal(CATALOG_FORMAT),
    name: text,
    /** Short label shown next to plugins from this catalog. */
    badge: z.string().min(1).max(16).optional(),
    website: z.url({ protocol: /^https$/ }).optional(),
    /** The Ed25519 public key (RFC 8037 JWK) that signs every package in the catalog. */
    signingKey: z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string().regex(BASE64URL_32) }),
    plugins: z.array(catalogPlugin).max(500),
  })
  .superRefine((catalog, context) => {
    const seen = new Set<string>();
    catalog.plugins.forEach((plugin, index) => {
      if (seen.has(plugin.id))
        context.addIssue({ code: 'custom', path: ['plugins', index, 'id'], message: 'duplicate plugin id' });
      seen.add(plugin.id);
    });
  });

export type PluginCatalog = z.output<typeof pluginCatalogSchema>;
export type PluginCatalogEntry = PluginCatalog['plugins'][number];

export type CatalogParseResult =
  { readonly ok: true; readonly catalog: PluginCatalog } | { readonly ok: false; readonly issues: readonly string[] };

export function parsePluginCatalog(input: unknown): CatalogParseResult {
  const result = pluginCatalogSchema.safeParse(input);
  if (result.success) return { ok: true, catalog: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

export function parseVersion(value: string): Version | undefined {
  const match = SEMVER.exec(value.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new RangeError(`Invalid version: ${a ? right : left}`);
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    (a.prerelease === b.prerelease
      ? 0
      : a.prerelease === undefined
        ? 1
        : b.prerelease === undefined
          ? -1
          : a.prerelease < b.prerelease
            ? -1
            : 1)
  );
}

type Comparator = { readonly operator: '>=' | '<' | '='; readonly version: string };

/** Supports exact versions, `^`, `~`, `>=` and space-separated `>=x <y` pairs. */
function parseVersionRange(range: string): readonly Comparator[] | undefined {
  const parts = range.trim().split(/\s+/);
  const comparators: Comparator[] = [];
  for (const part of parts) {
    const match = /^(\^|~|>=|<|=)?(.+)$/.exec(part);
    const version = match ? parseVersion(match[2]) : undefined;
    if (!match || !version) return undefined;
    const base = `${version.major}.${version.minor}.${version.patch}`;
    switch (match[1]) {
      case '^': {
        const upper =
          version.major > 0
            ? `${version.major + 1}.0.0`
            : version.minor > 0
              ? `0.${version.minor + 1}.0`
              : `0.0.${version.patch + 1}`;
        comparators.push({ operator: '>=', version: match[2] }, { operator: '<', version: upper });
        break;
      }
      case '~':
        comparators.push(
          { operator: '>=', version: match[2] },
          { operator: '<', version: `${version.major}.${version.minor + 1}.0` },
        );
        break;
      case '>=':
      case '<':
        comparators.push({ operator: match[1], version: match[2] });
        break;
      default:
        comparators.push({ operator: '=', version: base });
    }
  }
  return comparators;
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  const comparators = parseVersionRange(range);
  if (!comparators || !parseVersion(version)) return false;
  return comparators.every(({ operator, version: bound }) => {
    const order = compareVersions(version, bound);
    return operator === '>=' ? order >= 0 : operator === '<' ? order < 0 : order === 0;
  });
}
