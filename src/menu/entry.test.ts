import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('the guest menu entry', () => {
  it('is built as a page of its own beside the app, so both hosts ship it under app/', () => {
    // vercel.json and the Pages workflow copy dist/ whole (workflows.test.ts).
    expect(read('vite.config.ts')).toMatch(/menu: fileURLToPath\(new URL\('\.\/menu\.html'/);
    const page = read('menu.html');
    expect(page).toContain('<script type="module" src="/src/menu/main.ts"></script>');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(page).toContain('<meta name="referrer" content="no-referrer" />');
    // Not the app: no manifest to install, no theme script reading the register's choice.
    expect(page).not.toContain('manifest');
    expect(page).not.toContain('localStorage');
  });

  it('loads nothing of the register: no database, pairing, sync or service worker', () => {
    const imports = [...read('src/menu/main.ts').matchAll(/^import .*?['"](.+)['"];$/gm)].map(
      (match) => match[1],
    );
    expect(imports).toEqual(['@/design/fonts.css', './menu.css', '@/server/config', './page']);
    for (const file of ['src/menu/page.ts', 'src/menu/model.ts', 'src/menu/fetchMenu.ts']) {
      const text = read(file);
      expect(text, file).not.toMatch(/from '@\/(app|data\/db|sync|pwa|restaurant)/);
      expect(text, file).not.toMatch(/@supabase|react/);
    }
  });
});
