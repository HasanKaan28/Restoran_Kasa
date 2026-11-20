import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DEFAULT_DEVICE, saveDeviceSettings } from './device';

vi.mock('@/restaurant/TablesScreen', () => ({
  TablesScreen: () => {
    throw new Error('Masalar ekranı çöktü');
  },
}));

describe('App after a crash on the floor', () => {
  beforeEach(() => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, paired: true });
  });

  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('speaks of the restaurant’s orders, not of a market’s basket', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.location.hash = '#/tables';
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Yeniden başlat' })).toBeInTheDocument();
    expect(
      screen.getByText('Kaydedilen siparişler ve satışlar güvende. Uygulamayı yeniden başlatın.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sepet/)).toBeNull();
  });
});
