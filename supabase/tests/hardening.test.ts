// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

// The security review of 2026-11-20 (supabase/migrations/20261122120000_security_hardening.sql).

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

async function storedIds(market: string): Promise<string[]> {
  const rows = await server.query<{ id: string }>(
    'select id from app.rows where market_id = $1 order by id',
    [market],
  );
  return rows.map((row) => row.id);
}

describe('the QR menu and the licence', () => {
  /** A market with a dish on its menu, synced while its licence ran, then given `expires`. */
  async function menuWithLicence(expires: string | null): Promise<string> {
    const { userId } = await server.addDevice('a', 'K1');
    await server
      .as(userId)
      .rpc('sync_push', [
        [insert('products', 'p1', { id: 'p1', name: 'Adana kebap', sellPrice: 45000 })],
      ]);
    const owner = await server.addOwner('a');
    const { slug } = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    await server.query(
      `update app.markets set license_expires_at = ${expires ?? 'null'} where id = 'a'`,
    );
    return slug as string;
  }

  it('shows the menu while the licence runs and through its seven days of grace', async () => {
    const slug = await menuWithLicence("now() - interval '6 days 23 hours'");
    expect(await server.as(null).rpc('public_menu', [slug])).toMatchObject({
      name: 'Kebapçı Halil',
    });
  });

  it('shows no menu once the grace is over, as sync stops', async () => {
    const slug = await menuWithLicence("now() - interval '7 days 1 minute'");
    expect(await server.as(null).rpc('public_menu', [slug])).toBeNull();

    // Extended, the same link and the cards already printed work again.
    await server.query(
      "update app.markets set license_expires_at = now() + interval '30 days' where id = 'a'",
    );
    expect(await server.as(null).rpc('public_menu', [slug])).toMatchObject({
      name: 'Kebapçı Halil',
    });
  });

  it('keeps the menu of a market without a licence end', async () => {
    const slug = await menuWithLicence(null);
    expect(await server.as(null).rpc('public_menu', [slug])).toMatchObject({
      name: 'Kebapçı Halil',
    });
  });
});

describe('a suspended market', () => {
  it('syncs no more, as with a licence past its grace', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    expect(await errorOf(server.as(userId).rpc('sync_pull', [0, 10]))).toBe('no error');

    await server.query("update app.markets set status = 'suspended' where id = 'a'");

    expect(await errorOf(server.as(userId).rpc('sync_push', [[]]))).toContain('license_expired');
    expect(await errorOf(server.as(userId).rpc('sync_pull', [0, 10]))).toContain('license_expired');
  });
});

describe('what one push may carry', () => {
  it('refuses more than a thousand operations in one call', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const ops = Array.from({ length: 1001 }, (_, index) =>
      insert('sales', `s${index}`, { id: `s${index}`, total: 1 }),
    );
    expect(await errorOf(server.as(userId).rpc('sync_push', [ops]))).toContain('too_many_ops');
    expect(await storedIds('a')).toEqual([]);

    // The app's own batches (500) go through.
    const result = await server.as(userId).rpc<PushResult>('sync_push', [ops.slice(0, 500)]);
    expect(result.acknowledged).toHaveLength(500);
  });

  it('refuses a record over a megabyte, and keeps the rest of the batch', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const big = insert('sales', 'big', { id: 'big', note: 'x'.repeat(1_100_000) });
    const small = insert('sales', 'small', { id: 'small', total: 1 });

    const result = await server.as(userId).rpc<PushResult>('sync_push', [[big, small]]);

    expect(result.acknowledged).toEqual([small.seq]);
    expect(result.rejected).toEqual([{ seq: big.seq, reason: 'too_large' }]);
    expect(await storedIds('a')).toEqual(['small']);
  });

  it('refuses a patch that would grow a record past a megabyte', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const half = 'x'.repeat(600_000);
    await server
      .as(userId)
      .rpc('sync_push', [[insert('customers', 'c1', { id: 'c1', name: 'Emin', a: half })]]);
    const grow = patch('customers', 'c1', { b: half });

    const result = await server.as(userId).rpc<PushResult>('sync_push', [[grow]]);

    expect(result.rejected).toEqual([{ seq: grow.seq, reason: 'too_large' }]);
    const [row] = await server.query<{ has_b: boolean }>(
      "select row ? 'b' as has_b from app.rows where market_id = 'a' and id = 'c1'",
    );
    expect(row?.has_b).toBe(false);
  });

  it('refuses record and operation ids longer than any register makes', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const longId = 'r'.repeat(129);
    const badRecord = insert('sales', longId, { id: longId });
    const badOp = insert('sales', 's1', { id: 's1' }, 'o'.repeat(129));
    const fine = insert('sales', crypto.randomUUID(), { total: 1 });

    const result = await server.as(userId).rpc<PushResult>('sync_push', [[badRecord, badOp, fine]]);

    expect(result.acknowledged).toEqual([fine.seq]);
    expect(result.rejected).toEqual([
      { seq: badRecord.seq, reason: 'bad_record' },
      { seq: badOp.seq, reason: 'bad_op' },
    ]);
    expect(await storedIds('a')).toEqual([fine.recordId]);
  });
});

describe('the replaced functions keep their grants', () => {
  it('leaves a guest only the public menu', async () => {
    for (const [name, args] of [
      ['sync_push', [[]]],
      ['create_pairing', ['a']],
    ] as const) {
      expect(await errorOf(server.as(null).rpc(name, [...args])), name).toContain(
        'permission denied',
      );
    }
    expect(await server.as(null).rpc('public_menu', ['A'.repeat(28)])).toBeNull();
    const user = await server.addUser({ email: 'x@example.com' });
    for (const helper of ['app.market_lapsed($1)', 'app.new_pairing_code()']) {
      const call = server.as(user).query(`select ${helper}`, helper.includes('$1') ? ['a'] : []);
      expect(await errorOf(call), helper).toContain('permission denied');
    }
  });
});

describe('pairing codes', () => {
  it('are eight letters of the read-aloud alphabet, drawn from the strong random source', async () => {
    const owner = await server.addOwner('a');
    const codes = await Promise.all(
      Array.from({ length: 20 }, () => server.as(owner).rpc<string>('create_pairing', ['a'])),
    );
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);

    // random() is a predictable generator; gen_random_uuid() draws from pg_strong_random.
    const [made] = await server.query<{ body: string }>(
      "select pg_get_functiondef('app.new_pairing_code()'::regprocedure) as body",
    );
    expect(made?.body).toContain('gen_random_uuid()');
    expect(made?.body).not.toMatch(/\brandom\(\)/);
    const [create] = await server.query<{ body: string }>(
      "select pg_get_functiondef('public.create_pairing(text)'::regprocedure) as body",
    );
    expect(create?.body).not.toMatch(/\brandom\(\)/);
  });
});
