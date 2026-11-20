import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseWatch, type Found } from '@/updates/releaseWatch';
import { saveCheckedAt } from '@/updates/updateTimes';
import { UpdateSection, type DesktopUpdates, type UpdateStatus } from './UpdateSection';

function desktop() {
  let listener: ((status: UpdateStatus) => void) | undefined;
  const bridge: DesktopUpdates = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    onStatus(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return { bridge, emit: (status: UpdateStatus) => act(() => listener?.(status)) };
}

function watching(find: () => Promise<Found | null>) {
  return createReleaseWatch({ find, storage: localStorage });
}

const RELEASES = 'https://github.com/HasanKaan28/Restoran_Kasa/releases';

beforeEach(() => localStorage.clear());

afterEach(() => {
  // A tap on a link would leave the page.
  document.body.innerHTML = '';
});

describe('UpdateSection on the desktop', () => {
  it('offers a newer desktop version and installs it', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.0" desktop={bridge} />);
    expect(bridge.check).toHaveBeenCalled();
    expect(screen.getByText('Sürüm 2.0.0')).toBeInTheDocument();

    emit({ kind: 'available', version: '2.0.1' });
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle (2.0.1)' }));
    expect(bridge.install).toHaveBeenCalled();

    emit({ kind: 'downloading', percent: 42 });
    expect(screen.getByRole('status')).toHaveTextContent('İndiriliyor %42');
    expect(screen.getByRole('button', { name: 'Denetle' })).toBeDisabled();
    emit({ kind: 'installing', version: '2.0.1' });
    expect(screen.getByRole('status')).toHaveTextContent('Kuruluyor; uygulama yeniden açılacak.');
  });

  it('says a downloaded update goes in when the app closes, and installs it now on a press', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.4" desktop={bridge} />);
    emit({ kind: 'ready', version: '2.0.5' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sürüm 2.0.5 indirildi; program kapanınca kendiliğinden kurulur.',
    );
    expect(screen.getByRole('link', { name: 'Neler yeni' })).toHaveAttribute(
      'href',
      `${RELEASES}/tag/v2.0.5`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Şimdi kur (2.0.5)' }));
    expect(bridge.install).toHaveBeenCalled();
  });

  it('says the desktop app is up to date or could not check, and checks again on "Denetle"', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateSection version="2.0.0" desktop={bridge} />);
    emit({ kind: 'current' });
    expect(screen.getByRole('status')).toHaveTextContent('Güncel');
    expect(screen.getByText('Son denetim: az önce')).toBeInTheDocument();
    emit({ kind: 'error' });
    expect(screen.getByRole('status')).toHaveTextContent('Güncelleme denetlenemedi.');
    await userEvent.click(screen.getByRole('button', { name: 'Denetle' }));
    expect(bridge.check).toHaveBeenCalledTimes(2);
  });
});

describe('UpdateSection on Android', () => {
  it('links a newer Android version for download', async () => {
    const watch = watching(async () => ({ version: '2.1.0' }));
    render(<UpdateSection version="2.0.0" android watch={watch} />);
    const link = await screen.findByRole('link', { name: 'İndir ve kur (2.1.0)' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/HasanKaan28/Restoran_Kasa/releases/latest/download/Restoran-Kasa.apk',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'İndirilen dosyayı açıp kurun; verileriniz kalır.',
    );
    expect(screen.getByRole('link', { name: 'Neler yeni' })).toHaveAttribute(
      'href',
      `${RELEASES}/tag/v2.1.0`,
    );
  });

  it('says an Android phone is up to date, and when it last checked', async () => {
    saveCheckedAt(localStorage, Date.now() - 3 * 24 * 60 * 60 * 1000);
    const find = vi.fn(async () => null);
    render(<UpdateSection version="2.1.0" android watch={watching(find)} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Güncel');
    expect(screen.getByText('Son denetim: az önce')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /İndir/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neler yeni' })).toHaveAttribute(
      'href',
      `${RELEASES}/latest`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Denetle' }));
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('says a check that could not reach GitHub failed', async () => {
    const watch = watching(async () => {
      throw new TypeError('offline');
    });
    render(<UpdateSection version="2.1.0" android watch={watch} />);
    expect(await screen.findByText('Güncelleme denetlenemedi.')).toBeInTheDocument();
    expect(screen.getByText('Henüz denetlenmedi')).toBeInTheDocument();
  });
});

describe('UpdateSection in the web app', () => {
  it('checks the deployed build and offers to reload into a newer one', async () => {
    const reload = vi.fn();
    const watch = watching(async () => ({ version: '2.0.0' }));
    render(<UpdateSection version="2.0.0" web watch={watch} reload={reload} />);
    expect(await screen.findByText('Yeni sürüm hazır; yenileyince açılır.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(reload).toHaveBeenCalled();
  });

  it('says the web app is up to date', async () => {
    render(<UpdateSection version="2.0.0" web watch={watching(async () => null)} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Güncel');
    expect(screen.getByRole('button', { name: 'Denetle' })).toBeEnabled();
  });
});

it('shows nothing where no platform updates', () => {
  const { container } = render(<UpdateSection version="2.0.0" />);
  expect(container).toBeEmptyDOMElement();
});
