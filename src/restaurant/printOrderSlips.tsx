import { pageSizeRule } from '@/pos/printPage';
import { printView } from '@/pos/printView';
import type { OrderSlip } from './orderSlip';
import { OrderSlipsView } from './OrderSlipView';

/** The bridge the desktop app's preload script puts on `window.marketKasa.print`. */
type DesktopPrint = {
  /** Prints the page on the computer's default printer with no window; false if it could not. */
  silent(): Promise<boolean>;
};

/** Whether this is the desktop app, which prints with no window. */
export function printsSilently(): boolean {
  return desktopPrint() !== undefined;
}

/**
 * Prints slips on paper of the receipt's width: on the desktop app straight to the default
 * printer, elsewhere through the browser's print window. It waits its turn with every other print
 * of the app (printView), and a silent print holds the others back until the printer has it.
 */
export function printOrderSlips(slips: OrderSlip[], paperWidth: 58 | 80): Promise<void> {
  return printView(
    <OrderSlipsView slips={slips} paperWidth={paperWidth} />,
    (printed) => pageSizeRule(paperWidth, printed.getBoundingClientRect().height),
    () => {
      const desktop = desktopPrint();
      return desktop ? printSilently(desktop) : window.print();
    },
  );
}

async function printSilently(desktop: DesktopPrint): Promise<void> {
  const printed = await desktop.silent().catch(() => false);
  if (!printed) {
    // No printer set up, say: the window lets someone choose one.
    window.print();
  }
}

function desktopPrint(): DesktopPrint | undefined {
  return (window as { marketKasa?: { print?: DesktopPrint } }).marketKasa?.print;
}
