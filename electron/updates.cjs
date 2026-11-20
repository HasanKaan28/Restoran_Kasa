// Desktop updates from the GitHub release, with nothing for the shop to do: the app looks for a new
// release when it starts and every few hours, downloads it in the background and installs it when
// the app closes. An update found while the app is just starting always goes in as soon as it is
// downloaded, with the page showing the download over everything. One found while the register is
// at work waits, so no sale is cut short. "Güncelle" installs it at any time.

/** How often a register left open all day looks for a new release. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** An update found this soon after the app opens is installed at once: nobody is selling yet. */
const STARTING_MS = 2 * 60 * 1000;
/** The page's "Kuruluyor" screen shows its tick for this long before the app closes. */
const INSTALL_AFTER_MS = 1600;

/**
 * Connects electron-updater to the window. Status reaches the page on `updates:status`; the page
 * calls `updates:check` and `updates:install`. A build that is not installed never checks.
 */
function wireUpdates({
  autoUpdater,
  ipcMain,
  getWindow,
  isPackaged,
  now = Date.now,
  every = setInterval,
  wait = setTimeout,
}) {
  autoUpdater.autoDownload = true;
  // A downloaded update nobody installed goes in when the app closes.
  autoUpdater.autoInstallOnAppQuit = true;
  const startedAt = now();
  let installRequested = false;
  // Set when an update is found while the app is starting: it goes in when downloaded, however
  // long a slow line takes. There is no putting it off: a shop that never closes the app would
  // otherwise never get it.
  let installOnArrival = false;
  let downloaded;
  // The release on its way, so the page can name it while it downloads.
  let coming;
  const installNow = () => installRequested || installOnArrival;

  const send = (status) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('updates:status', status);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    if (now() - startedAt < STARTING_MS) {
      installOnArrival = true;
    }
    coming = info.version;
    send({ kind: 'available', version: info.version, installNow: installNow() });
  });
  autoUpdater.on('update-not-available', () => send({ kind: 'current' }));
  // `installNow` tells the page to cover the screen: the app will close when the download ends.
  autoUpdater.on('download-progress', (progress) =>
    send({
      kind: 'downloading',
      percent: Math.round(progress.percent),
      installNow: installNow(),
      ...(coming ? { version: coming } : {}),
    }),
  );
  let installing = false;
  const install = (version) => {
    if (installing) {
      return;
    }
    installing = true;
    send({ kind: 'installing', version });
    // Not silent, so the installer's progress shows; the app opens again when it is done. A
    // moment first, so the page can show the download is in before the window goes.
    wait(() => autoUpdater.quitAndInstall(false, true), INSTALL_AFTER_MS);
  };
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info.version;
    if (installNow()) {
      install(info.version);
    } else {
      send({ kind: 'ready', version: info.version });
    }
  });
  // An offline shop is normal: the page says the check failed, nothing more.
  autoUpdater.on('error', () => send({ kind: 'error' }));

  const check = async () => {
    if (!isPackaged) {
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      send({ kind: 'error' });
    }
  };
  ipcMain.handle('updates:check', check);
  ipcMain.handle('updates:install', async () => {
    if (!isPackaged) {
      return;
    }
    installRequested = true;
    if (downloaded) {
      install(downloaded);
      return;
    }
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      send({ kind: 'error' });
    }
  });

  if (isPackaged) {
    void check();
    every(() => void check(), CHECK_EVERY_MS);
  }
}

module.exports = { wireUpdates };
