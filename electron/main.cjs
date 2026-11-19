const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  APP_HOST,
  CONTENT_SECURITY_POLICY,
  devToolsAllowed,
  isExternalUrl,
  resolveAppFile,
} = require('./security.cjs');
const { displayBounds, isDisplayUrl } = require('./display.cjs');
const { wireUpdates } = require('./updates.cjs');

const DIST = path.join(__dirname, '../dist');
const APP_ORIGIN = `app://${APP_HOST}`;

// The app is served from its own origin rather than file://, so web security and the sandbox
// can stay on and its data lives under one stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;

// The window's colour until the page paints: the app's background in the system's scheme
// (src/design/tokens.css), so a dark desktop does not flash light on start.
function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#1C1815' : '#F4EEE6';
}

async function serveApp(request) {
  const file = resolveAppFile(DIST, request.url);
  if (!file) {
    return new Response('Not found', { status: 404 });
  }
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 650,
    title: 'Restoran Kasa',
    backgroundColor: windowBackground(),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: devToolsAllowed(app.isPackaged),
      // Runs sandboxed; it hands the page only the update calls.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Links such as WhatsApp go to the system browser. The one window of ours that opens is the
  // customer display, full screen on a second monitor when there is one.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isDisplayUrl(url)) {
      const { bounds, fullscreen } = displayBounds(
        screen.getAllDisplays(),
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id,
      );
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...bounds,
          fullscreen,
          title: 'Restoran Kasa · Müşteri ekranı',
          autoHideMenuBar: true,
          backgroundColor: windowBackground(),
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            devTools: devToolsAllowed(app.isPackaged),
          },
        },
      };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // The display stays on its page and opens nothing itself.
  mainWindow.webContents.on('did-create-window', (child) => {
    child.setMenu(null);
    child.webContents.on('will-navigate', (event, url) => {
      if (!isDisplayUrl(url)) {
        event.preventDefault();
      }
    });
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
    console.error('Load failed:', errorCode, errorDescription, url);
  });

  const view = [
    { role: 'reload', label: 'Yenile (F5)' },
    { role: 'forceReload', label: 'Zorla yenile' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Tam ekran (F11)' },
  ];
  if (devToolsAllowed(app.isPackaged)) {
    view.push({ role: 'toggleDevTools', label: 'Geliştirici araçları' });
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Görünüm', submenu: view },
      {
        label: 'Yardım',
        submenu: [
          {
            label: 'Restoran Kasa hakkında',
            click: () =>
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Restoran Kasa',
                message: `Restoran Kasa\nSürüm ${app.getVersion()}`,
              }),
          },
        ],
      },
    ]),
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', serveApp);
    wireUpdates({ autoUpdater, ipcMain, getWindow: () => mainWindow, isPackaged: app.isPackaged });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
