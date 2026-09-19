// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Secure storage (encrypted via OS keychain)
  secureStore: {
    get:    (key)        => ipcRenderer.invoke('secure-store:get', key),
    set:    (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
    remove: (key)        => ipcRenderer.invoke('secure-store:remove', key),
    clear:  ()           => ipcRenderer.invoke('secure-store:clear'),
  },

  // Platform info (useful for UI tweaks)
  platform: process.platform,
});