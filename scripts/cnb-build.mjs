import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { validateVersion } from './release.mjs';

const repository = 'Umbrae-Labs/lunar';
const remote = `https://cnb.cool/${repository}.git`;
const apiRoot = `https://api.cnb.cool/${repository}/-`;

export function buildRequest(env, commit) {
  if (!['release', 'nightly', 'development'].includes(env.BUILD_PROFILE)) throw new Error('Invalid build profile.');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid source commit.');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    throw new Error('Invalid GitHub repository.');
  }
  const ids = [env.GITHUB_REPOSITORY_ID, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT];
  if (ids.some((value) => !/^[1-9]\d*$/.test(value ?? ''))) throw new Error('Missing GitHub run identity.');
  const profile = env.BUILD_PROFILE;
  const buildId = [...ids, profile].join('-');
  const tag = env.RELEASE_TAG ?? '';
  if (profile === 'release' && !/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(tag)) {
    throw new Error('Invalid release tag.');
  }
  return {
    branch: `github-build/${buildId}`,
    sha: commit,
    event: 'api_trigger_github_android',
    sync: 'true',
    title: `GitHub ${profile} ${buildId}`,
    env: {
      BUILD_PROFILE: profile,
      RELEASE_TAG: tag,
      LUNAR_BUILD_ID: buildId,
      LUNAR_SOURCE_COMMIT: commit,
      LUNAR_GITHUB_REPOSITORY: env.GITHUB_REPOSITORY,
    },
  };
}

export function assetNames(request) {
  const { BUILD_PROFILE: profile, RELEASE_TAG: tag } = request.env;
  return profile === 'release'
    ? ['lunar-release.apk', `lunar-${tag}-android-arm64-v8a.apk`, 'SHA256SUMS.txt', 'release.json']
    : [`lunar-${profile}.apk`, `${profile}.json`];
}

export function cnbClient(token, fetcher = fetch) {
  if (!token) throw new Error('Configure the CNB_SECRET GitHub repository secret.');
  return async (method, endpoint, body) => {
    const response = await fetcher(`${apiRoot}${endpoint}`, {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.cnb.api+json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 302 && method === 'GET' && endpoint.startsWith('/commit-assets/download/')) {
      const location = new URL(response.headers.get('location'));
      if (location.protocol !== 'https:' || location.username || location.password) {
        throw new Error('Invalid CNB attachment download URL.');
      }
      // The signed storage URL is fetched separately so the CNB token stays on the API host.
      return location.href;
    }
    if (!response.ok) throw new Error(`CNB ${method} ${endpoint} failed: HTTP ${response.status}.`);
    return response.json();
  };
}

export async function waitForBuild(api, sn, { timeout = 160 * 60_000, interval = 30_000, pause = sleep } = {}) {
  const deadline = Date.now() + timeout;
  let previous;
  while (Date.now() < deadline) {
    const result = await api('GET', `/build/status/${encodeURIComponent(sn)}`);
    if (result.status !== previous) {
      console.log(`CNB ${sn}: ${result.status}`);
      previous = result.status;
    }
    if (result.status === 'success') {
      const pipelines = Object.values(result.pipelinesStatus ?? {});
      if (!pipelines.length || pipelines.some((item) => item.status !== 'success')) {
        throw new Error('CNB finished without a successful Android pipeline.');
      }
      return;
    }
    if (['error', 'cancel', 'cancelled', 'failed', 'timeout', 'skipped'].includes(result.status)) {
      throw new Error(`CNB build ${sn} ended with ${result.status}.`);
    }
    await pause(interval);
  }
  throw new Error(`Timed out waiting for CNB build ${sn}.`);
}

export async function verifyAssets(request, root = 'artifacts') {
  const { BUILD_PROFILE: profile, RELEASE_TAG: tag } = request.env;
  const apk = await readFile(resolve(root, `lunar-${profile}.apk`));
  const metadata = JSON.parse(await readFile(resolve(root, `${profile}.json`), 'utf8'));
  const digest = createHash('sha256').update(apk).digest('hex');
  if (!apk.length || metadata.commit !== request.sha || metadata.sha256 !== digest || metadata.abi !== 'arm64-v8a') {
    throw new Error('CNB APK commit, ABI or checksum differs from the requested build.');
  }
  if (profile === 'release') {
    const name = `lunar-${tag}-android-arm64-v8a.apk`;
    if (
      metadata.tag !== tag ||
      metadata.repository !== request.env.LUNAR_GITHUB_REPOSITORY ||
      !(await readFile(resolve(root, name))).equals(apk) ||
      (await readFile(resolve(root, 'SHA256SUMS.txt'), 'utf8')).trim() !== `${digest}  ${name}`
    ) {
      throw new Error('CNB release assets differ from the requested release.');
    }
  } else if (metadata.profile !== profile) {
    throw new Error('CNB APK profile differs from the requested build.');
  }
}

export async function downloadAssets(api, request, root = 'artifacts', fetcher = fetch) {
  await mkdir(root, { recursive: true });
  for (const name of assetNames(request)) {
    const filename = `${request.env.LUNAR_BUILD_ID}--${name}`;
    const url = await api('GET', `/commit-assets/download/${request.sha}/${encodeURIComponent(filename)}`);
    if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('Missing CNB download URL.');
    const response = await fetcher(url, { signal: AbortSignal.timeout(300_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Download failed for ${name}: HTTP ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(resolve(root, name)));
  }
  await verifyAssets(request, root);
}

async function main() {
  const env = process.env;
  const api = cnbClient(env.CNB_SECRET);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const request = buildRequest(env, commit);
  const pkg = JSON.parse(await readFile(new URL('../apps/mobile/package.json', import.meta.url), 'utf8'));
  const { expo } = JSON.parse(await readFile(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
  validateVersion(request.env.RELEASE_TAG || `v${pkg.version}`, pkg.version, expo.version);
  // Authentication stays in the child environment, never in a remote URL or persisted git config.
  const gitEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://cnb.cool/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`cnb:${env.CNB_SECRET}`).toString('base64')}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
  };
  const push = (ref) => execFileSync('git', ['push', '-o', 'ci.skip', remote, ref], { env: gitEnv, stdio: 'inherit' });
  let sn;
  let finished = false;
  let synced = false;
  const controller = new AbortController();
  const onCancel = () => controller.abort(new Error('GitHub build was cancelled.'));
  process.once('SIGINT', onCancel);
  process.once('SIGTERM', onCancel);
  try {
    push(`${commit}:refs/heads/${request.branch}`);
    synced = true;
    controller.signal.throwIfAborted();
    const build = await api('POST', '/build/start', request);
    sn = build.sn;
    if (!build.success || typeof sn !== 'string' || !sn) throw new Error('CNB did not accept the build.');
    const logUrl = new URL(build.buildLogUrl);
    if (logUrl.protocol !== 'https:' || logUrl.hostname !== 'cnb.cool') throw new Error('Invalid CNB build log URL.');
    console.log(`CNB build: ${logUrl}`);
    if (env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\nCNB ${env.BUILD_PROFILE}: [${sn}](${logUrl})\n\nCommit: ${commit}\n`,
      );
    }
    await waitForBuild(api, sn, {
      pause: (ms) => sleep(ms, undefined, { signal: controller.signal }),
    });
    finished = true;
    controller.signal.throwIfAborted();
    await downloadAssets(api, request);
    console.log(`Retrieved and verified ${env.BUILD_PROFILE} assets from CNB.`);
  } finally {
    if (sn && !finished) {
      try {
        await api('POST', `/build/stop/${encodeURIComponent(sn)}`);
      } catch (error) {
        console.warn(`Unable to stop CNB build: ${error.message}`);
      }
    }
    if (synced) {
      try {
        push(`:refs/heads/${request.branch}`);
      } catch {
        console.warn(`Unable to delete temporary CNB branch ${request.branch}.`);
      }
    }
    process.removeListener('SIGINT', onCancel);
    process.removeListener('SIGTERM', onCancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
