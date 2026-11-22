import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderSlipSection } from './OrderSlipSection';
import { loadSlipPrefs } from './slipPrefs';

afterEach(() => {
  delete (window as { marketKasa?: unknown }).marketKasa;
});

describe('OrderSlipSection', () => {
  it('is off until chosen, and keeps this device’s choice from the moment it is made', async () => {
    render(<OrderSlipSection />);
    expect(screen.getByRole('heading', { name: 'Sipariş adisyonu' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kapalı')).toBeChecked();

    const before = new Date().toISOString();
    await userEvent.click(screen.getByLabelText('Yalnız teslim edilenler'));
    expect(screen.getByLabelText('Yalnız teslim edilenler')).toBeChecked();
    const chosen = loadSlipPrefs();
    expect(chosen.mode).toBe('delivered');
    expect(chosen.mode !== 'off' && chosen.since >= before).toBe(true);

    await userEvent.click(screen.getByLabelText('Tüm siparişler'));
    expect(loadSlipPrefs().mode).toBe('all');
    await userEvent.click(screen.getByLabelText('Kapalı'));
    expect(loadSlipPrefs()).toEqual({ mode: 'off' });
  });

  it('says the browser asks each time, and the desktop app prints with no window', () => {
    const { unmount } = render(<OrderSlipSection />);
    expect(screen.getByText(/yazdırma penceresi açılır/)).toBeInTheDocument();
    unmount();

    (window as { marketKasa?: unknown }).marketKasa = { print: { silent: async () => true } };
    render(<OrderSlipSection />);
    expect(screen.getByText(/pencere açmadan varsayılan yazıcıya basar/)).toBeInTheDocument();
  });
});
