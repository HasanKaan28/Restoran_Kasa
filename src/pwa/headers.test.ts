import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The security headers vercel.json gives each page of the web deploy: the site at /, the app at
// /app/, the guests' QR menu and the seller's yönetim page.

type Rule = { source: string; headers: { key: string; value: string }[] };
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: Rule[] };

/** A Vercel source (path-to-regexp) as a RegExp: its groups are regex, the rest literal. */
function sourceRegex(source: string): RegExp {
  let pattern = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === '(') {
      let depth = 0;
      let end = index;
      for (; end < source.length; end += 1) {
        if (source[end] === '\\') {
          end += 1;
        } else if (source[end] === '(') {
          depth += 1;
        } else if (source[end] === ')' && --depth === 0) {
          break;
        }
      }
      pattern += source.slice(index, end + 1);
      index = end;
    } else {
      pattern += char.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Every header a request for `path` gets, by key; a key set twice is listed twice. */
function headersFor(path: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const rule of vercel.headers) {
    if (sourceRegex(rule.source).test(path)) {
      for (const { key, value } of rule.headers) {
        (found[key] ??= []).push(value);
      }
    }
  }
  return found;
}

function cspFor(path: string): Map<string, string> {
  const values = headersFor(path)['Content-Security-Policy'] ?? [];
  expect(values, path).toHaveLength(1);
  return new Map(
    (values[0] ?? '').split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/);
      return [name, sources.join(' ')] as const;
    }),
  );
}

/** A page's inline scripts as the browser hashes them (HTML reads CRLF as LF). */
function inlineScriptHashes(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, body]) =>
      `'sha256-${createHash('sha256')
        .update((body ?? '').replaceAll('\r\n', '\n'))
        .digest('base64')}'`,
  );
}

const SUPABASE = 'https://bjtymphglonbdvmjcnbw.supabase.co';
const SITE = ['/', '/style.css', '/fonts/x.woff2', '/img/logo.svg'];
const APP = [
  '/app/',
  '/app/index.html',
  '/app/sw.js',
  '/app/assets/index-1.js',
  '/app/manifest.json',
];
const MENU = ['/app/menu.html'];
const YONETIM = ['/app/yonetim', '/app/yonetim/', '/app/yonetim.html', '/app/yonetim/index.html'];

describe('the web deploy’s security headers', () => {
  it('give every page one policy that no other site may frame, and nosniff', () => {
    for (const path of [...SITE, ...APP, ...MENU, ...YONETIM]) {
      const csp = cspFor(path);
      expect(csp.get('frame-ancestors'), path).toBe("'none'");
      expect(csp.get('object-src'), path).toBe("'none'");
      expect(csp.get('base-uri'), path).toBe("'none'");
      expect(csp.get('default-src'), path).toBe("'self'");
      expect(csp.get('script-src'), path).toMatch(/^'self'( 'sha256-[A-Za-z0-9+/=]+')*$/);
      const headers = headersFor(path);
      expect(headers['X-Content-Type-Options'], path).toEqual(['nosniff']);
      expect(headers['X-Frame-Options'], path).toEqual(['DENY']);
      expect(headers['Referrer-Policy'], path).toHaveLength(1);
      expect(headers['Permissions-Policy'], path).toHaveLength(1);
    }
  });

  it('allow each page’s own inline scripts by their hash, and nothing else inline', () => {
    const allowed = (path: string) => cspFor(path).get('script-src')?.split(' ').slice(1);
    expect(allowed('/')).toEqual(inlineScriptHashes('site/index.html'));
    expect(allowed('/app/')).toEqual(inlineScriptHashes('index.html'));
    expect(allowed('/app/menu.html')).toEqual(inlineScriptHashes('menu.html'));
    expect(allowed('/app/yonetim.html')).toEqual([
      ...inlineScriptHashes('yonetim.html'),
      ...inlineScriptHashes('public/yonetim/index.html'),
    ]);
  });

  it('let the pages talk only to the restaurant’s own Supabase project', () => {
    expect(cspFor('/').get('connect-src')).toBe("'self'");
    expect(cspFor('/app/').get('connect-src')).toBe(
      `'self' ${SUPABASE} https://world.openfoodfacts.org https://api.github.com`,
    );
    // The guest's menu reads only the public menu; the seller's page only the server.
    expect(cspFor('/app/menu.html').get('connect-src')).toBe(SUPABASE);
    expect(cspFor('/app/yonetim').get('connect-src')).toBe(`'self' ${SUPABASE}`);
  });

  it('let only the app use the camera, for the barcode scanner', () => {
    for (const path of APP) {
      expect(headersFor(path)['Permissions-Policy']?.[0], path).toMatch(/(^|, )camera=\(self\)/);
    }
    for (const path of [...SITE, ...MENU, ...YONETIM]) {
      expect(headersFor(path)['Permissions-Policy']?.[0], path).toMatch(/(^|, )camera=\(\)/);
    }
  });

  it('keep the menu’s and the yönetim page’s address out of referrers', () => {
    for (const path of [...MENU, ...YONETIM]) {
      expect(headersFor(path)['Referrer-Policy'], path).toEqual(['no-referrer']);
    }
  });
});
