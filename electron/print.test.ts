import { describe, expect, it, vi } from 'vitest';
import printing from './print.cjs';

const { wirePrint, SILENT_PRINT_OPTIONS } = printing;

type Handler = (event: unknown) => unknown;

/** The main window's page, and whether its printer takes the job. */
function setup(printed = true) {
  const handlers = new Map<string, Handler>();
  const print = vi.fn((_options: unknown, callback: (success: boolean, reason: string) => void) =>
    callback(printed, printed ? '' : 'Printer not found'),
  );
  const webContents = { print };
  wirePrint({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    getWindow: () => ({ isDestroyed: () => false, webContents }),
  });
  const call = (event: unknown) => handlers.get('print:silent')!(event);
  const fromApp = { sender: webContents, senderFrame: { url: 'app://market/index.html#/tables' } };
  return { call, print, webContents, fromApp };
}

describe('desktop silent printing', () => {
  it('prints the app’s page on the default printer with no window, for the order slips', async () => {
    const { call, print, fromApp } = setup();
    expect(await call(fromApp)).toBe(true);
    expect(print).toHaveBeenCalledOnce();
    expect(print.mock.calls[0]?.[0]).toEqual({
      silent: true,
      printBackground: false,
      margins: { marginType: 'none' },
    });
    expect(SILENT_PRINT_OPTIONS.silent).toBe(true);
  });

  it('says so when the printer does not take the job, so the page can open the window', async () => {
    const { call, fromApp } = setup(false);
    expect(await call(fromApp)).toBe(false);
  });

  it('prints for no other page or window', async () => {
    const { call, print, webContents } = setup();
    expect(
      await call({ sender: webContents, senderFrame: { url: 'https://example.com/' } }),
    ).toBe(false);
    expect(await call({ sender: webContents, senderFrame: null })).toBe(false);
    // The customer display is a window of the app too, but prints nothing.
    expect(
      await call({ sender: { print }, senderFrame: { url: 'app://market/index.html#/display' } }),
    ).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });
});
