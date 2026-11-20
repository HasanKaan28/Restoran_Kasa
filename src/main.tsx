import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts.css';
// Receipts print in a monospaced face (src/pos/ReceiptView.tsx).
import '@fontsource/ibm-plex-mono/500.css';
import { Capacitor } from '@capacitor/core';
import { App } from './app/App';
import { BUILD_ID } from './app/version';
import { loadDeviceSettings } from './app/device';
import { applyTheme, followStoredTheme, loadTheme } from './app/theme';
import { CustomerDisplay } from './display/CustomerDisplay';
import './app/app.css';
import { registerServiceWorker } from './pwa/register';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing');
}

// index.html already set the theme before the first paint; this also points the browser bar at
// it, and keeps every window of the app (the customer display too) on the register's choice.
applyTheme(loadTheme());
followStoredTheme();

// The customer display is its own window: it shows the register's cart and starts nothing else.
const customerDisplay = window.location.hash === '#/display';

createRoot(container).render(
  <StrictMode>
    {customerDisplay ? <CustomerDisplay marketName={loadDeviceSettings().marketName} /> : <App />}
  </StrictMode>,
);

// Development only: `await seedDemo()` in the console fills an empty market for screenshots.
if (import.meta.env.DEV) {
  void import('./demo/seedDemo').then(({ seedDemo }) => Object.assign(window, { seedDemo }));
  void import('./demo/seedRestaurant').then(({ seedRestaurant }) =>
    Object.assign(window, { seedRestaurant }),
  );
}

void registerServiceWorker(
  {
    prod: import.meta.env.PROD,
    native: Capacitor.isNativePlatform(),
    protocol: window.location.protocol,
    hostname: window.location.hostname,
  },
  __APP_VERSION__,
  BUILD_ID,
);
