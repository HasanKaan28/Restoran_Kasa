/**
 * The yönetim page only on an address of its own. Every GitHub Pages site of the account answers
 * from one origin (hasankaan28.github.io): any page of any of them reads that origin's storage,
 * where the seller's session would sit. That session issues codes and lists every restaurant, so
 * on such an address the page sends him to its own one instead and keeps nothing there.
 */

/** The page's own address, apart from every other site. */
export const OPERATOR_PAGE = 'https://restorankasa.vercel.app/app/yonetim.html';

/** Whether pages of other sites share this host's origin (GitHub Pages user sites). */
export function isSharedOrigin(hostname: string): boolean {
  return /\.github\.io$/i.test(hostname);
}

/**
 * On a shared origin: drops any seller's session kept there and goes to the page's own address,
 * the hash along (an email confirmation link's session rides in it). Returns whether it left.
 */
export function leaveSharedOrigin(
  location: Pick<Location, 'hostname' | 'hash' | 'replace'>,
  storage: Pick<Storage, 'removeItem'> | null,
): boolean {
  if (!isSharedOrigin(location.hostname)) {
    return false;
  }
  try {
    storage?.removeItem('rk.operator');
  } catch {
    // Storage may be blocked; there is then nothing kept to drop.
  }
  location.replace(OPERATOR_PAGE + location.hash);
  return true;
}
