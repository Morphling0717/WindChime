const { contextBridge, ipcRenderer } = require('electron');
// No generic invoke, file, shell, token or request-header API crosses this bridge.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('windchimeDesktop', Object.freeze({
  sites: () => invoke('sites:list'),
  importKey: (key) => invoke('sites:import-key', key),
  pair: (input) => invoke('sites:pair', input),
  pairingStatus: (id) => invoke('sites:pair-status', id),
  cancelPairing: (id) => invoke('sites:pair-cancel', id),
  selectSite: (id) => invoke('sites:select', id),
  selectTopic: (id, connectionId) => invoke('sites:select-topic', id, connectionId),
  forgetSite: (id) => invoke('sites:forget', id),
  request: (input) => invoke('control:request', input),
  upload: (input) => invoke('control:upload', input),
  openDisplay: () => invoke('display:open'),
  hide: () => invoke('control:hide'),
  status: () => invoke('app:status'),
  openTile: (module) => invoke('tiles:open', module),
  closeTile: (module) => invoke('tiles:close', module),
  setTilePinned: (module, pinned) => invoke('tiles:pin', module, pinned),
  setTileDirty: (dirty) => invoke('tiles:dirty', dirty),
  selectMessage: (messageId, connectionId, contextVersion) => invoke('control:select-message', messageId, connectionId, contextVersion),
  setNextShortcut: (accelerator) => invoke('app:next-shortcut', accelerator),
  setShortcutRecording: (recording) => invoke('app:shortcut-recording', recording),
  confirm: (message) => invoke('app:confirm', { message }),
  saveFile: (input) => invoke('files:save', input),
  chooseAvatar: () => invoke('files:avatar'),
  openSubmission: () => invoke('share:open'),
}));
