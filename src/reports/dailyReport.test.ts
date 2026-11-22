import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCategory } from '@/data/categories';
import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { voidSale } from '@/data/voids';
import {
  addTabItem,
  openTab,
  payTabItems,
  remakeItem,
  sendTab,
  setComplimentary,
} from '@/data/restaurant';
import { makeTestDb } from '@/test/db';
import { dailyReportCsv, loadDailyReport } from './dailyReport';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const day = (n: number, minute = 0) => new Date(Date.UTC(2026, 9, n, 9, minute));
const date = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

async function setup() {
  const drinks = await createCategory(db, 'İçecek', day(1));
  const tea = await createProduct(
    db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1, categoryId: drinks.id },
    day(1),
  );
  const coffee = await createProduct(
    db,
    { name: 'Kahve', sellPrice: 12000, buyPrice: 8000, vatRate: 1, categoryId: drinks.id },
    day(1),
  );
  const cola = await createProduct(
    db,
    { name: 'Kola', sellPrice: 3000, buyPrice: 2000, vatRate: 20 },
    day(1),
  );
  const ahmet = await createCustomer(db, { name: 'Ahmet' }, day(1));
  return { tea, coffee, cola, ahmet };
}

describe('loadDailyReport', () => {
  it('groups products by category with subtotals, payment split and void line', async () => {
    const { tea, coffee, cola, ahmet } = await setup();
    await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [
        { productId: tea.id, qtyMilli: 2000 },
        { productId: coffee.id, qtyMilli: 1000 },
      ],
      payments: [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 20000 },
      ],
    });
    await recordSale(db, {
      deviceCode: 'K1',
      at: day(29, 1),
      lines: [{ productId: cola.id, qtyMilli: 1000 }],
      payments: [{ method: 'credit', amount: 3000 }],
      customerId: ahmet.id,
    });
    const voided = await recordSale(db, {
      deviceCode: 'K1',
      at: day(29, 2),
      lines: [{ productId: tea.id, qtyMilli: 5000 }],
      payments: [{ method: 'cash', amount: 45000 }],
    });
    await voidSale(db, { saleId: voided.id, reason: 'Yanlış', deviceCode: 'K1', at: day(29, 3) });

    const report = await loadDailyReport(db, { from: date(29), to: date(29) });

    expect(report.categories.map((group) => group.name)).toEqual(['İçecek', 'Diğer']);
    const [drinks, other] = report.categories;
    expect(drinks?.net).toBe(30000);
    expect(drinks?.rows).toEqual([
      expect.objectContaining({ name: 'Çay', qtyMilli: 2000, net: 18000 }),
      expect.objectContaining({ name: 'Kahve', qtyMilli: 1000, net: 12000 }),
    ]);
    expect(other?.rows).toEqual([expect.objectContaining({ name: 'Kola', net: 3000 })]);
    expect(report.total).toBe(33000);
    expect(report.salesCount).toBe(2);
    expect(report.byMethod).toEqual({ cash: 10000, card: 20000, credit: 3000 });
    expect(report.voidCount).toBe(1);
    expect(report.voidTotal).toBe(45000);
  });

  it('reports complimentary lines apart, at menu price, not in the sold rows', async () => {
    const { tea } = await setup();
    await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [
        { productId: tea.id, qtyMilli: 1000 },
        { productId: tea.id, qtyMilli: 2000, lineDiscount: 18000 },
      ],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(report.categories[0]?.rows).toEqual([
      expect.objectContaining({ name: 'Çay', qtyMilli: 1000, net: 9000 }),
    ]);
    expect(report.total).toBe(9000);
    expect(report.complimentary).toEqual({
      count: 1,
      value: 18000,
      rows: [expect.objectContaining({ name: 'Çay', qtyMilli: 2000, value: 18000 })],
    });
  });

  it('leaves a product sold only as complimentary out of the sold rows; an empty day is empty', async () => {
    const { cola } = await setup();
    await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [{ productId: cola.id, qtyMilli: 1000, lineDiscount: 3000 }],
      payments: [],
    });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(report.categories).toEqual([]);
    expect(report.complimentary.count).toBe(1);
    const empty = await loadDailyReport(db, { from: date(30), to: date(30) });
    expect(empty).toMatchObject({ total: 0, salesCount: 0, categories: [] });
  });
});

describe('remakes (Tekrar) on a tab', () => {
  const waiter = { deviceCode: 'K1' };

  /** A tab with two teas sent, one of them remade; `treat` also gives the second tea away. */
  async function paidTabWithRemake(treat: boolean) {
    const { tea } = await setup();
    const tab = await openTab(db, { ...waiter, label: 'Paket' }, day(29));
    const first = await addTabItem(db, tab.id, tea, { qtyMilli: 1000 }, waiter, day(29));
    const second = await addTabItem(db, tab.id, tea, { qtyMilli: 1000 }, waiter, day(29));
    await sendTab(db, tab.id, day(29, 1));
    const again = await remakeItem(
      db,
      { itemId: first.id, reason: 'Soğuk', ...waiter },
      day(29, 2),
    );
    if (treat) {
      await setComplimentary(db, second.id, true, day(29, 3));
    }
    await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [first.id, second.id, again.id],
        payments: [{ method: 'cash', amount: treat ? 9000 : 18000 }],
        ...waiter,
      },
      day(29, 4),
    );
  }

  it('lists a remade line as Tekrar, apart from the treats and the sold rows', async () => {
    await paidTabWithRemake(false);
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(report.remade).toEqual({
      count: 1,
      value: 9000,
      rows: [expect.objectContaining({ name: 'Çay', qtyMilli: 1000, value: 9000 })],
    });
    expect(report.complimentary).toEqual({ count: 0, value: 0, rows: [] });
    expect(report.categories[0]?.rows).toEqual([
      expect.objectContaining({ name: 'Çay', qtyMilli: 2000, net: 18000 }),
    ]);
    expect(report.total).toBe(18000);
  });

  it('keeps both as treats when a real treat and a remake cannot be told apart', async () => {
    await paidTabWithRemake(true);
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(report.remade.count).toBe(0);
    expect(report.complimentary).toMatchObject({ count: 2, value: 18000 });
    expect(report.total).toBe(9000);
  });
});

describe('treats with returns and earlier voids', () => {
  const noNegativeFreebies = (report: Awaited<ReturnType<typeof loadDailyReport>>) =>
    report.categories
      .flatMap((group) => group.rows)
      .filter((row) => row.qtyMilli < 0 && row.net === 0);

  it('does not count a returned treat twice', async () => {
    const { tea, cola } = await setup();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [
        { productId: tea.id, qtyMilli: 1000 },
        { productId: cola.id, qtyMilli: 2000, lineDiscount: 6000 },
      ],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: cola.id, qtyMilli: 2000 }],
      deviceCode: 'K1',
      at: day(29, 5),
    });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(noNegativeFreebies(report)).toEqual([]);
    expect(report.categories.flatMap((group) => group.rows.map((row) => row.name))).toEqual([
      'Çay',
    ]);
    expect(report.complimentary).toEqual({ count: 0, value: 0, rows: [] });
    expect(report.total).toBe(9000);
  });

  it('keeps a partly returned treat for what is left', async () => {
    const { tea, cola } = await setup();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [
        { productId: tea.id, qtyMilli: 1000 },
        { productId: cola.id, qtyMilli: 2000, lineDiscount: 6000 },
      ],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: cola.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(29, 5),
    });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(noNegativeFreebies(report)).toEqual([]);
    expect(report.complimentary.rows).toEqual([
      expect.objectContaining({ name: 'Kola', qtyMilli: 1000, value: 3000 }),
    ]);
    expect(report.complimentary.value).toBe(3000);
    expect(report.returnCount).toBe(1);
  });

  it('leaves the treats of an earlier day alone when its sale is voided now', async () => {
    const { tea, cola } = await setup();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: day(28),
      lines: [
        { productId: tea.id, qtyMilli: 1000 },
        { productId: cola.id, qtyMilli: 1000, lineDiscount: 3000 },
      ],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await voidSale(db, { saleId: sale.id, reason: 'Yanlış', deviceCode: 'K1', at: day(29) });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(noNegativeFreebies(report)).toEqual([]);
    expect(report.complimentary).toEqual({ count: 0, value: 0, rows: [] });
    expect(report.earlierVoidCount).toBe(1);
    expect(report.earlierVoidTotal).toBe(9000);
    expect(report.total).toBe(-9000);
  });

  it('does not take a treat of an earlier day off this day when it is returned', async () => {
    const { tea, cola } = await setup();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: day(28),
      lines: [
        { productId: tea.id, qtyMilli: 1000 },
        { productId: cola.id, qtyMilli: 1000, lineDiscount: 3000 },
      ],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: cola.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(29),
    });
    const report = await loadDailyReport(db, { from: date(29), to: date(29) });
    expect(noNegativeFreebies(report)).toEqual([]);
    expect(report.complimentary.count).toBe(0);
  });
});

describe('dailyReportCsv', () => {
  it('says returns and earlier voids are already off the grand total', async () => {
    const { tea } = await setup();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: day(28),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    const kept = await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [{ productId: tea.id, qtyMilli: 2000 }],
      payments: [{ method: 'cash', amount: 18000 }],
    });
    await recordReturn(db, {
      saleId: kept.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: day(29, 5),
    });
    await voidSale(db, { saleId: sale.id, reason: 'Yanlış', deviceCode: 'K1', at: day(29, 6) });
    const csv = dailyReportCsv(await loadDailyReport(db, { from: date(29), to: date(29) }));
    expect(csv).toContain('İade (genel toplamdan düşüldü);;1;İade;90,00\r\n');
    expect(csv).toContain('Önceki günlerin iptali (genel toplamdan düşüldü);;1;Fiş;90,00\r\n');
    expect(csv).toContain('İptal (genel toplama dahil değil);;0;Fiş;0,00\r\n');
  });

  it('lists products with category, subtotals and the figures, behind a BOM', async () => {
    const { tea, cola } = await setup();
    await recordSale(db, {
      deviceCode: 'K1',
      at: day(29),
      lines: [
        { productId: tea.id, qtyMilli: 2000 },
        { productId: cola.id, qtyMilli: 1000 },
      ],
      payments: [{ method: 'cash', amount: 21000 }],
    });
    const csv = dailyReportCsv(await loadDailyReport(db, { from: date(29), to: date(29) }));
    expect(csv.startsWith('﻿Kategori;Ürün;Miktar;Birim;Tutar\r\n')).toBe(true);
    expect(csv).toContain('İçecek;Çay;2;Adet;180,00\r\n');
    expect(csv).toContain('İçecek;Ara toplam;;;180,00\r\n');
    expect(csv).toContain('Diğer;Kola;1;Adet;30,00\r\n');
    expect(csv).toContain('Genel toplam;;;;210,00\r\n');
    expect(csv).toContain('Nakit;;;;210,00\r\n');
    expect(csv).toContain('Fiş sayısı;;;;1\r\n');
  });
});
