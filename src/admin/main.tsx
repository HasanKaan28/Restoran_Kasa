import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/design/fonts.css';
// The codes are shown in a monospaced face, so no letter is taken for another.
import '@fontsource/ibm-plex-mono/500.css';
import './admin.css';
import { SERVER } from '@/server/config';
import { AdminApp } from './AdminApp';
import { operatorClient } from './api';
import { ServerMissing } from './ServerMissing';

/*
 * The seller's yönetim page (yonetim.html): his own sign-in and the operator functions. It never
 * opens a register's database, pairing or service worker.
 */
const root = document.getElementById('admin');
if (!root) {
  throw new Error('Root element #admin is missing');
}

createRoot(root).render(
  <StrictMode>
    {SERVER ? <AdminApp client={operatorClient(SERVER)} /> : <ServerMissing />}
  </StrictMode>,
);
