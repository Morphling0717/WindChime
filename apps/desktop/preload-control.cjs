const { contextBridge, ipcRenderer } = require('electron');
// No generic invoke, file, shell, token or request-header API crosses this bridge.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('windchimeDesktop', Object.freeze({
  sites: () => invoke('sites:list'),
  pair: (input) => invoke('sites:pair', input),
  pairingStatus: (id) => invoke('sites:pair-status', id),
  cancelPairing: (id) => invoke('sites:pair-cancel', id),
  selectSite: (id) => invoke('sites:select', id),
  forgetSite: (id) => invoke('sites:forget', id),
  request: (input) => invoke('control:request', input),
  upload: (input) => invoke('control:upload', input),
  openDisplay: () => invoke('display:open'),
  hide: () => invoke('control:hide'),
  status: () => invoke('app:status'),
}));
