// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Market = { id: string; name: string };
type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };
type LogEntry = {
  id: number;
  at: string;
  action: string;
  marketId: string | null;
  marketName: string | null;
  operatorEmail: string | null;
  details: Record<string, unknown>;
};
type Overview = {
  restaurants: Record<
    'total' | 'active' | 'suspended' | 'expiring' | 'expired' | 'deleted',
    number
  >;
  codes: Record<'issued' | 'used' | 'unused' | 'revoked', number>;
  devices: { total: number; seenToday: number };
  expiring: { id: string; name: string; licenseExpiresAt: string; planName: string }[];
};
type Device = {
  id: string;
  code: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
type Detail = {
  id: string;
  name: string;
  status: string;
  deletedAt: string | null;
  plan: string;
  planName: string;
  planMaxDevices: number | null;
  maxDevicesOverride: number | null;
  maxDevices: number | null;
  licenseExpiresAt: string | null;
  createdAt: string;
  ownerEmail: string | null;
  storage: { bytes: number; limitBytes: number };
  rowCounts: { table: string; count: number }[];
  lastSyncAt: string | null;
  qrMenu: { enabled: boolean; slug: string } | null;
  note: string | null;
  devices: Device[];
  activity: { sales: number; tabs: number; activeDevices: number };
};
type Announcement = {
  id: string;
  marketId: string | null;
  marketName: string | null;
  message: string;
  createdAt: string;
  expiresAt: string | null;
  removedAt: string | null;
  live: boolean;
};

const DAY_MS = 86_400_000;
const CODE = /^RK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

let server: TestServer;
let operator: string;
let stranger: string;

beforeEach(async () => {
  server = await createTestServer();
  operator = await server.addUser({ email: 'satici@example.com' });
  await server.addOperator(operator);
  stranger = await server.addUser({ email: 'yabanci@example.com' });
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const op = <T = unknown>(name: string, args: unknown[] = []) =>
  server.as(operator).rpc<T>(name, args);

async function openOn(plan = 'restoran', name = 'Kebapçı Halil') {
  const owner = await server.addUser({ email: `${crypto.randomUUID()}@example.com` });
  const code = await server.addActivationCode({ plan, days: 30 });
  const market = await server.as(owner).rpc<Market>('create_own_market', [name, code]);
  return { owner, market };
}

async function claim(pairing: string, deviceCode: string | null = null) {
  const device = await server.addUser({ anonymous: true });
  const claimed = await server
    .as(device)
    .rpc<Claimed>('claim_device', [pairing, deviceCode, 'Kasa', 'web']);
  return { device, claimed };
}

async function join(owner: string, marketId: string) {
  return claim(await server.as(owner).rpc<string>('create_pairing', [marketId]));
}

async function log(): Promise<LogEntry[]> {
  return op<LogEntry[]>('operator_history', [200, null, null]);
}

async function market(id: string) {
  const [row] = await server.query<{
    name: string;
    status: string;
    deleted_at: string | null;
    license_expires_at: string | null;
    max_devices_override: number | null;
  }>(
    'select name, status, deleted_at, license_expires_at, max_devices_override from app.markets where id = $1',
    [id],
  );
  return row;
}

describe('the operator console is the operator’s alone', () => {
  const calls: [string, unknown[]][] = [
    ['operator_overview', []],
    ['operator_market', ['m']],
    ['operator_activity', [50]],
    ['operator_history', [50, null, null]],
    ['operator_list_codes', [50, null, null]],
    ['operator_issue_codes', ['restoran', 30, null, 2]],
    ['operator_set_market_status', ['m', 'suspended']],
    ['operator_set_license', ['m', null]],
    ['operator_set_max_devices', ['m', 3]],
    ['operator_rename_market', ['m', 'Yeni']],
    ['operator_set_qr_menu', ['m', true]],
    ['operator_rotate_qr_menu', ['m']],
    ['operator_create_pairing', ['m']],
    ['operator_set_note', ['m', 'not']],
    ['operator_delete_market', ['m', 'm']],
    ['operator_revoke_device', [crypto.randomUUID()]],
    ['operator_rename_device', [crypto.randomUUID(), 'Kasa']],
    ['operator_set_announcement', [null, 'Merhaba', null]],
    ['operator_remove_announcement', [crypto.randomUUID()]],
    ['operator_list_announcements', [50]],
  ];

  it('refuses everyone else, a register’s anonymous session and the anon role alike', async () => {
    await server.addMarket('m', 'Market');
    const anonymous = await server.addUser({ anonymous: true });
    for (const [name, args] of calls) {
      expect(await errorOf(server.as(stranger).rpc(name, args)), name).toContain('not_operator');
      expect(await errorOf(server.as(anonymous).rpc(name, args)), name).toContain('not_operator');
      expect(await errorOf(server.as(null).rpc(name, args)), name).toContain('permission denied');
    }
    const [{ count } = { count: -1 }] = await server.query<{ count: number }>(
      'select count(*)::int as count from app.operator_log',
    );
    expect(count).toBe(0);
  });

  it('keeps its new tables away from every client role', async () => {
    for (const table of ['app.operator_log', 'app.announcements', 'app.market_notes']) {
      expect(await errorOf(server.as(stranger).query(`select * from ${table}`)), table).toContain(
        'permission denied',
      );
    }
  });
});

describe('the overview', () => {
  it('counts restaurants by state, codes and registers, and lists the licences ending soon', async () => {
    const running = await openOn('restoran', 'Running');
    await join(running.owner, running.market.id);
    await join(running.owner, running.market.id);
    const soon = await openOn('qr', 'Soon');
    await server.query(
      "update app.markets set license_expires_at = now() + interval '3 days' where id = $1",
      [soon.market.id],
    );
    const ended = await openOn('restoran', 'Ended');
    await server.query(
      "update app.markets set license_expires_at = now() - interval '2 days' where id = $1",
      [ended.market.id],
    );
    const long = await openOn('restoran', 'Long gone');
    await server.query(
      "update app.markets set license_expires_at = now() - interval '40 days' where id = $1",
      [long.market.id],
    );
    await server.addMarket('grenn-bar', 'Grenn Bar');
    await server.addMarket('paused', 'Paused');
    await server.query("update app.markets set status = 'suspended' where id = 'paused'");
    await server.addMarket('gone', 'Gone');
    await server.query(
      "update app.markets set status = 'suspended', deleted_at = now() where id = 'gone'",
    );
    await server.addActivationCode();
    const revoked = await server.addActivationCode();
    await server.query('update app.activation_codes set revoked_at = now() where code = $1', [
      revoked,
    ]);

    const overview = await op<Overview>('operator_overview');
    expect(overview.restaurants).toEqual({
      total: 6,
      active: 3,
      suspended: 1,
      expiring: 1,
      expired: 2,
      deleted: 1,
    });
    expect(overview.codes).toEqual({ issued: 6, used: 4, unused: 1, revoked: 1 });
    expect(overview.devices).toEqual({ total: 2, seenToday: 2 });
    expect(overview.expiring.map((row) => row.name)).toEqual(['Ended', 'Soon']);
    expect(overview.expiring[1]).toMatchObject({ id: soon.market.id, planName: 'QR Menü' });
  });
});

describe('a restaurant’s detail', () => {
  it('shows what the seller needs, and only counts of what was synced', async () => {
    const { owner, market: opened } = await openOn('restoran');
    const first = await join(owner, opened.id);
    const second = await join(owner, opened.id);
    await server.as(owner).rpc('revoke_device', [first.claimed.deviceId]);
    await server.as(second.device).rpc('sync_push', [
      [
        { opId: 'a', seq: 1, table: 'sales', recordId: 's1', kind: 'insert', record: { total: 5 } },
        { opId: 'b', seq: 2, table: 'sales', recordId: 's2', kind: 'insert', record: { total: 7 } },
        { opId: 'c', seq: 3, table: 'tabs', recordId: 't1', kind: 'insert', record: { n: 1 } },
        { opId: 'd', seq: 4, table: 'products', recordId: 'p1', kind: 'insert', record: {} },
      ],
    ]);
    await server.query(
      "update app.rows set received_at = now() - interval '40 days' where id = 's1'",
    );
    await server.as(owner).rpc('set_qr_menu', [opened.id, true]);

    const detail = await op<Detail>('operator_market', [opened.id]);
    expect(detail).toMatchObject({
      id: opened.id,
      name: 'Kebapçı Halil',
      status: 'active',
      deletedAt: null,
      plan: 'restoran',
      planName: 'Restoran',
      planMaxDevices: 5,
      maxDevicesOverride: null,
      maxDevices: 5,
      note: null,
      qrMenu: { enabled: true },
      activity: { sales: 1, tabs: 1, activeDevices: 1 },
    });
    expect(detail.ownerEmail).toMatch(/@example\.com$/);
    expect(detail.storage.bytes).toBeGreaterThan(0);
    expect(detail.storage.limitBytes).toBe(200 * 1024 * 1024);
    expect(detail.rowCounts).toEqual([
      { table: 'products', count: 1 },
      { table: 'sales', count: 2 },
      { table: 'tabs', count: 1 },
    ]);
    expect(detail.lastSyncAt).not.toBeNull();
    // The live register first, the revoked one after it.
    expect(detail.devices.map((device) => [device.code, device.revokedAt === null])).toEqual([
      ['K2', true],
      ['K1', false],
    ]);
    expect(Object.keys(detail.devices[0] ?? {}).sort()).toEqual(
      ['code', 'createdAt', 'id', 'lastSeenAt', 'name', 'platform', 'revokedAt'].sort(),
    );
    // Counts only: no sale, tab or product leaves the server through the console.
    expect(JSON.stringify(detail)).not.toContain('"total"');
    expect(await errorOf(op('operator_market', ['nope']))).toContain('market_not_found');
  });

  it('lists the last 30 days of use per restaurant, as counts', async () => {
    const { owner, market: opened } = await openOn('restoran');
    const { device } = await join(owner, opened.id);
    await server.as(device).rpc('sync_push', [
      [
        {
          opId: 'a',
          seq: 1,
          table: 'sales',
          recordId: 's1',
          kind: 'insert',
          record: { total: 5 },
        },
      ],
    ]);
    await server.addMarket('quiet', 'Quiet');
    const activity = await op<
      { id: string; name: string; sales: number; tabs: number; activeDevices: number }[]
    >('operator_activity', [50]);
    expect(activity.find((row) => row.id === opened.id)).toEqual({
      id: opened.id,
      name: 'Kebapçı Halil',
      sales: 1,
      tabs: 0,
      activeDevices: 1,
    });
    expect(activity.find((row) => row.id === 'quiet')).toMatchObject({ sales: 0 });
    expect(await op<unknown[]>('operator_activity', [1])).toHaveLength(1);
  });
});

describe('the operator’s actions on a restaurant', () => {
  it('suspends a restaurant, which stops its sync and menu, and activates it again', async () => {
    const { owner, market: opened } = await openOn();
    const { device } = await join(owner, opened.id);
    await op('operator_set_market_status', [opened.id, 'suspended']);
    expect(await errorOf(server.as(device).rpc('sync_pull', [0, 10]))).toContain('license_expired');
    await op('operator_set_market_status', [opened.id, 'active']);
    expect(await errorOf(server.as(device).rpc('sync_pull', [0, 10]))).toBe('no error');
    expect(await errorOf(op('operator_set_market_status', [opened.id, 'gone']))).toContain(
      'bad_status',
    );
    expect(await errorOf(op('operator_set_market_status', ['nope', 'active']))).toContain(
      'market_not_found',
    );
    expect((await log()).map((entry) => [entry.action, entry.details])).toEqual([
      ['market.status', { from: 'suspended', to: 'active', restored: false }],
      ['market.status', { from: 'active', to: 'suspended', restored: false }],
    ]);
  });

  it('sets the licence end directly: later, earlier, or without an end', async () => {
    await server.addMarket('m', 'Market');
    const end = new Date(Date.now() + 100 * DAY_MS).toISOString();
    await op('operator_set_license', ['m', end]);
    expect(new Date((await market('m'))?.license_expires_at ?? '').getTime()).toBe(Date.parse(end));
    const earlier = new Date(Date.now() - DAY_MS).toISOString();
    await op('operator_set_license', ['m', earlier]);
    expect(new Date((await market('m'))?.license_expires_at ?? '').getTime()).toBe(
      Date.parse(earlier),
    );
    await op('operator_set_license', ['m', null]);
    expect((await market('m'))?.license_expires_at).toBeNull();
    expect(
      await errorOf(
        op('operator_set_license', ['m', new Date(Date.now() + 4000 * DAY_MS).toISOString()]),
      ),
    ).toContain('bad_date');
    const entries = await log();
    expect(entries.map((entry) => entry.action)).toEqual([
      'license.set',
      'license.set',
      'license.set',
    ]);
    expect(entries[0]?.details).toMatchObject({ to: null });
    expect(entries[0]?.marketId).toBe('m');
    expect(entries[0]?.marketName).toBe('Market');
    expect(entries[0]?.operatorEmail).toBe('satici@example.com');
  });

  it('gives a restaurant its own register limit, which claim_device and the owner’s list honour', async () => {
    const { owner, market: opened } = await openOn('qr');
    await join(owner, opened.id);
    expect(await errorOf(join(owner, opened.id))).toContain('device_limit 1');

    await op('operator_set_max_devices', [opened.id, 2]);
    expect(
      (await server.as(owner).rpc<{ maxDevices: number }>('owner_devices', [opened.id])).maxDevices,
    ).toBe(2);
    await join(owner, opened.id);
    expect(await errorOf(join(owner, opened.id))).toContain('device_limit 2');
    const detail = await op<Detail>('operator_market', [opened.id]);
    expect(detail).toMatchObject({ planMaxDevices: 1, maxDevicesOverride: 2, maxDevices: 2 });

    await op('operator_set_max_devices', [opened.id, null]);
    expect((await market(opened.id))?.max_devices_override).toBeNull();
    expect(await errorOf(op('operator_set_max_devices', [opened.id, 0]))).toContain(
      'bad_max_devices',
    );
    expect(await errorOf(op('operator_set_max_devices', [opened.id, 1000]))).toContain(
      'bad_max_devices',
    );
  });

  it('tells a register the limit it is held to', async () => {
    const { owner, market: opened } = await openOn('restoran');
    const { device } = await join(owner, opened.id);
    await op('operator_set_max_devices', [opened.id, 8]);
    const pulled = await server
      .as(device)
      .rpc<{ license: { maxDevices: number } }>('sync_pull', [0, 10]);
    expect(pulled.license.maxDevices).toBe(8);
    const lists = await op<{ id: string; maxDevices: number }[]>('list_markets', [50]);
    expect(lists.find((row) => row.id === opened.id)?.maxDevices).toBe(8);
  });

  it('renames a restaurant', async () => {
    await server.addMarket('m', 'Market');
    await op('operator_rename_market', ['m', '  Meyhane Deniz  ']);
    expect((await market('m'))?.name).toBe('Meyhane Deniz');
    expect(await errorOf(op('operator_rename_market', ['m', '   ']))).toContain('bad_name');
    expect(await errorOf(op('operator_rename_market', ['m', 'x'.repeat(61)]))).toContain(
      'bad_name',
    );
    expect((await log())[0]?.details).toEqual({ from: 'Market', to: 'Meyhane Deniz' });
  });

  it('turns the QR menu on and off and gives it a new link, past a lapsed licence too', async () => {
    await server.addMarket('m', 'Market');
    const on = await op<{ enabled: boolean; slug: string }>('operator_set_qr_menu', ['m', true]);
    expect(on.enabled).toBe(true);
    expect(await server.as(null).rpc('public_menu', [on.slug])).not.toBeNull();
    const rotated = await op<{ enabled: boolean; slug: string }>('operator_rotate_qr_menu', ['m']);
    expect(rotated.slug).not.toBe(on.slug);
    expect(rotated.enabled).toBe(true);
    expect(await server.as(null).rpc('public_menu', [on.slug])).toBeNull();
    const off = await op<{ enabled: boolean }>('operator_set_qr_menu', ['m', false]);
    expect(off.enabled).toBe(false);
    expect(await errorOf(op('operator_set_qr_menu', ['nope', true]))).toContain('market_not_found');
    expect((await log()).map((entry) => entry.action)).toEqual(['qr.set', 'qr.rotate', 'qr.set']);
  });

  it('makes a pairing code a customer’s register claims, within the restaurant’s limit', async () => {
    const { market: opened } = await openOn('qr');
    const made = await op<{ code: string; expiresAt: string }>('operator_create_pairing', [
      opened.id,
    ]);
    expect(made.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(Date.parse(made.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    const { claimed } = await claim(made.code);
    expect(claimed).toMatchObject({ marketId: opened.id, deviceCode: 'K1' });
    const second = await op<{ code: string }>('operator_create_pairing', [opened.id]);
    expect(await errorOf(claim(second.code))).toContain('device_limit 1');

    await op('operator_set_market_status', [opened.id, 'suspended']);
    expect(await errorOf(op('operator_create_pairing', [opened.id]))).toContain('license_expired');
    const entry = (await log()).find((item) => item.action === 'pairing.create');
    // The code itself stays out of the log.
    expect(JSON.stringify(entry?.details)).not.toContain(made.code);
  });

  it('keeps a private note per restaurant, and clears it when emptied', async () => {
    await server.addMarket('m', 'Market');
    await op('operator_set_note', ['m', '  Ödeme her ayın 5’inde.  ']);
    expect((await op<Detail>('operator_market', ['m'])).note).toBe('Ödeme her ayın 5’inde.');
    await op('operator_set_note', ['m', '']);
    expect((await op<Detail>('operator_market', ['m'])).note).toBeNull();
    expect(await errorOf(op('operator_set_note', ['m', 'x'.repeat(2001)]))).toContain(
      'note_too_long',
    );
    expect((await log()).map((entry) => entry.action)).toEqual(['note.set', 'note.set']);
  });

  it('deletes softly: only with the name typed, suspended and marked, nothing removed', async () => {
    const { owner, market: opened } = await openOn();
    const { device } = await join(owner, opened.id);
    expect(await errorOf(op('operator_delete_market', [opened.id, 'Kebapçı']))).toContain(
      'name_mismatch',
    );
    expect((await market(opened.id))?.deleted_at).toBeNull();

    await op('operator_delete_market', [opened.id, ' kebapçı halil ']);
    const row = await market(opened.id);
    expect(row?.status).toBe('suspended');
    expect(row?.deleted_at).not.toBeNull();
    expect(await errorOf(server.as(device).rpc('sync_pull', [0, 10]))).toContain('license_expired');
    const [{ count } = { count: 0 }] = await server.query<{ count: number }>(
      'select count(*)::int as count from app.devices where market_id = $1',
      [opened.id],
    );
    expect(count).toBe(1);
    const overview = await op<Overview>('operator_overview');
    expect(overview.restaurants.deleted).toBe(1);

    // Activating it again brings it back.
    await op('operator_set_market_status', [opened.id, 'active']);
    expect((await market(opened.id))?.deleted_at).toBeNull();
    expect((await log()).map((entry) => [entry.action, entry.details.restored])).toEqual([
      ['market.status', true],
      ['market.delete', undefined],
    ]);
  });

  it('revokes and renames a register', async () => {
    const { owner, market: opened } = await openOn();
    const { device, claimed } = await join(owner, opened.id);
    await op('operator_rename_device', [claimed.deviceId, '  Bar tableti ']);
    expect((await op<Detail>('operator_market', [opened.id])).devices[0]?.name).toBe('Bar tableti');
    expect(await errorOf(op('operator_rename_device', [claimed.deviceId, '']))).toContain(
      'bad_name',
    );
    await op('operator_revoke_device', [claimed.deviceId]);
    expect(await errorOf(server.as(device).rpc('sync_pull', [0, 10]))).toContain('device_revoked');
    expect(await errorOf(op('operator_revoke_device', [crypto.randomUUID()]))).toContain(
      'device_not_found',
    );
    const entries = await log();
    expect(entries.map((entry) => entry.action)).toEqual(['device.revoke', 'device.rename']);
    expect(entries[0]).toMatchObject({ marketId: opened.id, details: { code: 'K1' } });
  });

  it('logs the older operator actions too', async () => {
    await server.addMarket('m', 'Market');
    await server.query(
      "update app.markets set license_expires_at = now() + interval '1 day' where id = 'm'",
    );
    const code = await op<string>('issue_activation_code', ['restoran', 30, 'Not']);
    await op('revoke_activation_code', [code]);
    await op('extend_license', ['m', 30]);
    await op('set_market_plan', ['m', 'pro']);
    expect((await log()).map((entry) => [entry.action, entry.marketId])).toEqual([
      ['market.plan', 'm'],
      ['license.extend', 'm'],
      ['code.revoke', null],
      ['code.issue', null],
    ]);
  });
});

describe('codes', () => {
  it('issues many at once, logged once', async () => {
    const codes = await op<string[]>('operator_issue_codes', ['qr', 14, ' Fuar ', 5]);
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    for (const code of codes) {
      expect(code).toMatch(CODE);
    }
    expect(await errorOf(op('operator_issue_codes', ['qr', 14, null, 0]))).toContain('bad_count');
    expect(await errorOf(op('operator_issue_codes', ['qr', 14, null, 51]))).toContain('bad_count');
    expect(await errorOf(op('operator_issue_codes', ['gold', 14, null, 2]))).toContain('bad_plan');
    const entries = await log();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toMatchObject({ plan: 'qr', days: 14, count: 5, note: 'Fuar' });
  });

  it('filters by what became of a code and searches the note', async () => {
    const [unused] = await op<string[]>('operator_issue_codes', ['restoran', 30, 'Adana fuarı', 1]);
    const [revoked] = await op<string[]>('operator_issue_codes', [
      'restoran',
      30,
      '50%_indirim',
      1,
    ]);
    await op('revoke_activation_code', [revoked]);
    const used = await server.addActivationCode();
    const owner = await server.addUser({ email: 'o@example.com' });
    await server.as(owner).rpc('create_own_market', ['Kebapçı', used]);

    const list = (status: string | null, search: string | null) =>
      op<{ code: string }[]>('operator_list_codes', [50, status, search]).then((rows) =>
        rows.map((row) => row.code),
      );
    expect(await list('unused', null)).toEqual([unused]);
    expect(await list('revoked', null)).toEqual([revoked]);
    expect(await list('used', null)).toEqual([used]);
    expect((await list(null, null)).length).toBe(3);
    expect(await list(null, 'adana')).toEqual([unused]);
    // % and _ are letters here, not patterns.
    expect(await list(null, '50%_')).toEqual([revoked]);
    expect(await list(null, '%')).toEqual([revoked]);
    expect(await errorOf(op('operator_list_codes', [50, 'lost', null]))).toContain('bad_status');
  });
});

describe('announcements', () => {
  it('reach the registers of the restaurant named, and of every restaurant, through sync_pull', async () => {
    const a = await openOn('restoran', 'A');
    const b = await openOn('restoran', 'B');
    const regA = await join(a.owner, a.market.id);
    const regB = await join(b.owner, b.market.id);

    const everyone = await op<{ id: string }>('operator_set_announcement', [
      null,
      '  Yarın 02:00’de bakım var.  ',
      null,
    ]);
    await op('operator_set_announcement', [a.market.id, 'Faturanız hazır.', 7]);

    type Pulled = {
      rows: unknown[];
      latest: number;
      license: unknown;
      announcements: { id: string; message: string }[];
    };
    const pulledA = await server.as(regA.device).rpc<Pulled>('sync_pull', [0, 10]);
    expect(pulledA.announcements.map((item) => item.message)).toEqual([
      'Faturanız hazır.',
      'Yarın 02:00’de bakım var.',
    ]);
    // The answer an older register reads keeps every key it had.
    expect(Object.keys(pulledA).sort()).toEqual(['announcements', 'latest', 'license', 'rows']);
    const pulledB = await server.as(regB.device).rpc<Pulled>('sync_pull', [0, 10]);
    expect(pulledB.announcements.map((item) => item.message)).toEqual([
      'Yarın 02:00’de bakım var.',
    ]);

    await op('operator_remove_announcement', [everyone.id]);
    expect((await server.as(regB.device).rpc<Pulled>('sync_pull', [0, 10])).announcements).toEqual(
      [],
    );

    const listed = await op<Announcement[]>('operator_list_announcements', [50]);
    expect(listed.map((item) => [item.marketName, item.live])).toEqual([
      ['A', true],
      [null, false],
    ]);
    expect(Date.parse(listed[0]?.expiresAt ?? '') - Date.now()).toBeGreaterThan(6.9 * DAY_MS);
    expect((await log()).map((entry) => entry.action)).toEqual([
      'announcement.remove',
      'announcement.create',
      'announcement.create',
    ]);
  });

  it('stops an announcement once its days are over, and refuses a bad one', async () => {
    const a = await openOn();
    const reg = await join(a.owner, a.market.id);
    const made = await op<{ id: string }>('operator_set_announcement', [a.market.id, 'Kısa', 1]);
    await server.query(
      "update app.announcements set expires_at = now() - interval '1 minute' where id = $1",
      [made.id],
    );
    expect(
      (await server.as(reg.device).rpc<{ announcements: unknown[] }>('sync_pull', [0, 10]))
        .announcements,
    ).toEqual([]);
    expect(await errorOf(op('operator_set_announcement', [null, '  ', null]))).toContain(
      'bad_message',
    );
    expect(await errorOf(op('operator_set_announcement', [null, 'x'.repeat(281), null]))).toContain(
      'bad_message',
    );
    expect(await errorOf(op('operator_set_announcement', [null, 'ok', 0]))).toContain('bad_days');
    expect(await errorOf(op('operator_set_announcement', ['nope', 'ok', null]))).toContain(
      'market_not_found',
    );
    expect(await errorOf(op('operator_remove_announcement', [crypto.randomUUID()]))).toContain(
      'announcement_not_found',
    );
  });
});

describe('the history', () => {
  it('pages newest first, and narrows to one restaurant', async () => {
    await server.addMarket('m', 'Market');
    await server.addMarket('n', 'Other');
    await op('operator_rename_market', ['m', 'M1']);
    await op('operator_rename_market', ['n', 'N1']);
    await op('operator_rename_market', ['m', 'M2']);

    const first = await op<LogEntry[]>('operator_history', [2, null, null]);
    expect(first.map((entry) => entry.details.to)).toEqual(['M2', 'N1']);
    const next = await op<LogEntry[]>('operator_history', [2, first[1]?.id, null]);
    expect(next.map((entry) => entry.details.to)).toEqual(['M1']);
    const onlyM = await op<LogEntry[]>('operator_history', [50, null, 'm']);
    expect(onlyM.map((entry) => entry.details.to)).toEqual(['M2', 'M1']);
  });
});
