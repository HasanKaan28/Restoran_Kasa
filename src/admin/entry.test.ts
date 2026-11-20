import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('the yönetim page entry', () => {
  it('is built as a page of its own beside the app, kept out of search engines', () => {
    expect(read('vite.config.ts')).toMatch(/yonetim: fileURLToPath\(new URL\('\.\/yonetim\.html'/);
    const page = read('yonetim.html');
    expect(page).toContain('<script type="module" src="/src/admin/main.tsx"></script>');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(page).toContain('<meta name="referrer" content="no-referrer" />');
    expect(page).not.toContain('manifest');
  });

  it('opens at /app/yonetim on Vercel and on GitHub Pages', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      redirects: { source: string; destination: string }[];
      rewrites: { source: string; destination: string }[];
    };
    expect(vercel.rewrites).toContainEqual({
      source: '/app/yonetim',
      destination: '/app/yonetim.html',
    });
    // With a slash the page's relative files would be looked for under /app/yonetim/: redirect.
    expect(vercel.redirects).toContainEqual(
      expect.objectContaining({ source: '/app/yonetim/', destination: '/app/yonetim.html' }),
    );
    // Pages has no rewrites: dist/yonetim/index.html (from public/) sends the seller on.
    const pages = read('public/yonetim/index.html');
    expect(pages).toContain('../yonetim.html');
    expect(pages).toContain('noindex');
  });

  it('goes only into the web deploys, never into the desktop or Android app', () => {
    // vite.config builds the page only when asked, and drops its redirect page otherwise.
    const config = read('vite.config.ts');
    expect(config).toContain("const withYonetim = process.env.RK_YONETIM === '1';");
    expect(config).toMatch(/\.\.\.\(withYonetim\s*\?\s*\{ yonetim: fileURLToPath/);
    expect(config).toContain('...(withYonetim ? [] : [dropYonetimRedirect()])');
    // Vercel and the release's GitHub Pages build ask for it.
    const vercel = JSON.parse(read('vercel.json')) as { buildCommand: string };
    expect(vercel.buildCommand).toMatch(/^RK_YONETIM=1 npm run build && /);
    expect(read('.github/workflows/v2-release.yml')).toMatch(
      /- run: npm run build\r?\n\s+env:(\r?\n\s+#.*)*\r?\n\s+RK_YONETIM: '1'/,
    );
    // The desktop installer and the Android sync build without it.
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    for (const name of ['electron:installer', 'cap:sync']) {
      expect(scripts[name], name).toMatch(/^vite build && /);
    }
  });

  it('loads nothing of the register: no database, pairing, sync or service worker', () => {
    const files = [
      'src/admin/main.tsx',
      'src/admin/AdminApp.tsx',
      'src/admin/CodesTab.tsx',
      'src/admin/RestaurantsTab.tsx',
      'src/admin/api.ts',
      'src/admin/model.ts',
    ];
    for (const file of files) {
      expect(read(file), file).not.toMatch(/from '@\/(app|data|sync|pwa|restaurant|pos)/);
    }
    // The seller's session is kept under its own key, apart from a register's on the same browser.
    expect(read('src/admin/api.ts')).toContain("storageKey: 'rk.operator'");
  });
});
