import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { makeTestDb } from '@/test/db';
import { aSale, aSaleVoid, aTab, aTable, anItem } from '@/test/reportRecords';
import { loadTableReport } from './tableReport';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const range = { from: '2026-10-10', to: '2026-10-10' };

describe('loadTableReport', () => {
  it('groups paid sales by table, takeaway and other, with a total', async () => {
    await db.diningTables.bulkAdd([
      aTable({ id: 't5', name: 'Masa 5' }),
      aTable({ id: 't6', name: 'Masa 6', archivedAt: '2026-10-09T00:00:00.000Z' }),
    ]);
    await db.tabs.bulkAdd([
      aTab({ id: 'a', tableId: 't5' }),
      aTab({ id: 'b', tableId: 't5' }),
      aTab({ id: 'c', tableId: 't6' }),
      aTab({ id: 'd', label: 'Paket 1' }),
    ]);
    await db.sales.bulkAdd([
      aSale({ id: 's1', total: 10000 }),
      aSale({ id: 's2', total: 5001 }),
      aSale({ id: 's3', total: 7000 }),
      aSale({ id: 's4', total: 3000 }),
      aSale({ id: 's5', total: 2000 }), // a market sale, on no tab
      aSale({ id: 's6', total: 9999, businessDate: '2026-10-11' }), // outside the range
    ]);
    await db.tabItems.bulkAdd([
      anItem({ id: 'i1', tabId: 'a', paidSaleId: 's1' }),
      anItem({ id: 'i1b', tabId: 'a', paidSaleId: 's1' }),
      anItem({ id: 'i2', tabId: 'b', paidSaleId: 's2' }),
      anItem({ id: 'i3', tabId: 'c', paidSaleId: 's3' }),
      anItem({ id: 'i4', tabId: 'd', paidSaleId: 's4' }),
    ]);

    const report = await loadTableReport(db, range);

    expect(report.rows.map((row) => [row.name, row.tabCount, row.saleCount, row.revenue])).toEqual([
      ['Masa 5', 2, 2, 15001],
      ['Masa 6', 1, 1, 7000],
      ['Paket', 1, 1, 3000],
      ['Diğer', 0, 1, 2000],
    ]);
    // 15001 / 2 adisyon, rounded.
    expect(report.rows[0]?.average).toBe(7501);
    expect(report.total).toMatchObject({ tabCount: 4, saleCount: 5, revenue: 27001 });
  });

  it('leaves out sales that were voided', async () => {
    await db.diningTables.add(aTable({ id: 't5', name: 'Masa 5' }));
    await db.tabs.add(aTab({ id: 'a', tableId: 't5' }));
    await db.sales.bulkAdd([aSale({ id: 's1', total: 10000 }), aSale({ id: 's2', total: 4000 })]);
    await db.tabItems.bulkAdd([
      anItem({ id: 'i1', tabId: 'a', paidSaleId: 's1' }),
      anItem({ id: 'i2', tabId: 'a', paidSaleId: 's2' }),
    ]);
    await db.saleVoids.add(aSaleVoid({ id: 'v1', saleId: 's1', businessDate: '2026-10-12' }));

    const report = await loadTableReport(db, range);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ revenue: 4000, saleCount: 1 });
  });

  it('is empty with a zero total when nothing was sold', async () => {
    const report = await loadTableReport(db, range);
    expect(report.rows).toEqual([]);
    expect(report.total).toMatchObject({ tabCount: 0, saleCount: 0, revenue: 0, average: 0 });
  });
});
