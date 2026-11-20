import { describe, expect, it } from 'vitest';
import { androidWatch, findNewerRelease, webWatch } from './watches';

describe('release checks', () => {
  it('finds a later GitHub release, and nothing when the app is the latest', async () => {
    expect(await findNewerRelease('1.0.0', async () => '1.1.0')()).toEqual({ version: '1.1.0' });
    expect(await findNewerRelease('1.1.0', async () => '1.1.0')()).toBeNull();
    expect(await findNewerRelease('1.2.0', async () => '1.1.0')()).toBeNull();
  });

  it('fails a check that could not read the release, rather than saying "Güncel"', async () => {
    await expect(findNewerRelease('1.0.0', async () => null)()).rejects.toThrow();
  });

  it('gives the notice and Settings one shared watch per platform', () => {
    expect(androidWatch()).toBe(androidWatch());
    expect(webWatch()).toBe(webWatch());
    expect(webWatch()).not.toBe(androidWatch());
  });
});
