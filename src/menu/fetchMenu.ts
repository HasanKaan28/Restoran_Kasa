import type { ServerConfig } from '@/server/config';
import { isPublicMenu, type PublicMenu } from './model';

export type MenuAnswer = { kind: 'menu'; menu: PublicMenu } | { kind: 'closed' };

/** The menu could not be loaded: no connection, a server error or an answer that is no menu. */
export class MenuLoadError extends Error {
  constructor(reason: string) {
    super(`Menü yüklenemedi: ${reason}`);
    this.name = 'MenuLoadError';
  }
}

/**
 * Asks the server for the menu behind a slug. One call to public_menu through the Data API with
 * the build's publishable key: no session, no cookie, no referrer, nothing stored by the client
 * library (the full Supabase client would add its auth and realtime code to a page that needs
 * neither). Null from the server means the link is unknown or turned off.
 */
export async function fetchPublicMenu(
  config: ServerConfig,
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<MenuAnswer> {
  let response: Response;
  try {
    response = await fetcher(`${config.url}/rest/v1/rpc/public_menu`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ slug }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new MenuLoadError('bağlantı yok');
  }
  if (!response.ok) {
    throw new MenuLoadError(`sunucu ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (body === null) {
    return { kind: 'closed' };
  }
  if (!isPublicMenu(body)) {
    throw new MenuLoadError('beklenmeyen yanıt');
  }
  return { kind: 'menu', menu: body };
}
