import { describe, expect, it, vi } from 'vitest';
import { makeBuildId, precacheList, precachePlugin } from './precache';

describe('precache list', () => {
  it('lists every built file the worker must keep', () => {
    expect(
      precacheList([
        'index.html',
        'assets/index-B0x9.js',
        'assets/browser-Zx1.js',
        'assets/index-C2.css',
        'assets/ibm-plex-sans-latin-400-normal-D.woff2',
        'assets/ibm-plex-sans-latin-ext-400-normal-E.woff2',
        'assets/ibm-plex-sans-latin-400-normal-F.woff',
        'assets/ibm-plex-sans-cyrillic-400-normal-G.woff2',
        'assets/index-B0x9.js.map',
        'sw.js',
      ]),
    ).toEqual([
      './assets/browser-Zx1.js',
      './assets/ibm-plex-sans-latin-400-normal-D.woff2',
      './assets/ibm-plex-sans-latin-ext-400-normal-E.woff2',
      './assets/index-B0x9.js',
      './assets/index-C2.css',
    ]);
  });

  it('writes the list next to the build, lazy chunks and fonts included', () => {
    const emitFile = vi.fn();
    const plugin = precachePlugin();
    const generate = plugin.generateBundle as unknown as (
      this: { emitFile: typeof emitFile },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    generate.call(
      { emitFile },
      {},
      { 'index.html': {}, 'assets/camera-1.js': {}, 'assets/f-latin-1.woff2': {} },
    );
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'precache.json',
      source: JSON.stringify(['./assets/camera-1.js', './assets/f-latin-1.woff2']),
    });
    expect(plugin.apply).toBe('build');
  });

  it('stamps every build with an id the page carries and version.json repeats', () => {
    // An open page compares the two to see a new deploy, even one that kept the version number.
    const emitFile = vi.fn();
    const plugin = precachePlugin({ buildId: '3f2a9c1d0b7e' });
    const config = plugin.config as unknown as (config: { define?: Record<string, string> }) => {
      define: Record<string, string>;
    };
    expect(config({ define: { __APP_VERSION__: JSON.stringify('1.4.0') } })).toEqual({
      define: { __BUILD_ID__: JSON.stringify('3f2a9c1d0b7e') },
    });
    const generate = plugin.generateBundle as unknown as (
      this: { emitFile: typeof emitFile },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    generate.call({ emitFile }, {}, { 'index.html': {} });
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version: '1.4.0', build: '3f2a9c1d0b7e' }),
    });
  });

  it('names a build after the commit CI built, or else the time it was built', () => {
    expect(makeBuildId({ GITHUB_SHA: '3f2a9c1d0b7e55aa66' }, 0)).toBe('3f2a9c1d0b7e');
    expect(makeBuildId({ VERCEL_GIT_COMMIT_SHA: 'a1b2c3d4e5f6a7b8', GITHUB_SHA: 'x' }, 0)).toBe(
      'a1b2c3d4e5f6',
    );
    expect(makeBuildId({}, 1_790_000_000_000)).toBe((1_790_000_000_000).toString(36));
  });
});
