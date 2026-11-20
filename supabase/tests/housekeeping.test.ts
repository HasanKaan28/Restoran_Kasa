// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

let seq = 0;
const sale = (id: string, pad = '') => ({
  kind: 'insert',
  table: 'sales',
  recordId: id,
  seq: ++seq,
  opId: `op-${id}`,
  createdAt: '2026-10-30T07:05:00.000Z',
  record: {
    id,
    receiptNo: 'K1-20261030-0001',
    occurredAt: '2026-10-30T07:05:00.000Z',
    businessDate: '2026-10-30',
    lines: [{ productId: 'p1', name: 'Süt' + pad, qtyMilli: 1500, unitPrice: 2833, total: 4250 }],
    payments: [{ method: 'cash', amount: 4250 }],
    total: 4250,
  },
});

describe('storage quota', () => {
  it('tracks row sizes and refuses a push past the limit', async () => {
    await server.addMarket('m1');
    const { userId } = await server.addDevice('m1', 'K1');
    const session = server.as(userId);
    await session.rpc('sync_push', [[sale('s1', Array.from({ length: 300 }, () => crypto.randomUUID()).join(''))]]);
    const [usage] = await server.query<{ bytes: string }>(
      "select bytes from app.market_usage where market_id = 'm1'",
    );
    expect(Number(usage?.bytes)).toBeGreaterThan(1000);

    await server.query("update app.market_usage set limit_bytes = 1000 where market_id = 'm1'");
    expect(await errorOf(session.rpc('sync_push', [[sale('s2')]]))).toContain('quota_exceeded');

    await server.query("update app.market_usage set limit_bytes = null where market_id = 'm1'");
    expect(await errorOf(session.rpc('sync_push', [[sale('s2')]]))).toBe('no error');
  });

  it('keeps the counter right when a row is deleted or the market is removed', async () => {
    await server.addMarket('m2');
    const { userId } = await server.addDevice('m2', 'K1');
    await server.as(userId).rpc('sync_push', [[sale('s1', 'y'.repeat(500))]]);
    await server.query("delete from app.rows where market_id = 'm2'");
    const [usage] = await server.query<{ bytes: string }>(
      "select bytes from app.market_usage where market_id = 'm2'",
    );
    expect(Number(usage?.bytes)).toBe(0);
    await server.as(userId).rpc('sync_push', [[sale('s3')]]);
    await server.query("delete from app.markets where id = 'm2'");
    expect(await server.query("select 1 from app.market_usage where market_id = 'm2'")).toEqual([]);
  });
});

describe('app.prune', () => {
  it('drops old applied_ops and long-expired pairings, nothing else', async () => {
    await server.addMarket('m3');
    const owner = await server.addOwner('m3');
    const { userId } = await server.addDevice('m3', 'K1');
    await server.as(userId).rpc('sync_push', [[sale('s1')]]);
    await server.query(
      `insert into app.applied_ops (market_id, op_id, created_at) values
        ('m3', 'old', now() - interval '91 days'), ('m3', 'recent', now() - interval '89 days')`,
    );
    await server.query(
      `insert into app.pairings (code, market_id, created_by, expires_at) values
        ('OLD111', 'm3', $1, now() - interval '8 days'),
        ('NEW111', 'm3', $1, now() - interval '6 days'),
        ('LIVE11', 'm3', $1, now() + interval '5 minutes')`,
      [owner],
    );
    const [result] = await server.query<{ r: { appliedOps: number; pairings: number } }>(
      'select app.prune() as r',
    );
    expect(result?.r).toEqual({ appliedOps: 1, pairings: 1 });
    const ops = await server.query<{ op_id: string }>(
      "select op_id from app.applied_ops where market_id = 'm3' order by op_id",
    );
    expect(ops.map((o) => o.op_id)).toEqual(['op-s1', 'recent']);
    const codes = await server.query<{ code: string }>('select code from app.pairings order by code');
    expect(codes.map((c) => c.code)).toEqual(['LIVE11', 'NEW111']);
    expect(await server.query("select 1 from app.devices where market_id = 'm3'")).toHaveLength(1);
  });

  it('is not callable by clients', async () => {
    const user = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(user).query('select app.prune()'))).toMatch(/permission denied/);
  });
});
