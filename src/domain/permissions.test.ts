import { describe, expect, it } from 'vitest';
import {
  can,
  PERMISSION_LABELS,
  PERMISSIONS,
  RESTAURANT_PERMISSIONS,
  type Permission,
  type Role,
} from './permissions';

const ROLES: readonly Role[] = ['cashier', 'stock', 'manager', 'owner'];

// The restaurant's defaults, row by row; the columns are waiter, kitchen/bar, manager, owner.
// A waiter takes orders and payments; the kitchen and the bar only prepare (Yönetim paneli plan).
const TABLE: Record<Permission, readonly [boolean, boolean, boolean, boolean]> = {
  sell: [true, false, true, true],
  creditSale: [false, false, true, true],
  overLimit: [false, false, true, true],
  discount: [false, false, true, true],
  returnWithReceipt: [true, false, true, true],
  voidSale: [false, false, true, true],
  collect: [false, false, true, true],
  addProduct: [true, false, true, true],
  editProducts: [false, false, true, true],
  seeCost: [false, false, true, true],
  stock: [false, false, true, true],
  count: [false, false, true, true],
  suppliers: [false, false, true, true],
  reports: [false, false, true, true],
  closeDay: [false, false, true, true],
  invoice: [true, false, true, true],
  admin: [false, false, false, true],
};

describe('can', () => {
  it('gives each role the restaurant’s defaults', () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(TABLE).sort());
    for (const permission of PERMISSIONS) {
      const granted = ROLES.map((role) => can({ role }, permission));
      expect([permission, ...granted]).toEqual([permission, ...TABLE[permission]]);
    }
  });

  it('lets a person’s own permission win over the role, except for the owner', () => {
    expect(can({ role: 'cashier', permissions: { discount: true } }, 'discount')).toBe(true);
    expect(can({ role: 'manager', permissions: { reports: false } }, 'reports')).toBe(false);
    expect(can({ role: 'manager', permissions: { discount: true } }, 'reports')).toBe(true);
    expect(can({ role: 'owner', permissions: { admin: false } }, 'admin')).toBe(true);
  });

  it('keeps a person’s own setting from before the defaults changed', () => {
    // The staff records are not rewritten: what an owner turned on for someone stays on.
    expect(can({ role: 'cashier', permissions: { creditSale: true } }, 'creditSale')).toBe(true);
    expect(can({ role: 'cashier', permissions: { creditSale: true } }, 'collect')).toBe(false);
    expect(can({ role: 'stock', permissions: { stock: true } }, 'stock')).toBe(true);
    expect(can({ role: 'stock', permissions: { stock: true } }, 'editProducts')).toBe(false);
  });

  it('keeps the owner’s own rights to owners, and nothing to an unknown role', () => {
    expect(can({ role: 'manager', permissions: { admin: true } }, 'admin')).toBe(false);
    expect(can({ role: 'clerk' as Role }, 'sell')).toBe(false);
  });
});

describe('the staff screen’s permissions', () => {
  it('lists credit, stock, counts and suppliers for the owner to turn on, in order', () => {
    expect(RESTAURANT_PERMISSIONS).toEqual([
      'sell',
      'discount',
      'voidSale',
      'creditSale',
      'collect',
      'overLimit',
      'editProducts',
      'seeCost',
      'stock',
      'count',
      'suppliers',
      'reports',
      'closeDay',
      'admin',
    ]);
  });

  it('names them as the restaurant speaks of them', () => {
    expect(PERMISSION_LABELS).toMatchObject({
      creditSale: 'Veresiye satış',
      collect: 'Tahsilat, veresiye müşterileri',
      overLimit: 'Veresiye limit aşımı onayı',
      stock: 'Stok, mal kabul, kritik stok',
      count: 'Sayım',
      suppliers: 'Tedarikçi, alış faturaları',
    });
  });
});
