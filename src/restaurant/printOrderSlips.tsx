import { pageSizeRule } from '@/pos/printPage';
import { printView } from '@/pos/printView';
import type { OrderSlip } from './orderSlip';
import { OrderSlipsView } from './OrderSlipView';

/** A print that never says it is over stops holding up the next one after this. */
const LONGEST_PRINT_MS = 2 * 60_000;

/** The bridge the desktop app's preload script puts on `window.marketKasa.print`. */
type DesktopPrint = {
  /** Prints the page on the computer's default printer with no window; false if it could not. */
  silent(): Promise<boolean>;
};

let queue: Promise<void> = Promise.resolve();

/** Whether this is the desktop app, which prints with no window. */
export function printsSilently(): boolean {
  return desktopPrint() !== undefined;
}

/**
 * Prints slips on paper of the receipt's width: on the desktop app straight to the default
 * printer, elsewhere through the browser's print window. One print at a time: a print asked for
 * while another is under way waits for it, so neither takes the other's page away.
 */
export function printOrderSlips(slips: OrderSlip[], paperWidth: 58 | 80): Promise<void> {
  const job = queue.then(() => printOnce(slips, paperWidth));
  // A print that failed does not stop the ones after it.
  queue = job.catch(() => undefined);
  return job;
}

function printOnce(slips: OrderSlip[], paperWidth: 58 | 80): Promise<void> {
  return new Promise((resolve) => {
    let over = false;
    const finish = () => {
      if (!over) {
        over = true;
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(finish, LONGEST_PRINT_MS);
    window.addEventListener('afterprint', finish, { once: true });
    // The page tidies up after `afterprint`; a silent print may end without one, so it is said.
    const ended = () => {
      if (!over) {
        window.dispatchEvent(new Event('afterprint'));
      }
    };
    printView(
      <OrderSlipsView slips={slips} paperWidth={paperWidth} />,
      (printed) => pageSizeRule(paperWidth, printed.getBoundingClientRect().height),
      () => {
        const desktop = desktopPrint();
        if (!desktop) {
          window.print();
          return;
        }
        desktop
          .silent()
          .catch(() => false)
          .then((printed) => {
            if (!printed) {
              // No printer set up, say: the window lets someone choose one.
              window.print();
            }
            ended();
          }, ended);
      },
    );
  });
}

function desktopPrint(): DesktopPrint | undefined {
  return (window as { marketKasa?: { print?: DesktopPrint } }).marketKasa?.print;
}
