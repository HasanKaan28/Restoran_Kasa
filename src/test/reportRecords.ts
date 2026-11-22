import type {
  DiningTableRecord,
  SaleRecord,
  SaleVoidRecord,
  StaffRecord,
  TabItemRecord,
  TabRecord,
} from '@/data/types';

const STAMP = '2026-10-10T09:00:00.000Z';

/** Plain records for report tests: only the fields a test names differ from the defaults. */
export const aSale = (
  over: Partial<SaleRecord> & Pick<SaleRecord, 'id' | 'total'>,
): SaleRecord => ({
  receiptNo: `F-${over.id}`,
  deviceCode: 'K1',
  seq: 1,
  businessDate: '2026-10-10',
  occurredAt: STAMP,
  lines: [],
  subtotal: over.total,
  cartDiscount: 0,
  vatTotal: 0,
  vatByRate: {},
  payments: [],
  change: 0,
  ...over,
});

export const aSaleVoid = (
  over: Partial<SaleVoidRecord> & Pick<SaleVoidRecord, 'id' | 'saleId'>,
): SaleVoidRecord => ({
  reason: 'Hatalı fiş',
  deviceCode: 'K1',
  occurredAt: STAMP,
  businessDate: '2026-10-10',
  ...over,
});

export const aTable = (
  over: Partial<DiningTableRecord> & Pick<DiningTableRecord, 'id' | 'name'>,
): DiningTableRecord => ({
  area: 'Salon',
  sort: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const aTab = (over: Partial<TabRecord> & Pick<TabRecord, 'id'>): TabRecord => ({
  status: 'paid',
  deviceCode: 'K1',
  openedAt: STAMP,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const anItem = (
  over: Partial<TabItemRecord> & Pick<TabItemRecord, 'id' | 'tabId'>,
): TabItemRecord => ({
  productId: 'p1',
  name: 'Çay',
  unit: 'piece',
  unitPrice: 1000,
  qtyMilli: 1000,
  station: 'kitchen',
  status: 'ready',
  deviceCode: 'K1',
  orderedAt: STAMP,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const aStaffer = (
  over: Partial<StaffRecord> & Pick<StaffRecord, 'id' | 'name'>,
): StaffRecord => ({
  role: 'cashier',
  pinHash: '',
  pinSalt: '',
  pinIterations: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
