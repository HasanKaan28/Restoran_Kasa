import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  activationCode,
  fakeOperatorClient,
  operatorAnswers,
  restaurantDetail,
  restaurantRow,
  type Answer,
} from '@/test/operatorClient';
import { AdminApp } from './AdminApp';
import type { LogEntry, RestaurantDetail } from './api';

const DAY_MS = 86_400_000;

function start(answers: Record<string, Answer> = {}) {
  const fake = fakeOperatorClient(operatorAnswers(answers), true);
  render(<AdminApp client={fake.client} />);
  return fake;
}

/** Opens Kebapçı Halil's detail from the restaurants tab. */
async function openDetail(detail: () => RestaurantDetail, extra: Record<string, Answer> = {}) {
  const fake = start({
    list_markets: () => ({ data: [restaurantRow({})] }),
    operator_market: () => ({ data: detail() }),
    ...extra,
  });
  await userEvent.click(await screen.findByRole('tab', { name: 'Restoranlar' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kebapçı Halil' }));
  await screen.findByRole('heading', { name: 'Kebapçı Halil', level: 2 });
  return fake;
}

/** The open dialog, once it is there. */
const dialog = () => screen.findByRole('dialog');

describe('the overview', () => {
  it('counts restaurants, codes and registers, and extends a licence ending soon in one tap', async () => {
    const fake = start({
      operator_overview: () => ({
        data: {
          restaurants: { total: 9, active: 6, suspended: 1, expiring: 2, expired: 2, deleted: 1 },
          codes: { issued: 20, used: 9, unused: 8, revoked: 3 },
          devices: { total: 14, seenToday: 11 },
          expiring: [
            {
              id: 'meyhane-deniz',
              name: 'Meyhane Deniz',
              status: 'active',
              planName: 'Restoran Pro',
              licenseExpiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
            },
          ],
        },
      }),
      extend_license: () => ({ data: { licenseExpiresAt: '2027-01-01T00:00:00Z' } }),
      operator_market: () => ({
        data: restaurantDetail({ id: 'meyhane-deniz', name: 'Meyhane Deniz' }),
      }),
    });

    const restaurants = await screen.findByRole('region', { name: 'Restoranlar' });
    expect(within(restaurants).getByText('Etkin').nextSibling).toHaveTextContent('6');
    expect(within(restaurants).getByText('7 günde bitiyor').nextSibling).toHaveTextContent('2');
    expect(
      within(screen.getByRole('region', { name: 'Kodlar' })).getByText('Bekleyen').nextSibling,
    ).toHaveTextContent('8');
    expect(
      within(screen.getByRole('region', { name: 'Cihazlar' })).getByText('Bağlı').nextSibling,
    ).toHaveTextContent('14');
    expect(screen.getByText('Silinmiş 1 restoran sayılara katılmadı.')).toBeInTheDocument();

    const soon = screen.getByRole('heading', { name: 'Süresi yaklaşanlar' })
      .parentElement as HTMLElement;
    expect(within(soon).getByText('3 gün kaldı')).toBeInTheDocument();
    await userEvent.click(within(soon).getByRole('button', { name: 'Meyhane Deniz: +1 ay' }));
    expect(fake.last('extend_license')).toEqual({ market_id: 'meyhane-deniz', days: 30 });
    expect(await within(soon).findByRole('status')).toHaveTextContent('Meyhane Deniz: yeni bitiş');

    await userEvent.click(within(soon).getByRole('button', { name: /^Meyhane Deniz.*kaldı/ }));
    expect(await screen.findByRole('heading', { name: 'Meyhane Deniz', level: 2 })).toBeVisible();
    expect(fake.last('operator_market')).toEqual({ market_id: 'meyhane-deniz' });
  });
});

describe('a restaurant’s detail', () => {
  it('shows the restaurant, its use as counts only, its registers and QR link', async () => {
    await openDetail(() => restaurantDetail({}));
    expect(screen.getByText('halil@example.com')).toBeInTheDocument();
    const usage = screen.getByRole('region', { name: 'Kullanım · son 30 gün' });
    expect(within(usage).getAllByText('Satış')[0]?.nextSibling).toHaveTextContent('412');
    expect(within(usage).getByText('Adisyon').nextSibling).toHaveTextContent('96');
    expect(within(usage).getByText('3 MB / 200 MB')).toBeInTheDocument();
    expect(within(usage).getByText('1.250')).toBeInTheDocument();

    const devices = screen.getByRole('region', { name: 'Cihazlar' });
    const live = within(devices).getByRole('listitem', { name: 'K2 · Bar tableti' });
    expect(within(live).getByText(/Android · eklendi/)).toBeInTheDocument();
    const revoked = within(devices).getByRole('listitem', { name: 'K1 · Eski kasa' });
    expect(within(revoked).getByText('İptal edildi')).toBeInTheDocument();
    expect(within(revoked).queryByRole('button')).toBeNull();

    const qr = screen.getByRole('region', { name: 'QR menü' });
    expect(within(qr).getByText(/#AbCdEfGhIjKlMnOpQrStUvWxYz$/)).toBeInTheDocument();
  });

  it('revokes a register only after asking, and renames one', async () => {
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_revoke_device: () => ({}),
      operator_rename_device: () => ({}),
    });
    const live = screen.getByRole('listitem', { name: 'K2 · Bar tableti' });
    await userEvent.click(within(live).getByRole('button', { name: 'Cihazı iptal et…' }));
    const asked = await dialog();
    expect(asked).toHaveTextContent('Cihazdaki kayıtlar silinmez.');
    await userEvent.click(within(asked).getByRole('button', { name: 'Vazgeç' }));
    expect(fake.last('operator_revoke_device')).toBeUndefined();

    await userEvent.click(within(live).getByRole('button', { name: 'Cihazı iptal et…' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cihazı iptal et' }));
    expect(fake.last('operator_revoke_device')).toEqual({ device_id: 'd2' });

    await userEvent.click(within(live).getByRole('button', { name: 'Adını değiştir' }));
    const field = within(live).getByLabelText('Cihaz adı');
    await userEvent.clear(field);
    await userEvent.type(field, 'Teras');
    await userEvent.click(within(live).getByRole('button', { name: 'Adı kaydet' }));
    expect(fake.last('operator_rename_device')).toEqual({ device_id: 'd2', name: 'Teras' });
  });

  it('makes a support pairing code', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_create_pairing: () => ({
        data: { code: 'ABCD2345', expiresAt: new Date(Date.now() + 600_000).toISOString() },
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Bağlantı kodu üret' }));
    const made = await screen.findByRole('status', { name: 'Bağlantı kodu' });
    expect(within(made).getByText('ABCD2345')).toBeInTheDocument();
    expect(fake.last('operator_create_pairing')).toEqual({ market_id: 'kebapci-halil-ab12cd' });
    await userEvent.click(within(made).getByRole('button', { name: 'Kopyala' }));
    expect(writeText).toHaveBeenCalledWith('ABCD2345');
  });

  it('sets the licence end, asking before it ends sooner or never', async () => {
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_set_license: () => ({ data: { licenseExpiresAt: null } }),
    });
    const license = screen.getByRole('region', { name: 'Lisans ve paket' });
    await userEvent.click(within(license).getByRole('button', { name: 'Bitiş tarihi' }));

    // Later than now: saved straight away, to the end of that day in Turkey.
    const later = new Date(Date.now() + 400 * DAY_MS).toISOString().slice(0, 10);
    const day = within(license).getByLabelText('Lisansın son günü');
    await userEvent.clear(day);
    await userEvent.type(day, later);
    await userEvent.click(within(license).getByRole('button', { name: 'Tarihi kaydet' }));
    expect(fake.last('operator_set_license')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      expires_at: new Date(`${later}T23:59:59+03:00`).toISOString(),
    });

    // Sooner: asked first.
    await userEvent.click(within(license).getByRole('button', { name: 'Bitiş tarihi' }));
    const sooner = new Date(Date.now() + 5 * DAY_MS).toISOString().slice(0, 10);
    const again = within(license).getByLabelText('Lisansın son günü');
    await userEvent.clear(again);
    await userEvent.type(again, sooner);
    await userEvent.click(within(license).getByRole('button', { name: 'Tarihi kaydet' }));
    const asked = await dialog();
    expect(asked).toHaveTextContent('Lisans kısaltılsın mı?');
    await userEvent.click(within(asked).getByRole('button', { name: 'Kısalt' }));
    expect(fake.last('operator_set_license')?.expires_at).toBe(
      new Date(`${sooner}T23:59:59+03:00`).toISOString(),
    );

    // Without an end: asked too.
    await userEvent.click(within(license).getByRole('button', { name: 'Bitiş tarihi' }));
    await userEvent.click(within(license).getByRole('button', { name: 'Süresiz yap…' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Süresiz yap' }));
    expect(fake.last('operator_set_license')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      expires_at: null,
    });
  });

  it('gives the restaurant its own register limit, and back to the plan’s', async () => {
    let detail = restaurantDetail({});
    const fake = await openDetail(() => detail, {
      operator_set_max_devices: ({ max_devices }) => {
        detail = restaurantDetail({
          maxDevicesOverride: max_devices as number | null,
          maxDevices: (max_devices as number | null) ?? 5,
        });
        return { data: {} };
      },
    });
    const license = screen.getByRole('region', { name: 'Lisans ve paket' });
    await userEvent.click(within(license).getByRole('button', { name: 'Cihaz sınırı' }));
    const field = within(license).getByLabelText('Bu restorana özel cihaz sınırı');
    await userEvent.clear(field);
    await userEvent.type(field, '8');
    await userEvent.click(within(license).getByRole('button', { name: 'Sınırı kaydet' }));
    expect(fake.last('operator_set_max_devices')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      max_devices: 8,
    });
    expect(await screen.findByText('özel sınır', { exact: false })).toBeInTheDocument();
    await userEvent.click(within(license).getByRole('button', { name: 'Cihaz sınırı' }));
    await userEvent.click(within(license).getByRole('button', { name: 'Paketin sınırına dön' }));
    expect(fake.last('operator_set_max_devices')?.max_devices).toBeNull();
  });

  it('turns the QR menu off, and asks before giving it a new link', async () => {
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_set_qr_menu: () => ({ data: { enabled: false, slug: 'x' } }),
      operator_rotate_qr_menu: () => ({ data: { enabled: true, slug: 'y' } }),
    });
    const qr = screen.getByRole('region', { name: 'QR menü' });
    await userEvent.click(within(qr).getByRole('button', { name: 'QR menüyü kapat' }));
    expect(fake.last('operator_set_qr_menu')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      enabled: false,
    });
    await userEvent.click(within(qr).getByRole('button', { name: 'Yeni bağlantı…' }));
    const asked = await dialog();
    expect(asked).toHaveTextContent('masa kartları hemen çalışmaz');
    await userEvent.click(within(asked).getByRole('button', { name: 'Yeni bağlantı ver' }));
    expect(fake.last('operator_rotate_qr_menu')).toEqual({ market_id: 'kebapci-halil-ab12cd' });
  });

  it('keeps a private note and renames the restaurant', async () => {
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_set_note: () => ({}),
      operator_rename_market: () => ({ data: { name: 'Halil Usta' } }),
    });
    const note = screen.getByRole('region', { name: 'Özel not' });
    await userEvent.type(within(note).getByLabelText('Not'), 'Ödeme her ayın 5’inde.');
    await userEvent.click(within(note).getByRole('button', { name: 'Notu kaydet' }));
    expect(fake.last('operator_set_note')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      note: 'Ödeme her ayın 5’inde.',
    });
    expect(await within(note).findByRole('status')).toHaveTextContent('Not kaydedildi.');

    const rename = screen.getByRole('region', { name: 'Restoran adı' });
    const field = within(rename).getByLabelText('Ad');
    await userEvent.clear(field);
    await userEvent.type(field, 'Halil Usta');
    await userEvent.click(within(rename).getByRole('button', { name: 'Adı kaydet' }));
    expect(fake.last('operator_rename_market')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      name: 'Halil Usta',
    });
  });

  it('suspends after asking, and activates again', async () => {
    let detail = restaurantDetail({});
    const fake = await openDetail(() => detail, {
      operator_set_market_status: ({ status }) => {
        detail = restaurantDetail({ status: status as string });
        return { data: { status, deletedAt: null } };
      },
    });
    const state = screen.getByRole('region', { name: 'Durum' });
    await userEvent.click(within(state).getByRole('button', { name: 'Askıya al…' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Askıya al' }));
    expect(fake.last('operator_set_market_status')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      status: 'suspended',
    });
    await userEvent.click(await within(state).findByRole('button', { name: 'Etkinleştir' }));
    expect(fake.last('operator_set_market_status')?.status).toBe('active');
  });

  it('deletes softly, only once the restaurant’s name is typed', async () => {
    const fake = await openDetail(() => restaurantDetail({}), {
      operator_delete_market: () => ({ data: { deletedAt: '2026-11-27T10:00:00Z' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Restoranı sil…' }));
    const asked = await dialog();
    expect(asked).toHaveTextContent('Hiçbir veri silinmez');
    const confirm = within(asked).getByRole('button', { name: 'Restoranı sil' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(asked).getByLabelText('Onay için restoranın adını yazın'),
      'Kebapçı',
    );
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(asked).getByLabelText('Onay için restoranın adını yazın'),
      ' halil',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(fake.last('operator_delete_market')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      confirm_name: 'Kebapçı halil',
    });
  });

  it('goes back to the list', async () => {
    await openDetail(() => restaurantDetail({}));
    await userEvent.click(screen.getByRole('button', { name: 'Geri' }));
    expect(await screen.findByRole('heading', { name: 'Restoranlar' })).toBeInTheDocument();
  });
});

describe('the restaurant list', () => {
  it('shows each restaurant’s last 30 days, hides deleted ones until asked, and searches', async () => {
    start({
      list_markets: () => ({
        data: [
          restaurantRow({}),
          restaurantRow({
            id: 'gone',
            name: 'Kapanan Lokanta',
            status: 'suspended',
            deletedAt: '2026-11-20T10:00:00Z',
          }),
          restaurantRow({ id: 'deniz', name: 'Meyhane Deniz', ownerEmail: 'deniz@example.com' }),
        ],
      }),
      operator_activity: () => ({
        data: [
          {
            id: 'kebapci-halil-ab12cd',
            name: 'Kebapçı Halil',
            sales: 412,
            tabs: 96,
            activeDevices: 2,
          },
        ],
      }),
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Restoranlar' }));
    const halil = (await screen.findByRole('heading', { name: 'Kebapçı Halil' })).closest(
      'li',
    ) as HTMLElement;
    expect(within(halil).getByText('412 satış · 96 adisyon · 2 aktif cihaz')).toBeInTheDocument();
    expect(screen.queryByText('Kapanan Lokanta')).toBeNull();

    await userEvent.click(screen.getByLabelText('Silinenleri de göster (1)'));
    const gone = screen
      .getByRole('heading', { name: 'Kapanan Lokanta' })
      .closest('li') as HTMLElement;
    expect(within(gone).getByText('Silindi')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Restoran ara'), 'deniz@');
    await waitFor(() => expect(screen.queryByText('Kebapçı Halil')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Meyhane Deniz' })).toBeInTheDocument();
  });
});

describe('codes', () => {
  it('filters by state and searches the note', async () => {
    const fake = start({
      operator_list_codes: () => ({ data: [activationCode({ note: 'Adana' })] }),
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Kodlar' }));
    await screen.findByText('Adana');
    expect(fake.last('operator_list_codes')).toEqual({ lim: 200, status: null, search: null });
    await userEvent.click(screen.getByText('Kullanılmadı', { selector: 'label' }));
    await waitFor(() => expect(fake.last('operator_list_codes')?.status).toBe('unused'));
    await userEvent.type(screen.getByLabelText('Notta ara'), 'ada');
    await waitFor(() =>
      expect(fake.last('operator_list_codes')).toEqual({
        lim: 200,
        status: 'unused',
        search: 'ada',
      }),
    );
  });

  it('issues many codes at once and copies them all', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fake = start({
      operator_issue_codes: () => ({
        data: ['RK-AAAA-AAAA-AAAA', 'RK-BBBB-BBBB-BBBB', 'RK-CCCC-CCCC-CCCC'],
      }),
      operator_list_codes: () => ({
        data: [
          activationCode({ code: 'RK-AAAA-AAAA-AAAA', note: 'Fuar' }),
          activationCode({ code: 'RK-BBBB-BBBB-BBBB' }),
        ],
      }),
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Kodlar' }));
    const count = await screen.findByLabelText('Adet');
    await userEvent.clear(count);
    await userEvent.type(count, '3');
    await userEvent.type(screen.getByLabelText('Not'), 'Fuar');
    await userEvent.click(screen.getByRole('button', { name: '3 kod üret' }));
    expect(fake.last('operator_issue_codes')).toEqual({
      plan_id: 'restoran',
      days: 365,
      note: 'Fuar',
      count: 3,
    });
    const issued = await screen.findByRole('status', { name: 'Üretilen kodlar' });
    expect(within(issued).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(within(issued).getByRole('button', { name: 'Tümünü kopyala' }));
    expect(writeText).toHaveBeenLastCalledWith(
      'RK-AAAA-AAAA-AAAA\nRK-BBBB-BBBB-BBBB\nRK-CCCC-CCCC-CCCC',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Listedekileri kopyala' }));
    expect(writeText).toHaveBeenLastCalledWith('RK-AAAA-AAAA-AAAA · Fuar\nRK-BBBB-BBBB-BBBB');
  });

  it('refuses more than fifty codes at once', async () => {
    const fake = start();
    await userEvent.click(await screen.findByRole('tab', { name: 'Kodlar' }));
    const count = await screen.findByLabelText('Adet');
    await userEvent.clear(count);
    await userEvent.type(count, '51');
    await userEvent.click(screen.getByRole('button', { name: '51 kod üret' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Adet 1 ile 50 arasında olmalı.');
    expect(fake.last('operator_issue_codes')).toBeUndefined();
  });
});

describe('announcements', () => {
  it('sends a message to every restaurant or one, and takes one down after asking', async () => {
    const fake = start({
      list_markets: () => ({ data: [restaurantRow({})] }),
      operator_set_announcement: () => ({ data: { id: 'a1' } }),
      operator_remove_announcement: () => ({}),
      operator_list_announcements: () => ({
        data: [
          {
            id: 'a1',
            marketId: null,
            marketName: null,
            message: 'Yarın 02:00’de bakım var.',
            createdAt: '2026-11-27T09:00:00Z',
            expiresAt: null,
            removedAt: null,
            live: true,
          },
        ],
      }),
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Duyuru' }));
    await userEvent.type(await screen.findByLabelText('Mesaj'), 'Yarın 02:00’de bakım var.');
    await userEvent.click(screen.getByRole('button', { name: 'Duyuruyu yayınla' }));
    expect(fake.last('operator_set_announcement')).toEqual({
      market_id: null,
      message: 'Yarın 02:00’de bakım var.',
      days: 7,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('bütün restoranlara gönderildi');

    await screen.findByRole('option', { name: 'Kebapçı Halil' });
    await userEvent.selectOptions(screen.getByLabelText('Kime'), 'kebapci-halil-ab12cd');
    await userEvent.click(screen.getByText('Kaldırana kadar'));
    await userEvent.type(screen.getByLabelText('Mesaj'), 'Faturanız hazır.');
    await userEvent.click(screen.getByRole('button', { name: 'Duyuruyu yayınla' }));
    expect(fake.last('operator_set_announcement')).toEqual({
      market_id: 'kebapci-halil-ab12cd',
      message: 'Faturanız hazır.',
      days: null,
    });

    const listed = screen
      .getByText('Bütün restoranlar', { selector: 'li p' })
      .closest('li') as HTMLElement;
    expect(within(listed).getByText('Yayında · kaldırana kadar')).toBeInTheDocument();
    await userEvent.click(within(listed).getByRole('button', { name: 'Kaldır…' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Kaldır' }));
    expect(fake.last('operator_remove_announcement')).toEqual({ id: 'a1' });
  });
});

describe('the history', () => {
  const entry = (id: number): LogEntry => ({
    id,
    at: '2026-11-27T09:00:00Z',
    action: 'license.extend',
    marketId: 'kebapci-halil-ab12cd',
    marketName: 'Kebapçı Halil',
    operatorEmail: 'satici@example.com',
    details: { days: 30, to: '2027-01-01T00:00:00Z' },
  });

  it('lists what the operator changed, newest first, and pages back', async () => {
    const fake = start({
      operator_history: ({ before_id }) => ({
        data:
          before_id === null
            ? Array.from({ length: 50 }, (_, index) => entry(100 - index))
            : [entry(40)],
      }),
      operator_market: () => ({ data: restaurantDetail({}) }),
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Geçmiş' }));
    expect(await screen.findByRole('heading', { name: 'İşlem geçmişi' })).toBeInTheDocument();
    expect(await screen.findAllByText('Süre uzatıldı')).toHaveLength(50);
    expect(screen.getAllByText(/30 gün · yeni bitiş/)[0]).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Daha eskiler' }));
    await waitFor(() => expect(screen.getAllByText('Süre uzatıldı')).toHaveLength(51));
    expect(fake.last('operator_history')).toEqual({ lim: 50, before_id: 51, market_id: null });
    expect(screen.queryByRole('button', { name: 'Daha eskiler' })).toBeNull();

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Kebapçı Halil' })[0] as HTMLElement,
    );
    expect(await screen.findByRole('heading', { name: 'Kebapçı Halil', level: 2 })).toBeVisible();
  });
});
