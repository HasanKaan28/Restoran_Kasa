import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, followStoredTheme, loadTheme, saveTheme, THEME_STORAGE_KEY } from './theme';

const html = readFileSync('index.html', 'utf8');
/** The script in index.html's head that sets the theme before the first paint. */
const boot = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('appearance setting', () => {
  it('follows the system until the device chooses', () => {
    expect(loadTheme()).toBe('system');
  });

  it('is kept on this device under rk.theme', () => {
    saveTheme('dark');
    expect(localStorage.getItem('rk.theme')).toBe('dark');
    expect(loadTheme()).toBe('dark');
    saveTheme('light');
    expect(loadTheme()).toBe('light');
    saveTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(loadTheme()).toBe('system');
  });

  it('reads anything else as the system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(loadTheme()).toBe('system');
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadTheme(blocked)).toBe('system');
    expect(() => saveTheme('dark', blocked)).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('sets data-theme for a chosen theme and removes it for the system', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('gives the browser bar its scheme colours back when the system decides again', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4eee6" />' +
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1c1815" />',
    );
    applyTheme('dark');
    applyTheme('system');
    const colours = [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
      meta.getAttribute('content'),
    );
    expect(colours).toEqual(['#f4eee6', '#1c1815']);
  });

  it('follows a choice made in another window, such as the register’s on the customer display', () => {
    const stop = followStoredTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
  });
});

describe('theme before the first paint', () => {
  function runBoot(stored: string | null) {
    const root = { dataset: {} as Record<string, string> };
    runInNewContext(boot, {
      localStorage: { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
      document: { documentElement: root },
    });
    return root.dataset.theme;
  }

  it('runs in index.html’s head, before the page body and the app', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<script>${boot}</script>`);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it('sets the stored theme, and nothing for the system or a value it does not know', () => {
    expect(runBoot('dark')).toBe('dark');
    expect(runBoot('light')).toBe('light');
    expect(runBoot(null)).toBeUndefined();
    expect(runBoot('<img>')).toBeUndefined();
  });
});
