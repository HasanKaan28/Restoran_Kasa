import { describe, expect, it, vi } from 'vitest';
import { fetchPublicMenu, MenuLoadError } from './fetchMenu';

const config = { url: 'https://proje.supabase.co', key: 'sb_publishable_abc' };
const menu = { name: 'Kebapçı Halil', categories: [], dishes: [{ name: 'Ayran', price: 5000 }] };

const answer = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('loading the guest menu', () => {
  it('asks public_menu for the slug with the publishable key and nothing of the guest', async () => {
    const fetcher = answer(menu);
    expect(await fetchPublicMenu(config, 'Ab3dEf6hIj9kLm2nOp4qRs7t', fetcher)).toEqual({
      kind: 'menu',
      menu,
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://proje.supabase.co/rest/v1/rpc/public_menu');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ slug: 'Ab3dEf6hIj9kLm2nOp4qRs7t' }),
    });
    expect(init?.headers).toEqual({
      apikey: 'sb_publishable_abc',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('tells a closed or unknown link from a failure', async () => {
    expect(await fetchPublicMenu(config, 'x', answer(null))).toEqual({ kind: 'closed' });
    await expect(fetchPublicMenu(config, 'x', answer({ message: 'boom' }, 500))).rejects.toThrow(
      MenuLoadError,
    );
    await expect(fetchPublicMenu(config, 'x', answer({ name: 'X' }))).rejects.toThrow(
      MenuLoadError,
    );
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchPublicMenu(config, 'x', offline)).rejects.toThrow(MenuLoadError);
  });
});
