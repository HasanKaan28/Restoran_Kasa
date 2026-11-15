import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

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
