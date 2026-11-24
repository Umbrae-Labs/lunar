import { readResponseBytes } from './plugin-network';
import { parseGithubReleaseAsset } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { PACKAGE_LIMITS, type Sha256 } from '@umbrae-labs/lunar-plugin-sdk/package-format';

import type { CatalogFetch } from './plugin-catalog';

interface ReleaseAsset {
  readonly url: string;
  readonly size?: number;
  readonly sha256?: string;
}

const repositoryLink =
  /^https:\/\/github\.com\/([a-z\d][a-z\d-]*)\/([\w.-]+)(?:\/releases(?:\/latest(?:\/download\/([^/?#]+\.lunar-plugin))?|\/tag\/([^?#]+?))?)?\/?$/i;

async function githubAsset(input: string, request: CatalogFetch, assetName?: string): Promise<ReleaseAsset> {
  const link = input.trim().split(/[?#]/, 1)[0] ?? '';
  if (parseGithubReleaseAsset(link)) return { url: link };
  const match = repositoryLink.exec(link);
  if (!match || match[2] === '.' || match[2] === '..')
    throw new Error('Enter a GitHub repository, release, or .lunar-plugin release asset URL.');
  const [, owner, repo, filename, tag] = match;
  const wanted = filename ?? assetName;
  const repository = owner + '/' + repo!.replace(/\.git$/, '');
  const release = tag ? 'tags/' + encodeURIComponent(decodeURIComponent(tag)) : 'latest';
  const response = await request(`https://api.github.com/repos/${repository}/releases/${release}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub Release: HTTP ${response.status}`);
  const data = await response.json();
  const assets = Array.isArray(data.assets)
    ? data.assets.filter((asset: { browser_download_url?: string }) => {
        if (typeof asset?.browser_download_url !== 'string') return false;
        const parsed = parseGithubReleaseAsset(asset.browser_download_url);
        return parsed?.repository.toLowerCase() === repository.toLowerCase() && (!wanted || parsed.filename === wanted);
      })
    : [];
  if (assets.length !== 1)
    throw new Error(
      assets.length
        ? 'This release contains multiple plugins. Paste the URL of one .lunar-plugin asset.'
        : 'This release has no matching .lunar-plugin asset.',
    );
  const [asset] = assets;
  return {
    url: asset.browser_download_url,
    size: asset.size,
    sha256: /^sha256:[0-9a-f]{64}$/.test(asset.digest) ? asset.digest.slice(7) : undefined,
  };
}

/** A mirror may serve only bytes with a digest obtained independently of that mirror. */
export async function downloadReleaseAsset(
  asset: ReleaseAsset,
  request: CatalogFetch,
  sha256: Sha256,
  mirror?: string,
) {
  const limit = PACKAGE_LIMITS.archiveBytes;
  if (!parseGithubReleaseAsset(asset.url) || (asset.size !== undefined && (asset.size < 1 || asset.size > limit)))
    throw new Error('Invalid GitHub plugin asset.');
  const download = async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await request(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`GitHub download: HTTP ${response.status}`);
      const bytes = await readResponseBytes(response, asset.size ?? limit);
      if (
        !bytes.length ||
        bytes.length > limit ||
        (asset.size !== undefined && bytes.length !== asset.size) ||
        (asset.sha256 && (await sha256(bytes)) !== asset.sha256)
      )
        throw new Error('Plugin archive size or SHA-256 does not match.');
      return bytes;
    } finally {
      clearTimeout(timeout);
    }
  };
  if (mirror && /^https:\/\//.test(mirror) && asset.sha256) {
    try {
      return await download(mirror.replace(/\/+$/, '') + '/' + asset.url);
    } catch {
      /* Retry the canonical asset. */
    }
  }
  return download(asset.url);
}

export async function downloadGithubPlugin(input: string, request: CatalogFetch, sha256: Sha256, mirror?: string) {
  let asset = await githubAsset(input, request);
  const parsed = parseGithubReleaseAsset(asset.url)!;
  // An explicit asset link still works during GitHub API outages or rate limiting.
  if (mirror && !asset.sha256 && parseGithubReleaseAsset(input.trim().split(/[?#]/, 1)[0] ?? '')) {
    try {
      const tagged = await githubAsset(
        `https://github.com/${parsed.repository}/releases/tag/${parsed.tag}`,
        request,
        parsed.filename,
      );
      if (tagged.url === asset.url) asset = tagged;
    } catch {
      /* The canonical URL remains usable without a trusted digest. */
    }
  }
  return {
    archive: await downloadReleaseAsset(asset, request, sha256, mirror),
    githubRepository: parsed.repository,
  };
}
