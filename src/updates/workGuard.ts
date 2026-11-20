import { useEffect, useSyncExternalStore } from 'react';

/**
 * Whether the register is in the middle of something an update must not cut short: a dialog
 * (taking a payment, editing a dish), a field being typed in, or an order a screen holds unsent.
 * An update notice waits it out; a reload waits for it to end.
 */

const holds = new Set<symbol>();

/** A screen holding work that a reload would interrupt, such as an order not yet sent. */
export function useHoldUpdates(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const hold = Symbol('hold');
    holds.add(hold);
    return () => {
      holds.delete(hold);
    };
  }, [active]);
}

const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open]';
const TYPING =
  'input:not([type="button"], [type="checkbox"], [type="radio"], [type="submit"], [type="reset"]), textarea, select, [contenteditable="true"], [contenteditable=""]';

export function dialogOpen(doc: Document = document): boolean {
  return doc.querySelector(DIALOG) !== null;
}

function typing(doc: Document): boolean {
  return doc.activeElement?.matches(TYPING) ?? false;
}

export function workInProgress(doc: Document = document): boolean {
  return holds.size > 0 || dialogOpen(doc) || typing(doc);
}

function subscribeToDialogs(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'role'],
  });
  return () => observer.disconnect();
}

/** Whether a dialog is open now, following dialogs as they open and close. */
export function useDialogOpen(): boolean {
  return useSyncExternalStore(
    subscribeToDialogs,
    () => dialogOpen(),
    () => false,
  );
}

/**
 * Reloads the page as soon as nothing is in progress: at once on a quiet screen, otherwise when
 * the payment is taken, the order sent or the field left. Returns a way to call it off.
 */
export function reloadWhenIdle({
  isBusy = () => workInProgress(),
  reload = () => window.location.reload(),
  pollMs = 1000,
}: {
  isBusy?: () => boolean;
  reload?: () => void;
  pollMs?: number;
} = {}): () => void {
  if (!isBusy()) {
    reload();
    return () => undefined;
  }
  const timer = setInterval(() => {
    if (!isBusy()) {
      clearInterval(timer);
      reload();
    }
  }, pollMs);
  return () => clearInterval(timer);
}
