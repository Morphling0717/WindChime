const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windchimeOutput', Object.freeze({
  request: (input) => ipcRenderer.invoke('display:request', input),
  getOverlay: () => ipcRenderer.invoke('display:overlay-get'),
  getMotion: () => ipcRenderer.invoke('display:motion-get'),
  getSpotlight: () => ipcRenderer.invoke('display:spotlight-output-get'),
  getTestCard: () => ipcRenderer.invoke('display:test-card-output-get'),
  onBlank: (callback) => { const listener = () => callback(); ipcRenderer.on('output:blank', listener); return () => ipcRenderer.removeListener('output:blank', listener); },
  onScrollCommand: (callback) => { const listener = (_event, command) => callback(command); ipcRenderer.on('output:scroll', listener); return () => ipcRenderer.removeListener('output:scroll', listener); },
  onTestCard: (callback) => { const listener = (_event, payload) => callback(payload && typeof payload === 'object' ? { active: Boolean(payload.active), appearance: payload.appearance ?? null } : { active: Boolean(payload), appearance: null }); ipcRenderer.on('output:test-card', listener); return () => ipcRenderer.removeListener('output:test-card', listener); },
  onOverlay: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('output:overlay', listener); return () => ipcRenderer.removeListener('output:overlay', listener); },
  onSpotlight: (callback) => { const listener = (_event, assetId) => callback(typeof assetId === 'string' && assetId ? assetId : null); ipcRenderer.on('output:spotlight', listener); return () => ipcRenderer.removeListener('output:spotlight', listener); },
  onMotion: (callback) => { const listener = (_event, enabled) => callback(Boolean(enabled)); ipcRenderer.on('output:motion', listener); return () => ipcRenderer.removeListener('output:motion', listener); },
  reportScroll: (metrics) => { void ipcRenderer.invoke('display:scroll-metrics', metrics).catch(() => {}); },
}));
