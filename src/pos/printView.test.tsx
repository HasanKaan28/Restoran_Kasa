import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LONGEST_PRINT_MS, printView, resetPrinting } from './printView';

const rule = () => '@page { size: 80mm 100mm; margin: 0; }';
const rootText = () => document.getElementById('print-root')?.textContent ?? null;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // A print a test left hanging must not hold the next test's prints back.
  act(() => resetPrinting());
});

describe('printView', () => {
  it('lets a print still under way finish before the next one takes the page', async () => {
    let finishSlip: () => void = () => {};
    const silent = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSlip = resolve;
        }),
    );
    const slip = printView(<p>Masa 5 siparişi</p>, rule, silent);
    expect(silent).toHaveBeenCalledOnce();

    // The cashier prints a receipt while the slip is still with the printer.
    let printedReceipt: string | null = null;
    const dialog = vi.fn(() => {
      printedReceipt = rootText();
    });
    const receipt = printView(<p>Fiş K1-0001</p>, rule, dialog);
    expect(dialog).not.toHaveBeenCalled();
    expect(rootText()).toBe('Masa 5 siparişi');
    expect(document.body).toHaveClass('printing-receipt');

    // An afterprint from elsewhere neither ends the slip nor lets the receipt in.
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(rootText()).toBe('Masa 5 siparişi');
    expect(dialog).not.toHaveBeenCalled();

    await act(async () => {
      finishSlip();
      await slip;
    });
    await vi.waitFor(() => expect(dialog).toHaveBeenCalledOnce());
    expect(printedReceipt).toBe('Fiş K1-0001');

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    await receipt;
    expect(document.getElementById('print-root')).toBeNull();
    expect(document.getElementById('print-page')).toBeNull();
    expect(document.body).not.toHaveClass('printing-receipt');
  });

  it('ends a print that finishes on its own without any afterprint', async () => {
    await act(async () => {
      await printView(<p>Masa 6 siparişi</p>, rule, async () => undefined);
    });
    expect(document.getElementById('print-root')).toBeNull();
    expect(document.body).not.toHaveClass('printing-receipt');
  });

  it('prints through the window at once when nothing else is printing, as before', () => {
    const dialog = vi.fn();
    void printView(<p>Fiş</p>, rule, dialog);
    expect(dialog).toHaveBeenCalledOnce();
  });

  it('lets the other prints go when a silent print never ends', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(LONGEST_PRINT_MS).toBe(90_000);
    // A stuck spooler: the printer never answers.
    const stuck = printView(<p>Masa 5 siparişi</p>, rule, () => new Promise<void>(() => {}));
    const dialog = vi.fn();
    void printView(<p>Fiş K1-0001</p>, rule, dialog);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONGEST_PRINT_MS - 1);
    });
    expect(dialog).not.toHaveBeenCalled();
    expect(rootText()).toBe('Masa 5 siparişi');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await stuck;
    expect(dialog).toHaveBeenCalledOnce();
    expect(rootText()).toBe('Fiş K1-0001');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Yazıcı yanıt vermedi'));
  });

  it('logs a print that throws, tidies up, and lets the next one print', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = printView(<p>Fiş</p>, rule, () => {
      throw new Error('no printer');
    });
    await expect(failed).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    expect(document.getElementById('print-root')).toBeNull();
    expect(document.body).not.toHaveClass('printing-receipt');

    const dialog = vi.fn();
    void printView(<p>Fiş 2</p>, rule, dialog);
    expect(dialog).toHaveBeenCalledOnce();
  });
});
