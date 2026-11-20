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
    claim: vi.fn(async (input: { deviceCode: string }) => ({
      ...claimed,
      deviceCode: input.deviceCode,
    })),
    onDone: vi.fn(),
    supportNumber: '905321112233' as string | null,
    ...overrides,
  };
  render(<WelcomeScreen {...props} />);
  return props;
}

describe('WelcomeScreen', () => {
  it('opens a market with the shop’s own email', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Kurulum kodu'), 'abcd efgh jkmn');
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'Kurşunlu Market');
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));

    expect(screen.getByLabelText('Kurulum kodu')).toHaveValue('ABCD-EFGH-JKMN');
    expect(props.open).toHaveBeenCalledWith({
      marketName: 'Kurşunlu Market',
      email: 'emin@example.com',
      password: 'gizli-sifre',
      activationCode: 'RK-ABCD-EFGH-JKMN',
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
    await userEvent.type(screen.getByLabelText('Kurulum kodu'), 'ABCDEFGHJKMN');
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
    await userEvent.type(screen.getByLabelText('Kurulum kodu'), 'ABCDEFGHJKMN');
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    // Nothing was opened: the same form, once the email is confirmed, opens the restaurant.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'E-postanızı onaylayın, sonra tekrar deneyin: e-postanıza gelen bağlantıya tıklayın, sonra “Restoranı kur”a yeniden basın. Kurulum kodunuz kullanılmadı.',
    );
  });

  it('takes the code out of a pasted WhatsApp message', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.click(screen.getByLabelText('Kurulum kodu'));
    await userEvent.paste(
      'Restoran Kasa kurulum kodunuz: RK-ABCD-EFGH-JKMN  Uygulama: https://restorankasa.vercel.app/app/ → Restoran kur',
    );
    expect(screen.getByLabelText('Kurulum kodu')).toHaveValue('ABCD-EFGH-JKMN');
  });

  it('asks for the whole code before asking the server', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Kurulum kodu'), 'ABCD-EF');
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Kurulum kodunu eksiksiz yazın');
    expect(props.open).not.toHaveBeenCalled();
  });

  it('says a wrong or used code plainly', async () => {
    setup({
      open: vi.fn(async () => {
        throw new Error('Kod geçersiz ya da kullanılmış.');
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    await userEvent.type(screen.getByLabelText('Kurulum kodu'), 'ABCDEFGHJKMN');
    await userEvent.type(screen.getByLabelText('Restoran adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı kur' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod geçersiz ya da kullanılmış.');
  });

  it('offers a WhatsApp chat with the seller for a code', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    const link = screen.getByRole('link', { name: 'Kodunuz yok mu? WhatsApp’tan yazın' });
    expect(link).toHaveAttribute(
      'href',
      `https://wa.me/905321112233?text=${encodeURIComponent(
        'Merhaba, Restoran Kasa için kurulum kodu almak istiyorum.',
      )}`,
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('says whom to ask for a code when the build has no WhatsApp number', async () => {
    setup({ supportNumber: null });
    await userEvent.click(screen.getByRole('button', { name: 'Restoran kur' }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Kurulum kodu için satıcınızla iletişime geçin.')).toBeInTheDocument();
  });

  it('offers to write for another device when the plan is full', async () => {
    const full = Object.assign(
      new Error('Paketinizin cihaz sınırı dolu (5 cihaz). Ek cihaz için bize yazın.'),
      { deviceLimit: 5 },
    );
    setup({
      join: vi.fn(async () => {
        throw full;
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Restorana giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paketinizin cihaz sınırı dolu (5 cihaz). Ek cihaz için bize yazın.',
    );
    expect(screen.getByRole('link', { name: 'Ek cihaz için WhatsApp’tan yazın' })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/905321112233?text='),
    );
  });

  it('lets a new device take the place of a register when the plan is full', async () => {
    const full = {
      market: { id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' },
      limit: 1,
      devices: [
        {
          id: 'd1',
          code: 'K1',
          name: 'Kasa K1',
          platform: 'android',
          lastSeenAt: '2026-11-19T10:00:00.000Z',
        },
      ],
    };
    const join = vi.fn(async (input: { replaceCode?: string }) =>
      input.replaceCode ? { claimed } : { full },
    );
    const props = setup({ join });
    await userEvent.click(screen.getByRole('button', { name: 'Restorana giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kurşunlu Market: paketinizin cihaz sınırı dolu (1 cihaz).',
    );
    expect(screen.getByLabelText('Yerine geçeceği kasa')).toHaveDisplayValue(
      'K1 · Kasa K1 · son görülme 19/11 13:00',
    );
    expect(screen.getByRole('link', { name: 'Ek cihaz için WhatsApp’tan yazın' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Yerine geç' }));

    expect(join).toHaveBeenLastCalledWith({
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketId: 'kursunlu-ab12cd',
      replaceCode: 'K1',
    });
    expect(props.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'K1', paired: true }),
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
      'Bağlantı koduyla bağlan',
    ]);
  });

  describe('joining with a pairing code', () => {
    const openForm = () =>
      userEvent.click(screen.getByRole('button', { name: 'Bağlantı koduyla bağlan' }));

    it('keeps the option below the two main ones, lower in emphasis', () => {
      setup();
      const buttons = screen.getAllByRole('button');
      expect(buttons[2]).toHaveTextContent('Bağlantı koduyla bağlan');
      expect(buttons[0]?.className).not.toBe(buttons[2]?.className);
    });

    it('claims the code, uppercased, and hints where it comes from', async () => {
      const props = setup();
      await openForm();
      expect(
        screen.getByText('Satıcınızın ya da restoran sahibinin verdiği 8 haneli kod'),
      ).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'abcd2345');
      expect(screen.getByLabelText('Bağlantı kodu')).toHaveValue('ABCD2345');
      await userEvent.type(screen.getByLabelText('Cihaz adı'), 'Bar kasası');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));

      expect(props.claim).toHaveBeenCalledWith({
        code: 'ABCD2345',
        deviceCode: 'K1',
        deviceName: 'Bar kasası',
      });
      expect(props.onDone).toHaveBeenCalledWith(
        expect.objectContaining({
          marketId: 'kursunlu-ab12cd',
          deviceName: 'Bar kasası',
          paired: true,
        }),
      );
    });

    it('takes a pasted code with spaces and lower case', async () => {
      const props = setup();
      await openForm();
      await userEvent.click(screen.getByLabelText('Bağlantı kodu'));
      await userEvent.paste(' abcd 2345 ');
      expect(screen.getByLabelText('Bağlantı kodu')).toHaveValue('ABCD2345');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
      expect(props.claim).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABCD2345' }));
    });

    it('names the device after its code when no name is given', async () => {
      const props = setup();
      await openForm();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
      await userEvent.clear(screen.getByLabelText('Kasa kodu'));
      await userEvent.type(screen.getByLabelText('Kasa kodu'), 'k7');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
      expect(props.claim).toHaveBeenCalledWith({
        code: 'ABCD2345',
        deviceCode: 'K7',
        deviceName: 'Kasa K7',
      });
    });

    it('needs all eight characters before it connects', async () => {
      setup();
      await openForm();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD23');
      expect(screen.getByRole('button', { name: 'Bağla' })).toBeDisabled();
    });

    it('offers to take the place of the register that holds the Kasa kodu', async () => {
      const taken = Object.assign(new Error('K1 kodu bu restoranda kullanılıyor.'), {
        taken: true,
      });
      const claim = vi
        .fn()
        .mockRejectedValueOnce(taken)
        .mockResolvedValueOnce({ ...claimed, deviceCode: 'K1' });
      const props = setup({ claim });
      await openForm();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('K1 kodu bu restoranda');

      await userEvent.click(screen.getByLabelText(/K1 cihazının yerine geç/));
      await userEvent.click(screen.getByRole('button', { name: 'Yerine geç' }));
      expect(claim).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }));
      expect(props.onDone).toHaveBeenCalled();
    });

    it('writes to the seller when the plan is full', async () => {
      const full = Object.assign(new Error('Paketinizin cihaz sınırı dolu (5 cihaz).'), {
        deviceLimit: 5,
      });
      setup({ claim: vi.fn().mockRejectedValue(full) });
      await openForm();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('cihaz sınırı dolu');
      expect(screen.getByRole('link', { name: 'Ek cihaz için WhatsApp’tan yazın' })).toBeVisible();
    });

    it('shows an expired licence and offers the seller', async () => {
      setup({
        claim: vi.fn().mockRejectedValue(
          Object.assign(new Error('Lisansın süresi doldu; yeni cihaz bağlanamaz.'), {
            licenseExpired: true,
          }),
        ),
      });
      await openForm();
      await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
      await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Lisansın süresi doldu');
      expect(screen.getByRole('link', { name: /WhatsApp/ })).toBeVisible();
    });

    it('goes back to the choices', async () => {
      setup();
      await openForm();
      await userEvent.click(screen.getByRole('button', { name: 'Geri' }));
      expect(screen.getByRole('button', { name: 'Restoran kur' })).toBeVisible();
    });
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

  it('greets with the Restoran Kasa mark, from the build', () => {
    setup();
    expect(document.querySelector('main img[src^="data:image/svg+xml"]')).not.toBeNull();
  });

  it('clears the flag an earlier offline try left behind', () => {
    const stored = new Map([['rk.welcomeSkipped', '1']]);
    forgetSkippedWelcome({ removeItem: (key: string) => void stored.delete(key) });
    expect(stored.has('rk.welcomeSkipped')).toBe(false);
  });
});
