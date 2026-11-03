import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The SDK and CLI release in lockstep: the CLI depends on the exact SDK version,
// and `lunar-plugin init` writes `^<SDK_VERSION>` for both packages.
export const PACKAGES = [
  { name: '@umbrae-labs/lunar-plugin-sdk', directory: 'packages/plugin-sdk' },
  { name: '@umbrae-labs/lunar-plugin-cli', directory: 'packages/plugin-cli' },
];

const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;

/** Plain versions publish as `latest`; prereleases as `next`, so `^` ranges never resolve to them. */
export function releaseChannel(version, { packageVersions, sdkVersion, branch, publish }) {
  const match = VERSION.exec(version ?? '');
  if (!match) throw new Error('Use X.Y.Z or X.Y.Z-alpha.N, X.Y.Z-beta.N, X.Y.Z-rc.N.');
  for (const [name, packageVersion] of Object.entries(packageVersions)) {
    if (packageVersion !== version) throw new Error(`${name} is ${packageVersion}; set it to ${version} first.`);
  }
  if (sdkVersion !== version) {
    throw new Error(`SDK_VERSION in packages/plugin-sdk/src/manifest.ts is ${sdkVersion}; set it to ${version} first.`);
  }
  if (publish && branch !== 'main') throw new Error(`Publish from main, not ${branch}.`);
  return { version, tag: match[1] ? 'next' : 'latest', prerelease: Boolean(match[1]) };
}

export function tarballName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

function readWorkspace(root = '.') {
  const packageVersions = Object.fromEntries(
    PACKAGES.map(({ name, directory }) => [
      name,
      JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')).version,
    ]),
  );
  const manifestSource = readFileSync(resolve(root, 'packages/plugin-sdk/src/manifest.ts'), 'utf8');
  const sdkVersion = /export const SDK_VERSION = '([^']+)';/.exec(manifestSource)?.[1];
  return { packageVersions, sdkVersion };
}

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

/**
 * Installs the packed tarballs into a fresh directory the way a plugin author would,
 * scaffolds a plugin and checks that it type-checks, validates, packs and keeps the
 * host modules external.
 */
export function smoke(artifacts, version) {
  const tarballs = PACKAGES.map(({ name }) => resolve(artifacts, tarballName(name, version)));
  const workspace = mkdtempSync(join(tmpdir(), 'lunar-plugin-smoke-'));
  try {
    const tools = join(workspace, 'tools');
    run('npm', ['install', '--prefix', tools, '--no-audit', '--no-fund', ...tarballs], workspace);
    const cli = join(tools, 'node_modules/@umbrae-labs/lunar-plugin-cli/dist/bin.js');
    const plugin = join(workspace, 'plugin');
    run(process.execPath, [cli, 'init', plugin, '--id', 'org.example.smoke', '--name', 'Smoke'], workspace);

    const scaffold = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'));
    for (const { name } of PACKAGES) {
      if (scaffold.devDependencies[name] !== `^${version}`) {
        throw new Error(`init wrote ${name}@${scaffold.devDependencies[name]}, expected ^${version}.`);
      }
    }
    run('npm', ['install', '--no-audit', '--no-fund', ...tarballs], plugin);
    run(process.execPath, [join(plugin, 'node_modules/typescript/bin/tsc'), '--noEmit'], plugin);
    const pluginCli = join(plugin, 'node_modules/@umbrae-labs/lunar-plugin-cli/dist/bin.js');
    run(process.execPath, [pluginCli, 'validate'], plugin);
    run(process.execPath, [pluginCli, 'pack'], plugin);

    const bundle = readFileSync(join(plugin, 'dist/main.js'), 'utf8');
    const required = [...new Set([...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))].sort();
    const expected = ['@umbrae-labs/lunar-plugin-sdk', '@umbrae-labs/lunar-plugin-sdk/ui', 'react/jsx-runtime'];
    if (JSON.stringify(required) !== JSON.stringify(expected)) {
      throw new Error(`The scaffold bundle requires ${required.join(', ')}; expected ${expected.join(', ')}.`);
    }
    if (!readdirSync(join(plugin, 'dist')).includes('org.example.smoke-0.1.0.lunar-plugin')) {
      throw new Error('pack did not write the plugin package.');
    }
    console.log(`Smoke test passed for ${version}.`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const [command, version, ...rest] = process.argv.slice(2);
  if (command === 'channel') {
    const [branch, publish] = rest;
    const channel = releaseChannel(version, { ...readWorkspace(), branch, publish: publish === 'true' });
    console.log(`tag=${channel.tag}\nprerelease=${channel.prerelease}`);
    return;
  }
  if (command === 'smoke') {
    smoke(resolve(rest[0] ?? 'artifacts'), version);
    return;
  }
  throw new Error('Usage: plugin-sdk-release.mjs channel <version> <branch> <publish> | smoke <version> [artifacts]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
