import { describe, expect, it } from 'vitest';

import { createPluginRequire, evaluatePluginEntry } from '../../src/features/plugins/services/plugin-loader';
import { readPluginPackage } from '../../src/features/plugins/services/plugin-package';
import { manifest, packArchive, sha256 } from './plugin-test-support';

const entry = 'module.exports = { default: { activate() {} } };';
const files = () => ({
  'manifest.json': JSON.stringify(manifest()),
  'main.js': entry,
  'locales/zh-CN.json': JSON.stringify({ name: '测试' }),
});

describe('plugin loader', () => {
  it('returns the default export and resolves only shared modules', () => {
    const shared = { tag: 'sdk' };
    const pluginRequire = createPluginRequire({ '@umbrae-labs/lunar-plugin-sdk': shared });
    const definition = evaluatePluginEntry(
      'const sdk = require("@umbrae-labs/lunar-plugin-sdk"); exports.default = { activate() { return sdk.tag; } };',
      pluginRequire,
      'test.js',
    );
    expect(definition.activate({} as never)).toBe('sdk');
    expect(() => pluginRequire('expo-file-system')).toThrow('not provided by Lunar');
  });

  it('rejects entries without a plugin definition', () => {
    expect(() => evaluatePluginEntry('module.exports = {};', createPluginRequire({}), 'x.js')).toThrow('activate()');
    expect(() =>
      evaluatePluginEntry('module.exports = { activate() {}, deactivate: 1 };', createPluginRequire({}), 'x.js'),
    ).toThrow('deactivate');
  });
});

describe('plugin package', () => {
  it('reads a valid package with its locales and digests', async () => {
    const archive = await packArchive(files());
    const result = await readPluginPackage(archive, sha256);
    expect(result.manifest.id).toBe('org.example.test');
    expect(result.locales['zh-CN'].name).toBe('测试');
    expect(result.packageSha256).toBe(sha256(archive));
    expect(result.entrySha256).toBe(sha256(new TextEncoder().encode(entry)));
    expect(result.signature).toBeUndefined();
  });

  it('rejects a file changed after packing', async () => {
    const archive = await packArchive(files());
    const { unzipSync, zipSync } = await import('fflate');
    const entries = unzipSync(archive);
    entries['main.js'] = new TextEncoder().encode('module.exports = { default: { activate() { evil(); } } };');
    await expect(readPluginPackage(zipSync(entries), sha256)).rejects.toThrow('Integrity check failed');
  });

  it('rejects missing integrity, traversal paths and unlisted files', async () => {
    await expect(readPluginPackage(await packArchive(files(), { integrity: false }), sha256)).rejects.toThrow(
      'integrity.json is missing',
    );
    await expect(readPluginPackage(await packArchive({ ...files(), '../evil.js': 'x' }), sha256)).rejects.toThrow(
      'relative segment',
    );
  });

  it('rejects incompatible SDK ranges and sandboxed plugins', async () => {
    await expect(
      readPluginPackage(
        await packArchive({ ...files(), 'manifest.json': JSON.stringify(manifest({ sdk: '^2.0.0' })) }),
        sha256,
      ),
    ).rejects.toThrow('needs SDK ^2.0.0');
    await expect(
      readPluginPackage(
        await packArchive({ ...files(), 'manifest.json': JSON.stringify(manifest({ trust: 'sandboxed' })) }),
        sha256,
      ),
    ).rejects.toThrow('Sandboxed plugins');
  });

  it('requires a declared icon to be a packaged PNG', async () => {
    const withIcon = (icon?: Uint8Array) =>
      packArchive({
        ...files(),
        'manifest.json': JSON.stringify(manifest({ icon: 'assets/icon.png' })),
        ...(icon ? { 'assets/icon.png': icon } : {}),
      });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(readPluginPackage(await withIcon(png), sha256)).resolves.toMatchObject({
      manifest: { icon: 'assets/icon.png' },
    });
    await expect(readPluginPackage(await withIcon(), sha256)).rejects.toThrow('assets/icon.png: file is missing');
    await expect(readPluginPackage(await withIcon(new Uint8Array([1, 2, 3])), sha256)).rejects.toThrow('not a PNG');
  });

  it('rejects data that is not an archive', async () => {
    await expect(readPluginPackage(new Uint8Array([1, 2, 3]), sha256)).rejects.toThrow('not a valid plugin package');
  });
});
