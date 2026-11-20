import type { Plugin } from 'vite';

/**
 * The built files the service worker keeps at install: every hashed file, not only the page's.
 * Of the fonts only the Latin ones in WOFF2: Turkish needs no other script, and every browser that
 * runs a service worker reads WOFF2.
 */
export function precacheList(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => name.startsWith('assets/') && !name.endsWith('.map'))
    .filter(
      (name) =>
        !/\.(woff2?|ttf)$/.test(name) || (name.endsWith('.woff2') && name.includes('-latin-')),
    )
    .map((name) => `./${name}`)
    .sort();
}

/** What version.json says about a deploy: its release and the build that made it. */
export type BuildInfo = { version: string; build: string };

/**
 * A build's id: the commit CI built (the same code deployed twice keeps its id), or the time of a
 * build made by hand.
 */
export function makeBuildId(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): string {
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  return commit ? commit.slice(0, 12) : now.toString(36);
}

/**
 * Writes the files the service worker and the update check read beside the build:
 * - precache.json. The page names only its entry files; the camera's lazily loaded scanner and
 *   the fonts named from CSS would otherwise be missing offline until used once online.
 * - version.json, the release and the build id. The page is built with the same id
 *   (`__BUILD_ID__`), so an open page sees a newer deploy, even one that kept the version.
 */
export function precachePlugin({ buildId = makeBuildId() }: { buildId?: string } = {}): Plugin {
  let version = 'dev';
  return {
    name: 'market-kasa-precache',
    apply: 'build',
    config(config) {
      const defined = config.define?.__APP_VERSION__;
      if (typeof defined === 'string') {
        version = JSON.parse(defined) as string;
      }
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify(precacheList(Object.keys(bundle))),
      });
      const info: BuildInfo = { version, build: buildId };
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) });
    },
  };
}
