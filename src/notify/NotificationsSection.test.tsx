import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSection } from './NotificationsSection';
import { DEFAULT_NOTIFY_PREFS, loadNotifyPrefs, NOTIFY_STORAGE_KEY } from './prefs';
import { TRY_NOTICE_EVENT } from './ReadyNotifier';

/** The web's Notification API, as a browser that has not been asked yet has it. */
function stubNotifications(answer: NotificationPermission) {
  const api = Object.assign(vi.fn(), {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn(async () => {
      api.permission = answer;
      return answer;
    }),
  });
  vi.stubGlobal('Notification', api);
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsSection', () => {
  it('keeps this device’s choices, and asks for the phone’s permission only when told to', async () => {
    const api = stubNotifications('granted');
    render(<NotificationsSection />);

    expect(await screen.findByText(/Cihaz bir kez sorar/)).toBeInTheDocument();
    expect(api.requestPermission).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Tüm hazırlar'));
    await userEvent.click(screen.getByLabelText('Ses'));
    expect(loadNotifyPrefs()).toEqual({ ...DEFAULT_NOTIFY_PREFS, scope: 'all', sound: false });

    await userEvent.click(screen.getByRole('button', { name: 'Bildirim izni ver' }));
    expect(api.requestPermission).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Telefon bildirimi açık/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bildirim izni ver' })).toBeNull();
  });

  it('says how to allow it again once refused', async () => {
    const api = stubNotifications('denied');
    api.permission = 'denied';
    render(<NotificationsSection />);
    expect(await screen.findByText(/izin verilmemiş/)).toBeInTheDocument();
  });

  it('turns every notice off, and sends a sample with "Dene" while on', async () => {
    stubNotifications('default');
    const tried = vi.fn();
    window.addEventListener(TRY_NOTICE_EVENT, tried);
    render(<NotificationsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Dene' }));
    expect(tried).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByLabelText('Hazır bildirimleri'));
    expect(JSON.parse(localStorage.getItem(NOTIFY_STORAGE_KEY) ?? '{}')).toMatchObject({
      enabled: false,
    });
    expect(screen.getByRole('button', { name: 'Dene' })).toBeDisabled();
    window.removeEventListener(TRY_NOTICE_EVENT, tried);
  });
});

describe('loadNotifyPrefs', () => {
  it('falls back to each default on its own when the stored value is broken', () => {
    expect(loadNotifyPrefs({ getItem: () => '{"scope":"all","sound":"yes"}' })).toEqual({
      ...DEFAULT_NOTIFY_PREFS,
      scope: 'all',
    });
    expect(loadNotifyPrefs({ getItem: () => 'not json' })).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(
      loadNotifyPrefs({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_NOTIFY_PREFS);
  });
});
