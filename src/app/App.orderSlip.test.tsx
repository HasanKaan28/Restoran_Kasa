import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMarketDb } from '@/data/db';
import { deliverTab } from '@/data/deliver';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab } from '@/data/restaurant';
import { createStaff } from '@/data/staff';
import { chooseSlipMode } from '@/restaurant/slipPrefs';
import { App } from './App';
import { DEFAULT_DEVICE, saveDeviceSettings } from './device';

const marketId = `test-${crypto.randomUUID()}`;

afterEach(async () => {
  vi.unstubAllGlobals();
  window.location.hash = '';
  await openMarketDb(marketId).delete();
});

describe('App order slips', () => {
  it('prints a new order on the device chosen for it, even while its register is locked', async () => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, marketId, paired: true });
    const db = openMarketDb(marketId);
    // Someone set up: the register opens locked, asking for a PIN.
    await createStaff(db, { name: 'Kaan', role: 'owner', pin: '4821' }, new Date());
    chooseSlipMode('delivered', new Date());
    const print = vi.fn(() => window.dispatchEvent(new Event('afterprint')));
    vi.stubGlobal('print', print);

    render(<App />);
    expect(await screen.findByText(/PIN/)).toBeInTheDocument();

    const beer = await createProduct(
      db,
      { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' },
      new Date(),
    );
    const table = await createDiningTable(db, { name: '5', area: 'Salon' }, new Date());
    const waiter = { deviceCode: 'P1' };
    const tab = await openTab(db, { tableId: table.id, ...waiter }, new Date());
    await addTabItem(db, tab.id, beer, { qtyMilli: 5000 }, waiter, new Date());
    await deliverTab(db, tab.id, new Date());

    await waitFor(() => expect(print).toHaveBeenCalledOnce(), { timeout: 6000 });
  }, 15_000);
});
