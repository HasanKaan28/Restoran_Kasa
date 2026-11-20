import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionContext, type Session } from '@/app/session';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, markReady, openTab, sendTab } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { saveNotifyPrefs, DEFAULT_NOTIFY_PREFS } from './prefs';
import { ReadyBanner } from './ReadyBanner';
import { ReadyNotifier } from './ReadyNotifier';
import type { ReadyNotice } from './readyNotices';

const notice = (id: string, title: string, station: ReadyNotice['station']): ReadyNotice => ({
  id,
  tabId: `tab-${id}`,
  title,
  station,
  lines: [
    { label: 'Adana kebap', qtyMilli: 2000, unit: 'piece' },
    { label: 'Ayran', qtyMilli: 1000, unit: 'piece' },
  ],
  itemIds: [],
});

describe('ReadyBanner', () => {
  it('says which table is ready, what, and from where; a tap opens it, the cross puts it away', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReadyBanner
        notices={[notice('a', 'Masa 5', 'kitchen'), notice('b', 'Paket 2', 'bar')]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    const region = screen.getByRole('region', { name: 'Hazır siparişler' });
    expect(region).toHaveTextContent('Masa 5 hazır');
    expect(region).toHaveTextContent('Mutfak');
    expect(region).toHaveTextContent('2 × Adana kebap, 1 × Ayran');
    expect(region).toHaveTextContent('Bar');

    await userEvent.click(
      within(region).getByRole('button', {
        name: 'Masa 5 hazır: 2 × Adana kebap, 1 × Ayran. Adisyonu aç',
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab-a' }));
    await userEvent.click(within(region).getByRole('button', { name: 'Paket 2 hazır: kapat' }));
    expect(onDismiss).toHaveBeenCalledWith('b');
  });

  it('is an empty live region when there is nothing to say', () => {
    render(<ReadyBanner notices={[]} onOpen={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('region', { name: 'Hazır siparişler' })).toBeEmptyDOMElement();
  });
});

describe('ReadyNotifier', () => {
  const session = (staffId: string | null): Session => ({
    staff: staffId ? ({ id: staffId, name: 'Ayşe' } as Session['staff']) : null,
    open: staffId === null,
    can: () => true,
    signIn: () => {},
    signOut: () => {},
  });

  async function orderAtTableFive(data: ReturnType<typeof createTestData>) {
    const kebab = await createProduct(
      data.db,
      { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
      new Date(),
    );
    const table = await createDiningTable(data.db, { name: '5', area: 'Salon' }, new Date());
    const waiter = { deviceCode: 'K7', staffId: 'ayse' };
    const tab = await openTab(data.db, { tableId: table.id, ...waiter }, new Date());
    const line = await addTabItem(data.db, tab.id, kebab, { qtyMilli: 2000 }, waiter, new Date());
    await sendTab(data.db, tab.id, new Date());
    return { tab, line };
  }

  it('shows the waiter the kitchen’s "ready" for their order, and opens the tab on a tap', async () => {
    saveNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, sound: false, vibrate: false });
    const data = createTestData();
    const { tab, line } = await orderAtTableFive(data);
    await renderWithData(
      <SessionContext value={session('ayse')}>
        <ReadyNotifier route="tables" groupMs={10} />
      </SessionContext>,
      data,
    );
    const region = screen.getByRole('region', { name: 'Hazır siparişler' });
    // The first look only learns what is there.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await markReady(data.db, [line.id], new Date(), 'M1');

    await waitFor(() => expect(region).toHaveTextContent('Masa 5 hazır'));
    expect(region).toHaveTextContent('2 × Adana kebap');
    await userEvent.click(within(region).getByRole('button', { name: /Adisyonu aç/ }));
    expect(window.location.hash).toBe(`#/tables/${tab.id}`);
    expect(region).toBeEmptyDOMElement();
  });

  it('keeps a kitchen screen quiet', async () => {
    const data = createTestData();
    const { line } = await orderAtTableFive(data);
    saveNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, scope: 'all', sound: false, vibrate: false });
    await renderWithData(
      <SessionContext value={session(null)}>
        <ReadyNotifier route="kitchen" groupMs={10} />
      </SessionContext>,
      data,
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    await markReady(data.db, [line.id], new Date(), 'M1');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(screen.getByRole('region', { name: 'Hazır siparişler' })).toBeEmptyDOMElement();
  });
});
