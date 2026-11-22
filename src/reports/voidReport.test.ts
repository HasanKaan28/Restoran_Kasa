import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { makeTestDb } from '@/test/db';
import { aSale, aSaleVoid, aStaffer, aTab, aTable, anItem } from '@/test/reportRecords';
import { loadVoidReport } from './voidReport';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const range = { from: '2026-10-10', to: '2026-10-10', cutoffMinutes: 0 };
// Noon in Istanbul on the 10th, and the 11th.
const day10 = '2026-10-10T09:00:00.000Z';
const day11 = '2026-10-11T09:00:00.000Z';

describe('loadVoidReport', () => {
  it('lists receipt voids of the period with reason, person, time and amount', async () => {
    await db.staff.bulkAdd([aStaffer({ id: 'u1', name: 'Ayşe', archivedAt: day10 })]);
    await db.sales.bulkAdd([
      aSale({ id: 's1', total: 12500, businessDate: '2026-10-09' }),
      aSale({ id: 's2', total: 800 }),
    ]);
    await db.saleVoids.bulkAdd([
      aSaleVoid({ id: 'v1', saleId: 's1', reason: 'Yanlış fiş', staffId: 'u1' }),
      aSaleVoid({ id: 'v2', saleId: 's2', businessDate: '2026-10-11' }),
    ]);

    const report = await loadVoidReport(db, range);

    expect(report.receiptVoids).toEqual([
      expect.objectContaining({
        reason: 'Yanlış fiş',
        staffName: 'Ayşe',
        at: day10,
        amount: 12500,
      }),
    ]);
  });

  it('counts only sent lines as kitchen voids, and falls back for old rows', async () => {
    await db.staff.add(aStaffer({ id: 'u2', name: 'Mehmet' }));
    await db.tabs.add(aTab({ id: 'a', status: 'open' }));
    await db.tabItems.bulkAdd([
      // Sent, with the new fields.
      anItem({
        id: 'k1',
        tabId: 'a',
        status: 'void',
        sentAt: day10,
        voidReason: 'Müşteri vazgeçti',
        voidedAt: '2026-10-10T10:00:00.000Z',
        voidedByStaffId: 'u2',
        unitPrice: 5000,
        qtyMilli: 2000,
      }),
      // Sent, an old row: no voidedAt, no person.
      anItem({
        id: 'k2',
        tabId: 'a',
        status: 'void',
        sentAt: day10,
        voidReason: 'Yanlış',
        updatedAt: day10,
      }),
      // Never sent: taken off the order before the kitchen saw it.
      anItem({
        id: 'k3',
        tabId: 'a',
        status: 'void',
        voidReason: 'Gönderilmeden çıkarıldı',
        updatedAt: day10,
      }),
      // Sent but voided on another day.
      anItem({ id: 'k4', tabId: 'a', status: 'void', sentAt: day10, updatedAt: day11 }),
    ]);

    const report = await loadVoidReport(db, range);

    expect(report.lineVoids.map((row) => [row.name, row.staffName, row.amount])).toEqual([
      ['Çay', 'Mehmet', 10000],
      ['Çay', 'Bilinmiyor', 1000],
    ]);
  });

  it('lists cancelled tabs with the closer, or the opener when it was not kept', async () => {
    await db.staff.bulkAdd([
      aStaffer({ id: 'u1', name: 'Ayşe' }),
      aStaffer({ id: 'u2', name: 'Mehmet' }),
    ]);
    await db.diningTables.add(aTable({ id: 't5', name: 'Masa 5' }));
    await db.tabs.bulkAdd([
      aTab({
        id: 'a',
        tableId: 't5',
        status: 'cancelled',
        closedAt: day10,
        closedByStaffId: 'u2',
        staffId: 'u1',
      }),
      aTab({ id: 'b', label: 'Paket 2', status: 'cancelled', closedAt: day10, staffId: 'u1' }),
      aTab({ id: 'c', status: 'cancelled', closedAt: day11 }),
      aTab({ id: 'd', status: 'paid', closedAt: day10 }),
    ]);

    const report = await loadVoidReport(db, range);

    expect(report.cancelledTabs.map((row) => [row.name, row.staffName])).toEqual([
      ['Masa 5', 'Mehmet'],
      ['Paket 2', 'Ayşe'],
    ]);
  });

  it('lists remakes with the original product, reason, person and time', async () => {
    await db.staff.add(aStaffer({ id: 'u1', name: 'Ayşe' }));
    await db.tabs.add(aTab({ id: 'a', status: 'open' }));
    await db.tabItems.bulkAdd([
      anItem({ id: 'o1', tabId: 'a', name: 'Köfte', status: 'void', sentAt: day10 }),
      anItem({
        id: 'r1',
        tabId: 'a',
        name: 'Köfte',
        remakeOf: 'o1',
        remakeReason: 'Soğuk geldi',
        staffId: 'u1',
        orderedAt: '2026-10-10T11:00:00.000Z',
      }),
      anItem({ id: 'r2', tabId: 'a', remakeOf: 'gone', orderedAt: day11 }),
    ]);

    const report = await loadVoidReport(db, range);

    expect(report.remakes).toEqual([
      expect.objectContaining({
        name: 'Köfte',
        originalName: 'Köfte',
        reason: 'Soğuk geldi',
        staffName: 'Ayşe',
        at: '2026-10-10T11:00:00.000Z',
      }),
    ]);
  });

  it('honours the day cutoff for timestamps', async () => {
    await db.tabs.add(aTab({ id: 'a', status: 'open' }));
    // 01:00 Istanbul on the 11th is still the 10th with a 03:00 cutoff.
    await db.tabItems.add(
      anItem({
        id: 'k1',
        tabId: 'a',
        status: 'void',
        sentAt: day10,
        voidedAt: '2026-10-10T22:00:00.000Z',
      }),
    );
    expect((await loadVoidReport(db, range)).lineVoids).toHaveLength(0);
    const late = await loadVoidReport(db, { ...range, cutoffMinutes: 180 });
    expect(late.lineVoids).toHaveLength(1);
  });

  it('is empty when nothing happened', async () => {
    expect(await loadVoidReport(db, range)).toMatchObject({
      receiptVoids: [],
      lineVoids: [],
      cancelledTabs: [],
      remakes: [],
    });
  });
});
