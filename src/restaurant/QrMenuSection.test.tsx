import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiningTable } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import type { QrMenuState } from '@/server/qrMenu';
import { QrMenuPanel } from './QrMenuSection';

const PAGE = 'https://restorankasa.vercel.app/app/menu.html';
const SLUG = 'Ab3dEf6hIj9kLm2nOp4qRs7tUvWx';

afterEach(() => {
  document.getElementById('print-root')?.remove();
});

function setup(initial: QrMenuState, overrides: Partial<Parameters<typeof QrMenuPanel>[0]> = {}) {
  const change = vi.fn<Parameters<typeof QrMenuPanel>[0]['change']>();
  const onDone = vi.fn();
  const print = vi.fn();
  const copy = vi.fn(() => Promise.resolve());
  const props = {
    marketName: 'Kebapçı Halil',
    load: () => Promise.resolve(initial),
    change,
    onDone,
    page: PAGE,
    print,
    copy,
    ...overrides,
  };
  return { props, change, onDone, print, copy };
}

async function signInAsOwner(user: ReturnType<typeof userEvent.setup>, button: string) {
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('E-posta'), 'sahip@example.com');
  await user.type(within(dialog).getByLabelText('Şifre'), 'gizli123');
  await user.click(within(dialog).getByRole('button', { name: button }));
}

describe('Settings → QR menü', () => {
  it('turns the menu on with the owner’s sign-in and shows its link', async () => {
    const user = userEvent.setup();
    const { props, change, onDone } = setup({ enabled: false, slug: null });
    change.mockResolvedValue({ enabled: true, slug: SLUG });
    await renderWithData(<QrMenuPanel {...props} />);

    const toggle = await screen.findByRole('switch', { name: 'QR menü' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('Menü bağlantısı')).not.toBeInTheDocument();

    await user.click(toggle);
    await signInAsOwner(user, 'Menüyü aç');

    expect(change).toHaveBeenCalledWith({
      email: 'sahip@example.com',
      password: 'gizli123',
      change: { enabled: true },
    });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Menü bağlantısı')).toHaveValue(`${PAGE}#${SLUG}`);
    expect(screen.getByRole('link', { name: 'Önizle' })).toHaveAttribute('href', `${PAGE}#${SLUG}`);
    expect(onDone).toHaveBeenCalledWith('QR menü açıldı.');
  });

  it('keeps the dialog open and says why when the owner’s sign-in fails', async () => {
    const user = userEvent.setup();
    const { props, change } = setup({ enabled: true, slug: SLUG });
    change.mockRejectedValue(new Error('E-posta ya da şifre yanlış.'));
    await renderWithData(<QrMenuPanel {...props} />);

    await user.click(await screen.findByRole('switch', { name: 'QR menü' }));
    await signInAsOwner(user, 'Menüyü kapat');

    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta ya da şifre yanlış.');
    // The page behind the dialog is hidden from assistive technology while it is open.
    expect(screen.getByRole('switch', { name: 'QR menü', hidden: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('copies the link', async () => {
    const user = userEvent.setup();
    const { props, copy, onDone } = setup({ enabled: true, slug: SLUG });
    await renderWithData(<QrMenuPanel {...props} />);

    await user.click(await screen.findByRole('button', { name: 'Kopyala' }));
    expect(copy).toHaveBeenCalledWith(`${PAGE}#${SLUG}`);
    expect(onDone).toHaveBeenCalledWith('Bağlantı kopyalandı.');
  });

  it('makes a new link only after warning that the printed cards stop working', async () => {
    const user = userEvent.setup();
    const { props, change } = setup({ enabled: true, slug: SLUG });
    change.mockResolvedValue({ enabled: true, slug: 'YeniBaglanti0123456789abcd' });
    await renderWithData(<QrMenuPanel {...props} />);

    await user.click(await screen.findByRole('button', { name: 'Bağlantıyı yenile' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('basılmış masa kartları çalışmaz');
    await signInAsOwner(user, 'Yeni bağlantı oluştur');

    expect(change).toHaveBeenCalledWith(expect.objectContaining({ change: 'rotate' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Menü bağlantısı')).toHaveValue(
        `${PAGE}#YeniBaglanti0123456789abcd`,
      ),
    );
  });

  it('prints one card per table, each with its own QR code', async () => {
    const user = userEvent.setup();
    const data = createTestData();
    for (const name of ['1', '2', 'B1']) {
      await createDiningTable(data.db, { name, area: 'Salon' }, new Date());
    }
    const { props, print } = setup({ enabled: true, slug: SLUG });
    await renderWithData(<QrMenuPanel {...props} />, data);

    await user.click(await screen.findByRole('button', { name: 'Masa kartlarını yazdır' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('B1');
    await user.click(within(dialog).getByLabelText('B1'));
    expect(within(dialog).getByText('2 kart · 1 sayfa')).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Genel kart (masasız)'));
    await user.click(within(dialog).getByRole('button', { name: 'Yazdır' }));

    expect(print).toHaveBeenCalledTimes(1);
    const printed = within(document.getElementById('print-root') as HTMLElement);
    const codes = printed.getAllByRole('img');
    expect(codes.map((code) => code.getAttribute('aria-label'))).toEqual([
      `QR kod: ${PAGE}?masa=1#${SLUG}`,
      `QR kod: ${PAGE}?masa=2#${SLUG}`,
      `QR kod: ${PAGE}#${SLUG}`,
    ]);
    expect(printed.getByText('Masa 1')).toBeInTheDocument();
    expect(printed.getAllByText('Kebapçı Halil')).toHaveLength(3);
    expect(printed.getAllByText('Menüyü görmek için okutun')).toHaveLength(3);
    expect(document.getElementById('print-page')?.textContent).toBe(
      '@page { size: A4; margin: 0; }',
    );
    window.dispatchEvent(new Event('afterprint'));
  });

  it('offers to try again when the link could not be read', async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<() => Promise<QrMenuState>>()
      .mockRejectedValueOnce(new Error('Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.'))
      .mockResolvedValueOnce({ enabled: true, slug: SLUG });
    const { props } = setup({ enabled: false, slug: null }, { load });
    await renderWithData(<QrMenuPanel {...props} />);

    expect(await screen.findByText(/Bağlantı kurulamadı/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByLabelText('Menü bağlantısı')).toHaveValue(`${PAGE}#${SLUG}`);
  });
});
