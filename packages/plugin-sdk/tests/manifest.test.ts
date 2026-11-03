import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isPackageIcon,
  localizeManifestText,
  hasNetworkAccess,
  parsePluginManifest,
  satisfiesVersionRange,
} from '../src/manifest';

const valid = {
  manifestVersion: 1,
  id: 'org.example.reading-stats',
  name: '%name%',
  version: '0.1.0',
  sdk: '^0.1.0',
  trust: 'full',
  main: 'main.js',
  activationEvents: ['onReaderOpen'],
  permissions: [
    { name: 'reader.events', reason: 'Track pages' },
    { name: 'network', reason: 'Sync' },
  ],
  contributes: {
    commands: [{ id: 'open-stats', title: 'Open' }],
    slots: {
      'reader.toolbar': [{ id: 'stats-button', command: 'open-stats', icon: 'chart' }],
      'reader.panel': [{ id: 'stats', title: 'Stats', icon: 'chart' }],
    },
    settings: [{ key: 'limit', type: 'number', title: 'Limit', default: 80, min: 20, max: 300 }],
  },
};

describe('plugin manifest', () => {
  it('accepts a complete manifest and fills empty contribution lists', () => {
    const result = parsePluginManifest(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.contributes.slots['reader.overlay']).toEqual([]);
    expect(hasNetworkAccess(result.manifest)).toBe(true);
  });

  it('defaults every optional section', () => {
    const { activationEvents, permissions, contributes, ...minimal } = valid;
    void activationEvents;
    void permissions;
    void contributes;
    const result = parsePluginManifest(minimal);
    expect(result.ok && result.manifest.contributes.commands).toEqual([]);
  });

  it('declares credentials with an injected header that Lunar does not control', () => {
    const credentials = [{ id: 'api', title: 'API key', prefix: 'Bearer ', baseUrl: 'https://api.example.com/v1' }];
    const result = parsePluginManifest({ ...valid, contributes: { ...valid.contributes, credentials } });
    expect(result.ok && result.manifest.contributes.credentials[0]).toMatchObject({
      header: 'Authorization',
      prefix: 'Bearer ',
    });
    for (const header of ['Cookie', 'Sec-Fetch-Mode', 'bad header']) {
      const rejected = parsePluginManifest({
        ...valid,
        contributes: { ...valid.contributes, credentials: [{ ...credentials[0], header }] },
      });
      expect(rejected.ok).toBe(false);
    }
    const insecure = parsePluginManifest({
      ...valid,
      contributes: { ...valid.contributes, credentials: [{ ...credentials[0], baseUrl: 'http://api.example.com' }] },
    });
    expect(insecure.ok).toBe(false);
  });

  it('requires the network permission and unique ids for credentials', () => {
    const credential = { id: 'api', title: 'API key' };
    const offline = parsePluginManifest({
      ...valid,
      permissions: [{ name: 'reader.events', reason: 'x' }],
      contributes: { ...valid.contributes, credentials: [credential] },
    });
    expect(offline.ok || offline.issues).toContain(
      'contributes.credentials: credentials need the "network" permission',
    );
    const duplicate = parsePluginManifest({
      ...valid,
      contributes: { ...valid.contributes, credentials: [credential, credential] },
    });
    expect(duplicate.ok || duplicate.issues).toContain('contributes.credentials.1.id: duplicate credential id');
  });

  it('still loads per-origin network permissions as network access', () => {
    const result = parsePluginManifest({
      ...valid,
      permissions: [{ name: 'network:https://api.example.com', reason: 'Sync' }],
    });
    expect(result.ok && hasNetworkAccess(result.manifest)).toBe(true);
    const offline = parsePluginManifest({ ...valid, permissions: [{ name: 'reader.events', reason: 'x' }] });
    expect(offline.ok && hasNetworkAccess(offline.manifest)).toBe(false);
  });

  it('rejects unknown fields, permissions and slots', () => {
    const result = parsePluginManifest({
      ...valid,
      extra: true,
      permissions: [
        { name: 'files.everything', reason: 'x' },
        { name: 'network:http://insecure.test', reason: 'x' },
      ],
      contributes: { slots: { 'library.bookActions': [] } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'permissions.0.name: unknown permission',
        'permissions.1.name: unknown permission',
        'contributes.slots: Unrecognized key: "library.bookActions"',
        '(root): Unrecognized key: "extra"',
      ]),
    );
  });

  it('accepts host symbols or a PNG under assets/ as the plugin icon', () => {
    for (const icon of [
      'chart',
      { android: 'query_stats', ios: 'chart.bar' },
      'assets/icon.png',
      'assets/img/icon-2x.png',
    ]) {
      expect(parsePluginManifest({ ...valid, icon }).ok, JSON.stringify(icon)).toBe(true);
    }
    for (const icon of ['icon.png', 'assets/../icon.png', 'assets/icon.svg', 'assets/.png', 'assets/icon@2x.png']) {
      expect(parsePluginManifest({ ...valid, icon }).ok, icon).toBe(false);
    }
    expect(isPackageIcon('assets/icon.png')).toBe(true);
    expect(isPackageIcon('chart')).toBe(false);
  });

  it('rejects dangling command references and inconsistent settings', () => {
    const result = parsePluginManifest({
      ...valid,
      contributes: {
        commands: [],
        slots: { 'reader.toolbar': [{ id: 'a', command: 'missing' }] },
        settings: [
          { key: 'mode', type: 'select', title: 'Mode', default: 'c', options: [{ value: 'a', label: 'A' }] },
          { key: 'size', type: 'number', title: 'Size', default: 1, min: 5 },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      'contributes.slots.reader.toolbar.0.command: refers to an undeclared command',
      'contributes.settings.0.default: must be one of the options',
      'contributes.settings.1.default: must be within min and max',
    ]);
  });

  it('accepts an app tab that opens an entry route', () => {
    const result = parsePluginManifest({
      ...valid,
      contributes: {
        slots: {
          'app.route': [
            { id: 'home', title: 'Home', icon: 'book' },
            { id: 'detail', title: 'Detail', hidden: true },
          ],
          'app.tab': [{ id: 'main', route: 'home', icon: 'star' }],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.contributes.slots['app.tab']).toEqual([{ id: 'main', route: 'home', icon: 'star' }]);
  });

  it('rejects app tabs that open undeclared or hidden routes', () => {
    const routes = [{ id: 'detail', title: 'Detail', hidden: true }];
    const result = parsePluginManifest({
      ...valid,
      contributes: {
        slots: {
          'app.route': routes,
          'app.tab': [{ id: 'main', route: 'missing' }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(['contributes.slots.app.tab.0.route: refers to an undeclared route']);
    const hidden = parsePluginManifest({
      ...valid,
      contributes: { slots: { 'app.route': routes, 'app.tab': [{ id: 'main', route: 'detail' }] } },
    });
    expect(hidden.ok || hidden.issues).toEqual(['contributes.slots.app.tab.0.route: refers to a hidden route']);
  });

  it('rejects ids that are not reverse-domain names and invalid sdk ranges', () => {
    expect(parsePluginManifest({ ...valid, id: 'Stats' }).ok).toBe(false);
    expect(parsePluginManifest({ ...valid, sdk: 'latest' }).ok).toBe(false);
  });

  it('localizes percent-wrapped text and keeps plain text', () => {
    expect(localizeManifestText('%name%', { name: '阅读统计' })).toBe('阅读统计');
    expect(localizeManifestText('%missing%', {})).toBe('missing');
    expect(localizeManifestText('Plain', undefined)).toBe('Plain');
  });
});

describe('version ranges', () => {
  it('treats caret ranges on 0.x as minor-locked', () => {
    expect(satisfiesVersionRange('0.1.4', '^0.1.0')).toBe(true);
    expect(satisfiesVersionRange('0.2.0', '^0.1.0')).toBe(false);
    expect(satisfiesVersionRange('1.9.0', '^1.2.0')).toBe(true);
    expect(satisfiesVersionRange('2.0.0', '^1.2.0')).toBe(false);
  });

  it('supports tilde, exact and explicit bounds', () => {
    expect(satisfiesVersionRange('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesVersionRange('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesVersionRange('1.2.0', '1.2.0')).toBe(true);
    expect(satisfiesVersionRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesVersionRange('not-a-version', '^1.0.0')).toBe(false);
  });

  it('orders prereleases before their release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });
});
