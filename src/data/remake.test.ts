import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { CreditLimitError, RecordNotFoundError } from './errors';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import {
  addTabItem,
  kitchenTickets,
  markReady,
  markServed,
  openTab,
  payTabItems,
  reopenCancelledWithLines,
  sendTab,
  setComplimentary,
  tabBill,
  tabDue,
  voidItem,
  remakeItem,
} from './restaurant';
import type { TabItemRecord } from './types';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-22T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const waiter = { deviceCode: 'K1', staffId: 'ayse' };

/** An open tab with a kebab (kitchen) and a water (no preparing) sent. */
async function sentTab() {
  const kebab = await createProduct(
    db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  const water = await createProduct(
    db,
    { name: 'Su', sellPrice: 2000, vatRate: 1, station: 'none' },
    at,
  );
  const tab = await openTab(db, { ...waiter, label: 'Paket' }, at);
  const line = await addTabItem(
    db,
    tab.id,
    kebab,
    { qtyMilli: 2000, note: 'Az pişmiş' },
    waiter,
    at,
  );
  const drink = await addTabItem(db, tab.id, water, { qtyMilli: 1000 }, waiter, at);
  await sendTab(db, tab.id, at);
  return { tab, line, drink, kebab, water };
}

async function itemOf(id: string): Promise<TabItemRecord> {
  return (await db.tabItems.get(id))!;
}

describe('voiding a sent line', () => {
  it('stamps when and by whom it was taken back, and queues both', async () => {
    const { line } = await sentTab();
    await voidItem(db, line.id, 'Müşteri vazgeçti', later(5), 'mert');

    expect(await itemOf(line.id)).toMatchObject({
      status: 'void',
      voidReason: 'Müşteri vazgeçti',
      voidedAt: later(5).toISOString(),
      voidedByStaffId: 'mert',
    });
    const ops = (await pendingOps(db)).filter((op) => op.recordId === line.id);
    expect(ops.at(-1)).toMatchObject({
      kind: 'patch',
      patch: { voidedAt: later(5).toISOString(), voidedByStaffId: 'mert' },
    });
  });

  it('still works when called as before, with nobody named', async () => {
    const { line } = await sentTab();
    await voidItem(db, line.id, 'Yanlış masa', later(5));

    const record = await itemOf(line.id);
    expect(record).toMatchObject({ status: 'void', voidedAt: later(5).toISOString() });
    expect(record).not.toHaveProperty('voidedByStaffId');
    const ops = (await pendingOps(db)).filter((op) => op.recordId === line.id);
    const last = ops.at(-1);
    // Nothing to clear on the server: the field is left out, not sent as null.
    expect(last?.kind === 'patch' ? last.patch : {}).not.toHaveProperty('voidedByStaffId');
  });
});

describe('who closed a tab', () => {
  it('keeps the person who took the last payment', async () => {
    const { tab, line, drink } = await sentTab();
    await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [line.id, drink.id],
        payments: [{ method: 'card', amount: 92000 }],
        deviceCode: 'K1',
        staffId: 'mert',
      },
      later(30),
    );
    expect(await db.tabs.get(tab.id)).toMatchObject({ status: 'paid', closedByStaffId: 'mert' });
  });

  it('keeps who closed a tab left with nothing on it, and nobody when nobody signed in', async () => {
    const empty = await openTab(db, { deviceCode: 'K1', label: 'Paket' }, at);
    await payTabItems(
      db,
      { tabId: empty.id, itemIds: [], payments: [], deviceCode: 'K1', staffId: 'ayse' },
      later(1),
    );
    expect(await db.tabs.get(empty.id)).toMatchObject({
      status: 'cancelled',
      closedByStaffId: 'ayse',
    });

    const other = await openTab(db, { deviceCode: 'K1', label: 'Paket' }, at);
    await payTabItems(
      db,
      { tabId: other.id, itemIds: [], payments: [], deviceCode: 'K1' },
      later(1),
    );
    expect(await db.tabs.get(other.id)).not.toHaveProperty('closedByStaffId');
  });

  it('forgets who closed a cancelled tab once it opens again', async () => {
    const empty = await openTab(db, { deviceCode: 'K1', label: 'Paket' }, at);
    await payTabItems(
      db,
      { tabId: empty.id, itemIds: [], payments: [], deviceCode: 'K1', staffId: 'ayse' },
      later(1),
    );
    // A line ordered on another register before the close reached it, brought in by sync.
    const kebab = await createProduct(
      db,
      { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
      at,
    );
    await db.tabItems.add({
      id: 'from-other-register',
      tabId: empty.id,
      productId: kebab.id,
      name: kebab.name,
      unit: 'piece',
      unitPrice: 45000,
      qtyMilli: 1000,
      station: 'kitchen',
      status: 'sent',
      deviceCode: 'K2',
      orderedAt: at.toISOString(),
      sentAt: at.toISOString(),
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
    await db.transaction('rw', db.tabs, db.tabItems, db.outbox, () =>
      reopenCancelledWithLines(db, [empty.id], later(2)),
    );

    const tab = await db.tabs.get(empty.id);
    expect(tab).toMatchObject({ status: 'open' });
    expect(tab).not.toHaveProperty('closedByStaffId');
    const ops = (await pendingOps(db)).filter((op) => op.recordId === empty.id);
    expect(ops.at(-1)).toMatchObject({ kind: 'patch', patch: { closedByStaffId: null } });
  });

  it('names nobody on a tab paid only in part', async () => {
    const { tab, line } = await sentTab();
    await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [line.id],
        payments: [{ method: 'cash', amount: 90000 }],
        deviceCode: 'K1',
        staffId: 'mert',
      },
      later(30),
    );
    expect(await db.tabs.get(tab.id)).toMatchObject({ status: 'open' });
    expect(await db.tabs.get(tab.id)).not.toHaveProperty('closedByStaffId');
  });
});

describe('paying a tab on credit (veresiye)', () => {
  it('writes the bill to the customer’s account', async () => {
    const { tab, line, drink } = await sentTab();
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const sale = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [line.id, drink.id],
        payments: [{ method: 'credit', amount: 92000 }],
        customerId: customer.id,
        deviceCode: 'K1',
        staffId: 'mert',
      },
      later(30),
    );
    expect(sale).toMatchObject({ customerId: customer.id, total: 92000 });
    expect(await customerBalance(db, customer.id)).toBe(92000);
    expect(await db.tabs.get(tab.id)).toMatchObject({ status: 'paid' });
  });

  it('takes no credit without a customer, and nothing is paid', async () => {
    const { tab, line, drink } = await sentTab();
    await expect(
      payTabItems(
        db,
        {
          tabId: tab.id,
          itemIds: [line.id, drink.id],
          payments: [{ method: 'credit', amount: 92000 }],
          deviceCode: 'K1',
        },
        later(30),
      ),
    ).rejects.toThrow(RecordNotFoundError);
    expect(await db.tabs.get(tab.id)).toMatchObject({ status: 'open' });
    expect((await itemOf(line.id)).paidSaleId).toBeUndefined();
  });

  it('refuses a customer over the limit unless it was allowed', async () => {
    const { tab, line, drink } = await sentTab();
    const customer = await createCustomer(db, { name: 'Ahmet', creditLimit: 50000 }, at);
    const input = {
      tabId: tab.id,
      itemIds: [line.id, drink.id],
      payments: [{ method: 'credit' as const, amount: 92000 }],
      customerId: customer.id,
      deviceCode: 'K1',
    };
    await expect(payTabItems(db, input, later(30))).rejects.toThrow(CreditLimitError);
    expect(await customerBalance(db, customer.id)).toBe(0);

    await payTabItems(db, { ...input, allowOverLimit: true }, later(31));
    expect(await customerBalance(db, customer.id)).toBe(92000);
  });
});

describe('making a line again (tekrar hazırla)', () => {
  it('sends a free copy to the kitchen and leaves the bill as it was', async () => {
    const { tab, line } = await sentTab();
    const before = await tabBill(db, tab.id);
    const dueBefore = await tabDue(db, tab.id);

    const again = await remakeItem(
      db,
      { itemId: line.id, reason: ' Soğuk geldi ', deviceCode: 'K2', staffId: 'mert' },
      later(10),
    );

    expect(again).toMatchObject({
      tabId: tab.id,
      productId: line.productId,
      name: 'Adana kebap',
      unit: line.unit,
      unitPrice: 45000,
      qtyMilli: 2000,
      note: 'Az pişmiş',
      station: 'kitchen',
      complimentary: true,
      remakeOf: line.id,
      remakeReason: 'Soğuk geldi',
      status: 'sent',
      sentAt: later(10).toISOString(),
      orderedAt: later(10).toISOString(),
      deviceCode: 'K2',
      staffId: 'mert',
    });
    expect(again.id).not.toBe(line.id);
    expect(await db.tabItems.get(again.id)).toEqual(again);
    // The original line is untouched.
    expect(await itemOf(line.id)).toMatchObject({ status: 'sent' });
    expect(await itemOf(line.id)).not.toHaveProperty('complimentary');

    expect((await tabBill(db, tab.id)).total).toBe(before.total);
    expect((await tabDue(db, tab.id)).due).toBe(dueBefore.due);

    // A new ticket line for the kitchen.
    const [ticket] = await kitchenTickets(db, 'kitchen');
    expect(ticket!.items.map((item) => item.id)).toEqual([line.id, again.id]);

    const ops = (await pendingOps(db)).filter((op) => op.recordId === again.id);
    expect(ops).toMatchObject([{ kind: 'insert', table: 'tabItems', record: again }]);
  });

  it('copies the portion and the choices', async () => {
    const lahmacun = await createProduct(
      db,
      {
        name: 'Pide',
        sellPrice: 20000,
        vatRate: 10,
        station: 'kitchen',
        portions: [{ label: 'Büyük', price: 30000 }],
        optionGroups: [{ name: 'Acı', choices: ['Acılı', 'Acısız'], required: true }],
      },
      at,
    );
    const tab = await openTab(db, { ...waiter, label: 'Paket' }, at);
    const line = await addTabItem(
      db,
      tab.id,
      lahmacun,
      { qtyMilli: 1000, portion: 'Büyük', options: ['Acısız'] },
      waiter,
      at,
    );
    await sendTab(db, tab.id, at);
    const again = await remakeItem(
      db,
      { itemId: line.id, reason: 'Yandı', deviceCode: 'K1' },
      later(5),
    );
    expect(again).toMatchObject({ portion: 'Büyük', options: ['Acısız'], unitPrice: 30000 });
    expect(again).not.toHaveProperty('staffId');
  });

  it('remakes a ready or served line; what needs no preparing is ready at once', async () => {
    const { tab, line, drink } = await sentTab();
    await markReady(db, [line.id], later(5), 'MUTFAK');
    await markServed(db, [line.id], true, later(6));
    const again = await remakeItem(
      db,
      { itemId: line.id, reason: 'Soğuk', deviceCode: 'K1' },
      later(10),
    );
    expect(again).toMatchObject({ status: 'sent' });
    expect(again).not.toHaveProperty('readyAt');
    expect(again).not.toHaveProperty('servedAt');
    expect(again).not.toHaveProperty('readyDeviceCode');

    const water = await remakeItem(
      db,
      { itemId: drink.id, reason: 'Döküldü', deviceCode: 'K1' },
      later(11),
    );
    expect(water).toMatchObject({
      status: 'ready',
      sentAt: later(11).toISOString(),
      readyAt: later(11).toISOString(),
      complimentary: true,
    });
    expect((await tabBill(db, tab.id)).total).toBe(92000);
  });

  it('remakes a line already paid (split bill), without touching its sale', async () => {
    const { tab, line, drink } = await sentTab();
    const sale = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [line.id],
        payments: [{ method: 'cash', amount: 90000 }],
        deviceCode: 'K1',
      },
      later(20),
    );
    const again = await remakeItem(
      db,
      { itemId: line.id, reason: 'Soğuk', deviceCode: 'K1' },
      later(25),
    );
    expect(again).toMatchObject({ complimentary: true, status: 'sent' });
    expect(again).not.toHaveProperty('paidSaleId');
    expect((await itemOf(line.id)).paidSaleId).toBe('id' in sale ? sale.id : undefined);
    // What is left to pay is still only the water.
    expect((await tabBill(db, tab.id)).total).toBe(2000);
    expect((await tabBill(db, tab.id)).lines.map((one) => one.item.id)).toEqual([
      drink.id,
      again.id,
    ]);
  });

  it('needs a reason, an open tab, and a line the kitchen had', async () => {
    const { tab, line, drink } = await sentTab();
    await expect(
      remakeItem(db, { itemId: line.id, reason: '  ', deviceCode: 'K1' }, later(5)),
    ).rejects.toThrow(RangeError);

    const kebab = await db.products.get(line.productId);
    const fresh = await addTabItem(db, tab.id, kebab!, { qtyMilli: 1000 }, waiter, later(1));
    await expect(
      remakeItem(db, { itemId: fresh.id, reason: 'Soğuk', deviceCode: 'K1' }, later(5)),
    ).rejects.toThrow(RangeError);
    const held = await addTabItem(
      db,
      tab.id,
      kebab!,
      { qtyMilli: 1000, hold: true },
      waiter,
      later(1),
    );
    await sendTab(db, tab.id, later(2));
    expect((await itemOf(held.id)).status).toBe('held');
    await expect(
      remakeItem(db, { itemId: held.id, reason: 'Soğuk', deviceCode: 'K1' }, later(5)),
    ).rejects.toThrow(RangeError);
    await voidItem(db, drink.id, 'Vazgeçti', later(3));
    await expect(
      remakeItem(db, { itemId: drink.id, reason: 'Soğuk', deviceCode: 'K1' }, later(5)),
    ).rejects.toThrow(RangeError);
    await expect(
      remakeItem(db, { itemId: 'nope', reason: 'Soğuk', deviceCode: 'K1' }, later(5)),
    ).rejects.toThrow(RecordNotFoundError);
  });

  it('stays on the house: a remake cannot be charged after all', async () => {
    const { tab, line } = await sentTab();
    const again = await remakeItem(
      db,
      { itemId: line.id, reason: 'Soğuk', deviceCode: 'K1' },
      later(5),
    );
    await expect(setComplimentary(db, again.id, false, later(6))).rejects.toThrow(RangeError);
    expect(await itemOf(again.id)).toMatchObject({ complimentary: true });
    expect((await tabBill(db, tab.id)).total).toBe(92000);
  });

  it('refuses a tab already closed', async () => {
    const { tab, line, drink } = await sentTab();
    await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [line.id, drink.id],
        payments: [{ method: 'cash', amount: 92000 }],
        deviceCode: 'K1',
      },
      later(20),
    );
    await expect(
      remakeItem(db, { itemId: line.id, reason: 'Soğuk', deviceCode: 'K1' }, later(25)),
    ).rejects.toThrow('This tab is closed');
  });
});
