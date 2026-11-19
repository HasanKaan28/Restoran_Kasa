import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, kitchenTickets, openTab, sendTab } from '@/data/restaurant';
import { createStaff } from '@/data/staff';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { KitchenScreen } from './KitchenScreen';
import { TablesScreen } from './TablesScreen';

describe('a new owner’s first evening', () => {
  it('shows a setup list on the floor that follows the data and links to each place', async () => {
    const data = createTestData();
    await renderWithData(<TablesScreen />, data);
    const setup = await screen.findByRole('region', { name: 'Restoranı kuralım' });
    expect(within(setup).getByText('0 / 5 adım tamam')).toBeInTheDocument();
    expect(within(setup).getByRole('link', { name: /Masaları ekleyin/ })).toHaveAttribute(
      'href',
      '#/settings/masalar',
    );
    // The empty floor says what to do, with the way to do it.
    expect(await screen.findByRole('link', { name: 'Masaları ekle' })).toHaveAttribute(
      'href',
      '#/settings/masalar',
    );

    await createDiningTable(data.db, { name: '1', area: 'Salon' }, new Date());
    expect(
      await within(setup).findByText('1 / 5 adım tamam', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(setup).getByText('Masaları ekleyin').closest('li')).toHaveTextContent('(tamam)');
  });

  it('puts the list away for this restaurant on this device', async () => {
    const data = createTestData();
    const { unmount } = await renderWithData(<TablesScreen />, data);
    const setup = await screen.findByRole('region', { name: 'Restoranı kuralım' });
    await userEvent.click(within(setup).getByRole('button', { name: 'Kurulum listesini gizle' }));
    expect(screen.queryByRole('region', { name: 'Restoranı kuralım' })).not.toBeInTheDocument();
    unmount();

    await renderWithData(<TablesScreen />, data);
    await screen.findByRole('heading', { name: 'Masalar', level: 1 });
    expect(screen.queryByRole('region', { name: 'Restoranı kuralım' })).not.toBeInTheDocument();
  });

  it('is not shown to a waiter', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, new Date());
    const ayse = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234' },
      new Date(),
    );
    localStorage.setItem('rk.staff', ayse.id);
    await renderWithData(
      <SessionProvider>
        <TablesScreen />
      </SessionProvider>,
      data,
    );
    await screen.findByRole('heading', { name: 'Masalar', level: 1 });
    expect(screen.queryByRole('region', { name: 'Restoranı kuralım' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Masaları ekle' })).not.toBeInTheDocument();
  });
});

describe('the kitchen’s undo', () => {
  it('offers to take back a line marked ready by mistake, right where it was tapped', async () => {
    const data = createTestData();
    const table = await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, new Date());
    const ezme = await createProduct(
      data.db,
      { name: 'Ezme', sellPrice: 11000, vatRate: 10 },
      new Date(),
    );
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await renderWithData(<KitchenScreen />, data);

    const ticket = await screen.findByRole('listitem', { name: 'S1' });
    await userEvent.click(within(ticket).getByRole('button', { name: 'Hazır: Ezme' }));
    const toast = screen.getByRole('status', { name: 'Bildirim' });
    await waitFor(() => expect(toast).toHaveTextContent('Ezme hazır'));
    await userEvent.click(within(toast).getByRole('button', { name: 'Geri al' }));
    await waitFor(async () =>
      expect((await kitchenTickets(data.db, 'kitchen'))[0]?.items).toHaveLength(1),
    );
  });
});
