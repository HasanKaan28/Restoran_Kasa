// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

// The follow-up review of 2026-11-20 (supabase/migrations/20261123120000_trust_and_licence.sql):
// what a register may write, who wrote it, and the licence on the owner's functions.

type PushResult = { acknowledged: number[]; rejected?: { seq: number; reason: string }[] };
type MenuState = { enabled: boolean; slug: string | null };

let server: TestServer;
let seq = 0;

beforeEach(async () => {
  server = await createTestServer();
  await server.addMarket('a', 'Kebapçı Halil');
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const at = '2026-11-20T09:00:00.000Z';

const insert = (
  table: string,
  recordId: string,
  record: object,
  opId: string = crypto.randomUUID(),
) => ({
  kind: 'insert',
  table,
  recordId,
  record,
  seq: ++seq,
  opId,
  createdAt: at,
});

const patch = (table: string, recordId: string, fields: object) => ({
  kind: 'patch',
  table,
  recordId,
  patch: fields,
  seq: ++seq,
  opId: crypto.randomUUID(),
  createdAt: at,
});

type Stored = { id: string; row: Record<string, unknown>; pushed_by: string | null };

async function stored(table: string): Promise<Stored[]> {
  return server.query<Stored>(
    "select id, row, pushed_by from app.rows where market_id = 'a' and tbl = $1 order by id",
    [table],
  );
}

describe('a record is kept under its own id', () => {
  it('refuses an insert whose record names another id, and keeps one without an id whole', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const session = server.as(userId);
    await session.rpc('sync_push', [[insert('customers', 'c1', { id: 'c1', name: 'Emin' })]]);

    // Under a decoy id, a record naming c1 would overwrite c1 on every register that pulls it.
    const decoy = insert('customers', 'decoy', { id: 'c1', name: 'Sahte' });
    const event = insert('sales', 's-decoy', { id: 's1', total: 1 });
    const numeric = insert('sales', 's2', { id: 2, total: 1 });
    const bare = insert('sales', 's3', { total: 1 });

    const result = await session.rpc<PushResult>('sync_push', [[decoy, event, numeric, bare]]);

    expect(result.acknowledged).toEqual([bare.seq]);
    expect(result.rejected).toEqual([
      { seq: decoy.seq, reason: 'bad_record' },
      { seq: event.seq, reason: 'bad_record' },
      { seq: numeric.seq, reason: 'bad_record' },
    ]);
    expect((await stored('customers')).map(({ id, row }) => [id, row.name])).toEqual([
      ['c1', 'Emin'],
    ]);
    // A record sent without its id is stored with it, so every row the server gives carries it.
    expect((await stored('sales')).map(({ id, row }) => [id, row.id])).toEqual([['s3', 's3']]);
  });

  it('refuses a patch that clears or changes the id', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const session = server.as(userId);
    await session.rpc('sync_push', [[insert('staff', 'st1', { id: 'st1', name: 'Ayşe' })]]);
    const clear = patch('staff', 'st1', { id: null });
    const change = patch('staff', 'st1', { id: 'st2', name: 'Başka' });
    const same = patch('staff', 'st1', { id: 'st1', name: 'Ayşe Y.' });

    const result = await session.rpc<PushResult>('sync_push', [[clear, change, same]]);

    expect(result.acknowledged).toEqual([same.seq]);
    expect(result.rejected).toEqual([
      { seq: clear.seq, reason: 'bad_record' },
      { seq: change.seq, reason: 'bad_record' },
    ]);
    expect((await stored('staff')).map(({ id, row }) => [id, row.id, row.name])).toEqual([
      ['st1', 'st1', 'Ayşe Y.'],
    ]);
  });
});

describe('what a register may write', () => {
  it('reaches only the synced tables, never what the server keeps for itself', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const ops = [
      'devices',
      'markets',
      'memberships',
      'qr_menus',
      'stockLevels',
      'meta',
      'outbox',
    ].map((table) => insert(table, 'x1', { id: 'x1' }));

    const result = await server.as(userId).rpc<PushResult>('sync_push', [ops]);

    expect(result.acknowledged).toEqual([]);
    expect(result.rejected?.map((rejection) => rejection.reason)).toEqual(
      ops.map(() => 'unknown_table'),
    );
    expect(await server.query("select 1 from app.rows where market_id = 'a'")).toEqual([]);
  });

  it('keeps events as first written, whoever sends them again', async () => {
    const k1 = await server.addDevice('a', 'K1');
    const k2 = await server.addDevice('a', 'K2');
    const entry = { id: 'au1', deviceCode: 'K1', action: 'staff.pin', entity: 'staff' };
    await server.as(k1.userId).rpc('sync_push', [[insert('auditLog', 'au1', entry)]]);

    const forged = insert('auditLog', 'au1', { ...entry, deviceCode: 'K2', action: 'x' });
    const edit = patch('auditLog', 'au1', { action: 'x' });
    const result = await server.as(k2.userId).rpc<PushResult>('sync_push', [[forged, edit]]);

    expect(result.rejected).toEqual([{ seq: edit.seq, reason: 'not_patchable' }]);
    const [row] = await stored('auditLog');
    expect(row?.row).toEqual(entry);
    expect(row?.pushed_by).toBe(k1.deviceId);
  });

  it('records which register sent each row, whatever the row says of itself', async () => {
    const k1 = await server.addDevice('a', 'K1');
    const k2 = await server.addDevice('a', 'K2');
    await server
      .as(k2.userId)
      .rpc('sync_push', [
        [
          insert('sales', 's1', { id: 's1', deviceCode: 'K1', total: 1 }),
          insert('products', 'p1', { id: 'p1', name: 'Ayran' }),
        ],
      ]);
    await server.as(k1.userId).rpc('sync_push', [[patch('products', 'p1', { name: 'Ayran 2' })]]);

    // The sale claims K1, but K2 sent it; the product was last written by K1.
    expect((await stored('sales')).map((row) => row.pushed_by)).toEqual([k2.deviceId]);
    expect((await stored('products')).map((row) => row.pushed_by)).toEqual([k1.deviceId]);

    // Nothing of it reaches the registers: they pull the rows as they were sent.
    const pulled = await server
      .as(k1.userId)
      .rpc<{ rows: { row: Record<string, unknown> }[] }>('sync_pull', [0, 10]);
    expect(pulled.rows.every(({ row }) => !('pushed_by' in row))).toBe(true);
  });

  it('refuses an empty operation id, which every op could share', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const empty = insert('sales', 's1', { id: 's1' }, '');

    const result = await server.as(userId).rpc<PushResult>('sync_push', [[empty]]);

    expect(result.rejected).toEqual([{ seq: empty.seq, reason: 'bad_op' }]);
    expect(await stored('sales')).toEqual([]);
  });

  it('checks the register and the licence again once it holds the market', async () => {
    // A push waiting on the market's lock while the owner revokes the register (or the seller
    // suspends the market) must not commit after them. PGlite has one connection, so the order
    // is checked in the function itself: the second check comes after the lock.
    const [made] = await server.query<{ body: string }>(
      "select pg_get_functiondef('public.sync_push(jsonb)'::regprocedure) as body",
    );
    const body = made?.body ?? '';
    const locked = body.indexOf('app.lock_market(');
    expect(locked).toBeGreaterThan(0);
    const after = body.slice(locked);
    expect(after).toContain('app.current_device()');
    expect(after).toContain('app.require_license(');
  });
});

describe('the licence on the owner functions', () => {
  async function lapse(how: 'expired' | 'suspended' | 'grace'): Promise<void> {
    await server.query(
      how === 'suspended'
        ? "update app.markets set status = 'suspended' where id = 'a'"
        : how === 'expired'
          ? "update app.markets set license_expires_at = now() - interval '7 days 1 minute' where id = 'a'"
          : "update app.markets set license_expires_at = now() - interval '6 days' where id = 'a'",
    );
  }

  it('makes no pairing code for a market past its grace or suspended', async () => {
    const owner = await server.addOwner('a');
    await lapse('grace');
    expect(await server.as(owner).rpc<string>('create_pairing', ['a'])).toMatch(/^[A-Z2-9]{8}$/);

    await lapse('expired');
    expect(await errorOf(server.as(owner).rpc('create_pairing', ['a']))).toContain(
      'license_expired',
    );
    await server.query("update app.markets set license_expires_at = null, status = 'suspended'");
    expect(await errorOf(server.as(owner).rpc('create_pairing', ['a']))).toContain(
      'license_expired',
    );
  });

  it('binds no new register once the licence lapses, and keeps the code for after', async () => {
    const owner = await server.addOwner('a');
    const code = await server.as(owner).rpc<string>('create_pairing', ['a']);
    await lapse('expired');
    const register = await server.addUser({ anonymous: true });

    expect(
      await errorOf(server.as(register).rpc('claim_device', [code, '', 'Kasa', 'web', false])),
    ).toContain('license_expired');
    expect(await server.query('select 1 from app.devices')).toEqual([]);

    // Extended within the code's ten minutes, the same code still works.
    await server.query(
      "update app.markets set license_expires_at = now() + interval '30 days' where id = 'a'",
    );
    expect(
      await server.as(register).rpc('claim_device', [code, '', 'Kasa', 'web', false]),
    ).toMatchObject({ marketId: 'a', deviceCode: 'K1' });
  });

  it('turns on or renews no QR menu once the licence lapses, but lets the owner turn it off', async () => {
    const owner = await server.addOwner('a');
    const { slug } = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    await lapse('suspended');

    expect(await errorOf(server.as(owner).rpc('set_qr_menu', ['a', true]))).toContain(
      'license_expired',
    );
    expect(await errorOf(server.as(owner).rpc('rotate_qr_menu', ['a']))).toContain(
      'license_expired',
    );
    expect(await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', false])).toEqual({
      enabled: false,
      slug,
    });
  });
});

describe('when a register was last seen', () => {
  it('moves on a pull too, at most every five minutes', async () => {
    const { userId, deviceId } = await server.addDevice('a', 'K1');
    const seen = async () =>
      (
        await server.query<{ minutes: number | null }>(
          `select extract(epoch from now() - last_seen_at) / 60 as minutes
           from app.devices where id = $1`,
          [deviceId],
        )
      )[0]?.minutes;

    await server.as(userId).rpc('sync_pull', [0, 10]);
    expect(Number(await seen())).toBeLessThan(1);

    await server.query(
      "update app.devices set last_seen_at = now() - interval '3 minutes' where id = $1",
      [deviceId],
    );
    await server.as(userId).rpc('sync_pull', [0, 10]);
    expect(Math.round(Number(await seen()))).toBe(3);

    await server.query(
      "update app.devices set last_seen_at = now() - interval '6 minutes' where id = $1",
      [deviceId],
    );
    await server.as(userId).rpc('sync_pull', [0, 10]);
    expect(Number(await seen())).toBeLessThan(1);
  });
});

describe('the replaced functions keep their grants', () => {
  it('leaves the helpers to the functions that call them', async () => {
    const user = await server.addUser({ email: 'x@example.com' });
    const call = server.as(user).query("select app.apply_op('a', gen_random_uuid(), '{}'::jsonb)");
    expect(await errorOf(call)).toContain('permission denied');
    // The old two-argument form is gone, so nothing can write a row without saying who sent it.
    const [old] = await server.query<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname = 'apply_op' and pronargs = 2",
    );
    expect(old?.n).toBe(0);
    for (const [name, args] of [
      ['sync_pull', [0, 10]],
      ['claim_device', ['X', '', 'K', 'web', false]],
      ['set_qr_menu', ['a', true]],
      ['rotate_qr_menu', ['a']],
    ] as const) {
      expect(await errorOf(server.as(null).rpc(name, [...args])), name).toContain(
        'permission denied',
      );
    }
  });
});
