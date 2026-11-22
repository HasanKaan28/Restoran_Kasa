import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const ROOT_ID = 'print-root';
const PAGE_STYLE_ID = 'print-page';
const PRINTING_CLASS = 'printing-receipt';

/**
 * A silent print that has said nothing after this is given up on: a stuck spooler or driver must
 * not hold back every receipt, report and label of the app.
 */
export const LONGEST_PRINT_MS = 90_000;

/**
 * A print the page goes on with while it runs: the desktop app's silent print of an order slip.
 * Until it is over (or given up on), every other print waits for it, so none takes its page away.
 */
let inFlight: { done: Promise<void>; finish(): void } | null = null;
/** Ends the print shown through the browser's window that has not yet said it is over. */
let endShown: (() => void) | null = null;

/**
 * Prints one view: the view is rendered into a root laid out off-screen, the page rule is worked
 * out from it (a receipt is measured for its height), and only while it prints does the page hide
 * everything else (app.css). All of it is undone once printing is over, so a later Ctrl+P prints
 * the screen as usual.
 *
 * Every print of the app comes through here, one at a time. `print` is the browser's print window
 * by default, over once `afterprint` comes (a print started after it takes its place, as before);
 * a `print` that returns a promise (the desktop's silent print) is over when it settles, and
 * holds back every other print until then. The returned promise settles when this one is over.
 */
export function printView(
  view: ReactNode,
  pageRule: (printed: HTMLElement) => string,
  print: () => void | Promise<unknown> = () => window.print(),
): Promise<void> {
  if (inFlight) {
    return inFlight.done.then(() => printView(view, pageRule, print));
  }
  return printNow(view, pageRule, print);
}

/** Ends whatever is printing now, as if it were over; for tests, so none is left holding the rest. */
export function resetPrinting(): void {
  inFlight?.finish();
  endShown?.();
}

function printNow(
  view: ReactNode,
  pageRule: (printed: HTMLElement) => string,
  print: () => void | Promise<unknown>,
): Promise<void> {
  endShown?.();
  document.getElementById(ROOT_ID)?.remove();
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.append(container);

  const root = createRoot(container);
  flushSync(() => root.render(view));
  const style = pageStyle();
  style.textContent = pageRule(container);
  document.body.classList.add(PRINTING_CLASS);

  return new Promise((resolve) => {
    let over = false;
    const end = () => {
      if (over) {
        return;
      }
      over = true;
      window.removeEventListener('afterprint', end);
      if (endShown === end) {
        endShown = null;
      }
      root.unmount();
      container.remove();
      style.remove();
      document.body.classList.remove(PRINTING_CLASS);
      resolve();
    };

    // Listened for before printing: a browser's window blocks, and says `afterprint` before
    // `print` returns.
    window.addEventListener('afterprint', end);
    endShown = end;
    let job: void | Promise<unknown>;
    try {
      job = print();
    } catch (error) {
      // Nothing to wait for: tidy up so the next print can go, and say why on the console.
      console.error('Yazdırılamadı', error);
      end();
      return;
    }
    if (job instanceof Promise) {
      // Over when it settles, whatever else says `afterprint` meanwhile, or given up on.
      window.removeEventListener('afterprint', end);
      endShown = null;
      inFlight = holdUntilOver(job, end);
    }
  });
}

/** The lock a silent print holds: let go when the print settles or after `LONGEST_PRINT_MS`. */
function holdUntilOver(
  job: Promise<unknown>,
  end: () => void,
): { done: Promise<void>; finish(): void } {
  let release: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = {
    done,
    finish: () => {
      clearTimeout(timer);
      if (inFlight === lock) {
        inFlight = null;
      }
      end();
      release();
    },
  };
  const timer = setTimeout(() => {
    console.error('Yazıcı yanıt vermedi; sıradaki yazdırmalar bekletilmiyor.');
    lock.finish();
  }, LONGEST_PRINT_MS);
  job.then(lock.finish, lock.finish);
  return lock;
}

function pageStyle(): HTMLStyleElement {
  const existing = document.getElementById(PAGE_STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  document.head.append(style);
  return style;
}
