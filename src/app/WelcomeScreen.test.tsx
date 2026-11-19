import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from './device';
import { forgetSkippedWelcome, shouldWelcome } from './welcome';
import { ServerMissingScreen, WelcomeScreen } from './WelcomeScreen';

const claimed = {
  marketId: 'kursunlu-ab12cd',
  marketName: 'Kurşunlu Market',
  deviceId: 'd1',
  deviceCode: 'K1',
};

function setup(overrides: Partial<Parameters<typeof WelcomeScreen>[0]> = {}) {
  const props = {
    current: DEFAULT_DEVICE,
    open: vi.fn(async () => ({ claimed })),
    join: vi.fn(async () => ({ claimed: { ...claimed, deviceCode: 'K2' } })),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<WelcomeScreen {...props} />);
  return props;
}

describe('WelcomeScreen', () => {
  it('opens a market with the shop’s own email', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'Kurşunlu Market');
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));

    expect(props.open).toHaveBeenCalledWith({
      marketName: 'Kurşunlu Market',
      email: 'emin@example.com',
      password: 'gizli-sifre',
    });
    expect(props.onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: 'kursunlu-ab12cd',
        marketName: 'Kurşunlu Market',
        deviceCode: 'K1',
        deviceName: 'Kasa K1',
        paired: true,
      }),
    );
  });

  it('checks the password before asking the server', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'kisa');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'kisa');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Şifre en az 8 karakter olmalı.');

    await userEvent.clear(screen.getByLabelText('Şifre'));
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Şifreler aynı değil.');
    expect(props.open).not.toHaveBeenCalled();
  });

  it('tells the shop to confirm its email', async () => {
    setup({ open: vi.fn(async () => ({ confirmEmail: true as const })) });
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'E-postanıza gelen bağlantıya tıklayın, sonra “Restorana giriş yap” ile girin.',
    );
  });

  it('signs another device into the market', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restorana giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(props.join).toHaveBeenCalledWith({ email: 'emin@example.com', password: 'gizli-sifre' });
    expect(props.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'K2', deviceName: 'Kasa K2', paired: true }),
    );
  });

  it('asks which market when the owner has several', async () => {
    const join = vi.fn(async (input: { marketId?: string }) =>
      input.marketId
        ? { claimed }
        : {
            markets: [
              { id: 'a', name: 'A Market' },
              { id: 'b', name: 'B Market' },
            ],
          },
    );
    setup({ join });
    await userEvent.click(screen.getByRole('button', { name: 'Restorana giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    await userEvent.selectOptions(await screen.findByLabelText('Restoran'), 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(join).toHaveBeenLastCalledWith(expect.objectContaining({ marketId: 'b' }));
  });

  it('offers no way to use the app without an account', () => {
    setup();
    expect(screen.queryByRole('button', { name: /dene/i })).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Restoran kur',
      'Restorana giriş yap',
    ]);
  });

  it('appears on every device that is not yet paired', () => {
    expect(shouldWelcome(DEFAULT_DEVICE)).toBe(true);
    expect(shouldWelcome({ ...DEFAULT_DEVICE, paired: true })).toBe(false);
  });

  it('says the server is missing instead of opening the app', () => {
    render(<ServerMissingScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sunucu ayarlı değil');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('greets with the Market Kasa logo', () => {
    setup();
    expect(document.querySelector('main img[src$="logo.svg"]')).not.toBeNull();
  });

  it('clears the flag an earlier offline try left behind', () => {
    const stored = new Map([['rk.welcomeSkipped', '1']]);
    forgetSkippedWelcome({ removeItem: (key: string) => void stored.delete(key) });
    expect(stored.has('rk.welcomeSkipped')).toBe(false);
  });
});
