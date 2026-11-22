import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab, sendTab } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { takeNewSlips } from './orderSlip';
import { OrderSlipSection } from './OrderSlipSection';
import { loadSlipPrefs } from './slipPrefs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { marketKasa?: unknown }).marketKasa;
});

describe('OrderSlipSection', () => {
  it('is off until chosen, and keeps this device’s choice from the moment it is made', async () => {
    const { data } = await renderWithData(<OrderSlipSection />);
    expect(screen.getByRole('heading', { name: 'Sipariş adisyonu' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kapalı')).toBeChecked();

    const before = new Date().toISOString();
    await userEvent.click(screen.getByLabelText('Yalnız teslim edilenler'));
    expect(screen.getByLabelText('Yalnız teslim edilenler')).toBeChecked();
    const chosen = loadSlipPrefs();
    expect(chosen.mode).toBe('delivered');
    expect(chosen.mode !== 'off' && chosen.since >= before).toBe(true);
    expect(chosen.mode !== 'off' && chosen.marketId).toBe(data.settings.marketId);

    await userEvent.click(screen.getByLabelText('Tüm siparişler'));
    expect(loadSlipPrefs().mode).toBe('all');
    await userEvent.click(screen.getByLabelText('Kapalı'));
    expect(loadSlipPrefs()).toEqual({ mode: 'off' });
  });

  it('says the browser asks each time, and the desktop app prints with no window', async () => {
    const { unmount } = await renderWithData(<OrderSlipSection />);
    expect(screen.getByText(/yazdırma penceresi açılır/)).toBeInTheDocument();
    unmount();

    (window as { marketKasa?: unknown }).marketKasa = { print: { silent: async () => true } };
    await renderWithData(<OrderSlipSection />);
    expect(screen.getByText(/pencere açmadan varsayılan yazıcıya basar/)).toBeInTheDocument();
  });

  it('cannot be turned on in the Android app, which has no way to print', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    await renderWithData(<OrderSlipSection />);
    expect(screen.getByText(/Android uygulaması yazıcıya basamaz/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tüm siparişler')).toBeDisabled();
    expect(screen.getByLabelText('Kapalı')).toBeChecked();
  });

  it('prints the latest slip again on demand, once there is one', async () => {
    const data = createTestData();
    let printed: string | null = null;
    vi.stubGlobal(
      'print',
      vi.fn(() => {
        printed = document.getElementById('print-root')?.textContent ?? null;
        window.dispatchEvent(new Event('afterprint'));
      }),
    );
    await renderWithData(<OrderSlipSection />, data);
    const again = screen.getByRole('button', { name: 'Son adisyonu tekrar bas' });
    expect(again).toBeDisabled();

    const beer = await createProduct(
      data.db,
      { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' },
      new Date(),
    );
    const table = await createDiningTable(data.db, { name: '5', area: 'Salon' }, new Date());
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'P1' }, new Date());
    await addTabItem(data.db, tab.id, beer, { qtyMilli: 5000 }, { deviceCode: 'P1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await act(() =>
      takeNewSlips(data.db, {
        mode: 'all',
        since: new Date(Date.now() - 60_000).toISOString(),
        now: new Date(),
      }),
    );

    await waitFor(() => expect(again).toBeEnabled());
    await userEvent.click(again);
    await waitFor(() => expect(printed).toContain('5 × Efes'));
    expect(printed).toContain('Masa 5');
  });
});
