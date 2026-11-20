// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Market = { id: string; name: string };
type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };
type CodeRow = {
  code: string;
  plan: string;
  planName: string;
  days: number;
  note: string | null;
  status: 'unused' | 'used' | 'revoked';
  marketId: string | null;
  marketName: string | null;
};
type MarketRow = {
  id: string;
  name: string;
  plan: string;
  planName: string;
  maxDevices: number | null;
  licenseExpiresAt: string | null;
  devices: number;
  lastSeenAt: string | null;
  ownerEmail: string | null;
};
type License = {
  plan: string;
  planName: string;
  maxDevices: number | null;
  licenseExpiresAt: string | null;
};

const CODE = /^RK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const DAY_MS = 86_400_000;

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/** Days from the database's now to the market's licence end. */
async function daysLeft(marketId: string): Promise<number> {
  const [row] = await server.query<{ days: number }>(
    `select extract(epoch from license_expires_at - now()) / 86400 as days
     from app.markets where id = $1`,
    [marketId],
  );
  return Number(row?.days);
}

async function openWith(code: string, name = 'Kebapçı Halil') {
  const owner = await server.addUser({ email: `${crypto.randomUUID()}@example.com` });
  const market = await server.as(owner).rpc<Market>('create_own_market', [name, code]);
  return { owner, market };
}

/** A register joining the market the way the app does: the owner's pairing code, then a claim. */
async function join(owner: string, marketId: string, deviceCode: string | null = null) {
  const code = await server.as(owner).rpc<string>('create_pairing', [marketId]);
  const device = await server.addUser({ anonymous: true });
  return server.as(device).rpc<Claimed>('claim_device', [code, deviceCode, 'Kasa', 'web']);
}

describe('opening a restaurant takes an activation code', () => {
  it('opens the market on the code’s plan, with the licence running for its days', async () => {
    const code = await server.addActivationCode({ plan: 'pro', days: 14 });
    const { market } = await openWith(code);

    const [row] = await server.query<{ plan_id: string }>(
      'select plan_id from app.markets where id = $1',
      [market.id],
    );
    expect(row?.plan_id).toBe('pro');
    expect(await daysLeft(market.id)).toBeCloseTo(14, 2);
    const [used] = await server.query<{ used_by_market: string; used_at: string | null }>(
      'select used_by_market, used_at from app.activation_codes where code = $1',
      [code],
    );
    expect(used?.used_by_market).toBe(market.id);
    expect(used?.used_at).not.toBeNull();
  });

  it('takes the code however it was typed or pasted', async () => {
    const code = await server.addActivationCode();
    const typed = ` ${code.toLowerCase().replaceAll('-', ' ')} `;
    expect((await openWith(typed)).market.name).toBe('Kebapçı Halil');

    const bare = await server.addActivationCode();
    expect((await openWith(bare.slice(3).replaceAll('-', ''))).market.name).toBe('Kebapçı Halil');
  });

  it('refuses a missing, unknown, used or revoked code with one and the same error', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    const open = (code: string | null) =>
      errorOf(server.as(owner).rpc('create_own_market', ['Market', code]));

    const used = await server.addActivationCode();
    await openWith(used);
    const revoked = await server.addActivationCode();
    await server.query('update app.activation_codes set revoked_at = now() where code = $1', [
      revoked,
    ]);

    const errors = [
      await open(null),
      await open(''),
      await open('RK-AAAA-BBBB-CCCC'),
      await open(used),
      await open(revoked),
    ];
    expect(new Set(errors)).toEqual(new Set(['activation_invalid']));
  });

  it('uses a code once when two shops send it at the same time', async () => {
    const code = await server.addActivationCode();
    const first = await server.addUser({ email: 'first@example.com' });
    const second = await server.addUser({ email: 'second@example.com' });

    const results = await Promise.allSettled([
      server.as(first).rpc('create_own_market', ['Bir', code]),
      server.as(second).rpc('create_own_market', ['İki', code]),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(String((refused as PromiseRejectedResult).reason)).toContain('activation_invalid');
    const [{ count } = { count: 0 }] = await server.query<{ count: number }>(
      'select count(*)::int as count from app.markets',
    );
    expect(count).toBe(1);
  });

  it('keeps the code when the market cannot be opened', async () => {
    const code = await server.addActivationCode();
    const owner = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['  ', code]))).toContain(
      'bad_name',
    );
    const [row] = await server.query<{ used_at: string | null }>(
      'select used_at from app.activation_codes where code = $1',
      [code],
    );
    expect(row?.used_at).toBeNull();
    expect((await openWith(code)).market.name).toBe('Kebapçı Halil');
  });

  it('tells a register built before codes that it must be updated', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['Market']))).toContain(
      'activation_required',
    );
  });

  it('leaves a market opened before codes as it was: no licence end, the Restoran plan', async () => {
    await server.addMarket('grenn-bar', 'Grenn Bar');
    const [row] = await server.query<{ plan_id: string; license_expires_at: string | null }>(
      "select plan_id, license_expires_at from app.markets where id = 'grenn-bar'",
    );
    expect(row).toEqual({ plan_id: 'restoran', license_expires_at: null });
  });

  it('gives no client role the activation tables', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    for (const table of ['app.activation_codes', 'app.operators', 'app.plans']) {
      expect(await errorOf(server.as(owner).query(`select * from ${table}`)), table).toContain(
        'permission denied',
      );
      expect(await errorOf(server.as(null).query(`select * from ${table}`)), table).toContain(
        'permission denied',
      );
    }
  });
});

describe('the plan’s device limit', () => {
  it('refuses a register past the limit and says how many the plan allows', async () => {
    const { owner, market } = await openWith(await server.addActivationCode({ plan: 'qr' }));
    expect((await join(owner, market.id)).deviceCode).toBe('K1');

    expect(await errorOf(join(owner, market.id))).toMatch(/device_limit 1\b/);
    const [{ count } = { count: 0 }] = await server.query<{ count: number }>(
      'select count(*)::int as count from app.devices where market_id = $1',
      [market.id],
    );
    expect(count).toBe(1);
  });

  it('lets a register take over a code at the limit, and counts no revoked one', async () => {
    const { owner, market } = await openWith(await server.addActivationCode({ plan: 'qr' }));
    const first = await join(owner, market.id);

    const code = await server.as(owner).rpc<string>('create_pairing', [market.id]);
    const fresh = await server.addUser({ anonymous: true });
    const taken = await server
      .as(fresh)
      .rpc<Claimed>('claim_device', [code, 'K1', 'Kasa', 'web', true]);
    expect(taken.deviceCode).toBe('K1');

    // A code no register holds is a new register, replace or not.
    const other = await server.addUser({ anonymous: true });
    const another = await server.as(owner).rpc<string>('create_pairing', [market.id]);
    expect(
      await errorOf(server.as(other).rpc('claim_device', [another, 'K2', 'Kasa', 'web', true])),
    ).toContain('device_limit');

    await server.as(owner).rpc('revoke_device', [taken.deviceId]);
    expect((await join(owner, market.id)).deviceCode).toBe('K1');
    expect(first.deviceId).not.toBe(taken.deviceId);
  });

  it('allows five registers on Restoran and any number on Restoran Pro', async () => {
    const restoran = await openWith(await server.addActivationCode({ plan: 'restoran' }));
    for (let n = 1; n <= 5; n++) {
      await join(restoran.owner, restoran.market.id);
    }
    expect(await errorOf(join(restoran.owner, restoran.market.id))).toMatch(/device_limit 5\b/);

    const pro = await openWith(await server.addActivationCode({ plan: 'pro' }));
    for (let n = 1; n <= 7; n++) {
      await join(pro.owner, pro.market.id);
    }
  });

  it('frees a pairing code that the limit refused', async () => {
    const { owner, market } = await openWith(await server.addActivationCode({ plan: 'qr' }));
    await join(owner, market.id);
    const code = await server.as(owner).rpc<string>('create_pairing', [market.id]);
    const device = await server.addUser({ anonymous: true });
    expect(
      await errorOf(server.as(device).rpc('claim_device', [code, null, 'Kasa', 'web'])),
    ).toContain('device_limit');
    await server.query("update app.markets set plan_id = 'pro' where id = $1", [market.id]);
    expect(
      (await server.as(device).rpc<Claimed>('claim_device', [code, null, 'Kasa', 'web']))
        .deviceCode,
    ).toBe('K2');
  });
});

describe('the licence on sync', () => {
  async function registerOf(expires: string | null) {
    await server.addMarket('m', 'Market');
    await server.query(
      `update app.markets set license_expires_at = ${expires ?? 'null'} where id = 'm'`,
    );
    return (await server.addDevice('m', 'K1')).userId;
  }
  const sync = async (userId: string) => [
    await errorOf(server.as(userId).rpc('sync_push', [[]])),
    await errorOf(server.as(userId).rpc('sync_pull', [0, 10])),
  ];

  it('keeps syncing up to seven days after the licence ends', async () => {
    const device = await registerOf("now() - interval '6 days 23 hours'");
    expect(await sync(device)).toEqual(['no error', 'no error']);
  });

  it('refuses push and pull once the seven days of grace are over', async () => {
    const device = await registerOf("now() - interval '7 days 1 minute'");
    expect(await sync(device)).toEqual(['license_expired', 'license_expired']);
  });

  it('never refuses a market without a licence end', async () => {
    const device = await registerOf(null);
    expect(await sync(device)).toEqual(['no error', 'no error']);
  });

  it('tells the register its plan and licence end with every pull and in my_device', async () => {
    const device = await registerOf("'2026-12-20T09:00:00Z'");
    const pulled = await server.as(device).rpc<{ license: License }>('sync_pull', [0, 10]);
    const expected = {
      plan: 'restoran',
      planName: 'Restoran',
      maxDevices: 5,
    };
    expect(pulled.license).toMatchObject(expected);
    expect(Date.parse(pulled.license.licenseExpiresAt ?? '')).toBe(
      Date.parse('2026-12-20T09:00:00Z'),
    );
    const mine = await server.as(device).rpc<License>('my_device');
    expect(mine).toMatchObject(expected);
    expect(Date.parse(mine.licenseExpiresAt ?? '')).toBe(Date.parse('2026-12-20T09:00:00Z'));

    const unlimited = await registerOfUnlimited();
    expect(
      (await server.as(unlimited).rpc<{ license: License }>('sync_pull', [0, 10])).license,
    ).toEqual({ ...expected, licenseExpiresAt: null });
  });

  async function registerOfUnlimited() {
    await server.addMarket('grenn', 'Grenn Bar');
    return (await server.addDevice('grenn', 'K1')).userId;
  }
});

describe('the operator', () => {
  let operator: string;
  let stranger: string;

  beforeEach(async () => {
    operator = await server.addUser({ email: 'satici@example.com' });
    await server.addOperator(operator);
    stranger = await server.addUser({ email: 'yabanci@example.com' });
  });

  const calls: [string, unknown[]][] = [
    ['issue_activation_code', ['restoran', 30, null]],
    ['list_activation_codes', [50]],
    ['revoke_activation_code', ['RK-AAAA-BBBB-CCCC']],
    ['list_markets', [50]],
    ['extend_license', ['m', 30]],
    ['set_market_plan', ['m', 'pro']],
  ];

  it('is the only one who may call the operator functions', async () => {
    const anonymous = await server.addUser({ anonymous: true });
    for (const [name, args] of calls) {
      expect(await errorOf(server.as(stranger).rpc(name, args)), name).toContain('not_operator');
      expect(await errorOf(server.as(anonymous).rpc(name, args)), name).toContain('not_operator');
      expect(await errorOf(server.as(null).rpc(name, args)), name).toContain('permission denied');
    }
    expect(await server.as(operator).rpc('operator_whoami')).toBe(true);
    expect(await server.as(stranger).rpc('operator_whoami')).toBe(false);
    expect(await errorOf(server.as(null).rpc('operator_whoami'))).toContain('permission denied');
  });

  it('issues codes that open a restaurant, and lists them with what became of each', async () => {
    const issued = await server
      .as(operator)
      .rpc<string>('issue_activation_code', ['qr', 365, '  Kebapçı Halil, Adana  ']);
    expect(issued).toMatch(CODE);
    const revoked = await server
      .as(operator)
      .rpc<string>('issue_activation_code', ['restoran', 14, null]);
    await server.as(operator).rpc('revoke_activation_code', [revoked.toLowerCase()]);
    const unused = await server.as(operator).rpc<string>('issue_activation_code', ['pro', 30, '']);
    const { market } = await openWith(issued);

    const codes = await server.as(operator).rpc<CodeRow[]>('list_activation_codes', [50]);
    expect(codes.map((row) => [row.code, row.status, row.marketName])).toEqual([
      [unused, 'unused', null],
      [revoked, 'revoked', null],
      [issued, 'used', 'Kebapçı Halil'],
    ]);
    expect(codes[2]).toMatchObject({
      plan: 'qr',
      planName: 'QR Menü',
      days: 365,
      note: 'Kebapçı Halil, Adana',
      marketId: market.id,
    });
    expect(codes[0]?.note).toBeNull();
    expect(await server.as(operator).rpc<CodeRow[]>('list_activation_codes', [1])).toHaveLength(1);
    expect(await errorOf(openWith(revoked))).toContain('activation_invalid');
  });

  it('refuses a bad plan, a bad number of days and revoking a code already used', async () => {
    const issue = (plan: string, days: number) =>
      errorOf(server.as(operator).rpc('issue_activation_code', [plan, days, null]));
    expect(await issue('gold', 30)).toContain('bad_plan');
    expect(await issue('restoran', 0)).toContain('bad_days');
    expect(await issue('restoran', 4000)).toContain('bad_days');

    const code = await server.addActivationCode();
    await openWith(code);
    expect(await errorOf(server.as(operator).rpc('revoke_activation_code', [code]))).toContain(
      'code_used',
    );
    expect(
      await errorOf(server.as(operator).rpc('revoke_activation_code', ['RK-AAAA-BBBB-CCCC'])),
    ).toContain('code_not_found');
  });

  it('lists the restaurants with their plan, licence, registers and owner', async () => {
    const { owner, market } = await openWith(
      await server.addActivationCode({ plan: 'restoran', days: 30 }),
      'Kebapçı Halil',
    );
    const first = await join(owner, market.id);
    await join(owner, market.id);
    await server.as(owner).rpc('revoke_device', [first.deviceId]);
    await server.addMarket('grenn-bar', 'Grenn Bar');

    const markets = await server.as(operator).rpc<MarketRow[]>('list_markets', [50]);
    const halil = markets.find((row) => row.id === market.id);
    expect(halil).toMatchObject({
      name: 'Kebapçı Halil',
      plan: 'restoran',
      planName: 'Restoran',
      maxDevices: 5,
      devices: 1,
    });
    expect(halil?.ownerEmail).toMatch(/@example\.com$/);
    expect(halil?.lastSeenAt).not.toBeNull();
    expect(Date.parse(halil?.licenseExpiresAt ?? '') - Date.now()).toBeGreaterThan(29 * DAY_MS);
    expect(markets.find((row) => row.id === 'grenn-bar')).toMatchObject({
      licenseExpiresAt: null,
      devices: 0,
      lastSeenAt: null,
      ownerEmail: null,
    });
    expect(await server.as(operator).rpc<MarketRow[]>('list_markets', [1])).toHaveLength(1);
  });

  it('extends a licence from its end, or from today once it has ended', async () => {
    await server.addMarket('ahead', 'Ahead');
    await server.addMarket('ended', 'Ended');
    await server.query(
      "update app.markets set license_expires_at = now() + interval '10 days' where id = 'ahead'",
    );
    await server.query(
      "update app.markets set license_expires_at = now() - interval '20 days' where id = 'ended'",
    );

    await server.as(operator).rpc('extend_license', ['ahead', 30]);
    await server.as(operator).rpc('extend_license', ['ended', 30]);

    expect(await daysLeft('ahead')).toBeCloseTo(40, 2);
    expect(await daysLeft('ended')).toBeCloseTo(30, 2);
  });

  it('never puts an end on a licence that has none', async () => {
    await server.addMarket('grenn-bar', 'Grenn Bar');
    expect(await errorOf(server.as(operator).rpc('extend_license', ['grenn-bar', 30]))).toContain(
      'license_unlimited',
    );
    const [row] = await server.query<{ license_expires_at: string | null }>(
      "select license_expires_at from app.markets where id = 'grenn-bar'",
    );
    expect(row?.license_expires_at).toBeNull();
    expect(await errorOf(server.as(operator).rpc('extend_license', ['nope', 30]))).toContain(
      'market_not_found',
    );
    expect(await errorOf(server.as(operator).rpc('extend_license', ['grenn-bar', 0]))).toContain(
      'bad_days',
    );
  });

  it('changes a restaurant’s plan', async () => {
    await server.addMarket('m', 'Market');
    await server.as(operator).rpc('set_market_plan', ['m', 'pro']);
    const [row] = await server.query<{ plan_id: string }>(
      "select plan_id from app.markets where id = 'm'",
    );
    expect(row?.plan_id).toBe('pro');
    expect(await errorOf(server.as(operator).rpc('set_market_plan', ['m', 'gold']))).toContain(
      'bad_plan',
    );
    expect(await errorOf(server.as(operator).rpc('set_market_plan', ['nope', 'qr']))).toContain(
      'market_not_found',
    );
  });
});
