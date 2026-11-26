const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windchimeOutput', Object.freeze({
  request: (input) => ipcRenderer.invoke('display:request', input),
  onBlank: (callback) => { const listener = () => callback(); ipcRenderer.on('output:blank', listener); return () => ipcRenderer.removeListener('output:blank', listener); },
  onScrollCommand: (callback) => { const listener = (_event, command) => callback(command); ipcRenderer.on('output:scroll', listener); return () => ipcRenderer.removeListener('output:scroll', listener); },
  onTestCard: (callback) => { const listener = (_event, payload) => callback(payload && typeof payload === 'object' ? { active: Boolean(payload.active), appearance: payload.appearance ?? null } : { active: Boolean(payload), appearance: null }); ipcRenderer.on('output:test-card', listener); return () => ipcRenderer.removeListener('output:test-card', listener); },
  reportScroll: (metrics) => { void ipcRenderer.invoke('display:scroll-metrics', metrics).catch(() => {}); },
}));
