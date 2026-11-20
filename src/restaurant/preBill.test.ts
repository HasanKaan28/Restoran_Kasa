import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import {
  addTabItem,
  openTab,
  payTabAmount,
  sendTab,
  setComplimentary,
  tabBill,
  tabDue,
} from '@/data/restaurant';
import { createStaff } from '@/data/staff';
import { makeTestDb } from '@/test/db';
import { receiptText } from '@/pos/receiptText';
import { buildPreBill, waiterOf } from './preBill';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-21T18:00:00Z');
const context = { marketName: 'Lokanta', deviceName: 'Kasa 1' };

describe('the pre-bill (adisyon)', () => {
  it('lists what is on the bill, the shares paid and what is left, and is no receipt', async () => {
    await createStaff(db, { name: 'Mert', role: 'owner', pin: '1111' }, at);
    const ali = await createStaff(db, { name: 'Ali', role: 'cashier', pin: '2222' }, at);
    const kebab = await createProduct(db, { name: 'Adana', sellPrice: 45000, vatRate: 10 }, at);
    const water = await createProduct(db, { name: 'Su', sellPrice: 2000, vatRate: 1 }, at);
    const tab = await openTab(db, { label: 'Paket 1', deviceCode: 'K1', staffId: ali.id }, at);
    await addTabItem(db, tab.id, kebab, { qtyMilli: 2000 }, { deviceCode: 'K1' }, at);
    const treat = await addTabItem(db, tab.id, water, { qtyMilli: 1000 }, { deviceCode: 'K1' }, at);
    await sendTab(db, tab.id, at);
    await setComplimentary(db, treat.id, true, at);
    await payTabAmount(db, { tabId: tab.id, method: 'cash', amount: 30000, deviceCode: 'K1' }, at);

    const due = await tabDue(db, tab.id);
    const bill = await tabBill(db, tab.id, due.lineIds);
    const model = buildPreBill(bill, due, {
      ...context,
      at,
      table: 'Paket 1',
      waiter: await waiterOf(db, tab),
    });
    expect(model.heading).toBe('ÖN HESAP (ADİSYON)');
    expect(model.receiptNo).toBe('');
    expect(model.waiter).toBe('Garson: Ali');
    expect(model.lines.map((line) => line.name).sort()).toEqual(['Adana', 'Su']);
    expect(model.lines.find((line) => line.name === 'Su')).toMatchObject({
      discount: 'İkram',
      amount: '₺0,00',
    });
    expect(model.totals).toEqual([
      { label: 'Toplam', amount: '₺900,00' },
      { label: 'Ödenen', amount: '−₺300,00' },
      { label: 'Kalan', amount: '₺600,00' },
    ]);
    expect(model.footer).toContain('Ödeme fişi değildir.');
    const text = receiptText(model, 32);
    expect(text).toContain('ÖN HESAP (ADİSYON)');
    expect(text).not.toContain('Fiş ');
  });

  it('names no waiter when none opened the tab', async () => {
    const tab = await openTab(db, { label: 'Paket 1', deviceCode: 'K1' }, at);
    expect(await waiterOf(db, tab)).toBeUndefined();
  });
});
