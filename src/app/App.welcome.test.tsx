import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DEFAULT_DEVICE, saveDeviceSettings } from './device';

const config = vi.hoisted(() => ({
  server: null as { url: string; key: string } | null,
}));

vi.mock('@/server/config', () => ({
  get SERVER() {
    return config.server;
  },
}));

describe('App without an account', () => {
  beforeEach(() => {
    config.server = { url: 'https://x.supabase.co', key: 'sb_publishable_x' };
  });

  it('shows the first screen on a device that is not paired', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Restoran kur' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).toBeNull();
  });

  it('ignores the flag an earlier offline try left, and clears it', async () => {
    localStorage.setItem('rk.welcomeSkipped', '1');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Restorana giriş yap' })).toBeInTheDocument();
    expect(localStorage.getItem('rk.welcomeSkipped')).toBeNull();
  });

  it('says the server is missing on a build without one', async () => {
    config.server = null;
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu ayarlı değil');
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).toBeNull();
  });

  it('opens a device that is already paired', async () => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, paired: true });
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Ana menü' })).toBeInTheDocument();
  });
});
