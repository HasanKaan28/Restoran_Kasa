import { describe, expect, it, vi } from 'vitest';
import type { ServerClient } from './client';
import { joinMarket, openMarket } from './onboarding';

type Answer = { data?: unknown; error?: { message: string; code?: string } };

function fakeClient(answers: Record<string, Answer>, session: unknown = { user: {} }) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const auth = {
    signUp: vi.fn(async () => ({ data: { session }, error: null as { message: string } | null })),
    signInWithPassword: vi.fn(async () => ({ error: null as { message: string } | null })),
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

const claimed = {
  marketId: 'kursunlu-ab12cd',
  marketName: 'Kurşunlu Market',
  deviceId: 'd1',
  deviceCode: 'K1',
};

describe('opening a market', () => {
  it('signs the shop up, opens its market and makes this device the first register', async () => {
    const owner = fakeClient({
      create_own_market: { data: { id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' } },
      create_pairing: { data: 'ABCD2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);

    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: ' emin@example.com ',
      password: 'gizli-sifre',
      marketName: ' Kurşunlu Market ',
      activationCode: 'RK-ABCD-EFGH-JKMN',
      platform: 'windows',
    });

    expect(owner.auth.signUp).toHaveBeenCalledWith({
      email: 'emin@example.com',
      password: 'gizli-sifre',
    });
    expect(owner.calls.map((call) => call.fn)).toEqual(['create_own_market', 'create_pairing']);
    expect(owner.calls[0]?.args).toEqual({ name: 'Kurşunlu Market', code: 'RK-ABCD-EFGH-JKMN' });
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(device.calls[0]?.args).toMatchObject({ code: 'ABCD2345', device_code: '' });
    expect(result).toEqual({ claimed });
  });

  it('asks to confirm the email when the server wants it, before the code is used', async () => {
    const owner = fakeClient({}, null);
    owner.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Email not confirmed' },
    });
    const device = fakeClient({});
    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: 'Market',
      activationCode: 'RK-ABCD-EFGH-JKMN',
      platform: 'web',
    });
    expect(result).toEqual({ confirmEmail: true });
    expect(owner.calls).toEqual([]);
  });

  it('signs in when the server confirms emails and does not say the account exists', async () => {
    // With "Confirm email" on, signing up an email that has an account answers like a new one:
    // no session and no error. The password then signs in, once the email is confirmed.
    const owner = fakeClient(
      {
        create_own_market: { data: { id: 'm-1', name: 'Market' } },
        create_pairing: { data: 'ABCD2345' },
      },
      null,
    );
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: 'Market',
      activationCode: 'RK-ABCD-EFGH-JKMN',
      platform: 'web',
    });
    expect(owner.auth.signInWithPassword).toHaveBeenCalled();
    expect(result).toEqual({ claimed });
  });

  it('says the password is wrong for an account the confirming server hid', async () => {
    const owner = fakeClient({}, null);
    owner.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    });
    await expect(
      openMarket({
        owner: owner.client,
        device: fakeClient({}).client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        marketName: 'Market',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow('Bu e-postanın hesabı var ama şifre yanlış.');
    expect(owner.calls).toEqual([]);
  });

  it('signs in instead when the email already has an account', async () => {
    const owner = fakeClient({
      create_own_market: { data: { id: 'm-1', name: 'Market' } },
      create_pairing: { data: 'ABCD2345' },
    });
    owner.auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'User already registered' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: 'Market',
      activationCode: 'RK-ABCD-EFGH-JKMN',
      platform: 'web',
    });
    expect(owner.auth.signInWithPassword).toHaveBeenCalled();
  });

  it('says why a market could not be opened', async () => {
    const short = fakeClient({});
    short.auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Password should be at least 6 characters.' },
    });
    await expect(
      openMarket({
        owner: short.client,
        device: fakeClient({}).client,
        email: 'a@example.com',
        password: '123',
        marketName: 'M',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow('Şifre en az 8 karakter olmalı.');
    const many = fakeClient({ create_own_market: { error: { message: 'too_many_markets' } } });
    await expect(
      openMarket({
        owner: many.client,
        device: fakeClient({}).client,
        email: 'a@example.com',
        password: 'gizli-sifre',
        marketName: 'M',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow('Bu hesapla en çok 3 restoran açılabilir.');
  });

  it('says the code is wrong or used, and leaves no owner signed in', async () => {
    const owner = fakeClient({ create_own_market: { error: { message: 'activation_invalid' } } });
    const device = fakeClient({});
    await expect(
      openMarket({
        owner: owner.client,
        device: device.client,
        email: 'a@example.com',
        password: 'gizli-sifre',
        marketName: 'M',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow('Kod geçersiz ya da kullanılmış.');
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(device.calls).toEqual([]);
  });
});

describe('finishing a restaurant whose first try failed after its code was used', () => {
  it('binds this device to the restaurant the code opened, without a new code', async () => {
    const owner = fakeClient({
      create_own_market: { error: { message: 'activation_invalid' } },
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      create_pairing: { data: 'ABCD2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: ' kurşunlu market ',
      activationCode: 'RK-ABCD-EFGH-JKMN',
      platform: 'web',
    });
    expect(owner.calls.map((call) => call.fn)).toEqual([
      'create_own_market',
      'owner_markets',
      'create_pairing',
    ]);
    expect(owner.calls[2]?.args).toEqual({ market_id: 'kursunlu-ab12cd' });
    expect(result).toEqual({ claimed });
  });

  it('finishes it too when the account is at its three restaurants', async () => {
    const owner = fakeClient({
      create_own_market: { error: { message: 'too_many_markets' } },
      owner_markets: {
        data: [
          { id: 'a', name: 'A' },
          { id: 'm-1', name: 'Market' },
          { id: 'c', name: 'C' },
        ],
      },
      create_pairing: { data: 'ABCD2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    expect(
      await openMarket({
        owner: owner.client,
        device: device.client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        marketName: 'Market',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).toEqual({ claimed });
  });

  it('points an owner whose code is used to “Restorana giriş yap” for the restaurant they have', async () => {
    const owner = fakeClient({
      create_own_market: { error: { message: 'activation_invalid' } },
      owner_markets: { data: [{ id: 'b', name: 'Başka Lokanta' }] },
    });
    await expect(
      openMarket({
        owner: owner.client,
        device: fakeClient({}).client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        marketName: 'Market',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow(
      'Kod geçersiz ya da kullanılmış. Bu hesabın restoranı var (Başka Lokanta): bu cihazı eklemek için “Restorana giriş yap”.',
    );
  });

  it('says the restaurant is open and a retry needs no new code when binding fails', async () => {
    const owner = fakeClient({
      create_own_market: { data: { id: 'm-1', name: 'Market' } },
      create_pairing: { error: { message: 'Failed to fetch' } },
    });
    await expect(
      openMarket({
        owner: owner.client,
        device: fakeClient({}).client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        marketName: 'Market',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow(/^Restoran açıldı ama bu cihaz bağlanamadı.*yeni kod gerekmez\.$/);
    const device = fakeClient({ claim_device: { error: { message: 'Failed to fetch' } } }, null);
    const paired = fakeClient({
      create_own_market: { data: { id: 'm-1', name: 'Market' } },
      create_pairing: { data: 'ABCD2345' },
    });
    await expect(
      openMarket({
        owner: paired.client,
        device: device.client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        marketName: 'Market',
        activationCode: 'RK-ABCD-EFGH-JKMN',
        platform: 'web',
      }),
    ).rejects.toThrow(/^Restoran açıldı ama bu cihaz bağlanamadı/);
  });
});

describe('joining a market from another device', () => {
  it('signs the owner in once and binds this device as the next register', async () => {
    const owner = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      create_pairing: { data: 'ZZZZ2345' },
    });
    const device = fakeClient({ claim_device: { data: { ...claimed, deviceCode: 'K2' } } }, null);
    const result = await joinMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      platform: 'android',
    });
    expect(device.calls[0]?.args).toMatchObject({ code: 'ZZZZ2345', device_code: '' });
    expect(result).toEqual({ claimed: { ...claimed, deviceCode: 'K2' } });
  });

  it('makes no code and no session when the plan is full, and lists the registers', async () => {
    const registers = [
      { id: 'd1', code: 'K1', name: 'Kasa K1', platform: 'web', lastSeenAt: null },
    ];
    const owner = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      owner_devices: { data: { maxDevices: 1, devices: registers } },
    });
    const device = fakeClient({}, null);
    const result = await joinMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      platform: 'web',
    });
    expect(result).toEqual({
      full: {
        market: { id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' },
        limit: 1,
        devices: registers,
      },
    });
    expect(owner.calls.map((call) => call.fn)).toEqual(['owner_markets', 'owner_devices']);
    expect(device.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('takes the place of the register the owner chose, at the plan’s limit', async () => {
    const owner = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      create_pairing: { data: 'ZZZZ2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    await joinMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketId: 'kursunlu-ab12cd',
      replaceCode: 'K1',
      platform: 'web',
    });
    expect(owner.calls.map((call) => call.fn)).toEqual(['owner_markets', 'create_pairing']);
    expect(device.calls[0]?.args).toMatchObject({
      code: 'ZZZZ2345',
      device_code: 'K1',
      replace: true,
    });
  });

  it('joins as before on a server that cannot list registers yet', async () => {
    const owner = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      owner_devices: {
        error: {
          message:
            'Could not find the function public.owner_devices(market_id) in the schema cache',
          code: 'PGRST202',
        },
      },
      create_pairing: { data: 'ZZZZ2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    expect(
      await joinMarket({
        owner: owner.client,
        device: device.client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        platform: 'web',
      }),
    ).toEqual({ claimed });
  });

  it('asks to confirm the email first', async () => {
    const owner = fakeClient({});
    owner.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Email not confirmed' },
    });
    await expect(
      joinMarket({
        owner: owner.client,
        device: fakeClient({}).client,
        email: 'emin@example.com',
        password: 'gizli-sifre',
        platform: 'web',
      }),
    ).rejects.toThrow('E-postanızı onaylayın, sonra tekrar deneyin.');
  });

  it('lists the markets when the owner has several', async () => {
    const markets = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const owner = fakeClient({ owner_markets: { data: markets } });
    const result = await joinMarket({
      owner: owner.client,
      device: fakeClient({}).client,
      email: 'e@example.com',
      password: 'p',
      platform: 'web',
    });
    expect(result).toEqual({ markets });
  });
});
