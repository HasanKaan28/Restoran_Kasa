import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActivationCode, OperatorClient, Restaurant } from './api';
import { AdminApp } from './AdminApp';

type Answer = (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } };

/** A stand-in for the seller's Supabase client: a session, and each RPC answered by a function. */
function fakeClient(answers: Record<string, Answer>, signedIn = false) {
  let session: { user: { email: string } } | null = signedIn
    ? { user: { email: 'satici@example.com' } }
    : null;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const auth = {
    getSession: vi.fn(async () => ({ data: { session } })),
    signInWithPassword: vi.fn(async ({ email }: { email: string }) => {
      session = { user: { email } };
      return { data: { session }, error: null };
    }),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => {
      session = null;
      return { error: null };
    }),
  };
  const client = {
    auth,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      const answer = answers[fn]?.(args) ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as OperatorClient;
  return { client, calls, auth };
}

const code = (fields: Partial<ActivationCode>): ActivationCode => ({
  code: 'RK-AAAA-BBBB-CCCC',
  plan: 'restoran',
  planName: 'Restoran',
  days: 365,
  note: null,
  createdAt: '2026-11-19T10:00:00Z',
  usedAt: null,
  revokedAt: null,
  marketId: null,
  marketName: null,
  status: 'unused',
  ...fields,
});

const restaurant = (fields: Partial<Restaurant>): Restaurant => ({
  id: 'kebapci-halil-ab12cd',
  name: 'Kebapçı Halil',
  status: 'active',
  plan: 'restoran',
  planName: 'Restoran',
  maxDevices: 5,
  createdAt: '2026-11-01T10:00:00Z',
  licenseExpiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
  devices: 2,
  lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  ownerEmail: 'halil@example.com',
  ...fields,
});

const operator = (extra: Record<string, Answer> = {}) => ({
  operator_whoami: () => ({ data: true }),
  list_activation_codes: () => ({ data: [] }),
  list_markets: () => ({ data: [] }),
  ...extra,
});

describe('the yönetim page', () => {
  it('signs the seller in and opens the codes', async () => {
    const fake = fakeClient(operator());
    render(<AdminApp client={fake.client} />);
    await userEvent.type(await screen.findByLabelText('E-posta'), 'satici@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(await screen.findByRole('heading', { name: 'Yeni kurulum kodu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Kodlar' })).toHaveAttribute('aria-selected', 'true');
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'satici@example.com',
      password: 'gizli-sifre',
    });
  });

  it('tells an account that is not an operator so, and shows nothing else', async () => {
    const fake = fakeClient({ operator_whoami: () => ({ data: false }) }, true);
    render(<AdminApp client={fake.client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu hesap yönetici değil.');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(fake.calls.map((call) => call.fn)).toEqual(['operator_whoami']);
  });

  it('opens an account for the first visit and says it sees nothing until it is made operator', async () => {
    const fake = fakeClient(operator());
    render(<AdminApp client={fake.client} />);
    await userEvent.click(await screen.findByText('Hesap oluştur'));
    expect(screen.getByText(/yönetici olarak işaretlenene kadar hiçbir şey göremez/)).toBeVisible();
    await userEvent.type(screen.getByLabelText('E-posta'), 'satici@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'E-postanıza gelen bağlantıya tıklayın, sonra buradan giriş yapın.',
    );
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'satici@example.com', password: 'gizli-sifre' }),
    );
  });

  it('issues a code and hands it over: big, to copy, and as a WhatsApp message', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fake = fakeClient(
      operator({ issue_activation_code: () => ({ data: 'RK-ABCD-EFGH-JKMN' }) }),
      true,
    );
    render(<AdminApp client={fake.client} />);
    await userEvent.selectOptions(await screen.findByLabelText('Paket'), 'qr');
    await userEvent.click(screen.getByText('6 ay sezon'));
    await userEvent.type(screen.getByLabelText('Not'), 'Kebapçı Halil, Adana');
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));

    const issued = await screen.findByRole('status', { name: 'Üretilen kod' });
    expect(within(issued).getByText('RK-ABCD-EFGH-JKMN')).toBeInTheDocument();
    expect(within(issued).getByText('QR Menü · 6 ay sezon')).toBeInTheDocument();
    expect(fake.calls.find((call) => call.fn === 'issue_activation_code')?.args).toEqual({
      plan_id: 'qr',
      days: 183,
      note: 'Kebapçı Halil, Adana',
    });
    expect(within(issued).getByRole('link', { name: 'WhatsApp’ta gönder' })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent(
        'Restoran Kasa kurulum kodunuz: RK-ABCD-EFGH-JKMN\nUygulama: https://restorankasa.vercel.app/app/ → Restoran kur',
      )}`,
    );
    await userEvent.click(within(issued).getByRole('button', { name: 'Kopyala' }));
    expect(writeText).toHaveBeenCalledWith('RK-ABCD-EFGH-JKMN');
    expect(await within(issued).findByRole('button', { name: 'Kopyalandı' })).toBeInTheDocument();
  });

  it('takes a custom number of days and refuses one out of range', async () => {
    const fake = fakeClient(
      operator({ issue_activation_code: () => ({ data: 'RK-ABCD-EFGH-JKMN' }) }),
      true,
    );
    render(<AdminApp client={fake.client} />);
    await userEvent.click(await screen.findByText('Özel'));
    await userEvent.type(screen.getByLabelText('Gün sayısı'), '4000');
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Süre 1 ile 3660 gün arasında olmalı.');
    await userEvent.clear(screen.getByLabelText('Gün sayısı'));
    await userEvent.type(screen.getByLabelText('Gün sayısı'), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));
    expect(await screen.findByText('Restoran · 45 gün')).toBeInTheDocument();
  });

  it('lists the codes with what became of each, and revokes an unused one', async () => {
    let codes = [
      code({ code: 'RK-NEWW-CODE-2222' }),
      code({ code: 'RK-USED-CODE-3333', status: 'used', marketName: 'Kebapçı Halil' }),
      code({ code: 'RK-GONE-CODE-4444', status: 'revoked' }),
    ];
    const fake = fakeClient(
      operator({
        list_activation_codes: () => ({ data: codes }),
        revoke_activation_code: ({ code: revoked }) => {
          codes = codes.map((item) =>
            item.code === revoked ? { ...item, status: 'revoked' as const } : item,
          );
          return {};
        },
      }),
      true,
    );
    render(<AdminApp client={fake.client} />);
    // A busy machine may take a while for the session, the operator check and the list.
    const list = await screen.findByRole('list', {}, { timeout: 5000 });
    const unused = within(list).getByText('RK-NEWW-CODE-2222').closest('li') as HTMLElement;
    expect(within(unused).getByText('Kullanılmadı')).toBeInTheDocument();
    expect(within(list).getByText('Kullanıldı · Kebapçı Halil')).toBeInTheDocument();
    expect(within(list).getByText('İptal')).toBeInTheDocument();

    await userEvent.click(within(unused).getByRole('button', { name: 'İptal et…' }));
    await userEvent.click(within(unused).getByRole('button', { name: 'İptal et' }));
    expect(fake.calls.find((call) => call.fn === 'revoke_activation_code')?.args).toEqual({
      code: 'RK-NEWW-CODE-2222',
    });
    await waitFor(() => expect(within(list).getAllByText('İptal')).toHaveLength(2), {
      timeout: 5000,
    });
  });

  it('lists the restaurants, extends a licence and changes a plan', async () => {
    const fake = fakeClient(
      operator({
        list_markets: () => ({
          data: [
            restaurant({}),
            restaurant({
              id: 'grenn-bar',
              name: 'Grenn Bar',
              licenseExpiresAt: null,
              ownerEmail: null,
              devices: 3,
            }),
          ],
        }),
        extend_license: () => ({ data: { licenseExpiresAt: '2027-12-31T00:00:00Z' } }),
        set_market_plan: () => ({}),
      }),
      true,
    );
    render(<AdminApp client={fake.client} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Restoranlar' }));
    const halil = (await screen.findByRole('heading', { name: 'Kebapçı Halil' })).closest(
      'li',
    ) as HTMLElement;
    expect(within(halil).getByText('halil@example.com')).toBeInTheDocument();
    expect(within(halil).getByText('2 / 5 cihaz')).toBeInTheDocument();
    expect(within(halil).getByText(/^40 gün kaldı/)).toBeInTheDocument();
    expect(within(halil).getByText('3 saat önce')).toBeInTheDocument();

    await userEvent.click(within(halil).getByRole('button', { name: 'Süre uzat' }));
    await userEvent.click(within(halil).getByText('3 ay'));
    await userEvent.click(within(halil).getByRole('button', { name: 'Süreyi uzat' }));
    expect(fake.calls.find((call) => call.fn === 'extend_license')?.args).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      days: 90,
    });

    await userEvent.click(within(halil).getByRole('button', { name: 'Paket değiştir' }));
    await userEvent.selectOptions(within(halil).getByLabelText('Paket'), 'pro');
    await userEvent.click(within(halil).getByRole('button', { name: 'Paketi kaydet' }));
    expect(fake.calls.find((call) => call.fn === 'set_market_plan')?.args).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      plan_id: 'pro',
    });

    const grenn = screen.getByRole('heading', { name: 'Grenn Bar' }).closest('li') as HTMLElement;
    expect(within(grenn).getByText('Süresiz')).toBeInTheDocument();
    await userEvent.click(within(grenn).getByRole('button', { name: 'Süre uzat' }));
    expect(within(grenn).getByText(/lisansı süresiz; uzatmaya gerek yok/)).toBeInTheDocument();
    expect(within(grenn).queryByRole('button', { name: 'Süreyi uzat' })).toBeNull();
  });

  it('signs out', async () => {
    const fake = fakeClient(operator(), true);
    render(<AdminApp client={fake.client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Çıkış' }));
    expect(await screen.findByRole('button', { name: 'Giriş yap' })).toBeInTheDocument();
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
