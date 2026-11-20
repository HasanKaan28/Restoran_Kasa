import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { closeCashSession, expectedCash, openCashSession } from './cash';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import {
  addTabItem,
  mergeTabs,
  openTab,
  payTabAmount,
  payTabItems,
  refundTabPart,
  sendTab,
  setComplimentary,
  tabDue,
  voidItem,
} from './restaurant';
import { recentSales } from './sales';
import { voidSale } from './voids';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-21T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const waiter = { deviceCode: 'K1', staffId: 'ayse' };

/** A sent tab of ₺1.500: two Adana (₺900) and a rakı (₺600). */
async function sentTab(label = 'Paket 1') {
  const kebab = await createProduct(db, { name: 'Adana', sellPrice: 45000, vatRate: 10 }, at);
  const raki = await createProduct(db, { name: 'Rakı', sellPrice: 60000, vatRate: 20 }, at);
  const tab = await openTab(db, { label, ...waiter }, at);
  const plates = await addTabItem(db, tab.id, kebab, { qtyMilli: 2000 }, waiter, at);
  const drink = await addTabItem(db, tab.id, raki, { qtyMilli: 1000 }, waiter, at);
  await sendTab(db, tab.id, at);
  return { tab, plates, drink, kebab, raki };
}

describe('paying a share of a tab by amount', () => {
  it('takes one guest’s share and leaves the rest to pay; the tab stays open', async () => {
    const { tab } = await sentTab();
    const result = await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 50000, cashGiven: 60000, ...waiter },
      later(1),
    );
    expect(result).toMatchObject({
      part: { tabId: tab.id, method: 'cash', amount: 50000, cashGiven: 60000, change: 10000 },
    });
    expect(await tabDue(db, tab.id)).toMatchObject({ bill: 150000, paid: 50000, due: 100000 });
    expect((await db.tabs.get(tab.id))?.status).toBe('open');
    expect(await recentSales(db)).toEqual([]);
    const ops = (await pendingOps(db, 500)).map((op) => `${op.table}:${op.kind}`);
    expect(ops).toContain('tabPayments:insert');
  });

  it('records one sale when the last share comes in, its payments carrying the shares', async () => {
    const { tab } = await sentTab();
    const first = await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 50000, ...waiter },
      later(1),
    );
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 50000, ...waiter }, later(2));
    const last = await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 50000, cashGiven: 70000, ...waiter },
      later(3),
    );
    expect('sale' in last).toBe(true);
    const [sale] = await recentSales(db);
    expect(sale?.total).toBe(150000);
    expect(sale?.lines.map((line) => line.name).sort()).toEqual(['Adana', 'Rakı']);
    expect(sale?.payments).toEqual([
      { method: 'cash', amount: 50000, tabPaymentId: 'part' in first ? first.part.id : '' },
      { method: 'card', amount: 50000, tabPaymentId: expect.any(String) },
      { method: 'cash', amount: 50000 },
    ]);
    // Change is on the cash handed over now, not on the shares paid before.
    expect(sale).toMatchObject({ cashGiven: 70000, change: 20000 });
    expect((await db.tabs.get(tab.id))?.status).toBe('paid');
  });

  it('refuses more than is left, and nothing', async () => {
    const { tab } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 100000, ...waiter }, later(1));
    await expect(
      payTabAmount(db, { tabId: tab.id, method: 'card', amount: 50001, ...waiter }, later(2)),
    ).rejects.toThrow(RangeError);
    await expect(
      payTabAmount(db, { tabId: tab.id, method: 'card', amount: 0, ...waiter }, later(2)),
    ).rejects.toThrow(RangeError);
  });

  it('keeps the bill from going under what was paid toward it', async () => {
    const { tab, drink, plates } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 100000, ...waiter }, later(1));
    await expect(voidItem(db, plates.id, 'Yanlış', later(2))).rejects.toThrow(RangeError);
    await expect(setComplimentary(db, plates.id, true, later(2))).rejects.toThrow(RangeError);
    // Taking the rakı off still leaves ₺900 to cover the ₺1.000 paid: no.
    await expect(voidItem(db, drink.id, 'Yanlış', later(2))).rejects.toThrow(RangeError);
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 10000, ...waiter }, later(3));
    await expect(tabDue(db, tab.id)).resolves.toMatchObject({ due: 40000 });
  });

  it('pays lines with the shares counted: the last lines take the shares in', async () => {
    const { tab, plates, drink } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 70000, ...waiter }, later(1));
    // The rakı alone would leave ₺900 for ₺700 paid: fine.
    const rakiSale = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [drink.id],
        payments: [{ method: 'card', amount: 60000 }],
        ...waiter,
      },
      later(2),
    );
    expect('id' in rakiSale && rakiSale.payments).toEqual([{ method: 'card', amount: 60000 }]);
    // The kebabs are the last lines: ₺900 less the ₺700 share.
    const last = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [plates.id],
        payments: [{ method: 'card', amount: 20000 }],
        ...waiter,
      },
      later(3),
    );
    expect('id' in last && last.payments).toEqual([
      { method: 'cash', amount: 70000, tabPaymentId: expect.any(String) },
      { method: 'card', amount: 20000 },
    ]);
    expect((await db.tabs.get(tab.id))?.status).toBe('paid');
  });

  it('refuses paying lines that would leave less than the shares already paid', async () => {
    const { tab, plates } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 70000, ...waiter }, later(1));
    await expect(
      payTabItems(
        db,
        {
          tabId: tab.id,
          itemIds: [plates.id],
          payments: [{ method: 'card', amount: 90000 }],
          ...waiter,
        },
        later(2),
      ),
    ).rejects.toThrow(RangeError);
  });

  it('gives a share back: it no longer counts, and the drawer pays it out', async () => {
    const { tab } = await sentTab();
    const taken = await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 50000, ...waiter },
      later(1),
    );
    if (!('part' in taken)) {
      throw new Error('expected a share');
    }
    await refundTabPart(db, taken.part.id, waiter, later(2));
    expect(await tabDue(db, tab.id)).toMatchObject({ paid: 0, due: 150000 });
    await expect(refundTabPart(db, taken.part.id, waiter, later(3))).rejects.toThrow(RangeError);
    expect((await expectedCash(db, 'K1', later(4))).expected).toBe(0);
  });

  it('keeps a tab with shares on it from being merged away; another may merge into it', async () => {
    const { tab } = await sentTab();
    const other = await openTab(db, { label: 'Paket 2', ...waiter }, at);
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 50000, ...waiter }, later(1));
    await expect(mergeTabs(db, tab.id, other.id, later(2))).rejects.toThrow(RangeError);
    await mergeTabs(db, other.id, tab.id, later(2));
    expect((await db.tabs.get(other.id))?.status).toBe('merged');
  });
});

describe('the drawer and shares paid by amount', () => {
  it('counts a cash share when it is taken, and never again in the sale', async () => {
    const { tab } = await sentTab();
    await openCashSession(db, { deviceCode: 'K1', openingCash: 10000 }, at);
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 50000, ...waiter }, later(1));
    expect((await expectedCash(db, 'K1', later(2))).expected).toBe(60000);
    await payTabAmount(db, { tabId: tab.id, method: 'card', amount: 100000, ...waiter }, later(3));
    const cash = await expectedCash(db, 'K1', later(4));
    expect(cash.expected).toBe(60000);
    expect(cash.sales).toBe(50000);
  });

  it('counts the share on the register that took it, not on the one that closes the tab', async () => {
    const { tab } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 50000, ...waiter }, later(1));
    await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 100000, deviceCode: 'K2' },
      later(2),
    );
    expect((await expectedCash(db, 'K1', later(3))).expected).toBe(50000);
    expect((await expectedCash(db, 'K2', later(3))).expected).toBe(100000);
  });

  it('keeps the till right when a day closes between a share and the end of the bill', async () => {
    const { tab } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 50000, ...waiter }, later(1));
    const z = await closeCashSession(db, { deviceCode: 'K1', countedCash: 50000 }, later(2));
    expect(z).toMatchObject({ expectedCash: 50000, difference: 0 });
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 100000, ...waiter }, later(3));
    const next = await closeCashSession(db, { deviceCode: 'K1', countedCash: 100000 }, later(4));
    expect(next).toMatchObject({ expectedCash: 100000, difference: 0 });
    // The sale, on the second day, carries the whole bill for the reports.
    expect(next.summary).toMatchObject({ gross: 150000, byMethod: { cash: 150000 } });
  });

  it('pays every cash part back out of the drawer when the closing sale is voided', async () => {
    const { tab } = await sentTab();
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 50000, ...waiter }, later(1));
    const closed = await payTabAmount(
      db,
      { tabId: tab.id, method: 'cash', amount: 100000, ...waiter },
      later(2),
    );
    if (!('sale' in closed)) {
      throw new Error('expected the sale');
    }
    await voidSale(db, { saleId: closed.sale.id, deviceCode: 'K1', reason: 'Hata', at: later(3) });
    expect((await expectedCash(db, 'K1', later(4))).expected).toBe(0);
  });
});
