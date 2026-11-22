import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSummary } from '@/reports/summary';
import { openMarketDb, type MarketDb } from './db';
import type { OutboxItem, SaleRecord, SavedReportRecord, TabItemRecord, TabRecord } from './types';

const V17_STORES = {
  products: 'id, &barcode, name, updatedAt, *packCodes',
  customers: 'id, name, phone, updatedAt',
  sales: 'id, receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId, businessDate',
  stockMovements: 'id, productId, [productId+occurredAt]',
  stockLevels: 'productId',
  ledger: 'id, customerId',
  outbox: '++seq',
  meta: 'key',
  saleVoids: 'id, saleId, businessDate, occurredAt',
  returns: 'id, saleId, businessDate, occurredAt',
  categories: 'id, updatedAt',
  purchases: 'id, occurredAt',
  stockCounts: 'id, occurredAt',
  suppliers: 'id, name, updatedAt',
  supplierLedger: 'id, supplierId, occurredAt',
  cashSessions: 'id, [deviceCode+closedAt], closedAt',
  cashMovements: 'id, [deviceCode+occurredAt], occurredAt',
  staff: 'id, name, updatedAt',
  settings: 'id',
  auditLog: 'id, occurredAt',
  invoices: 'id, saleId, status, updatedAt',
  diningTables: 'id, area, sort',
  tabs: 'id, tableId, status, openedAt',
  tabItems: 'id, tabId, status, station, sentAt',
  tabPayments: 'id, tabId, [deviceCode+occurredAt]',
};

const AT = '2026-11-22T12:00:00.000Z';

const TAB: TabRecord = {
  id: 'T1',
  tableId: 'M4',
  status: 'open',
  deviceCode: 'K1',
  openedAt: AT,
  createdAt: AT,
  updatedAt: AT,
};

const TAB_ITEMS: [TabItemRecord, TabItemRecord] = [
  {
    id: 'L1',
    tabId: 'T1',
    productId: 'P1',
    name: 'Ezme',
    unit: 'piece',
    unitPrice: 11000,
    qtyMilli: 1000,
    station: 'kitchen',
    status: 'sent',
    deviceCode: 'K1',
    orderedAt: AT,
    sentAt: AT,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'L2',
    tabId: 'T1',
    productId: 'P2',
    name: 'Ayran',
    unit: 'piece',
    unitPrice: 4000,
    qtyMilli: 2000,
    station: 'bar',
    status: 'ready',
    paidSaleId: 'S1',
    deviceCode: 'K1',
    staffId: 'ST1',
    orderedAt: AT,
    sentAt: AT,
    readyAt: AT,
    createdAt: AT,
    updatedAt: AT,
  },
];

const SALE: SaleRecord = {
  id: 'S1',
  receiptNo: 'K1-20261122-0001',
  deviceCode: 'K1',
  seq: 1,
  businessDate: '2026-11-22',
  occurredAt: AT,
  lines: [],
  subtotal: 8000,
  cartDiscount: 0,
  total: 8000,
  vatTotal: 727,
  vatByRate: { 10: 727 },
  payments: [{ method: 'cash', amount: 8000 }],
  change: 0,
};

const PENDING_OP: OutboxItem = {
  kind: 'insert',
  table: 'sales',
  recordId: 'S1',
  record: SALE,
  opId: 'op-1',
  createdAt: AT,
};

let db: MarketDb | undefined;
afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe('openMarketDb', () => {
  it('names the database per market, apart from v1', () => {
    db = openMarketDb('kursunlu-market');
    expect(db.name).toBe('rk-kursunlu-market');
    expect(db.name).not.toBe('MarketPosDB');
  });

  it('declares the data and sync tables', async () => {
    db = openMarketDb('tables-check');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'auditLog',
      'cashMovements',
      'cashSessions',
      'categories',
      'customers',
      'diningTables',
      'invoices',
      'ledger',
      'meta',
      'outbox',
      'products',
      'purchases',
      'returns',
      'saleVoids',
      'sales',
      'savedReports',
      'settings',
      'staff',
      'stockCounts',
      'stockLevels',
      'stockMovements',
      'supplierLedger',
      'suppliers',
      'tabItems',
      'tabPayments',
      'tabs',
    ]);
  });

  it('indexes movements by product and time', () => {
    db = openMarketDb('movement-index-check');
    expect(db.stockMovements.schema.indexes.map((index) => index.name)).toContain(
      '[productId+occurredAt]',
    );
  });

  it('indexes order lines by the sale that paid them, and saved reports by date', () => {
    db = openMarketDb('report-index-check');
    expect(db.tabItems.schema.indexes.map((index) => index.name)).toContain('paidSaleId');
    expect(db.savedReports.schema.indexes.map((index) => index.name)).toEqual(['createdAt']);
  });

  it('upgrades a v17 database without losing rows', async () => {
    // The schema v1.0.4 opens with (versions 1 to 17 of MarketDb, every table as it ended).
    const old = new Dexie('rk-upgrade-17');
    old.version(17).stores(V17_STORES);
    await old.open();
    expect(old.verno).toBe(17);
    await old.table('tabs').bulkAdd([TAB]);
    await old.table('tabItems').bulkAdd(TAB_ITEMS);
    await old.table('sales').bulkAdd([SALE]);
    await old.table('outbox').add(PENDING_OP);
    await old.table('meta').add({ key: 'cursor', value: 41 });
    old.close();

    db = openMarketDb('upgrade-17');
    await db.open();
    expect(db.verno).toBe(18);
    expect(await db.tabs.toArray()).toEqual([TAB]);
    expect(await db.tabItems.orderBy('id').toArray()).toEqual(TAB_ITEMS);
    expect(await db.sales.toArray()).toEqual([SALE]);
    expect(await db.outbox.toArray()).toEqual([{ ...PENDING_OP, seq: 1 }]);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 41 });
    // The new index is built over the rows already there.
    expect(await db.tabItems.where('paidSaleId').equals(SALE.id).primaryKeys()).toEqual(['L2']);
    expect(await db.savedReports.count()).toBe(0);
  });

  it('keeps the new optional fields of a line, a tab and a saved report', async () => {
    db = openMarketDb('new-fields');
    const voided: TabItemRecord = {
      ...TAB_ITEMS[0],
      status: 'void',
      voidedAt: '2026-11-22T12:05:00.000Z',
      voidedByStaffId: 'ST1',
    };
    const remake: TabItemRecord = {
      ...TAB_ITEMS[0],
      id: 'L3',
      complimentary: true,
      remakeOf: 'L1',
      remakeReason: 'Yandı',
    };
    const delivered: TabItemRecord = {
      ...TAB_ITEMS[0],
      id: 'L4',
      status: 'ready',
      sentAt: '2026-11-22T12:00:00.000Z',
      readyAt: '2026-11-22T12:00:00.000Z',
      servedAt: '2026-11-22T12:00:00.000Z',
      deliveredAt: '2026-11-22T12:00:00.000Z',
    };
    await db.tabItems.bulkAdd([voided, remake, delivered]);
    await db.tabs.add({ ...TAB, status: 'paid', closedByStaffId: 'ST1' });
    const report: SavedReportRecord = {
      id: 'R1',
      title: 'Kasım',
      kind: 'period',
      from: '2026-11-01',
      to: '2026-11-22',
      register: 'K1',
      summary: await loadSummary(db, { from: '2026-11-01', to: '2026-11-22' }),
      deviceCode: 'K1',
      staffId: 'ST1',
      createdAt: '2026-11-22T23:00:00.000Z',
      updatedAt: '2026-11-22T23:00:00.000Z',
    };
    await db.savedReports.add(report);
    expect(await db.tabItems.bulkGet(['L1', 'L3', 'L4'])).toEqual([voided, remake, delivered]);
    expect((await db.tabs.get(TAB.id))?.closedByStaffId).toBe('ST1');
    expect(await db.savedReports.get('R1')).toEqual(report);
  });

  it('does not index booleans', () => {
    db = openMarketDb('index-check');
    expect(db.products.schema.indexes.map((index) => index.name)).not.toContain('isQuick');
  });

  it('rejects market ids that are not slug-safe', () =>
    expect(() => openMarketDb('Kurşunlu Market')).toThrow(RangeError));

  it('upper-cases stored barcodes when it opens, keeping the oldest holder', async () => {
    const old = new Dexie('rk-barcode-case');
    old.version(4).stores({
      products: 'id, &barcode, name, updatedAt',
      customers: 'id, name, phone, updatedAt',
      sales: 'id, receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      ledger: 'id, customerId',
      outbox: '++seq',
      meta: 'key',
      saleVoids: 'id, saleId',
      returns: 'id, saleId',
    });
    const product = (id: string, barcode: string, createdAt: string) => ({
      id,
      barcode,
      name: id,
      unit: 'piece',
      sellPrice: 100,
      buyPrice: 0,
      vatRate: 1,
      isQuick: false,
      criticalLevelMilli: 0,
      createdAt,
      updatedAt: createdAt,
    });
    // Added newest first, so the oldest holder wins by date, not by the order of the rows.
    await old
      .table('products')
      .bulkAdd([
        product('newer', 'ABC', '2026-02-01T00:00:00.000Z'),
        product('older', 'abc', '2026-01-01T00:00:00.000Z'),
        product('dashed', 'x-1', '2026-03-01T00:00:00.000Z'),
      ]);
    old.close();

    db = openMarketDb('barcode-case');
    expect((await db.products.get('older'))?.barcode).toBe('ABC');
    expect((await db.products.get('newer'))?.barcode).toBeUndefined();
    expect((await db.products.get('dashed'))?.barcode).toBe('X-1');
  });
});
