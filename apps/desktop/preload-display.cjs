const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windchimeOutput', Object.freeze({
  request: (input) => ipcRenderer.invoke('display:request', input),
  onBlank: (callback) => { const listener = () => callback(); ipcRenderer.on('output:blank', listener); return () => ipcRenderer.removeListener('output:blank', listener); },
}));
