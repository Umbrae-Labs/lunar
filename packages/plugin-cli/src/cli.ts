import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENTRY_FILE } from '@umbrae-labs/lunar-plugin-sdk/package-format';
import { buildPlugin } from './build.ts';
import { buildCatalog, writeMarketEntry, writeMarketIndex } from './catalog.ts';
import { startDevServer } from './dev-server.ts';
import { initMarket, initProject } from './init.ts';
import { checkPackageLimits, collectPackageFiles, packPlugin } from './pack.ts';
import { loadProject } from './project.ts';
import { generateSigningKey, loadSigningKey } from './sign.ts';

const USAGE = `Usage: lunar-plugin <command> [directory] [options]

Commands:
  init <directory> --id <id> --name <name>   Create a plugin project
  build [directory]                          Bundle the plugin into dist/main.js
  validate [directory]                       Check the manifest, locales, build and package limits
  pack [directory] [--key <file>]            Build and write dist/<id>-<version>.lunar-plugin,
                                             signed with the Ed25519 PKCS#8 key when --key is given
  keygen [file]                              Create an Ed25519 signing key (PKCS#8 PEM, default
                                             lunar-signing-key.pem) and print its public JWK
  catalog <package...> --out <directory> --key <file> --name <name> [--badge <label>] [--website <url>]
                                             Write a catalog index.json with its packages and icons
  init-market <directory>                    Create a GitHub Pages market repository
  market-entry <package> --url <release-asset-url> --key <author.pem> --out <entry.json>
  market-index [entry.json ...] --key <market.pem> --out <index.json> [--config-out <config.json> [--index-url <url>] [--mirror <https-prefix>]]
  dev [directory] [--port 5757] [--host 0.0.0.0]
                                             Rebuild on change and serve to a Lunar development build`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'config-out': { type: 'string' },
      'index-url': { type: 'string' },
      mirror: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      port: { type: 'string', default: '5757' },
      host: { type: 'string', default: '0.0.0.0' },
      key: { type: 'string' },
      out: { type: 'string' },
      badge: { type: 'string' },
      website: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const directory = positionals[0] ?? '.';
  if (!command || values.help || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  switch (command) {
    case 'init': {
      if (!positionals[0] || !values.id || !values.name) {
        console.error('init requires a directory, --id and --name');
        return 1;
      }
      const files = await initProject(directory, { id: values.id, name: values.name });
      console.log(`Created ${files.length} files in ${path.resolve(directory)}`);
      return 0;
    }
    case 'build': {
      const project = await loadProject(directory);
      const result = await buildPlugin(project);
      await mkdir(project.outDir, { recursive: true });
      await writeFile(path.join(project.outDir, ENTRY_FILE), result.code);
      result.warnings.forEach((warning) => console.warn(`warning: ${warning}`));
      console.log(`Built ${path.join(project.outDir, ENTRY_FILE)} (${result.code.byteLength} bytes)`);
      return 0;
    }
    case 'validate': {
      const project = await loadProject(directory);
      const result = await buildPlugin(project);
      const problems = checkPackageLimits(await collectPackageFiles(project, result.code));
      if (problems.length > 0) {
        problems.forEach((problem) => console.error(`error: ${problem}`));
        return 1;
      }
      console.log(`${project.manifest.id}@${project.manifest.version} is valid`);
      return 0;
    }
    case 'pack': {
      const key = values.key ? await loadSigningKey(values.key) : undefined;
      const result = await packPlugin(await loadProject(directory), key);
      result.warnings.forEach((warning) => console.warn(`warning: ${warning}`));
      console.log(`Packed ${result.file} (${result.bytes} bytes, sha256 ${result.sha256})`);
      if (result.keyId) console.log(`Signed with key ${result.keyId}`);
      return 0;
    }
    case 'keygen': {
      const file = path.resolve(positionals[0] ?? 'lunar-signing-key.pem');
      const key = await generateSigningKey(file);
      console.log(`Wrote the private key to ${file}. Keep it secret and out of version control.`);
      console.log(`Key id (publisherKeyId): ${key.keyId}`);
      console.log(`Public key (JWK): ${JSON.stringify(key.publicJwk)}`);
      return 0;
    }
    case 'catalog': {
      if (positionals.length === 0 || !values.out || !values.key || !values.name) {
        console.error('catalog requires package files, --out, --key and --name');
        return 1;
      }
      const result = await buildCatalog({
        outDir: path.resolve(values.out),
        name: values.name,
        badge: values.badge,
        website: values.website,
        key: await loadSigningKey(values.key),
        packages: positionals.map((file) => path.resolve(file)),
      });
      console.log(`Wrote ${result.file} with ${result.catalog.plugins.length} plugins`);
      return 0;
    }
    case 'init-market': {
      if (positionals.length !== 1) throw new Error('init-market requires a directory');
      await initMarket(directory);
      console.log('Created the market repository in ' + path.resolve(directory));
      return 0;
    }
    case 'market-entry': {
      if (positionals.length !== 1 || !values.url || !values.key || !values.out)
        throw new Error('market-entry requires one package, --url, --key and --out');
      await writeMarketEntry(directory, values.url, await loadSigningKey(values.key), values.out);
      return 0;
    }
    case 'market-index': {
      if (!values.key || !values.out) throw new Error('market-index requires --key and --out');
      const configOut = values['config-out'];
      if (!configOut && (values.mirror || values['index-url']))
        throw new Error('--mirror and --index-url require --config-out');
      await writeMarketIndex(
        positionals,
        await loadSigningKey(values.key),
        values.out,
        configOut ? { out: configOut, indexUrl: values['index-url'], githubMirror: values.mirror } : undefined,
      );
      return 0;
    }
    case 'dev': {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        console.error('--port must be an integer between 0 and 65535');
        return 1;
      }
      const server = await startDevServer(directory, {
        port,
        host: values.host ?? '0.0.0.0',
        onEvent: (message) => console.log(`[dev] ${message}`),
        onLog: (line) => console.log(`[app] ${line}`),
      });
      console.log('Enter one of these addresses in Lunar → Settings → Plugins → Developer connection:');
      server.urls.forEach((url) => console.log(`  ${url}`));
      const boundPort = new URL(server.urls[0]!).port;
      console.log(`Over USB, run \`adb reverse tcp:${boundPort} tcp:${boundPort}\` and use:`);
      console.log(`  http://127.0.0.1:${boundPort}/?token=${server.token}`);
      await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
      await server.close();
      return 0;
    }
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}
