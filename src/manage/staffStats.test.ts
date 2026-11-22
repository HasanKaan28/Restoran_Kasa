import { describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import type { TabItemRecord, TabRecord } from '@/data/types';
import { voidSale } from '@/data/voids';
import { createTestData } from '@/test/renderWithData';
import { loadStaffStats } from './staffStats';

const NOON = '2026-11-20T09:00:00.000Z';

function tab(id: string, staffId: string | undefined, openedAt: string): TabRecord {
  return {
    id,
    status: 'open',
    deviceCode: 'K1',
    staffId,
    openedAt,
    createdAt: openedAt,
    updatedAt: openedAt,
  };
}

function line(
  id: string,
  staffId: string | undefined,
  orderedAt: string,
  extra: Partial<TabItemRecord> = {},
): TabItemRecord {
  return {
    id,
    tabId: 'T1',
    productId: 'P1',
    name: 'Ayran',
    unit: 'piece',
    unitPrice: 5000,
    qtyMilli: 1000,
    station: 'bar',
    status: 'sent',
    deviceCode: 'K1',
    staffId,
    orderedAt,
    createdAt: orderedAt,
    updatedAt: orderedAt,
    ...extra,
  };
}

describe('loadStaffStats', () => {
  it('counts a person’s orders, tabs, sales and cancellations inside the period only', async () => {
    const { db } = createTestData();
    await db.tabs.bulkAdd([
      tab('T1', 'A', NOON),
      tab('T2', 'A', '2026-11-01T09:00:00.000Z'),
      tab('T3', 'B', NOON),
    ]);
    await db.tabItems.bulkAdd([
      line('L1', 'A', NOON),
      line('L2', 'A', NOON),
      // Made again at no charge: not a new order.
      line('L3', 'A', NOON, { remakeOf: 'L1', complimentary: true }),
      // Ordered on an earlier day.
      line('L4', 'A', '2026-11-19T09:00:00.000Z'),
      line('L5', 'B', NOON, {
        status: 'void',
        voidReason: 'Yanlış',
        voidedAt: NOON,
        voidedByStaffId: 'A',
      }),
      // An old void line: nobody to blame, nothing counted.
      line('L6', 'B', NOON, { status: 'void', voidReason: 'Eski' }),
      line('L7', undefined, NOON),
    ]);
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, vatRate: 1 },
      new Date(NOON),
    );
    const sell = (staffId: string, qty: number) =>
      recordSale(db, {
        deviceCode: 'K1',
        at: new Date(NOON),
        staffId,
        lines: [{ productId: tea.id, qtyMilli: qty * 1000 }],
        payments: [{ method: 'cash', amount: qty * 9000 }],
      });
    await sell('A', 1);
    const cancelled = await sell('A', 2);
    await sell('B', 3);
    await voidSale(db, {
      saleId: cancelled.id,
      reason: 'Hata',
      deviceCode: 'K1',
      staffId: 'B',
      at: new Date(NOON),
    });

    const stats = await loadStaffStats(db, {
      from: '2026-11-20',
      to: '2026-11-20',
      cutoffMinutes: 0,
    });
    const of = (id: string) => stats.find((stat) => stat.staffId === id);
    expect(of('A')).toEqual({
      staffId: 'A',
      orders: 2,
      remakes: 1,
      tabsOpened: 1,
      billsClosed: 1,
      salesTotal: 9000,
      voidedLines: 1,
      voidedSales: 0,
    });
    // B's 3-tea sale stays; the voided sale left A's figures and is B's cancellation.
    expect(of('B')).toMatchObject({
      orders: 2,
      tabsOpened: 1,
      billsClosed: 1,
      salesTotal: 27000,
      voidedLines: 0,
      voidedSales: 1,
    });
    expect(stats.map((stat) => stat.staffId).sort()).toEqual(['A', 'B']);
  });

  it('puts an instant before the cutoff on the previous business day', async () => {
    const { db } = createTestData();
    await db.tabs.add(tab('T1', 'A', '2026-11-20T23:30:00.000Z'));
    await db.tabItems.add(line('L1', 'A', '2026-11-20T23:30:00.000Z'));
    // 02:30 Istanbul on the 21st, cutoff 04:00: still the 20th.
    const stats = await loadStaffStats(db, {
      from: '2026-11-20',
      to: '2026-11-20',
      cutoffMinutes: 240,
    });
    expect(stats).toMatchObject([{ staffId: 'A', orders: 1, tabsOpened: 1 }]);
    expect(
      await loadStaffStats(db, { from: '2026-11-21', to: '2026-11-21', cutoffMinutes: 240 }),
    ).toEqual([]);
  });
});
