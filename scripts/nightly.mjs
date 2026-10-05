import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bilingualNotes, githubClient, publish, validateApk, validateVersion } from './release.mjs';

export function nightlyRelease(tag) {
  if (!/^nightly-\d{8}-[1-9]\d*$/.test(tag ?? '')) throw new Error('Invalid nightly tag.');
  return { tag, prerelease: true, name: `Lunar ${tag}` };
}

export function nightlyNotes() {
  const chinese = [
    '### 注意事项',
    'Nightly 是预发布版本，用于提前体验最新功能。功能仍在开发与测试中，可能出现错误或兼容性问题，安装前请备份重要书籍和数据。',
    'Nightly 与正式版使用相同包名，覆盖安装后沿用书库、阅读进度和设置。覆盖安装要求签名一致且构建编号满足更新条件；恢复使用正式版时，请安装构建编号更高且数据格式兼容的正式版本。',
    '此前使用独立包名的 Nightly 保留独立数据，切换到本版本前请另行备份和迁移。',
    '### 下载说明',
    '本次发布包含同一提交编译的两个 Android arm64 APK。',
    '**`lunar-nightly.apk`**：内置应用代码，安装后可独立运行，适合体验最新功能。',
    '**`lunar-develop.apk`**：使用独立包名的 Expo 开发客户端，可与正式版或 Nightly 同时安装，需要从同一提交启动 Metro 开发服务器。',
  ].join('\n\n');
  const english = [
    '### Important notes',
    'Nightly is a prerelease for trying the latest features. Features are still being developed and tested, so bugs or compatibility issues may occur. Back up important books and data before installing.',
    'Nightly uses the same package name as the stable app. Installing it as an update preserves your library, reading progress, and settings. Updates require the same signing certificate and a compatible version code. To return to stable, install a stable build with a higher version code and a compatible data format.',
    'Older Nightly builds with a separate package name retain their own data. Back up and migrate that data separately before switching to this build.',
    '### Downloads',
    'Both Android arm64 APKs are built from the same commit.',
    '**`lunar-nightly.apk`**: standalone app with bundled JavaScript for trying the latest features.',
    '**`lunar-develop.apk`**: Expo development client with a separate package name; can coexist with stable or Nightly. Requires Metro running from the same source commit.',
  ].join('\n\n');
  return `${bilingualNotes(chinese, english)}\n\n### Develop\n\n\`\`\`sh\nAPP_VARIANT=development pnpm start --dev-client\n\`\`\``;
}

export async function nightlyAssets(root, commit, version, packageName) {
  const assets = [];
  const manifests = [];
  for (const profile of ['nightly', 'development']) {
    const file = `lunar-${profile}.apk`;
    const data = await readFile(resolve(root, file));
    const metadata = JSON.parse(await readFile(resolve(root, `${profile}.json`), 'utf8'));
    const sha256 = createHash('sha256').update(data).digest('hex');
    const expectedPackage = profile === 'development' ? `${packageName}.dev` : packageName;
    if (
      !data.length ||
      metadata.profile !== profile ||
      metadata.commit !== commit ||
      metadata.sha256 !== sha256 ||
      metadata.packageName !== expectedPackage ||
      metadata.version !== version ||
      metadata.abi !== 'arm64-v8a'
    ) {
      throw new Error(`Invalid ${profile} artifact metadata.`);
    }
    // Use the product name Develop in public downloads; EAS keeps its development profile name.
    const name = profile === 'development' ? 'lunar-develop.apk' : file;
    assets.push({ name, data, contentType: 'application/vnd.android.package-archive' });
    manifests.push({ ...metadata, artifact: name });
  }
  assets.push({
    name: 'SHA256SUMS.txt',
    contentType: 'text/plain',
    data: Buffer.from(manifests.map((item) => `${item.sha256}  ${item.artifact}\n`).join('')),
  });
  assets.push({
    name: 'nightly.json',
    contentType: 'application/json',
    data: Buffer.from(`${JSON.stringify({ commit, builds: manifests }, null, 2)}\n`),
  });
  return assets;
}

async function main() {
  const [command, profile] = process.argv.slice(2);
  const pkg = JSON.parse(await readFile(new URL('../apps/mobile/package.json', import.meta.url), 'utf8'));
  const { expo } = JSON.parse(await readFile(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
  validateVersion(`v${pkg.version}`, pkg.version, expo.version);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (command === 'prepare') {
    if (!['nightly', 'development'].includes(profile)) throw new Error('Invalid nightly build profile.');
    const apk = `artifacts/lunar-${profile}.apk`;
    const badging = execFileSync(
      resolve(process.env.ANDROID_HOME, 'build-tools/36.0.0/aapt'),
      ['dump', 'badging', apk],
      { encoding: 'utf8' },
    );
    const packageName = profile === 'development' ? `${expo.android.package}.dev` : expo.android.package;
    const android = validateApk(badging, pkg.version, packageName, { allowDebuggable: profile === 'development' });
    const sha256 = createHash('sha256')
      .update(await readFile(apk))
      .digest('hex');
    await writeFile(
      `artifacts/${profile}.json`,
      `${JSON.stringify({ profile, commit, version: pkg.version, sha256, ...android }, null, 2)}\n`,
    );
    return;
  }
  if (command !== 'publish') throw new Error('Usage: node scripts/nightly.mjs <prepare profile|publish>');
  const release = nightlyRelease(process.env.NIGHTLY_TAG);
  const repository = process.env.LUNAR_GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
  const assets = await nightlyAssets('artifacts', commit, pkg.version, expo.android.package);
  const api = githubClient(process.env.GITHUB_TOKEN);
  // List refs to handle reruns without replacing an existing tag.
  const refs = await api('GET', `/repos/${repository}/git/matching-refs/tags/${release.tag}`);
  if (!refs.some((ref) => ref.ref === `refs/tags/${release.tag}`)) {
    await api('POST', `/repos/${repository}/git/refs`, { ref: `refs/tags/${release.tag}`, sha: commit });
  }
  const result = await publish(api, repository, release, commit, assets, nightlyNotes());
  console.log(`Published ${result.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
