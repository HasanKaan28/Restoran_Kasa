import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab, sendTab, kitchenTickets } from '@/data/restaurant';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { KitchenScreen } from './KitchenScreen';
import { TablesScreen } from './TablesScreen';

afterEach(async () => {
  localStorage.clear();
  await disposeTestData();
});

async function restaurant() {
  const data = createTestData();
  const at = new Date();
  const table = await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  const adana = await createProduct(
    data.db,
    {
      name: 'Adana kebap',
      sellPrice: 45000,
      vatRate: 10,
      portions: [{ label: 'Yarım', price: 25000 }],
      optionGroups: [{ name: 'Acı', choices: ['Acılı', 'Acısız'], required: true }],
    },
    at,
  );
  const ezme = await createProduct(data.db, { name: 'Ezme', sellPrice: 11000, vatRate: 10 }, at);
  return { data, table, adana, ezme };
}

async function openTable(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('region', { name: 'Menü' });
}

describe('ordering a dish that asks', () => {
  it('asks the portion and the required choice, and shows them on the line', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    const menu = await openTable(/^S1, boş/);
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adana kebap' });
    await userEvent.click(within(dialog).getByRole('button', { name: /^Ekle/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Acı seçin.');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Yarım/ }));
    // The button says what the chosen portion costs.
    expect(within(dialog).getByRole('button', { name: /^Ekle/ })).toHaveTextContent('₺250,00');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Acısız' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Ekle/ }));

    const order = await screen.findByRole('region', { name: 'Adisyon' });
    expect(await within(order).findByText('Adana kebap (Yarım)')).toBeInTheDocument();
    expect(within(order).getByText('Acısız')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Kalan tutar')).toHaveTextContent('₺250,00'));
  });

  it('keeps a dish for the next course and fires it later', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    const menu = await openTable(/^S1, boş/);
    await userEvent.click(await within(menu).findByRole('button', { name: /Ezme/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Adana kebap/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adana kebap' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Acılı' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Beklet/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Ekle/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));

    const fire = await screen.findByRole('button', { name: 'Bekleyenleri gönder (1)' });
    let [ticket] = await kitchenTickets(data.db, 'kitchen');
    expect(ticket?.items.map((item) => item.name)).toEqual(['Ezme']);
    await userEvent.click(fire);
    await waitFor(async () => {
      [ticket] = await kitchenTickets(data.db, 'kitchen');
      expect(ticket?.items).toHaveLength(2);
    });
  });
});

describe('leaving an empty table', () => {
  it('closes a tab nothing was ordered on, so the table shows empty again', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await openTable(/^S1, boş/);
    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    // The tab closes first, then the floor reads it again: give a busy run time for both.
    expect(
      await screen.findByRole('button', { name: /^S1, boş/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await data.db.tabs.where('status').equals('open').count()).toBe(0);
  });
});

describe('the open tab’s address', () => {
  it('opens a table at #/tables/<id>, and the phone’s back gesture returns to the floor', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    const menu = await openTable(/^S1, boş/);
    await userEvent.click(await within(menu).findByRole('button', { name: /Ezme/ }));
    const [tab] = await data.db.tabs.where('status').equals('open').toArray();
    expect(window.location.hash).toBe(`#/tables/${tab?.id}`);

    window.history.back();
    expect(await screen.findByRole('button', { name: /^S1, dolu/ })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('reopens the tab its address names, as after a reload', async () => {
    const { data, table, ezme } = await restaurant();
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    window.history.replaceState(null, '', `#/tables/${tab.id}`);
    await renderWithData(<TablesScreen />, data);
    expect(await screen.findByRole('heading', { name: 'S1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    expect(await screen.findByRole('button', { name: /^S1, dolu/ })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/tables');
  });
});

describe('asking for the bill', () => {
  it('marks the table, locks the tab, and unlocks it again', async () => {
    const { data, table, ezme } = await restaurant();
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await renderWithData(<TablesScreen />, data);

    // A right click (or a long press) opens the table's actions.
    fireEvent.contextMenu(await screen.findByRole('button', { name: /^S1, dolu/ }));
    const actions = await screen.findByRole('dialog', { name: /S1/ });
    await userEvent.click(within(actions).getByRole('button', { name: 'Hesap iste' }));
    expect(await screen.findByRole('button', { name: /^S1, hesap istendi/ })).toBeInTheDocument();

    const menu = await openTable(/^S1, hesap istendi/);
    await userEvent.click(await within(menu).findByRole('button', { name: /Ezme/ }));
    expect(
      await screen.findByText('Hesap istendi. Sipariş eklemek için önce “Siparişe aç”a basın.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siparişe aç' }));
    await waitFor(async () =>
      expect((await data.db.tabs.get(tab.id))?.billRequestedAt).toBeUndefined(),
    );
  });
});

describe('the kitchen’s counts and recall', () => {
  it('counts what is still to make and brings back a ticket marked ready by mistake', async () => {
    const { data, table, ezme } = await restaurant();
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 2000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await renderWithData(<KitchenScreen />, data);

    const counts = await screen.findByRole('list', { name: 'Toplam' });
    expect(counts).toHaveTextContent('Ezme ×2');
    // The tickets and the counts are separate reads: wait for the ticket's button too.
    await userEvent.click(await screen.findByRole('button', { name: 'Hepsi hazır' }));
    expect(await screen.findByText('Bekleyen sipariş yok.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Son hazırı geri al' }));
    expect(await screen.findByRole('listitem', { name: 'S1' })).toBeInTheDocument();
  });
});
