import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every source file of the app, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.(ts|tsx|cjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('browser storage names', () => {
  it('never uses Market Kasa’s, which lives on the same site and would be read as ours', () => {
    // Both apps are served from hasankaan28.github.io: the browser keeps one storage per site,
    // not per path, so a shared name hands this app the market's device, session and data.
    const offending = [...sources('src'), ...sources('electron')].filter((path) =>
      /['"`]mk2[.-]/.test(readFileSync(path, 'utf8')),
    );
    expect(offending).toEqual([]);
  });
});
