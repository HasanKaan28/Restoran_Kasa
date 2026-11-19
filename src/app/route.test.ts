import { describe, expect, it } from 'vitest';
import { parseRoute, parseTabId, tabAddress } from './route';

describe('parseRoute', () => {
  it('reads the screen from the address', () => {
    expect(parseRoute('#/products')).toBe('products');
    expect(parseRoute('#/reports')).toBe('reports');
    expect(parseRoute('#/settings')).toBe('settings');
    expect(parseRoute('#/tables')).toBe('tables');
    expect(parseRoute('#/kitchen')).toBe('kitchen');
    // A restaurant opens on its floor of tables; the market's screens have no address here.
    expect(parseRoute('#/pos')).toBe('tables');
    expect(parseRoute('#/stock')).toBe('tables');
    expect(parseRoute('')).toBe('tables');
    expect(parseRoute('#/bilinmeyen')).toBe('tables');
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
