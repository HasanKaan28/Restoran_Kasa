import type { ServerClient } from './client';

/** A restaurant's QR menu: whether guests can open it, and its link's slug once it has one. */
export type QrMenuState = { enabled: boolean; slug: string | null };

/** Where guests open the menu (menu.html, built beside the app; vercel.json ships it). */
export const PUBLIC_MENU_PAGE = 'https://restorankasa.vercel.app/app/menu.html';

type MenuEnv = { DEV: boolean; VITE_PUBLIC_MENU_URL?: string };

/**
 * The menu page links and table cards point at. Always the public site in a release, so a card
 * printed on any register, desktop or phone opens the same page; while developing, the page
 * beside the app. A build may name another https address (or a local build being tried out).
 */
export function menuPageUrl(
  env: MenuEnv = import.meta.env as MenuEnv,
  href: string = typeof window === 'undefined' ? '' : window.location.href,
): string {
  const named = env.VITE_PUBLIC_MENU_URL?.trim();
  if (named && /^(https:\/\/|http:\/\/localhost[:/])/.test(named)) {
    return named;
  }
  if (env.DEV && href) {
    return new URL('menu.html', href).href;
  }
  return PUBLIC_MENU_PAGE;
}

/** The address a guest opens: `?masa=` names the table, the slug rides after `#`. */
export function menuLink(slug: string, table?: string, page: string = menuPageUrl()): string {
  return `${page}${table ? `?masa=${encodeURIComponent(table)}` : ''}#${slug}`;
}

const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

const MESSAGES: Record<string, string> = {
  not_owner: 'Bu hesap bu restoranın sahibi değil.',
  device_not_registered: 'Bu cihaz sunucuya bağlı değil.',
  device_revoked: 'Bu cihazın kaydı iptal edildi.',
};

function explain(message: string): string {
  const known = Object.keys(MESSAGES).find((key) => message.includes(key));
  return known ? (MESSAGES[known] as string) : OFFLINE;
}

function stateOf(data: unknown): QrMenuState {
  const { enabled, slug } = (data ?? {}) as { enabled?: unknown; slug?: unknown };
  return { enabled: enabled === true, slug: typeof slug === 'string' ? slug : null };
}

/** The register's own restaurant's QR menu; any register may read it, only the owner changes it. */
export async function readQrMenu(device: ServerClient): Promise<QrMenuState> {
  const { data, error } = await device.rpc('my_qr_menu');
  if (error) {
    throw new Error(explain(error.message));
  }
  return stateOf(data);
}

/**
 * Turns the QR menu on or off, or gives it a new link, with the owner's one sign-in. As with a
 * pairing code, the owner's session ends at once and the password is never kept.
 */
export async function changeQrMenu({
  owner,
  email,
  password,
  marketId,
  change,
}: {
  owner: ServerClient;
  email: string;
  password: string;
  marketId: string;
  change: { enabled: boolean } | 'rotate';
}): Promise<QrMenuState> {
  const signIn = await owner.auth.signInWithPassword({ email: email.trim(), password });
  if (signIn.error) {
    throw new Error(
      /invalid login/i.test(signIn.error.message) ? 'E-posta ya da şifre yanlış.' : OFFLINE,
    );
  }
  try {
    const { data, error } =
      change === 'rotate'
        ? await owner.rpc('rotate_qr_menu', { market_id: marketId })
        : await owner.rpc('set_qr_menu', { market_id: marketId, enabled: change.enabled });
    if (error) {
      throw new Error(explain(error.message));
    }
    return stateOf(data);
  } finally {
    // Only this sign-in ends; the owner's sessions on other devices stay.
    await owner.auth.signOut({ scope: 'local' });
  }
}
