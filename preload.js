// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  secureStore: {
    get:    (key)        => ipcRenderer.invoke('secure-store:get', key),
    set:    (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
    remove: (key)        => ipcRenderer.invoke('secure-store:remove', key),
    clear:  ()           => ipcRenderer.invoke('secure-store:clear'),
  },

  // Lifecycle listeners for graceful shutdown & secure flushing
  onFlushSecureWrites: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = () => callback();
    ipcRenderer.on('app:flush-secure-writes', subscription);
    return () => {
      ipcRenderer.removeListener('app:flush-secure-writes', subscription);
    };
  },

  sendFlushComplete: () => {
    ipcRenderer.send('app:flush-complete');
  },

  platform: process.platform,
});