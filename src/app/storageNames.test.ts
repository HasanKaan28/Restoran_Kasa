import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Every source file of the app, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.(ts|tsx|cjs|js|json)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const serviceWorker = readFileSync('public/sw.js', 'utf8');

describe('browser storage names', () => {
  it('never uses Market Kasa’s, which lives on the same site and would be read as ours', () => {
    // Both apps are served from hasankaan28.github.io: the browser keeps one storage per site,
    // not per path, so a shared name hands this app the market's device, session and data.
    const offending = [
      ...sources('src'),
      ...sources('electron'),
      ...sources('public'),
      'vite.config.ts',
    ].filter((path) => /['"`]mk2[.-]/.test(readFileSync(path, 'utf8')));
    expect(offending).toEqual([]);
  });

  it('keeps the offline copy in caches of its own, rk-<version>', () => {
    expect(serviceWorker).toContain('const CACHE = `rk-${VERSION}`;');
  });

  it('clears only its own old caches, so Market Kasa’s offline copy is never deleted', () => {
    const cleared = [...serviceWorker.matchAll(/key\.startsWith\('([^']*)'\)/g)].map(
      (match) => match[1],
    );
    expect(cleared).toEqual(['rk-']);
  });

  it('on activation deletes its own old cache and leaves Market Kasa’s alone', async () => {
    const kept = new Set(['mk2-2.0.0', 'mk2-dev', 'rk-0.9.0', 'rk-1.0.0']);
    const listeners: Record<string, (event: { waitUntil(work: Promise<unknown>): void }) => void> =
      {};
    let work: Promise<unknown> = Promise.resolve();
    runInNewContext(serviceWorker, {
      URL,
      self: {
        location: { href: 'https://hasankaan28.github.io/Restoran_Kasa/app/sw.js?v=1.0.0' },
        addEventListener: (type: string, listener: (typeof listeners)[string]) => {
          listeners[type] = listener;
        },
        clients: { claim: () => Promise.resolve() },
      },
      caches: {
        keys: () => Promise.resolve([...kept]),
        delete: (key: string) => Promise.resolve(kept.delete(key)),
      },
    });
    listeners.activate?.({ waitUntil: (promise) => (work = promise) });
    await work;
    expect([...kept]).toEqual(['mk2-2.0.0', 'mk2-dev', 'rk-1.0.0']);
  });

  it('reads back only from its own cache, never from every cache on the site', () => {
    // caches.match() with no cache searches every cache the origin holds, Market Kasa's too.
    expect(serviceWorker).not.toMatch(/\bcaches\.match\(/);
  });
});
