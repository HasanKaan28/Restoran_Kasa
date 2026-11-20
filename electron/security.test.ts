import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import security from './security.cjs';

const {
  CONTENT_SECURITY_POLICY,
  SUPABASE_ORIGIN,
  devToolsAllowed,
  isExternalUrl,
  permissionAllowed,
  permissionCheckAllowed,
  resolveAppFile,
} = security;

/**
 * index.html's one inline script, which sets the theme before the first paint, as the browser
 * hashes it: with its line breaks read as LF, whatever the checkout keeps on disk.
 */
const themeScript = /<script>([\s\S]*?)<\/script>/
  .exec(readFileSync('index.html', 'utf8'))?.[1]
  ?.replaceAll('\r\n', '\n');

const dist = path.resolve('/opt/market-kasa/dist');

describe('electron security', () => {
  it('opens outside only the https links the app makes', () => {
    expect(isExternalUrl('https://wa.me/?text=merhaba')).toBe(true);
    expect(isExternalUrl('https://wa.me/905551112233?text=merhaba')).toBe(true);
    expect(isExternalUrl('https://github.com/HasanKaan28/Restoran_Kasa/releases')).toBe(true);
    expect(isExternalUrl('https://restorankasa.vercel.app/app/menu.html#Ab3dEf6h')).toBe(true);
    expect(isExternalUrl('https://restorankasa.vercel.app/')).toBe(true);
    // Any other address, however it is dressed up, stays shut: a page that went wrong cannot
    // send the till's browser anywhere.
    expect(isExternalUrl('https://github.com/someone-else/malware/releases')).toBe(false);
    expect(isExternalUrl('https://example.com/')).toBe(false);
    expect(isExternalUrl('https://wa.me.example.com/')).toBe(false);
    expect(isExternalUrl('https://restorankasa.vercel.app.example.com/')).toBe(false);
    expect(isExternalUrl('https://user@wa.me/')).toBe(false);
    expect(isExternalUrl('https://world.openfoodfacts.org/product/1')).toBe(false);
    expect(isExternalUrl('http://wa.me/')).toBe(false);
    expect(isExternalUrl('http://example.com/')).toBe(false);
    expect(isExternalUrl('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('app://market/index.html')).toBe(false);
    expect(isExternalUrl('not a url')).toBe(false);
  });

  it('keeps requests inside dist', () => {
    expect(resolveAppFile(dist, 'app://market/')).toBe(path.join(dist, 'index.html'));
    expect(resolveAppFile(dist, 'app://market/index.html')).toBe(path.join(dist, 'index.html'));
    expect(resolveAppFile(dist, 'app://market/assets/index-B0x9.js')).toBe(
      path.join(dist, 'assets', 'index-B0x9.js'),
    );
    expect(resolveAppFile(dist, 'app://market/assets/index-abc.js?v=1#x')).toBe(
      path.join(dist, 'assets', 'index-abc.js'),
    );
    expect(resolveAppFile(dist, 'app://market/assets/%C3%A7ay.svg')).toBe(
      path.join(dist, 'assets', 'çay.svg'),
    );
    // Dot segments are resolved by the URL itself, so they stay inside dist.
    expect(resolveAppFile(dist, 'app://market/../secret.txt')).toBe(path.join(dist, 'secret.txt'));
    expect(resolveAppFile(dist, 'app://market/%2e%2e/%2e%2e/secret.txt')).toBe(
      path.join(dist, 'secret.txt'),
    );
    // An escaped backslash, another host, another scheme, or a broken escape.
    expect(resolveAppFile(dist, 'app://market/assets/..%5C..%5Csecret.txt')).toBeNull();
    expect(resolveAppFile(dist, 'app://market/assets/%2F..%2F..%2Fsecret.txt')).toBeNull();
    expect(resolveAppFile(dist, 'app://other/index.html')).toBeNull();
    expect(resolveAppFile(dist, 'https://market/index.html')).toBeNull();
    expect(resolveAppFile(dist, 'app://market/%E0%A4%A')).toBeNull();
  });

  it('turns developer tools off when packaged', () => {
    expect(devToolsAllowed(true)).toBe(false);
    expect(devToolsAllowed(false)).toBe(true);
  });

  it('sends a policy that allows only what the app uses', () => {
    const directives = Object.fromEntries(
      CONTENT_SECURITY_POLICY.split(';').map((part: string) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'self'",
      // The theme script and nothing else inline: allowed by its hash, so an edit must update it.
      'script-src': `'self' 'sha256-${createHash('sha256')
        .update(themeScript ?? '')
        .digest('base64')}'`,
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' data: blob:",
      'font-src': "'self' data:",
      'media-src': "'self' blob: mediastream:",
      // The market's server: without it the desktop register could never sync or be set up.
      'connect-src': `'self' ${SUPABASE_ORIGIN} https://world.openfoodfacts.org`,
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'frame-ancestors': "'none'",
    });
  });

  it('talks to the restaurant’s own Supabase project, the one the web deploy allows', () => {
    expect(SUPABASE_ORIGIN).toBe('https://bjtymphglonbdvmjcnbw.supabase.co');
    const vercel = readFileSync('vercel.json', 'utf8');
    expect(vercel).toContain(SUPABASE_ORIGIN);
    expect(CONTENT_SECURITY_POLICY).not.toContain('*');
  });

  it('grants the page only the camera, writing the clipboard and "order ready" notifications', () => {
    const page = 'app://market/index.html#/pos';
    expect(permissionAllowed('media', page, { mediaTypes: ['video'] })).toBe(true);
    expect(permissionAllowed('clipboard-sanitized-write', page, {})).toBe(true);
    expect(permissionAllowed('notifications', page, {})).toBe(true);
    // A microphone, a location, USB or serial devices: never.
    expect(permissionAllowed('media', page, { mediaTypes: ['audio'] })).toBe(false);
    expect(permissionAllowed('media', page, { mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(permissionAllowed('media', page, {})).toBe(false);
    for (const permission of [
      'geolocation',
      'midi',
      'clipboard-read',
      'hid',
      'serial',
      'usb',
      'openExternal',
      'pointerLock',
      'display-capture',
    ]) {
      expect(permissionAllowed(permission, page, {}), permission).toBe(false);
    }
    // Nothing for a page that is not the app's own.
    expect(permissionAllowed('media', 'https://example.com/', { mediaTypes: ['video'] })).toBe(
      false,
    );
    expect(permissionAllowed('clipboard-sanitized-write', 'file:///C:/x.html', {})).toBe(false);
    expect(permissionAllowed('notifications', 'https://example.com/', {})).toBe(false);
  });

  it('answers the page’s permission checks the same way', () => {
    expect(permissionCheckAllowed('media', 'app://market', { mediaType: 'video' })).toBe(true);
    expect(permissionCheckAllowed('media', 'app://market', { mediaType: 'unknown' })).toBe(true);
    expect(permissionCheckAllowed('media', 'app://market', { mediaType: 'audio' })).toBe(false);
    expect(permissionCheckAllowed('clipboard-sanitized-write', 'app://market', {})).toBe(true);
    expect(permissionCheckAllowed('notifications', 'app://market', {})).toBe(true);
    expect(permissionCheckAllowed('geolocation', 'app://market', {})).toBe(false);
    expect(permissionCheckAllowed('media', 'https://example.com', { mediaType: 'video' })).toBe(
      false,
    );
  });
});
