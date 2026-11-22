// The only bridge from the page to the main process: checking for and installing updates, and
// printing an order slip with no window (print.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketKasa', {
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus(callback) {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('updates:status', listener);
      return () => ipcRenderer.removeListener('updates:status', listener);
    },
  },
  print: {
    silent: () => ipcRenderer.invoke('print:silent'),
  },
});
