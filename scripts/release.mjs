import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateVersion(tag, packageVersion, appVersion) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(alpha|beta|rc)\.([1-9]\d*))?$/.exec(tag ?? '');
  if (!match) throw new Error('Use vX.Y.Z or vX.Y.Z-alpha.N, vX.Y.Z-beta.N, vX.Y.Z-rc.N.');
  if (packageVersion !== match[1] || appVersion !== match[1]) {
    throw new Error(`Tag ${tag} requires package.json and app.json version ${match[1]}.`);
  }
  return { tag, version: match[1], prerelease: Boolean(match[2]) };
}

export function validateApk(badging, version, packageName, { allowDebuggable = false } = {}) {
  const pkg = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  const abi = /^native-code: (.+)$/m.exec(badging)?.[1].trim();
  if (!pkg || pkg[1] !== packageName || pkg[3] !== version || Number(pkg[2]) < 1) {
    throw new Error('APK package name or version differs from the release configuration.');
  }
  if (abi !== "'arm64-v8a'") throw new Error('Release APK must contain only the supported arm64-v8a ABI.');
  if (!allowDebuggable && /^application-debuggable/m.test(badging)) throw new Error('Release APK is debuggable.');
  return { packageName: pkg[1], versionCode: Number(pkg[2]), abi: 'arm64-v8a' };
}

export function bilingualNotes(chinese, english) {
  return `<details>\n<summary>中文</summary>\n\n${chinese}\n\n</details>\n\n## English\n\n${english}`;
}

export async function readChangelog(tag, root = 'changelog') {
  if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(tag)) {
    throw new Error('Invalid changelog tag.');
  }
  const sections = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const file = resolve(root, tag, `${locale}.md`);
    const content = (await readFile(file, 'utf8')).trim();
    if (!content || /\bTODO\b|\bTBD\b|待填写/i.test(content)) throw new Error(`Complete changelog: ${file}`);
    sections.push(content);
  }
  return bilingualNotes(...sections);
}

export async function withReleaseComparison(api, repository, release, notes) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
  const current = release.version.split('.').map(Number);
  const compare = (left, right) => {
    for (let index = 0; index < 3; index++) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };
  let previous;
  // Compare against the preceding stable release, even when Nightly builds or backports were published later.
  for (let page = 1; ; page++) {
    const releases = await api('GET', `/repos/${repository}/releases?per_page=100&page=${page}`);
    for (const item of releases) {
      const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(item.tag_name);
      if (item.draft || item.prerelease || !match) continue;
      const version = match[1].split('.').map(Number);
      if (compare(version, current) < 0 && (!previous || compare(version, previous.version) > 0)) {
        previous = { tag: item.tag_name, version };
      }
    }
    if (releases.length < 100) break;
  }
  if (!previous) return notes;
  const url = `https://github.com/${repository}/compare/${previous.tag}...${release.tag}`;
  return `${notes}\n\n**Full changelog:** [${previous.tag} → ${release.tag}](${url})`;
}

export function githubClient(token) {
  if (!token) throw new Error('GITHUB_TOKEN or GITHUB_RELEASE_TOKEN is required.');
  return async (method, endpoint, body, contentType = 'application/json') => {
    const url = new URL(endpoint, 'https://api.github.com');
    if (url.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(url.hostname)) {
      throw new Error('Unexpected GitHub API host.');
    }
    const response = await fetch(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': contentType,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(contentType === 'application/json' ? 30_000 : 300_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${url.pathname} failed: HTTP ${response.status}.`);
    return response.status === 204 ? undefined : response.json();
  };
}

export async function preflight(api, repository, release, commit) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
  const base = `/repos/${repository}`;
  const refs = await api('GET', `${base}/git/matching-refs/tags/${encodeURIComponent(release.tag)}`);
  const ref = refs.find((item) => item.ref === `refs/tags/${release.tag}`);
  // A new release gets its tag when the fully uploaded draft is published.
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 10; depth++) {
      object = (await api('GET', `${base}/git/tags/${object.sha}`)).object;
    }
    if (object.type !== 'commit' || object.sha !== commit) {
      throw new Error('GitHub tag and the build checkout must identify the same commit.');
    }
  }
  let existing;
  for (let page = 1; ; page++) {
    const releases = await api('GET', `${base}/releases?per_page=100&page=${page}`);
    existing = releases.find((item) => item.tag_name === release.tag);
    if (existing || releases.length < 100) break;
  }
  const marker = `<!-- lunar-release:${commit} -->`;
  if (existing && (!existing.draft || !existing.body?.includes(marker))) {
    throw new Error('This release is published or managed elsewhere. Use a new version tag.');
  }
  return { base, existing, marker };
}

export async function publish(api, repository, release, commit, assets, notes) {
  if (!notes?.trim()) throw new Error('Release notes are required.');
  const { base, existing, marker } = await preflight(api, repository, release, commit);
  const body = `${marker}\n${notes}\n\nSource commit: ${commit}`;
  const draft =
    existing ??
    (await api('POST', `${base}/releases`, {
      tag_name: release.tag,
      target_commitish: commit,
      name: release.name ?? `Lunar ${release.tag}`,
      body,
      draft: true,
      prerelease: release.prerelease,
      generate_release_notes: false,
    }));
  // Only replace artifacts in a draft created by this script for this commit.
  for (const asset of assets) {
    const previous = draft.assets?.find((item) => item.name === asset.name);
    if (previous) await api('DELETE', `${base}/releases/assets/${previous.id}`);
    const url = new URL(draft.upload_url.replace(/\{.*$/, ''));
    url.searchParams.set('name', asset.name);
    const uploaded = await api('POST', url.href, asset.data, asset.contentType);
    if (uploaded.state !== 'uploaded' || uploaded.size !== asset.data.length) {
      throw new Error(`GitHub did not confirm the full upload of ${asset.name}. The release remains a draft.`);
    }
  }
  // Recheck the remote tag after uploading and before exposing the assets.
  await preflight(api, repository, release, commit);
  return api('PATCH', `${base}/releases/${draft.id}`, {
    tag_name: release.tag,
    target_commitish: commit,
    body,
    draft: false,
    prerelease: release.prerelease,
    make_latest: release.prerelease ? 'false' : 'legacy',
  });
}

async function main() {
  const [command, explicitTag] = process.argv.slice(2);
  if (!['validate', 'preflight', 'prepare', 'publish'].includes(command)) {
    throw new Error('Usage: node scripts/release.mjs <validate|preflight|prepare|publish> [tag]');
  }
  const pkg = JSON.parse(await readFile(new URL('../apps/mobile/package.json', import.meta.url), 'utf8'));
  const { expo } = JSON.parse(await readFile(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
  const release = validateVersion(explicitTag ?? process.env.CNB_BRANCH, pkg.version, expo.version);
  const notes = await readChangelog(release.tag);
  if (command === 'validate') {
    console.log(`Validated ${release.tag}.`);
    return;
  }
  const repository = process.env.LUNAR_GITHUB_REPOSITORY;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (command === 'preflight') {
    const api = githubClient(process.env.GITHUB_TOKEN ?? process.env.GITHUB_RELEASE_TOKEN);
    await preflight(api, repository, release, commit);
    console.log(`Validated release destination for ${release.tag} at ${commit}.`);
    return;
  }
  const apk = await readFile('artifacts/lunar-release.apk');
  const name = `lunar-${release.tag}-android-arm64-v8a.apk`;
  const digest = createHash('sha256').update(apk).digest('hex');
  if (command === 'publish') {
    const metadata = JSON.parse(await readFile('artifacts/release.json', 'utf8'));
    if (
      metadata.commit !== commit ||
      metadata.tag !== release.tag ||
      metadata.sha256 !== digest ||
      metadata.repository !== repository
    ) {
      throw new Error('Release artifact metadata differs from the publishing checkout.');
    }
    const assets = await Promise.all(
      [name, 'SHA256SUMS.txt', 'release.json'].map(async (assetName) => ({
        name: assetName,
        data: await readFile(resolve('artifacts', assetName)),
        contentType: 'application/octet-stream',
      })),
    );
    if (!assets[0].data.equals(apk)) throw new Error('Named release APK differs from the verified APK.');
    const api = githubClient(process.env.GITHUB_TOKEN ?? process.env.GITHUB_RELEASE_TOKEN);
    const result = await publish(
      api,
      repository,
      release,
      commit,
      assets,
      await withReleaseComparison(api, repository, release, notes),
    );
    console.log(`Published ${result.html_url}`);
    return;
  }
  const badging = execFileSync(
    resolve(process.env.ANDROID_HOME ?? '/opt/android-sdk', 'build-tools/36.0.0/aapt'),
    ['dump', 'badging', 'artifacts/lunar-release.apk'],
    { encoding: 'utf8' },
  );
  const android = validateApk(badging, release.version, expo.android.package);
  const assets = [
    { name, data: apk, contentType: 'application/vnd.android.package-archive' },
    { name: 'SHA256SUMS.txt', data: Buffer.from(`${digest}  ${name}\n`), contentType: 'text/plain' },
    {
      name: 'release.json',
      data: Buffer.from(
        `${JSON.stringify(
          {
            ...release,
            ...android,
            repository,
            commit,
            sha256: digest,
            artifact: name,
          },
          null,
          2,
        )}\n`,
      ),
      contentType: 'application/octet-stream',
    },
  ];
  await mkdir('artifacts', { recursive: true });
  for (const asset of assets) await writeFile(resolve('artifacts', asset.name), asset.data);
  console.log(`Prepared ${release.tag} artifacts.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
