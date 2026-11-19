/** How this device draws the app: as its system says, or always light or dark. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * Kept on the device, not synced: one screen may sit in a dim bar and another by a window.
 * index.html reads the same key before the first paint, so a dark device never flashes light.
 */
export const THEME_STORAGE_KEY = 'rk.theme';

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
};

export function loadTheme(storage?: Pick<Storage, 'getItem'>): ThemeChoice {
  try {
    const stored = (storage ?? localStorage).getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(
  choice: ThemeChoice,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  try {
    const target = storage ?? localStorage;
    if (choice === 'system') {
      target.removeItem(THEME_STORAGE_KEY);
    } else {
      target.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Storage blocked: the choice lasts until the app is closed.
  }
}

/**
 * Draws the page in `choice`: tokens.css switches its colours on `data-theme`, or on the system's
 * scheme when there is none. The browser bar follows: index.html gives it one colour per scheme,
 * and a chosen theme puts its own background in both.
 */
export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
): void {
  if (choice === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
  const background =
    choice === 'system' ? '' : getComputedStyle(root).getPropertyValue('--color-bg').trim();
  for (const meta of root.ownerDocument.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    meta.dataset.schemeColor ??= meta.content;
    meta.content = background || meta.dataset.schemeColor;
  }
}

/**
 * Follows a choice made in another window of the app, such as the customer display beside the
 * register: the browser tells every other window when the stored value changes.
 */
export function followStoredTheme(target: Window = window): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyTheme(loadTheme());
    }
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
