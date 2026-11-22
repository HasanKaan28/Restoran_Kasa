import { afterEach, describe, expect, it } from 'vitest';
import type { MarketDb } from './db';
import { createProduct } from './products';
import { recordSale } from './sales';
import { loadSummary } from '@/reports/summary';
import { createTestData, disposeTestData } from '@/test/renderWithData';
import { RecordNotFoundError } from './errors';
import { archiveSavedReport, listSavedReports, saveReport } from './savedReports';

afterEach(disposeTestData);

function summaryOf(db: MarketDb) {
  return loadSummary(db, { from: '0000-01-01', to: '9999-12-31' });
}

describe('savedReports', () => {
  it('saves the figures as they were and queues the insert', async () => {
    const { db } = createTestData();
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, new Date());
    await recordSale(db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    const summary = await summaryOf(db);
    const at = new Date('2026-11-22T10:00:00Z');
    const saved = await saveReport(
      db,
      { title: ' Kasım ', from: '2026-11-01', to: '2026-11-22', summary, deviceCode: 'K1' },
      at,
    );
    expect(saved).toMatchObject({ title: 'Kasım', kind: 'period', createdAt: at.toISOString() });
    expect(saved.register).toBeUndefined();
    expect(await db.savedReports.get(saved.id)).toEqual(saved);
    const ops = (await db.outbox.toArray()).filter((op) => op.kind === 'insert');
    expect(ops.at(-1)).toMatchObject({ table: 'savedReports', recordId: saved.id });
    // A later sale does not change what was saved.
    await recordSale(db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    expect((await db.savedReports.get(saved.id))?.summary.net).toBe(summary.net);
  });

  it('keeps the register and the person when given', async () => {
    const { db } = createTestData();
    const saved = await saveReport(
      db,
      {
        title: 'K2 haftası',
        from: '2026-11-16',
        to: '2026-11-22',
        register: 'K2',
        summary: await summaryOf(db),
        deviceCode: 'K1',
        staffId: 's1',
      },
      new Date(),
    );
    expect(saved).toMatchObject({ register: 'K2', staffId: 's1', deviceCode: 'K1' });
  });

  it('refuses an empty title', async () => {
    const { db } = createTestData();
    await expect(
      saveReport(
        db,
        {
          title: '  ',
          from: '2026-11-01',
          to: '2026-11-02',
          summary: await summaryOf(db),
          deviceCode: 'K1',
        },
        new Date(),
      ),
    ).rejects.toThrow(RangeError);
  });

  it('lists the newest first and leaves out the archived', async () => {
    const { db } = createTestData();
    const summary = await summaryOf(db);
    const base = { from: '2026-11-01', to: '2026-11-02', summary, deviceCode: 'K1' };
    const a = await saveReport(db, { ...base, title: 'A' }, new Date('2026-11-01T10:00:00Z'));
    const b = await saveReport(db, { ...base, title: 'B' }, new Date('2026-11-02T10:00:00Z'));
    const c = await saveReport(db, { ...base, title: 'C' }, new Date('2026-11-03T10:00:00Z'));
    expect((await listSavedReports(db)).map((r) => r.title)).toEqual(['C', 'B', 'A']);
    await archiveSavedReport(db, b.id, new Date('2026-11-04T10:00:00Z'));
    expect((await listSavedReports(db)).map((r) => r.id)).toEqual([c.id, a.id]);
    const archived = await db.savedReports.get(b.id);
    expect(archived?.archivedAt).toBe('2026-11-04T10:00:00.000Z');
    const patch = (await db.outbox.toArray()).at(-1);
    expect(patch).toMatchObject({ kind: 'patch', table: 'savedReports', recordId: b.id });
  });

  it('archives once, and refuses an unknown id', async () => {
    const { db } = createTestData();
    const saved = await saveReport(
      db,
      {
        title: 'A',
        from: '2026-11-01',
        to: '2026-11-02',
        summary: await summaryOf(db),
        deviceCode: 'K1',
      },
      new Date(),
    );
    await archiveSavedReport(db, saved.id, new Date());
    const before = await db.outbox.count();
    await archiveSavedReport(db, saved.id, new Date());
    expect(await db.outbox.count()).toBe(before);
    await expect(archiveSavedReport(db, 'nope', new Date())).rejects.toThrow(RecordNotFoundError);
  });

  it('lists an old record without optional fields', async () => {
    const { db } = createTestData();
    const summary = await summaryOf(db);
    await db.savedReports.add({
      id: 'old',
      title: 'Eski',
      kind: 'period',
      from: '2026-10-01',
      to: '2026-10-02',
      summary,
      deviceCode: 'K1',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    });
    expect((await listSavedReports(db)).map((r) => r.id)).toEqual(['old']);
  });
});
