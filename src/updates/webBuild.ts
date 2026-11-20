import { BUILD_ID } from '@/app/version';
import type { BuildInfo } from '@/pwa/precache';
import type { Found } from './releaseWatch';

/**
 * What is deployed now, from version.json beside the page (src/pwa/precache.ts writes it). It
 * goes past the browser's cache and the CDN's, so a deploy minutes old is seen.
 */
export async function fetchDeployedBuild(
  fetcher: typeof fetch = fetch,
  base: string = document.baseURI,
  now: number = Date.now(),
): Promise<BuildInfo> {
  const address = new URL('version.json', base);
  address.searchParams.set('t', String(now));
  const response = await fetcher(address.href, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`version.json: ${response.status}`);
  }
  const info = (await response.json()) as Partial<BuildInfo> | null;
  if (typeof info?.version !== 'string' || typeof info.build !== 'string') {
    throw new Error('version.json names no build');
  }
  return { version: info.version, build: info.build };
}

/** A check for a deploy newer than the page: any build other than the one it came from. */
export function findNewBuild(
  running: string = BUILD_ID,
  fetcher?: typeof fetch,
  base?: string,
): () => Promise<Found | null> {
  return async () => {
    const deployed = await fetchDeployedBuild(fetcher, base);
    return deployed.build === running ? null : { version: deployed.version };
  };
}
