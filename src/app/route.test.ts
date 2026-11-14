import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('reads the screen from the address', () => {
    expect(parseRoute('#/products')).toBe('products');
    expect(parseRoute('#/pos')).toBe('pos');
    expect(parseRoute('#/stock')).toBe('stock');
    expect(parseRoute('#/customers')).toBe('customers');
    expect(parseRoute('#/suppliers')).toBe('suppliers');
    expect(parseRoute('#/reports')).toBe('reports');
    expect(parseRoute('#/settings')).toBe('settings');
    expect(parseRoute('#/tables')).toBe('tables');
    expect(parseRoute('#/kitchen')).toBe('kitchen');
    // A restaurant opens on its floor of tables.
    expect(parseRoute('')).toBe('tables');
    expect(parseRoute('#/bilinmeyen')).toBe('tables');
  });
});
