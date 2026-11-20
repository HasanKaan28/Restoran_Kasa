import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppData } from '@/app/appData';
import { DataProvider } from '@/app/DataProvider';
import { DEFAULT_DEVICE } from '@/app/device';
import { createProduct } from '@/data/products';
import { FakeServer } from '@/sync/fakeServer';
import { MoveBanner, NEW_ADDRESS } from './MoveBanner';

const made: { db: { delete(): Promise<void> } }[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((data) => data.db.delete()));
});

/** A paired register with one record waiting to sync, on a server that answers. */
async function pairedRegister() {
  const server = new FakeServer();
  const data = createAppData(
    { ...DEFAULT_DEVICE, marketId: `test-${crypto.randomUUID()}`, paired: true },
    { transport: server, isOnline: () => true },
  );
  made.push(data);
  await createProduct(data.db, { name: 'Ayran', sellPrice: 4000, vatRate: 1 }, new Date());
  return data;
}

describe('the move off the shared GitHub Pages address', () => {
  it('shows nothing on the app’s own address', async () => {
    const data = await pairedRegister();
    render(
      <DataProvider value={data}>
        <MoveBanner hostname="restorankasa.vercel.app" />
      </DataProvider>,
    );
    expect(screen.queryByText(/Uygulamanın yeni adresi/)).toBeNull();
  });

  it('says where the app lives now, syncs what waits, explains the sign-in, then opens it', async () => {
    const data = await pairedRegister();
    const go = vi.fn();
    render(
      <DataProvider value={data}>
        <MoveBanner hostname="hasankaan28.github.io" go={go} />
      </DataProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Uygulamanın yeni adresi: restorankasa.vercel.app/app/',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Taşı' }));
    const move = await screen.findByRole('dialog', { name: 'Yeni adrese taşı' });
    expect(await within(move).findByText('1 kayıt eşitlenmeyi bekliyor.')).toBeInTheDocument();
    expect(move).toHaveTextContent('Restorana giriş yap');
    expect(move).toHaveTextContent('Yerine geç');
    expect(move).toHaveTextContent('K1');
    const open = within(move).getByRole('button', { name: 'Yeni adresi aç' });
    expect(open).toBeDisabled();

    await userEvent.click(within(move).getByRole('button', { name: 'Şimdi eşitle' }));
    expect(await within(move).findByText('Bekleyen kayıt yok.')).toBeInTheDocument();
    await waitFor(() => expect(open).toBeEnabled());
    await userEvent.click(open);
    expect(go).toHaveBeenCalledWith(NEW_ADDRESS);
    // Nothing here is deleted: the old address keeps its data.
    expect(await data.db.products.count()).toBe(1);
  });

  it('sends a device not set up yet straight to the new address', async () => {
    const go = vi.fn();
    render(<MoveBanner hostname="hasankaan28.github.io" fresh go={go} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yeni adresi aç' }));
    expect(go).toHaveBeenCalledWith(NEW_ADDRESS);
  });

  it('tells a register that does not sync to keep a backup before leaving', async () => {
    const data = createAppData({ ...DEFAULT_DEVICE, marketId: `test-${crypto.randomUUID()}` });
    made.push(data);
    render(
      <DataProvider value={data}>
        <MoveBanner hostname="hasankaan28.github.io" go={vi.fn()} />
      </DataProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Taşı' }));
    const move = await screen.findByRole('dialog', { name: 'Yeni adrese taşı' });
    expect(move).toHaveTextContent('Bu cihaz sunucuyla eşitlenmiyor');
    expect(within(move).getByRole('button', { name: 'Yeni adresi aç' })).toBeEnabled();
  });
});
