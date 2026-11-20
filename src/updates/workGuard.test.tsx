import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadWhenIdle, useDialogOpen, useHoldUpdates, workInProgress } from './workGuard';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('work in progress', () => {
  it('is nothing on a quiet screen', () => {
    expect(workInProgress()).toBe(false);
  });

  it('is an open dialog, such as taking a payment', () => {
    document.body.innerHTML = '<div role="dialog"><button>Nakit</button></div>';
    expect(workInProgress()).toBe(true);
  });

  it('is a field being typed in', () => {
    document.body.innerHTML = '<input aria-label="Not" /><button>Kaydet</button>';
    document.querySelector('input')?.focus();
    expect(workInProgress()).toBe(true);
    document.querySelector('button')?.focus();
    expect(workInProgress()).toBe(false);
  });

  it('is an order a screen holds unsent, for as long as it holds it', () => {
    const { rerender, unmount } = renderHook(({ active }) => useHoldUpdates(active), {
      initialProps: { active: true },
    });
    expect(workInProgress()).toBe(true);
    rerender({ active: false });
    expect(workInProgress()).toBe(false);
    rerender({ active: true });
    unmount();
    expect(workInProgress()).toBe(false);
  });
});

describe('an open dialog, followed live', () => {
  it('comes and goes with the dialog', async () => {
    const { result } = renderHook(() => useDialogOpen());
    expect(result.current).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    await act(async () => {
      document.body.append(dialog);
    });
    expect(result.current).toBe(true);
    await act(async () => {
      dialog.remove();
    });
    expect(result.current).toBe(false);
  });

  it('sees a dialog rendered inside the app too', async () => {
    function Screen({ open }: { open: boolean }) {
      return <main>{open ? <section role="dialog">Ödeme</section> : null}</main>;
    }
    const { result } = renderHook(() => useDialogOpen());
    const { rerender } = render(<Screen open={false} />);
    await act(async () => rerender(<Screen open />));
    expect(result.current).toBe(true);
  });
});

describe('reloading when idle', () => {
  it('reloads at once on a quiet screen', () => {
    const reload = vi.fn();
    reloadWhenIdle({ isBusy: () => false, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the work to end, then reloads once', () => {
    vi.useFakeTimers();
    let busy = true;
    const reload = vi.fn();
    reloadWhenIdle({ isBusy: () => busy, reload, pollMs: 1000 });
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('can be called off while it waits', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const stop = reloadWhenIdle({ isBusy: () => true, reload, pollMs: 1000 });
    stop();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});
