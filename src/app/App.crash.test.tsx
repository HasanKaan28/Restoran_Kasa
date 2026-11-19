import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_STORAGE_KEY } from '@/pos/held';
import { App } from './App';
import { DEFAULT_DEVICE, saveDeviceSettings } from './device';

vi.mock('@/products/ProductsScreen', () => ({
  ProductsScreen: () => {
    throw new Error('Ürünler ekranı çöktü');
  },
}));

describe('App after a crash', () => {
  beforeEach(() => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, paired: true });
  });

  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('goes back to the floor from a crashed screen and keeps the carts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(HELD_STORAGE_KEY, '[]');
    window.location.hash = '#/products';
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Masalara dön' }));
    expect(window.location.hash).toBe('#/tables');
    expect(localStorage.getItem(HELD_STORAGE_KEY)).toBe('[]');
  });
});
