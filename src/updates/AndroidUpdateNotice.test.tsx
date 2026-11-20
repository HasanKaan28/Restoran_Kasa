import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APK_URL } from '@/settings/updates';
import { AndroidUpdateNotice } from './AndroidUpdateNotice';
import { createReleaseWatch, type Found } from './releaseWatch';
import { START_DELAY_MS } from './schedule';
import { isSnoozed, snoozeRelease } from './updateTimes';

async function found(version: string | null) {
  const watch = createReleaseWatch({
    find: async (): Promise<Found | null> => (version ? { version } : null),
    storage: localStorage,
  });
  await act(() => watch.check());
  return watch;
}

beforeEach(() => {
  localStorage.clear();
  // A tap on the download link would leave the page.
  document.addEventListener('click', preventNavigation);
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function preventNavigation(event: MouseEvent) {
  if ((event.target as Element).closest('a')) {
    event.preventDefault();
  }
}

describe('AndroidUpdateNotice', () => {
  it('offers a newer release to download and install, without stopping the work', async () => {
    render(<AndroidUpdateNotice watch={await found('1.2.0')} schedule={false} />);
    const notice = screen.getByRole('region', { name: 'Yeni sürüm 1.2.0 hazır' });
    expect(notice).toHaveTextContent('Verileriniz telefonda kalır');
    const link = screen.getByRole('link', { name: 'İndir ve kur' });
    expect(link).toHaveAttribute('href', APK_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Sonra' })).toBeInTheDocument();
  });

  it('explains the one-time "Bu kaynaktan izin ver" step once the download starts', async () => {
    render(<AndroidUpdateNotice watch={await found('1.2.0')} schedule={false} />);
    await userEvent.click(screen.getByRole('link', { name: 'İndir ve kur' }));
    const notice = screen.getByRole('region', { name: 'Kurulum için son adım' });
    expect(notice).toHaveTextContent('Restoran-Kasa.apk');
    expect(notice).toHaveTextContent('Bu kaynaktan izin ver');
    expect(notice).toHaveTextContent('Güncelle');
    await userEvent.click(screen.getByRole('button', { name: 'Tamam' }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('puts the release off for a day on this phone with "Sonra"', async () => {
    const watch = await found('1.2.0');
    const { unmount } = render(<AndroidUpdateNotice watch={watch} schedule={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sonra' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(isSnoozed(localStorage, '1.2.0', Date.now())).toBe(true);
    unmount();
    render(<AndroidUpdateNotice watch={watch} schedule={false} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('lets a still newer release through a snooze', async () => {
    snoozeRelease(localStorage, '1.2.0', Date.now());
    render(<AndroidUpdateNotice watch={await found('1.3.0')} schedule={false} />);
    expect(screen.getByRole('region', { name: 'Yeni sürüm 1.3.0 hazır' })).toBeInTheDocument();
  });

  it('never shows during an open payment dialog', async () => {
    document.body.innerHTML = '<div role="dialog">Ödeme al</div>';
    render(<AndroidUpdateNotice watch={await found('1.2.0')} schedule={false} />);
    expect(screen.queryByRole('region', { name: /Yeni sürüm/ })).toBeNull();
  });

  it('says nothing when the phone has the latest release', async () => {
    render(<AndroidUpdateNotice watch={await found(null)} schedule={false} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('looks for a release when the app starts', async () => {
    vi.useFakeTimers();
    const find = vi.fn(async () => null);
    const watch = createReleaseWatch({ find, storage: localStorage });
    render(<AndroidUpdateNotice watch={watch} />);
    await act(async () => vi.advanceTimersByTime(START_DELAY_MS));
    expect(find).toHaveBeenCalledTimes(1);
  });
});
