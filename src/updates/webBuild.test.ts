import { describe, expect, it, vi } from 'vitest';
import { fetchDeployedBuild, findNewBuild } from './webBuild';

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

describe('the deployed web build', () => {
  it('reads version.json beside the page, past every cache', async () => {
    const fetcher = vi.fn(async () => json({ version: '1.0.0', build: 'b2' }));
    const info = await fetchDeployedBuild(fetcher, 'https://restorankasa.vercel.app/app/', 42);
    expect(info).toEqual({ version: '1.0.0', build: 'b2' });
    expect(fetcher).toHaveBeenCalledWith('https://restorankasa.vercel.app/app/version.json?t=42', {
      cache: 'no-store',
    });
  });

  it('refuses an answer that is not a build', async () => {
    const base = 'https://x.test/';
    await expect(fetchDeployedBuild(async () => json({}, false), base)).rejects.toThrow();
    await expect(fetchDeployedBuild(async () => json({ v: 1 }), base)).rejects.toThrow();
  });

  it('finds a newer deploy only when its build differs from the page’s', async () => {
    const deployed = async () => json({ version: '1.0.0', build: 'b2' });
    expect(await findNewBuild('b1', deployed, 'https://x.test/')()).toEqual({ version: '1.0.0' });
    expect(await findNewBuild('b2', deployed, 'https://x.test/')()).toBeNull();
  });
});
