import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab, sendTab } from '@/data/restaurant';
import { deliverTab } from '@/data/deliver';
import { createTestData, renderWithData } from '@/test/renderWithData';
import type { OrderSlip } from './orderSlip';
import { OrderSlipPrinter } from './OrderSlipPrinter';
import { OrderSlipsView } from './OrderSlipView';
import { printOrderSlips } from './printOrderSlips';
import { chooseSlipMode } from './slipPrefs';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { marketKasa?: unknown }).marketKasa;
  document.getElementById('print-root')?.remove();
});

const slip: OrderSlip = {
  id: 'tab-1@2026-11-22T18:05:00.000Z',
  tabId: 'tab-1',
  title: 'Masa 5',
  waiters: ['Ali'],
  devices: [],
  sentAt: '2026-11-22T18:05:00.000Z',
  delivered: true,
  lines: [
    { label: 'Efes', qtyMilli: 5000, unit: 'piece', details: [] },
    { label: 'Adana kebap', qtyMilli: 1000, unit: 'piece', details: ['Acısız', 'Not: Az pişmiş'] },
  ],
};

async function fiveBeers(data: ReturnType<typeof createTestData>, deliver: boolean) {
  const beer = await createProduct(
    data.db,
    { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' },
    new Date(),
  );
  const table = await createDiningTable(data.db, { name: '5', area: 'Salon' }, new Date());
  const waiter = { deviceCode: 'P1', staffId: 'ali' };
  const tab = await openTab(data.db, { tableId: table.id, ...waiter }, new Date());
  await addTabItem(data.db, tab.id, beer, { qtyMilli: 5000 }, waiter, new Date());
  await (deliver ? deliverTab : sendTab)(data.db, tab.id, new Date());
  return tab;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('OrderSlipPrinter', () => {
  it('prints each new order once as it comes in, and nothing from before it was turned on', async () => {
    const data = createTestData();
    const tab = await fiveBeers(data, true);
    await pause(5);
    chooseSlipMode('all', new Date());
    const print = vi.fn(async () => undefined);
    const { unmount } = await renderWithData(
      <OrderSlipPrinter settleMs={10} print={print} />,
      data,
    );
    await pause(80);
    expect(print).not.toHaveBeenCalled();

    // A phone hands five more beers over; sync brings them here.
    const beer = (await data.db.products.toArray())[0]!;
    await addTabItem(data.db, tab.id, beer, { qtyMilli: 5000 }, { deviceCode: 'P1' }, new Date());
    await deliverTab(data.db, tab.id, new Date());
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(print.mock.calls[0]).toEqual([
      [expect.objectContaining({ title: 'Masa 5', delivered: true })],
    ]);

    // Reloaded: nothing prints again.
    unmount();
    await renderWithData(<OrderSlipPrinter settleMs={10} print={print} />, data);
    await pause(80);
    expect(print).toHaveBeenCalledOnce();
  });

  it('prints nothing while off, which it is unless chosen', async () => {
    const data = createTestData();
    const print = vi.fn(async () => undefined);
    await renderWithData(<OrderSlipPrinter settleMs={10} print={print} />, data);
    await fiveBeers(data, true);
    await pause(80);
    expect(print).not.toHaveBeenCalled();
  });

  it('with "delivered only" leaves the orders sent to the kitchen or the bar', async () => {
    const data = createTestData();
    chooseSlipMode('delivered', new Date(Date.now() - 1000));
    const print = vi.fn(async () => undefined);
    await renderWithData(<OrderSlipPrinter settleMs={10} print={print} />, data);
    await fiveBeers(data, false);
    await pause(80);
    expect(print).not.toHaveBeenCalled();
  });
});

describe('OrderSlipsView', () => {
  it('shows what and how many, the table, who entered it, the day and the time', () => {
    render(<OrderSlipsView slips={[slip]} paperWidth={80} />);
    const printed = screen.getByRole('article', { name: 'Masa 5 siparişi' });
    expect(printed).toHaveTextContent('Teslim edildi');
    expect(printed).toHaveTextContent('Masa 5');
    expect(printed).toHaveTextContent('Garson: Ali');
    expect(printed).toHaveTextContent('22.11.2026');
    expect(printed).toHaveTextContent('21:05');
    expect(printed).toHaveTextContent('5 × Efes');
    expect(printed).toHaveTextContent('1 × Adana kebap');
    expect(printed).toHaveTextContent('Not: Az pişmiş');
  });

  it('calls an order sent to the kitchen a "Sipariş"', () => {
    render(
      <OrderSlipsView
        slips={[{ ...slip, delivered: false, waiters: [], devices: ['Kasa 1'] }]}
        paperWidth={58}
      />,
    );
    const printed = screen.getByRole('article', { name: 'Masa 5 siparişi' });
    expect(printed).toHaveTextContent('Sipariş');
    expect(printed).not.toHaveTextContent('Garson');
    // No waiter known: the device it was entered on says who.
    expect(printed).toHaveTextContent('Cihaz: Kasa 1');
  });
});

describe('printOrderSlips', () => {
  it('prints through the browser’s print window where there is no desktop app', async () => {
    const print = vi.fn(() => {
      expect(document.getElementById('print-root')).toHaveTextContent('5 × Efes');
      window.dispatchEvent(new Event('afterprint'));
    });
    vi.stubGlobal('print', print);
    await printOrderSlips([slip], 80);
    expect(print).toHaveBeenCalledOnce();
    expect(document.getElementById('print-root')).toBeNull();
  });

  it('prints with no window on the desktop app, and one order after the other', async () => {
    const browserPrint = vi.fn();
    vi.stubGlobal('print', browserPrint);
    const jobs: { text: string | null; finish: (printed: boolean) => void }[] = [];
    const silent = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          jobs.push({
            text: document.getElementById('print-root')?.textContent ?? null,
            finish: resolve,
          });
        }),
    );
    (window as { marketKasa?: unknown }).marketKasa = { print: { silent } };

    const first = printOrderSlips([slip], 80);
    const second = printOrderSlips([{ ...slip, title: 'Masa 6' }], 80);
    await waitFor(() => expect(silent).toHaveBeenCalledOnce());
    expect(jobs[0]?.text).toContain('Masa 5');

    // The second waits until the first is out of the printer.
    await pause(20);
    expect(silent).toHaveBeenCalledOnce();
    jobs[0]?.finish(true);
    await first;
    await waitFor(() => expect(silent).toHaveBeenCalledTimes(2));
    expect(jobs[1]?.text).toContain('Masa 6');
    jobs[1]?.finish(true);
    await second;
    expect(browserPrint).not.toHaveBeenCalled();
    expect(document.getElementById('print-root')).toBeNull();
  });

  it('opens the print window when the desktop app could not print on its own', async () => {
    const browserPrint = vi.fn(() => window.dispatchEvent(new Event('afterprint')));
    vi.stubGlobal('print', browserPrint);
    const silent = vi.fn(async () => false);
    (window as { marketKasa?: unknown }).marketKasa = { print: { silent } };
    await printOrderSlips([slip], 80);
    expect(silent).toHaveBeenCalledOnce();
    expect(browserPrint).toHaveBeenCalledOnce();
  });
});
