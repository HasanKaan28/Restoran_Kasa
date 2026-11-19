import '@/design/fonts.css';
import './menu.css';
import { SERVER } from '@/server/config';
import { startMenuPage } from './page';

/*
 * The guest menu's own entry (menu.html): it never opens the register's database, its pairing or
 * its service worker, and it loads nothing of the app but the server address and a few helpers.
 */
const root = document.getElementById('menu');
if (!root) {
  throw new Error('Root element #menu is missing');
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const open = () =>
  void startMenuPage({ root, config: SERVER, location: window.location, storage: storage() });

open();
window.addEventListener('hashchange', open);
