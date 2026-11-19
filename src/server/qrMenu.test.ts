import { describe, expect, it, vi } from 'vitest';
import type { ServerClient } from './client';
import { changeQrMenu, menuLink, menuPageUrl, PUBLIC_MENU_PAGE, readQrMenu } from './qrMenu';

type Answer = { data?: unknown; error?: { message: string; code?: string } };

function fakeClient(answers: Record<string, Answer>, signIn: { message: string } | null = null) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const auth = {
    signInWithPassword: vi.fn(async () => ({ error: signIn })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInAnonymously: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    refreshSession: vi.fn(async () => ({ error: null })),
  };
  const client: ServerClient = {
    auth,
    async rpc(fn, args) {
      calls.push({ fn, args });
      const answer = answers[fn] ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { client, calls, auth };
}

const SLUG = 'Ab3dEf6hIj9kLm2nOp4qRs7tUvWx';

describe('the QR menu on the server', () => {
  it('reads the register’s link with its own session', async () => {
    const device = fakeClient({ my_qr_menu: { data: { enabled: true, slug: SLUG } } });
    expect(await readQrMenu(device.client)).toEqual({ enabled: true, slug: SLUG });
    expect(device.calls).toEqual([{ fn: 'my_qr_menu', args: undefined }]);

    const lost = fakeClient({ my_qr_menu: { error: { message: 'device_not_registered' } } });
    await expect(readQrMenu(lost.client)).rejects.toThrow('Bu cihaz sunucuya bağlı değil.');
  });

  it('turns it on with the owner’s one sign-in, then signs out again', async () => {
    const owner = fakeClient({ set_qr_menu: { data: { enabled: true, slug: SLUG } } });
    const state = await changeQrMenu({
      owner: owner.client,
      email: ' sahip@example.com ',
      password: 'gizli',
      marketId: 'kebapci-abc123',
      change: { enabled: true },
    });

    expect(state).toEqual({ enabled: true, slug: SLUG });
    expect(owner.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'sahip@example.com',
      password: 'gizli',
    });
    expect(owner.calls).toEqual([
      { fn: 'set_qr_menu', args: { market_id: 'kebapci-abc123', enabled: true } },
    ]);
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('makes a new link, and says why when the server refuses', async () => {
    const owner = fakeClient({ rotate_qr_menu: { data: { enabled: true, slug: 'Yeni' } } });
    const input = { email: 'a@b.c', password: 'p', marketId: 'm', change: 'rotate' } as const;
    expect(await changeQrMenu({ owner: owner.client, ...input })).toEqual({
      enabled: true,
      slug: 'Yeni',
    });
    expect(owner.calls).toEqual([{ fn: 'rotate_qr_menu', args: { market_id: 'm' } }]);

    const stranger = fakeClient({ rotate_qr_menu: { error: { message: 'not_owner' } } });
    await expect(changeQrMenu({ owner: stranger.client, ...input })).rejects.toThrow(
      'Bu hesap bu restoranın sahibi değil.',
    );
    expect(stranger.auth.signOut).toHaveBeenCalled();

    const wrong = fakeClient({}, { message: 'Invalid login credentials' });
    await expect(changeQrMenu({ owner: wrong.client, ...input })).rejects.toThrow(
      'E-posta ya da şifre yanlış.',
    );
    expect(wrong.calls).toEqual([]);
  });

  it('links to the public page, with the table when there is one', () => {
    const page = PUBLIC_MENU_PAGE;
    expect(menuLink(SLUG, undefined, page)).toBe(`${page}#${SLUG}`);
    expect(menuLink(SLUG, 'Bahçe 2', page)).toBe(`${page}?masa=Bah%C3%A7e%202#${SLUG}`);
    expect(menuLink(SLUG, undefined, 'http://localhost:5173/menu.html')).toBe(
      `http://localhost:5173/menu.html#${SLUG}`,
    );
  });

  it('prints the public address in every release, the local one only while developing', () => {
    expect(PUBLIC_MENU_PAGE).toBe('https://restorankasa.vercel.app/app/menu.html');
    const href = 'http://localhost:5173/#/settings';
    expect(menuPageUrl({ DEV: false }, href)).toBe(PUBLIC_MENU_PAGE);
    expect(menuPageUrl({ DEV: true }, href)).toBe('http://localhost:5173/menu.html');
    expect(
      menuPageUrl({ DEV: false, VITE_PUBLIC_MENU_URL: 'https://kasa.example.com/app/menu.html' }),
    ).toBe('https://kasa.example.com/app/menu.html');
    // Only https, or a local build being tried out.
    expect(menuPageUrl({ DEV: false, VITE_PUBLIC_MENU_URL: 'http://evil.example/menu.html' })).toBe(
      PUBLIC_MENU_PAGE,
    );
    expect(
      menuPageUrl({ DEV: false, VITE_PUBLIC_MENU_URL: 'http://localhost:5199/app/menu.html' }),
    ).toBe('http://localhost:5199/app/menu.html');
  });
});
