// Printing with no window: the order slip the bar's PC prints for every new order. The browser
// always asks first; the desktop app can send the page straight to the default printer.
const { isAppUrl } = require('./security.cjs');

/** A thermal printer's roll: no margins (the page sets its own size), no background colours. */
const SILENT_PRINT_OPTIONS = Object.freeze({
  silent: true,
  printBackground: false,
  margins: Object.freeze({ marginType: 'none' }),
});

/**
 * The page calls `print:silent` with what it wants printed already laid out (src/pos/printView);
 * the answer says whether the printer took it. Only the app's own page in the main window may
 * ask: the customer display and any other page get false and print nothing.
 */
function wirePrint({ ipcMain, getWindow }) {
  ipcMain.handle('print:silent', (event) => {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      !isAppUrl(event.senderFrame?.url ?? '')
    ) {
      return false;
    }
    return new Promise((resolve) => {
      event.sender.print({ ...SILENT_PRINT_OPTIONS }, (success) => resolve(success === true));
    });
  });
}

module.exports = { wirePrint, SILENT_PRINT_OPTIONS };
