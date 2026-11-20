// Security decisions of the desktop app, kept apart from Electron so they can be tested.
const path = require('path');

const APP_HOST = 'market';

/**
 * The restaurant's own Supabase project, as in the release builds' VITE_SUPABASE_URL and in the
 * web deploy's policy (vercel.json): the one server the desktop register may talk to.
 */
const SUPABASE_ORIGIN = 'https://bjtymphglonbdvmjcnbw.supabase.co';

/**
 * What the page may load and talk to: its own files, the restaurant's server on Supabase
 * (sign-up, pairing and every sync) and product names from Open Food Facts.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // The one inline script, index.html's theme setter, by its hash (security.test.ts checks it).
  "script-src 'self' 'sha256-oFKhc3JUbuqVl40H0gwKWMueGsnIH0xanJF0EW3TQu4='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  `connect-src 'self' ${SUPABASE_ORIGIN} https://world.openfoodfacts.org`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * A link the app hands to the system browser: only the https links the app itself makes, a
 * WhatsApp chat, its releases on GitHub and its own web address (the QR menu, the site). Never a
 * file, a script or any other address, so a page gone wrong cannot send the till anywhere.
 */
function isExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return false;
  }
  if (parsed.hostname === 'wa.me' || parsed.hostname === 'restorankasa.vercel.app') {
    return true;
  }
  return (
    parsed.hostname === 'github.com' && parsed.pathname.startsWith('/HasanKaan28/Restoran_Kasa/')
  );
}

/** Whether an address or origin is the app's own, app://market. */
function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'app:' && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

/** What the app's own page may have besides the camera. */
const PAGE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);

/**
 * Whether the page may have a permission it asks for (Electron grants every one unless told).
 * The app's own page gets the camera, video only, for the barcode scanner, writing to the
 * clipboard (copying the QR menu's link) and notifications ("Masa 5 hazır"); nothing else, and
 * nothing for any other page.
 */
function permissionAllowed(permission, requestingUrl, details = {}) {
  if (!isAppUrl(requestingUrl)) {
    return false;
  }
  if (permission === 'media') {
    const types = details.mediaTypes ?? [];
    return types.length > 0 && types.every((type) => type === 'video');
  }
  return PAGE_PERMISSIONS.has(permission);
}

/** The same answer to the page's checks (whether a camera may be listed, say). */
function permissionCheckAllowed(permission, requestingOrigin, details = {}) {
  if (!isAppUrl(requestingOrigin)) {
    return false;
  }
  if (permission === 'media') {
    return details.mediaType !== 'audio';
  }
  return PAGE_PERMISSIONS.has(permission);
}

/**
 * The file in `distDir` an `app://market/...` request names, or null for anything that is not
 * ours or would leave `distDir`. The bare address is the app's page.
 */
function resolveAppFile(distDir, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.host !== APP_HOST) {
    return null;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // A backslash or NUL decoded from the address could step out on Windows or cut the name.
  if (relative.includes('\\') || relative.includes('\u0000')) {
    return null;
  }
  if (relative === '' || relative.endsWith('/')) {
    relative += 'index.html';
  }
  const root = path.resolve(distDir);
  const file = path.resolve(root, '.' + relative);
  return file.startsWith(root + path.sep) ? file : null;
}

/** Developer tools let anyone at the till rewrite the session or the data, so a packaged app has none. */
function devToolsAllowed(isPackaged) {
  return !isPackaged;
}

module.exports = {
  APP_HOST,
  CONTENT_SECURITY_POLICY,
  SUPABASE_ORIGIN,
  isExternalUrl,
  permissionAllowed,
  permissionCheckAllowed,
  resolveAppFile,
  devToolsAllowed,
};
