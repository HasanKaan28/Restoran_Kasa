import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseWatch } from './releaseWatch';
import { WebUpdateNotice } from './WebUpdateNotice';
import { useHoldUpdates } from './workGuard';

async function deployed() {
  const watch = createReleaseWatch({
    find: async () => ({ version: '1.0.0' }),
    storage: localStorage,
  });
  await act(() => watch.check());
  return watch;
}

/** A screen taking an order that has not gone to the kitchen yet. */
function OrderBeingTaken({ unsent }: { unsent: boolean }) {
  useHoldUpdates(unsent);
  return null;
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('WebUpdateNotice', () => {
  it('says a newer deploy is ready and reloads into it on a quiet screen', async () => {
    const reload = vi.fn();
    render(<WebUpdateNotice watch={await deployed()} schedule={false} reload={reload} />);
    expect(screen.getByRole('region', { name: 'Yeni sürüm hazır' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads over an unsent order: it waits until the order is sent', async () => {
    const reload = vi.fn();
    const watch = await deployed();
    vi.useFakeTimers();
    const { rerender } = render(
      <>
        <OrderBeingTaken unsent />
        <WebUpdateNotice watch={watch} schedule={false} reload={reload} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('region')).toHaveTextContent('Elinizdeki iş bitince yenilenecek.');
    expect(screen.queryByRole('button', { name: 'Yenile' })).toBeNull();

    rerender(
      <>
        <OrderBeingTaken unsent={false} />
        <WebUpdateNotice watch={watch} schedule={false} reload={reload} />
      </>,
    );
    await act(async () => vi.advanceTimersByTime(1000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('goes away when closed', async () => {
    render(<WebUpdateNotice watch={await deployed()} schedule={false} reload={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('waits behind an open dialog', async () => {
    document.body.innerHTML = '<div role="dialog">Ürün düzenle</div>';
    render(<WebUpdateNotice watch={await deployed()} schedule={false} reload={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Yeni sürüm hazır' })).toBeNull();
  });

  it('says nothing while the page is the deployed build', async () => {
    const watch = createReleaseWatch({ find: async () => null, storage: localStorage });
    await act(() => watch.check());
    render(<WebUpdateNotice watch={watch} schedule={false} reload={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
