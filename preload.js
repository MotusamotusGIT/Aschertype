// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  secureStore: {
    get:    (key)        => ipcRenderer.invoke('secure-store:get', key),
    set:    (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
    remove: (key)        => ipcRenderer.invoke('secure-store:remove', key),
    clear:  ()           => ipcRenderer.invoke('secure-store:clear'),
  },
  platform: process.platform,
});

contextBridge.exposeInMainWorld('ai', {
  health:      (model)          => ipcRenderer.invoke('ai:health', { model }),
  chat:        (messages, opts, model) => ipcRenderer.invoke('ai:chat', { messages, options: opts, model }),
  chatTools:   (messages, tools, opts, requestId, model) => ipcRenderer.invoke('ai:chat-tools', { messages, tools, options: opts, requestId, model }),
  parseTask:   (sentence)       => ipcRenderer.invoke('ai:parse-task', { sentence }),
  abort:       (requestId)      => ipcRenderer.invoke('ai:abort', { requestId }),
  chatStream:  (messages, opts, model) => ipcRenderer.invoke('ai:chat-stream', { messages, options: opts, model }),
  onChunk: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:chunk', listener);
    return () => ipcRenderer.removeListener('ai:chunk', listener);
  },
  onDone: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:done', listener);
    return () => ipcRenderer.removeListener('ai:done', listener);
  },
});