import { describe, expect, it } from 'vitest';
import type { Permission } from '@/domain/permissions';
import {
  canOpenRoute,
  MANAGE_SECTIONS,
  manageAddress,
  parseManageSection,
  parseRoute,
  parseTabId,
  SECTION_ACCESS,
  tabAddress,
  type ManageSection,
} from './route';

/** A person allowed exactly these. */
function allowed(...granted: Permission[]) {
  return (permission: Permission) => granted.includes(permission);
}

describe('parseRoute', () => {
  it('reads the screen from the address', () => {
    expect(parseRoute('#/products')).toBe('products');
    expect(parseRoute('#/manage')).toBe('manage');
    expect(parseRoute('#/manage/stock')).toBe('manage');
    expect(parseRoute('#/settings')).toBe('settings');
    expect(parseRoute('#/tables')).toBe('tables');
    expect(parseRoute('#/kitchen')).toBe('kitchen');
    // A restaurant opens on its floor of tables; the market's screens have no address here.
    expect(parseRoute('#/pos')).toBe('tables');
    expect(parseRoute('#/stock')).toBe('tables');
    expect(parseRoute('')).toBe('tables');
    expect(parseRoute('#/bilinmeyen')).toBe('tables');
  });

  it('takes the old reports address to Yönetim, as a bookmark from v1.0.4 has it', () => {
    expect(parseRoute('#/reports')).toBe('manage');
    expect(parseManageSection('#/reports')).toBe('reports');
  });
});

describe('the sections of Yönetim', () => {
  it('reads the section from the address', () => {
    expect(MANAGE_SECTIONS).toEqual([
      'reports',
      'staff',
      'credit',
      'stock',
      'suppliers',
      'archive',
    ]);
    for (const section of MANAGE_SECTIONS) {
      expect(manageAddress(section)).toBe(`#/manage/${section}`);
      expect(parseManageSection(manageAddress(section))).toBe(section);
    }
  });

  it('reads no section from an address that names none it knows', () => {
    expect(parseManageSection('#/manage')).toBeNull();
    expect(parseManageSection('#/manage/')).toBeNull();
    expect(parseManageSection('#/manage/bilinmeyen')).toBeNull();
    expect(parseManageSection('#/manage/constructor')).toBeNull();
    expect(parseManageSection('#/stock')).toBeNull();
    expect(parseManageSection('#/tables')).toBeNull();
    expect(parseManageSection('')).toBeNull();
  });

  it('opens each section with its own permission', () => {
    const open = (section: ManageSection, ...granted: Permission[]) =>
      SECTION_ACCESS[section](allowed(...granted));
    expect(open('reports', 'reports')).toBe(true);
    expect(open('staff', 'reports')).toBe(true);
    expect(open('archive', 'reports')).toBe(true);
    expect(open('credit', 'creditSale')).toBe(true);
    expect(open('credit', 'collect')).toBe(true);
    expect(open('stock', 'stock')).toBe(true);
    expect(open('stock', 'count')).toBe(true);
    expect(open('suppliers', 'suppliers')).toBe(true);
    // Nothing else opens them.
    const everythingBut =
      (...left: Permission[]) =>
      (permission: Permission) =>
        !left.includes(permission);
    expect(SECTION_ACCESS.reports(everythingBut('reports'))).toBe(false);
    expect(SECTION_ACCESS.staff(everythingBut('reports'))).toBe(false);
    expect(SECTION_ACCESS.archive(everythingBut('reports'))).toBe(false);
    expect(SECTION_ACCESS.credit(everythingBut('creditSale', 'collect'))).toBe(false);
    expect(SECTION_ACCESS.stock(everythingBut('stock', 'count'))).toBe(false);
    expect(SECTION_ACCESS.suppliers(everythingBut('suppliers'))).toBe(false);
  });
});

describe('canOpenRoute', () => {
  it('opens the floor and the kitchen to everyone', () => {
    expect(canOpenRoute('tables', allowed())).toBe(true);
    expect(canOpenRoute('kitchen', allowed())).toBe(true);
  });

  it('opens the menu to who edits it and the settings to the owner', () => {
    expect(canOpenRoute('products', allowed())).toBe(false);
    expect(canOpenRoute('products', allowed('editProducts'))).toBe(true);
    expect(canOpenRoute('settings', allowed('reports', 'editProducts'))).toBe(false);
    expect(canOpenRoute('settings', allowed('admin'))).toBe(true);
  });

  it('opens Yönetim to whoever may open any one of its sections', () => {
    expect(canOpenRoute('manage', allowed('sell', 'discount', 'voidSale', 'seeCost'))).toBe(false);
    expect(canOpenRoute('manage', allowed('reports'))).toBe(true);
    expect(canOpenRoute('manage', allowed('collect'))).toBe(true);
    expect(canOpenRoute('manage', allowed('count'))).toBe(true);
    expect(canOpenRoute('manage', allowed('suppliers'))).toBe(true);
  });
});

describe('an open tab', () => {
  it('has its own address under the floor, so the back button returns to the tables', () => {
    expect(parseRoute('#/tables/01J9ZK')).toBe('tables');
    expect(parseTabId('#/tables/01J9ZK')).toBe('01J9ZK');
    expect(parseTabId('#/tables')).toBeNull();
    expect(parseTabId('#/tables/')).toBeNull();
    expect(parseTabId('#/kitchen/01J9ZK')).toBeNull();
    expect(tabAddress('01J9ZK')).toBe('#/tables/01J9ZK');
  });

  it('reads only an id, not anything typed after it', () => {
    expect(parseTabId('#/tables/01J9ZK/extra')).toBeNull();
    expect(parseTabId('#/tables/%3Cscript%3E')).toBeNull();
  });
});
