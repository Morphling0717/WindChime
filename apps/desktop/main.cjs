const { app, BrowserWindow, ipcMain, shell, safeStorage, globalShortcut, Tray, Menu, session, powerMonitor, dialog, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const osNode = require('node:os');
const crypto = require('node:crypto');
const httpNode = require('node:http');
const { performance } = require('node:perf_hooks');
const { version: appVersion } = require('./package.json');
const { normalizeOrigin, validateRequest, restoreSite, verifier, challenge, publicSite } = require('./security.cjs');
const { parseWindChimeConnectionKey } = require('./build/connection-key.cjs');
const {
  TILE_MODULES,
  HIDE_SHORTCUT,
  normalizeShortcut,
  normalizeNextShortcut,
  sanitizeObsBridge,
  sanitizeLocalOverlay,
  restoreWorkspace,
  fitTileBounds,
  fitDisplayPosition,
} = require('./workspace.cjs');
const { atomicRename, createWorkspaceStore, createVaultStore } = require('./main/vault.cjs');
const { createShortcutManager } = require('./main/shortcuts.cjs');
const { createObsBridge } = require('./main/obs-bridge.cjs');
const { createOverlayStore } = require('./main/overlay-store.cjs');
const { createSessionHistoryStore } = require('./main/session-history.cjs');
const { createUpdater } = require('./main/updater.cjs');

const state = { sites: [], selected: null, pairings: new Map(), output: null, connectionError: '' };
let controlWindow, displayWindow, tray, quitting = false;
let selectionVersion = 0, outputVersion = 0, switching = false, importVersion = 0;
const tiles = new Map();
let selectedMessageId = null, mainDirty = false, mainReviewDirty = false, mainOtherDirty = false;
let displaySize = { width: 960, height: 640 }, outputScrollState = null, outputOnAir = null;
let outputTestCard = false, outputAppearance = null, lastLiveFrame = null, desktopTheme = 'light';
let desktopPrefs = {
  randomDrawEnabled: false,
  clearOnBlindDraw: false,
  chimeEnabled: false,
  chimeVolume: 70,
  startupView: 'last',
  lastView: null,
  autoCheckUpdate: true,
  uiSurface: 'liquid',
};
let controlAcrylicActive = false;
function supportsWinAcrylic() {
  if (process.platform !== 'win32') return false;
  const parts = String(osNode.release() || '').split('.');
  const build = Number(parts[2] || 0);
  return Number.isFinite(build) && build >= 22000;
}
function prefsPayload() {
  return { ...desktopPrefs, acrylicActive: controlAcrylicActive };
}
let displayMoveTimer = null;
const pendingRequests = new Set();
let writeTail = Promise.resolve();
let outputDeadline = 0, outputHeld = false, pendingOutputClears = 0;
let outputReceiverVersion = 0, outputReceiverId = null, outputEpoch = null, outputSnapshotId = null;
let obsGrant = null, obsReceiverId = null, obsEpoch = null, obsPollTimer = null, obsPollActive = false, obsPollVersion = 0;
let lastKnownTopicTitle = '';
const recoveringWindows = new WeakSet();
const rendererTerminations = new WeakMap();
const blankDocument = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>WindChime Display</title><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}</style></head><body></body></html>');

const squirrelEvent = process.argv.find(arg => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(arg));
const legacyInstall = /^app-\d+\./i.test(path.basename(path.dirname(process.execPath)));
if (squirrelEvent) {
  if (squirrelEvent !== '--squirrel-obsolete') {
    if (squirrelEvent === '--squirrel-uninstall') app.requestSingleInstanceLock();
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    const command = squirrelEvent === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
    const child = require('node:child_process').spawn(updateExe, [command, path.basename(process.execPath)], { detached: false, windowsHide: true, stdio: 'ignore' });
    const finish = () => squirrelEvent === '--squirrel-uninstall' ? setTimeout(() => app.quit(), 3000) : app.quit();
    child.on('close', finish); child.on('error', finish); setTimeout(() => app.quit(), 5000);
  } else app.quit();
  return;
}

if (process.platform === 'win32') app.setAppUserModelId?.('org.windchime.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => {
    if (argv.includes('--squirrel-uninstall')) { if (legacyInstall) app.quit(); return; }
    controlWindow?.show(); controlWindow?.focus();
  });
  app.whenReady().then(start).catch(error => { console.error('WindChime startup failed:', error.message); app.quit(); });
}

function selected() { return state.sites.find(site => site.id === state.selected); }
function activeTopic(site) { return site?.scope === 'site' ? site.selectedTopicId : site?.topicId; }
function abortRequests() { for (const request of pendingRequests) request.abort(); pendingRequests.clear(); }
function connectionError(message) { state.connectionError = [state.connectionError, message].filter(Boolean).join('\n'); }
function liveContents(window) {
  if (!window || window.isDestroyed()) return null;
  const contents = window.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}
function broadcastPrivate(channel, payload) {
  liveContents(controlWindow)?.send?.(channel, payload);
  for (const tile of tiles.values()) liveContents(tile.window)?.send?.(channel, payload);
}

let workspacePath = '', vaultPath = '', historyPath = '', overlayDir = '', updatesDir = '';
const workspaceStore = createWorkspaceStore({
  fs,
  getPath: () => workspacePath,
  restoreWorkspace,
  sanitizeObsBridge,
  sanitizeLocalOverlay,
  onReadError: connectionError,
  setTimeoutFn: setTimeout,
});

const vaultStore = createVaultStore({
  fs,
  safeStorage,
  restoreSite,
  publicSite,
  getVaultPath: () => vaultPath,
  state,
  activeTopic,
  selected,
  onReadError: connectionError,
  confirmDirty,
  dirtyTiles,
  getSelectionVersion: () => selectionVersion,
  isSwitching: () => switching,
  setTimeoutFn: setTimeout,
  onConnectionCommitted: async previous => {
    disposeTiles();
    ++selectionVersion;
    switching = true;
    lastKnownTopicTitle = '';
    abortRequests();
    stopObsPoller();
    obsBridge.disconnectAll();
    closeOutput();
    sessionHistory.resetSessionDedupe();
    try { await hideSite(previous).catch(() => {}); } finally { switching = false; }
  },
});

const overlayStore = createOverlayStore({
  fs,
  path,
  nativeImage,
  dialog,
  getDir: () => overlayDir,
  getConfig: () => workspaceStore.get().localOverlay,
  saveConfig: config => workspaceStore.save({ localOverlay: config }),
  onChanged: statePayload => {
    broadcastPrivate('overlay:changed', statePayload);
    liveContents(displayWindow)?.send?.('output:overlay', statePayload);
    obsBridge.pushOverlay();
  },
});

const sessionHistory = createSessionHistoryStore({
  fs,
  getPath: () => historyPath,
  atomicRename,
  crypto,
  onChanged: list => broadcastPrivate('history:changed', list),
  setTimeoutFn: setTimeout,
});

const updater = createUpdater({
  fetch,
  shell,
  crypto,
  fs,
  path,
  spawn: (cmd, args, opts) => require('node:child_process').spawn(cmd, args, opts),
  getUpdatesDir: () => updatesDir,
  onStateChange: info => broadcastPrivate('updater:changed', info),
  onBeforeInstallQuit: () => { setTimeout(() => app.quit(), 250).unref?.(); },
  currentVersion: appVersion,
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
});

const obsBridge = createObsBridge({
  http: httpNode,
  crypto,
  fs,
  path,
  buildDir: path.join(__dirname, 'build'),
  getInitialState: basePath => ({
    overlay: overlayStore.getObsPayload(basePath),
    frame: lastLiveFrame && outputSnapshotId ? { ...lastLiveFrame, basePath } : null,
    testCard: outputTestCard && !outputSnapshotId ? { active: true, appearance: outputAppearance } : null,
  }),
  fetchDisplayAsset: async (assetId, activation) => {
    const scope = selected();
    if (!scope || !outputSnapshotId) return null;
    const grant = state.output || obsGrant;
    const receiverId = state.output ? outputReceiverId : obsReceiverId;
    if (!grant || !receiverId) return null;
    const query = new URLSearchParams({ receiverId, ...(activation ? { activation } : {}) });
    const result = await http(`${scope.origin}/api/mail/live`, `/display/assets/${encodeURIComponent(assetId)}?${query.toString()}`, 'GET', undefined, grant.token, { binary: true, timeout: 4000 });
    return { bytes: Buffer.from(result.image, 'base64'), mimeType: result.mimeType };
  },
  getOverlayBytes: slot => overlayStore.getBytes(slot),
  getOverlayPayload: basePath => overlayStore.getObsPayload(basePath),
  onScrollMetrics: metrics => broadcastScrollState(sanitizeScrollMetrics(metrics)),
  onClientCountChange: count => {
    if (count > 0 && (!displayWindow || displayWindow.isDestroyed())) {
      void startObsPoller();
    } else if (count === 0) {
      stopObsPoller();
    }
  },
  onStatusChange: status => broadcastPrivate('obs:status-changed', status),
  setIntervalFn: setInterval,
  clearIntervalFn: typeof clearInterval === 'function' ? clearInterval : () => {},
});

const shortcuts = createShortcutManager({
  globalShortcut,
  HIDE_SHORTCUT,
  normalizeShortcut,
  normalizeNextShortcut,
  saveWorkspace: patch => workspaceStore.save(patch),
  onHide: () => hide().catch(() => {}),
  onScrollCommand: cmd => { sendDisplayScroll(cmd); },
  onConnectionError: connectionError,
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
  onNextLetter: async isCurrentVersion => {
    const scope = context();
    const receiverVersion = outputReceiverVersion;
    const assertReady = () => {
      assertCurrent(scope);
      const nativeReady = !!(displayWindow && !displayWindow.isDestroyed() && state.output && outputReceiverId);
      const obsReady = !!(obsBridge.getClientCount() > 0 && obsGrant && obsReceiverId);
      if (
        !isCurrentVersion() ||
        receiverVersion !== outputReceiverVersion ||
        pendingOutputClears ||
        outputHeld ||
        (!nativeReady && !obsReady) ||
        outputDeadline <= performance.now()
      ) {
        throw new Error('展示窗口未就绪或操作已取消，请连接展示窗口后重新按下一封');
      }
    };
    assertReady();
    await writeCommand(async () => {
      assertReady();
      const current = await siteRequest(scope.site, { path: `/control/state?topicId=${encodeURIComponent(activeTopic(scope.site))}`, method: 'GET' });
      assertReady();
      if (current.topicId !== activeTopic(scope.site) || !Number.isInteger(current.revision) || current.receivers < 1) {
        throw new Error('当前话题没有在线展示窗口，请先连接展示窗口');
      }
      await siteRequest(scope.site, { path: '/control/action', method: 'POST', body: { topicId: activeTopic(scope.site), action: 'next', expectedRevision: current.revision, operationId: crypto.randomUUID() } });
      assertReady();
    });
  },
});

function tileFor(window) { return [...tiles.values()].find(tile => tile.window === window); }
function tileMetadata(tile) { return { module: tile.module, pinned: tile.pinned, dirty: tile.dirty, connectionId: tile.scope.site.id, topicId: tile.topicId, contextVersion: tile.scope.version }; }
function assertTile(tile) { if (tiles.get(tile.module) !== tile || !isCurrent(tile.scope) || tile.topicId !== activeTopic(selected())) throw Object.assign(new Error('磁贴所属信箱已切换，请重新打开磁贴'), { code: 'CONNECTION_CHANGED' }); }
function cancelled() { return Object.assign(new Error('已取消操作，未保存内容仍然保留'), { code: 'OPERATION_CANCELLED' }); }
async function confirmDirty(tileList, message, includeMain = false, parent = controlWindow) {
  const mainBlocked = includeMain === 'review' ? mainReviewDirty : Boolean(includeMain && mainDirty);
  if (!tileList.some(tile => tile.dirty) && !mainBlocked) return;
  const response = await dialog.showMessageBox(parent, { type: 'warning', title: '保留未保存内容', message, buttons: ['取消，继续编辑', '放弃并继续'], defaultId: 0, cancelId: 0, noLink: true });
  if (response.response !== 1) throw cancelled();
}
function dirtyTiles() { return [...tiles.values()].filter(tile => tile.dirty); }
function rememberTile(tile) {
  const ws = workspaceStore.get();
  const bounds = !tile.window.isDestroyed() ? tile.window.getBounds?.() : ws.tiles[tile.module]?.bounds;
  const nextTiles = { ...ws.tiles, [tile.module]: { pinned: tile.pinned, ...(bounds ? { bounds } : {}) } };
  void workspaceStore.save({ tiles: nextTiles }).catch(() => { connectionError('磁贴位置未能保存'); });
}
function disposeTiles() {
  selectedMessageId = null; mainDirty = false; mainReviewDirty = false; mainOtherDirty = false;
  for (const tile of tiles.values()) { rememberTile(tile); tile.allowClose = true; tile.window.close(); }
  tiles.clear();
}
async function openTile(module) {
  if (!Object.prototype.hasOwnProperty.call(TILE_MODULES, module)) throw new Error('未知磁贴模块');
  const scope = context(); if (!activeTopic(scope.site)) throw new Error('请先选择话题');
  const existing = tiles.get(module); if (existing) { assertTile(existing); existing.window.show(); existing.window.focus(); return tileMetadata(existing); }
  const preferences = workspaceStore.get().tiles[module] || {}, partition = `windchime-private-tile-${crypto.randomUUID()}`;
  const stableTitle = `WindChime Private · ${TILE_MODULES[module]}`;
  const defaultWidth = module === 'review' || module === 'appearance' ? 760 : module === 'blindbox' ? 380 : 480;
  const defaultHeight = module === 'transport' ? 560 : module === 'blindbox' ? 560 : 720;
  const tileUseAcrylic = desktopPrefs.uiSurface === 'liquid' && supportsWinAcrylic();
  const window = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: module === 'blindbox' ? 320 : 340,
    minHeight: module === 'blindbox' ? 380 : 260,
    ...fitTileBounds(preferences.bounds, screen?.getAllDisplays().map(display => display.workArea)),
    title: stableTitle,
    frame: false,
    resizable: true,
    alwaysOnTop: preferences.pinned !== false,
    icon: path.join(__dirname, 'build/icon.ico'),
    backgroundColor: tileUseAcrylic ? '#00000000' : desktopTheme === 'dark' ? '#101822' : '#e9f1f5',
    ...(tileUseAcrylic ? { backgroundMaterial: 'acrylic' } : {}),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-control.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition, spellcheck: false },
  });
  applyWindowSurface(window, desktopTheme, desktopPrefs.uiSurface, { isControl: false, allowAcrylic: true });
  const tile = { module, window, scope, topicId: activeTopic(scope.site), pinned: preferences.pinned !== false, dirty: false, allowClose: false, closing: false };
  tiles.set(module, tile); secureWindow(window, partition);
  window.on('page-title-updated', event => event.preventDefault());
  for (const event of ['moved', 'resized']) window.on(event, () => { if (tiles.get(module) === tile) rememberTile(tile); });
  window.on('close', event => {
    if (tile.allowClose || quitting || !tile.dirty) return;
    event.preventDefault(); if (tile.closing) return; tile.closing = true;
    void confirmDirty([tile], '此磁贴有未保存的修改。关闭磁贴会放弃这些修改。', false, window).then(() => { if (tiles.get(module) !== tile) return; tile.allowClose = true; rememberTile(tile); window.close(); }).catch(() => {}).finally(() => { tile.closing = false; });
  });
  window.on('closed', () => { if (tiles.get(module) !== tile) return; rememberTile(tile); tiles.delete(module); });
  try { await window.loadFile(path.join(__dirname, 'build/control.html'), { query: { tile: module } }); assertTile(tile); window.setTitle?.(stableTitle); window.show(); return tileMetadata(tile); }
  catch (error) { if (tiles.get(module) === tile) { tiles.delete(module); tile.allowClose = true; window.close(); } throw error; }
}
async function closeTile(module) {
  const tile = tiles.get(module); if (!tile) return; assertTile(tile);
  await confirmDirty([tile], '此磁贴有未保存的修改。关闭磁贴会放弃这些修改。', false, tile.window); assertTile(tile);
  rememberTile(tile); tile.allowClose = true; tiles.delete(module); tile.window.close();
}
async function chooseMessage(messageId, connectionId, contextVersion, parent = controlWindow) {
  const scope = context(), initiatingTile = tileFor(parent);
  const assertSelection = () => { assertCurrent(scope); if (initiatingTile) assertTile(initiatingTile); };
  if (connectionId !== scope.site.id || (contextVersion !== undefined && contextVersion !== scope.version)) throw Object.assign(new Error('信箱已切换，旧选信操作已取消'), { code: 'CONNECTION_CHANGED' });
  if (messageId !== null && (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId))) throw new Error('无效信件');
  if (messageId === selectedMessageId) return selectedMessageId;
  const old = selectedMessageId;
  if (messageId !== null) { await siteRequest(scope.site, { path: `/control/messages/${encodeURIComponent(messageId)}?topicId=${encodeURIComponent(activeTopic(scope.site))}`, method: 'GET' }); assertSelection(); }
  if (old !== selectedMessageId) throw Object.assign(new Error('当前信件已更新，请重新选择'), { code: 'CONNECTION_CHANGED' });
  const review = tiles.get('review');
  await confirmDirty(review ? [review] : [], '当前审阅中有未保存的修改。选择另一封信会放弃当前信件的修改。', 'review', parent); assertSelection();
  if (old !== selectedMessageId) throw Object.assign(new Error('当前信件已更新，请重新选择'), { code: 'CONNECTION_CHANGED' });
  selectedMessageId = messageId; if (review) review.dirty = false; return selectedMessageId;
}

function sanitizeScrollCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('无效滚动指令');
  if (command.type === 'ratio') {
    if (!Number.isFinite(command.ratio)) throw new Error('无效滚动位置');
    return { type: 'ratio', ratio: Math.min(1, Math.max(0, command.ratio)) };
  }
  if (command.type === 'step') {
    if (!Number.isFinite(command.delta)) throw new Error('无效滚动步长');
    return { type: 'step', delta: Math.min(2, Math.max(-2, command.delta)) };
  }
  if (command.type === 'top') return { type: 'top' };
  if (command.type === 'togglePause') {
    return typeof command.paused === 'boolean' ? { type: 'togglePause', paused: command.paused } : { type: 'togglePause' };
  }
  throw new Error('未知滚动指令');
}
function sanitizeScrollMetrics(metrics) {
  if (metrics === null || !metrics || typeof metrics !== 'object') return null;
  const phases = ['top', 'scrolling', 'bottom', 'still', 'manual'];
  if (!phases.includes(metrics.phase)) return null;
  const num = (v, min, max) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0;
  return {
    ratio: num(metrics.ratio, 0, 1),
    offset: num(metrics.offset, 0, 100000),
    maximum: num(metrics.maximum, 0, 100000),
    viewportHeight: num(metrics.viewportHeight, 0, 10000),
    contentHeight: num(metrics.contentHeight, 0, 100000),
    paused: Boolean(metrics.paused),
    autoEnabled: Boolean(metrics.autoEnabled),
    phase: metrics.phase,
  };
}
function broadcastScrollState(next) {
  outputScrollState = next;
  broadcastPrivate('display:scroll-state', next);
}
function broadcastOnAir(next) {
  const prev = outputOnAir;
  if (
    prev === next ||
    (prev && next && prev.snapshotId === next.snapshotId && prev.messageId === next.messageId && prev.nickname === next.nickname && prev.textPreview === next.textPreview)
  ) return;
  outputOnAir = next;
  liveContents(controlWindow)?.send?.('display:on-air', next);
}
function broadcastTestCard(active) {
  const next = Boolean(active);
  outputTestCard = next;
  const payload = { active: next, appearance: outputAppearance };
  liveContents(displayWindow)?.send?.('output:test-card', payload);
  obsBridge.pushTestCard(payload);
  broadcastPrivate('display:test-card-state', next);
}
function snapshotToOnAir(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const nickname = typeof snapshot.nickname === 'string' && snapshot.nickname.trim() ? snapshot.nickname.trim().slice(0, 40) : null;
  const textPreview = typeof snapshot.text === 'string' ? snapshot.text.replace(/\s+/g, ' ').trim().slice(0, 48) : '';
  return {
    messageId: typeof snapshot.messageId === 'string' ? snapshot.messageId : '',
    snapshotId: typeof snapshot.id === 'string' ? snapshot.id : '',
    nickname,
    textPreview,
  };
}
function applyWindowSurface(win, theme, uiSurface, { isControl = false, allowAcrylic = true } = {}) {
  if (!win || win.isDestroyed()) return false;
  const wantAcrylic = allowAcrylic && uiSurface === 'liquid' && supportsWinAcrylic();
  let appliedAcrylic = false;
  if (wantAcrylic && typeof win.setBackgroundMaterial === 'function') {
    try {
      win.setBackgroundColor?.('#00000000');
      win.setBackgroundMaterial('acrylic');
      appliedAcrylic = true;
    } catch {
      appliedAcrylic = false;
    }
  }
  if (!appliedAcrylic) {
    try { win.setBackgroundMaterial?.('none'); } catch {}
    win.setBackgroundColor?.(theme === 'dark' ? '#101822' : '#e9f1f5');
  }
  if (isControl && process.platform === 'win32') {
    win.setTitleBarOverlay?.({
      color: '#00000000',
      symbolColor: theme === 'dark' ? '#d0e4ee' : '#315262',
      height: 48,
    });
  }
  return appliedAcrylic;
}
function applyWindowTheme(theme) {
  controlAcrylicActive = applyWindowSurface(controlWindow, theme, desktopPrefs.uiSurface, { isControl: true, allowAcrylic: true });
  for (const tile of tiles.values()) {
    applyWindowSurface(tile.window, theme, desktopPrefs.uiSurface, { isControl: false, allowAcrylic: true });
  }
}
function sendDisplayScroll(command) {
  const sanitized = sanitizeScrollCommand(command);
  const nativeReady = !!(displayWindow && !displayWindow.isDestroyed() && state.output && !outputHeld && outputSnapshotId);
  const obsReady = !!(obsBridge.getClientCount() > 0 && !outputHeld && outputSnapshotId);
  if (!nativeReady && !obsReady) return false;
  if (nativeReady) liveContents(displayWindow)?.send?.('output:scroll', sanitized);
  if (obsReady) obsBridge.pushScroll(sanitized);
  return true;
}

async function http(base, relative, method = 'GET', body, token, { binary = false, timeout = 8000, scoped = false } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  if (scoped) pendingRequests.add(controller);
  try {
    const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    const response = await fetch(`${base}${relative}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const fallback = response.status === 404 ? '未找到风铃接口（HTTP 404），请检查网站地址和部署版本' : response.status === 401 ? '授权无效、已过期或已撤销，请在网页重新生成连接密钥' : response.status === 403 ? '此授权没有执行该操作的权限' : `网站请求失败（HTTP ${response.status}）`;
      const e = new Error(response.status === 404 ? fallback : data.error || fallback); e.status = response.status; e.code = data.code || 'REMOTE_ERROR'; throw e;
    }
    if (binary) {
      const mimeType = response.headers.get('content-type')?.split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('图片格式无效');
      const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 5 * 1024 * 1024) throw new Error('图片过大');
      return { image: bytes.toString('base64'), mimeType };
    }
    try { return await response.json(); } catch { throw Object.assign(new Error('网站返回了无法识别的响应，请检查网站地址和部署版本'), { code: 'REMOTE_INVALID_RESPONSE', status: response.status }); }
  } catch (error) {
    if (error.code && typeof error.status === 'number') throw error;
    if (controller.signal.aborted) throw Object.assign(new Error('连接网站超时，请检查网络后重试'), { code: 'REMOTE_TIMEOUT', status: 0 });
    throw Object.assign(new Error('无法连接网站，请检查网络、HTTPS 证书和网站地址'), { code: 'REMOTE_UNREACHABLE', status: 0 });
  } finally { clearTimeout(timer); pendingRequests.delete(controller); }
}

function connectionFailure(error) {
  const messages = {
    OPERATION_CANCELLED: '已取消连接，原信箱及未保存内容仍然保留',
    CONNECTION_KEY_INVALID: '连接密钥无效，请从网页重新复制完整密钥',
    CONNECTION_KEY_EXPIRED: '连接密钥已过期，请在网页生成新的密钥',
    CONNECTION_KEY_REVOKED: '连接密钥已被撤销，请在网页生成新的密钥',
    CONNECTION_CHANGED: '信箱选择已更新，旧连接请求已取消',
    CONNECTION_KEYS_UNSUPPORTED: '此网站尚未支持密钥连接，请先部署风铃 0.6.1 或使用旧版浏览器配对',
    CONNECTION_SITE_MISMATCH: '此密钥不属于当前网站实例，请从正确的网站重新生成',
    CREDENTIAL_ENCRYPTION_UNAVAILABLE: '系统凭据加密暂不可用，无法保存连接，请稍后重试',
    CREDENTIAL_SAVE_FAILED: '无法保存加密连接，原有连接未更改，请检查磁盘空间和目录权限后重试',
    REMOTE_INVALID_RESPONSE: '网站返回了无法识别的响应，请检查网站地址和部署版本',
    REMOTE_TIMEOUT: '连接网站超时，请检查网络后重试',
    REMOTE_UNREACHABLE: '无法连接网站，请检查网络、HTTPS 证书和网站地址',
  };
  const code = typeof error.code === 'string' && Object.prototype.hasOwnProperty.call(messages, error.code) ? error.code : 'CONNECTION_FAILED';
  const message = messages[code] || (error.status === 404 ? '未找到风铃接口（HTTP 404），请检查网站地址和部署版本' : error.status === 401 ? '连接密钥无效、已过期或已撤销，请在网页重新生成' : error.status === 403 ? '此密钥没有管理信箱的权限' : error.status === 429 ? '连接过于频繁，请稍后重试' : '连接失败，请检查网站状态后重试');
  return Object.assign(new Error(message), { code, status: error.status || 0 });
}

async function importConnectionKey(input) {
  let key;
  try { key = parseWindChimeConnectionKey(input); } catch { throw Object.assign(new Error('连接密钥格式无效或版本不支持，请复制网页生成的完整密钥'), { code: 'CONNECTION_KEY_INVALID', status: 0 }); }
  await vaultStore.waitForCommit();
  const attempt = ++importVersion, selectedVersion = selectionVersion, sites = state.sites;
  const assertConnection = vaultStore.beginAttempt();
  const assertAttempt = () => { assertConnection(); if (attempt !== importVersion || selectedVersion !== selectionVersion || sites !== state.sites || switching) throw vaultStore.connectionChanged(); };
  try {
    if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error(), { code: 'CREDENTIAL_ENCRYPTION_UNAVAILABLE' });
    const capability = await http(`${key.origin}/api/mail/live`, '/capabilities'); assertAttempt();
    if (capability.protocolVersion !== 1 || capability.features?.connectionKeys !== true) throw Object.assign(new Error(), { code: 'CONNECTION_KEYS_UNSUPPORTED' });
    if (capability.siteId !== key.siteId) throw Object.assign(new Error(), { code: 'CONNECTION_SITE_MISMATCH' });
    const identity = await http(`${key.origin}/api/mail/live`, '/control/identity', 'GET', undefined, key.token); assertAttempt();
    if (identity.siteId !== key.siteId) throw Object.assign(new Error(), { code: 'CONNECTION_SITE_MISMATCH' });
    const scope = identity.scope ?? 'topic';
    if (!['site', 'topic'].includes(scope) || (scope === 'site' && (identity.topicId !== null || capability.features?.siteControl !== true))) throw Object.assign(new Error(), { code: 'REMOTE_INVALID_RESPONSE' });
    for (const field of ['grantId', 'label', ...(scope === 'topic' ? ['topicId', 'topicTitle'] : [])]) if (typeof identity[field] !== 'string' || identity[field].length > 200 || (field === 'topicId' && !identity[field])) throw Object.assign(new Error(), { code: 'REMOTE_INVALID_RESPONSE' });
    if (!Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now()) throw Object.assign(new Error(), { code: 'CONNECTION_KEY_EXPIRED' });
    const existing = state.sites.find(site => site.origin === key.origin && site.siteId === key.siteId && site.token === key.token && site.topicId === identity.topicId);
    const site = restoreSite({ id: existing?.id ?? crypto.randomUUID(), origin: key.origin, siteId: identity.siteId, scope, topicId: identity.topicId, selectedTopicId: existing?.selectedTopicId ?? null, mailManagement: capability.features?.mailManagement === true, token: key.token, label: identity.label || identity.topicTitle || new URL(key.origin).hostname, expiresAt: identity.expiresAt });
    await vaultStore.persistImported(site, assertAttempt);
    return publicSite(site);
  } catch (error) { throw connectionFailure(error); }
}

function requireSite() { if (switching) throw new Error('正在切换信箱，请稍候'); const site = selected(); if (!site) throw new Error('请先连接并选择信箱'); return site; }
function context() { return { site: requireSite(), version: selectionVersion }; }
function isCurrent(value) { return !switching && value.version === selectionVersion && value.site.id === state.selected; }
function assertCurrent(value) { if (!isCurrent(value)) { const error = new Error('信箱已切换，旧操作已取消'); error.code = 'CONNECTION_CHANGED'; throw error; } }
function writeCommand(operation) { const result = writeTail.then(operation); writeTail = result.catch(() => {}); return result; }
function siteRequest(site, request, options) { return http(`${site.origin}/api/mail/live`, request.path, request.method, request.body, site.token, { scoped: true, ...options }); }
function assertWindow(event, kind) {
  const window = kind === 'display' ? displayWindow : controlWindow;
  if (window && event.sender.id === window.webContents.id && event.senderFrame === window.webContents.mainFrame) return window;
  if (kind === 'private') {
    const tile = [...tiles.values()].find(item => event.sender.id === item.window.webContents.id && event.senderFrame === item.window.webContents.mainFrame);
    if (tile) { assertTile(tile); return tile.window; }
  }
  throw new Error('未经授权的窗口');
}
function handle(channel, kind, operation, bound = false) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { const window = assertWindow(event, kind), tile = tileFor(window); const data = await (bound ? operation(window, ...args) : operation(...args)); if (tile) assertTile(tile); return { ok: true, data }; }
    catch (error) { return { ok: false, error: error.message || '操作失败', code: error.code || 'DESKTOP_ERROR', status: error.status || 0 }; }
  });
}

function applyConfirmedFrame(result, site, source = 'native') {
  const nextSnapshotId = result.snapshot?.id ?? null;
  if (nextSnapshotId !== outputSnapshotId) broadcastScrollState(null);
  if (nextSnapshotId && outputTestCard) broadcastTestCard(false);
  outputSnapshotId = nextSnapshotId;
  broadcastOnAir(snapshotToOnAir(result.snapshot));
  if (result.appearance && typeof result.appearance === 'object') {
    outputAppearance = result.appearance;
    if (outputTestCard && !nextSnapshotId) {
      const payload = { active: true, appearance: outputAppearance };
      liveContents(displayWindow)?.send?.('output:test-card', payload);
      obsBridge.pushTestCard(payload);
    }
  }
  if (nextSnapshotId) {
    lastLiveFrame = {
      snapshot: result.snapshot,
      appearance: result.appearance || outputAppearance,
      activation: result.activation,
      epoch: result.epoch,
    };
    const key = obsBridge.getKey();
    if (obsBridge.getClientCount() > 0 && key) {
      obsBridge.pushFrame({ ...lastLiveFrame, basePath: `/obs/${key}` });
    }
    void sessionHistory.record({
      snapshot: result.snapshot,
      siteLabel: site?.label || '',
      topicTitle: lastKnownTopicTitle || activeTopic(site) || '',
    }).catch(() => {});
  } else {
    lastLiveFrame = null;
    if (source === 'obs' && !outputTestCard) obsBridge.pushBlank();
  }
}

function stopObsPoller() {
  obsPollVersion++;
  obsPollActive = false;
  clearTimeout(obsPollTimer);
  obsPollTimer = null;
  obsGrant = null;
  obsReceiverId = null;
  obsEpoch = null;
}

async function startObsPoller() {
  if (obsPollActive || quitting || pendingOutputClears || outputHeld || (displayWindow && !displayWindow.isDestroyed())) return;
  const site = selected();
  if (!site || !activeTopic(site) || obsBridge.getClientCount() === 0) return;
  obsPollActive = true;
  const pollVersion = ++obsPollVersion;
  const scope = { site, version: selectionVersion };

  const alive = () =>
    obsPollActive &&
    pollVersion === obsPollVersion &&
    !quitting &&
    !pendingOutputClears &&
    !outputHeld &&
    isCurrent(scope) &&
    obsBridge.getClientCount() > 0 &&
    (!displayWindow || displayWindow.isDestroyed());

  const schedule = ms => {
    clearTimeout(obsPollTimer);
    if (!alive()) return;
    obsPollTimer = setTimeout(() => void tick(), ms);
    obsPollTimer.unref?.();
  };

  async function tick() {
    if (!alive()) { stopObsPoller(); return; }
    try {
      if (!obsGrant) {
        const grant = await siteRequest(scope.site, { path: '/control/grants', method: 'POST', body: { topicId: activeTopic(scope.site), kind: 'display', label: 'OBS 本地浏览器源' } });
        if (!alive()) return;
        obsGrant = grant;
      }
      const startedAt = performance.now();
      if (!obsReceiverId) {
        const opened = await http(`${scope.site.origin}/api/mail/live`, '/display/open', 'POST', {}, obsGrant.token, { timeout: 2400 });
        if (!alive()) return;
        if (typeof opened.receiverId !== 'string' || typeof opened.epoch !== 'string') throw new Error('展示接收端无效');
        obsReceiverId = opened.receiverId;
        obsEpoch = opened.epoch;
        confirmOutputLease(opened, startedAt);
      }
      const frame = await http(`${scope.site.origin}/api/mail/live`, `/display/frame?receiverId=${encodeURIComponent(obsReceiverId)}`, 'GET', undefined, obsGrant.token, { timeout: 2400 });
      if (!alive()) return;
      if (frame.receiverId !== obsReceiverId || frame.epoch !== obsEpoch) {
        obsReceiverId = null;
        obsEpoch = null;
        obsBridge.pushBlank();
        schedule(500);
        return;
      }
      confirmOutputLease(frame, startedAt);
      if (outputSnapshotId && !frame.snapshot) {
        outputSnapshotId = null;
        lastLiveFrame = null;
        broadcastScrollState(null);
        broadcastOnAir(null);
        obsBridge.pushBlank();
      } else {
        applyConfirmedFrame(frame, scope.site, 'obs');
      }
      schedule(500);
    } catch (error) {
      if (!alive()) return;
      outputSnapshotId = null;
      lastLiveFrame = null;
      outputDeadline = 0;
      broadcastScrollState(null);
      broadcastOnAir(null);
      obsBridge.pushBlank();
      obsReceiverId = null;
      obsEpoch = null;
      if (error?.status === 401 || error?.status === 403) obsGrant = null;
      schedule(1200);
    }
  }

  void tick();
}

function terminateRenderer(window) {
  const contents = liveContents(window); if (!contents) return Promise.resolve(false);
  const pending = rendererTerminations.get(window); if (pending) return pending;
  if (contents.isCrashed()) return Promise.resolve(true);
  let finish, fail;
  const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const cleanup = () => { clearTimeout(timer); contents.removeListener('render-process-gone', gone); contents.removeListener('destroyed', destroyed); window.removeListener('closed', destroyed); if (rendererTerminations.get(window) === promise) rendererTerminations.delete(window); };
  const gone = () => { cleanup(); finish(liveContents(window) === contents); };
  const destroyed = () => { cleanup(); finish(false); };
  const timer = setTimeout(() => { cleanup(); fail(new Error('展示进程未及时退出')); }, 2000); timer.unref();
  rendererTerminations.set(window, promise); contents.once('render-process-gone', gone); contents.once('destroyed', destroyed); window.once('closed', destroyed);
  try { contents.forcefullyCrashRenderer(); }
  catch (error) { cleanup(); if (liveContents(window) !== contents) finish(false); else fail(error); }
  return promise;
}
async function paintHeldOutput(held) {
  const window = held.window;
  if (!window || window.isDestroyed()) return false;
  const owned = () => window === displayWindow && held.version === outputVersion && outputHeld;
  const contents = liveContents(window);
  const current = () => owned() && !quitting && liveContents(window) === contents;
  if (!contents) { if (owned()) closeOutput(window); return false; }
  let timer;
  try {
    if (!await terminateRenderer(window)) { if (owned()) closeOutput(window); return false; }
    if (!current()) return false;
    await Promise.race([window.loadURL(blankDocument), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('空白画面加载超时')), 500); })]);
    if (!current()) return false;
    window.showInactive(); return true;
  } catch {
    if (owned()) closeOutput(window); return false;
  } finally { clearTimeout(timer); }
}
function blank(paint = true) {
  shortcuts.bumpNextVersion();
  const held = { window: displayWindow, version: ++outputVersion, painted: Promise.resolve(false) };
  outputDeadline = 0; outputHeld = true;
  outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputSnapshotId = null; lastLiveFrame = null;
  stopObsPoller();
  broadcastScrollState(null);
  broadcastOnAir(null);
  if (outputTestCard) broadcastTestCard(false);
  obsBridge.pushBlank();
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.hide();
    void terminateRenderer(displayWindow).catch(() => {});
  }
  if (paint) held.painted = paintHeldOutput(held);
  return held;
}
async function resumeOutput(held) {
  await held.painted;
  if (!quitting && !pendingOutputClears && held.version === outputVersion) {
    if (held.window === displayWindow && displayWindow) await recoverOutput(held.window);
    else {
      outputHeld = false;
      if (obsBridge.getClientCount() > 0) void startObsPoller();
    }
  }
}
async function clearOutputWith(operation) {
  const held = blank(); pendingOutputClears++;
  let result;
  try { result = await operation(); } finally { pendingOutputClears--; }
  await resumeOutput(held); return result;
}
async function recoverOutput(window = displayWindow, crashed = false) {
  if (quitting || pendingOutputClears || !window || window !== displayWindow || window.isDestroyed() || recoveringWindows.has(window)) return;
  const contents = liveContents(window); if (!contents) { closeOutput(window); return; }
  recoveringWindows.add(window); outputDeadline = 0; outputHeld = true;
  outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputSnapshotId = null; lastLiveFrame = null;
  broadcastScrollState(null);
  broadcastOnAir(null);
  if (outputTestCard) broadcastTestCard(false);
  obsBridge.pushBlank();
  const version = ++outputVersion;
  const owned = () => window === displayWindow && version === outputVersion;
  const current = () => owned() && !quitting && !pendingOutputClears && liveContents(window) === contents;
  window.hide();
  try {
    if (!crashed && !await terminateRenderer(window)) { if (owned()) closeOutput(window); return; }
    if (!current()) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); contents.removeListener('did-finish-load', loaded); contents.removeListener('did-fail-load', failed); contents.removeListener('destroyed', destroyed); };
      const loaded = () => { cleanup(); resolve(); };
      const failed = (_event, code, _description, _url, isMainFrame) => { if (isMainFrame) { cleanup(); reject(new Error(`展示加载失败 (${code})`)); } };
      const destroyed = () => { cleanup(); reject(new Error('展示窗口已关闭')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('展示加载超时')); }, 5000); timer.unref();
      contents.once('did-finish-load', loaded); contents.on('did-fail-load', failed); contents.once('destroyed', destroyed);
      void window.loadFile(path.join(__dirname, 'build/display.html')).catch(error => { cleanup(); reject(error); });
    });
    if (current()) {
      outputHeld = false;
      liveContents(window)?.send?.('output:overlay', overlayStore.get());
      window.showInactive();
    }
  } catch (error) {
    console.error('WindChime display recovery failed:', error.message);
    if (owned()) closeOutput(window);
  } finally { recoveringWindows.delete(window); }
}
function confirmOutputLease(result, startedAt) {
  if (!Number.isFinite(result?.leaseMs) || result.leaseMs <= 0) throw new Error('展示租期无效');
  outputDeadline = startedAt + Math.min(result.leaseMs, 3000) - 400;
  if (performance.now() >= outputDeadline) {
    if (displayWindow && !displayWindow.isDestroyed()) void recoverOutput();
    else obsBridge.pushBlank();
    throw new Error('展示租期已失效');
  }
}
function syncDisplaySize(appearance) {
  if (!displayWindow || displayWindow.isDestroyed() || !appearance || typeof appearance !== 'object') return;
  const width = Number.isFinite(appearance.maxWidth) ? Math.round(Math.min(1920, Math.max(280, appearance.maxWidth))) : 1200;
  const height = Number.isFinite(appearance.viewportHeight) ? Math.round(Math.min(1080, Math.max(180, appearance.viewportHeight))) : 640;
  if (displaySize.width === width && displaySize.height === height) return;
  displaySize = { width, height };
  displayWindow.setContentSize?.(width, height);
}
function closeOutput(expectedWindow = displayWindow) {
  if (expectedWindow !== displayWindow) return;
  const old = displayWindow; blank(false); displayWindow = null; state.output = null; displaySize = { width: 960, height: 640 }; outputDeadline = 0; outputHeld = false; outputVersion++;
  if (old && !old.isDestroyed()) old.close();
}
function hideSite(site) {
  if (!site || !activeTopic(site)) return Promise.resolve();
  return writeCommand(() => siteRequest(site, { path: '/control/action', method: 'POST', body: { topicId: activeTopic(site), action: 'hide', expectedRevision: 0, operationId: crypto.randomUUID() } }));
}
async function selectSite(id) {
  await vaultStore.waitForCommit();
  if (id !== null && !state.sites.some(site => site.id === id)) throw new Error('信箱不存在');
  const assertAttempt = vaultStore.beginAttempt();
  if (!switching && state.selected === id) return selected() ? publicSite(selected()) : null;
  return vaultStore.persist(state.sites, id, assertAttempt);
}
async function selectTopic(id, connectionId) {
  await vaultStore.waitForCommit();
  const scope = context(), site = scope.site;
  if (connectionId !== site.id) throw new Error('网站已切换，旧话题选择已取消');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error('无效话题');
  if (site.scope !== 'site' && id !== site.topicId) throw new Error('旧版话题密钥只能访问原话题，请在网站生成站点密钥');
  if (activeTopic(site) === id) return publicSite(site);
  const assertAttempt = vaultStore.beginAttempt();
  const topic = await siteRequest(site, { path: `/control/topics/${encodeURIComponent(id)}`, method: 'GET' });
  await vaultStore.waitForCommit(); assertCurrent(scope); assertAttempt();
  if (topic.id !== id) throw new Error('网站返回了不匹配的话题');
  lastKnownTopicTitle = typeof topic.title === 'string' ? topic.title : '';
  const next = { ...site, selectedTopicId: id };
  return vaultStore.persist(state.sites.map(item => item.id === site.id ? next : item), site.id, assertAttempt);
}
async function hide() {
  return clearOutputWith(() => hideSite(selected()));
}
function secureWindow(window, partition) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const isolated = session.fromPartition(partition);
  isolated.setPermissionRequestHandler((_, __, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, callback) => callback({ cancel: true }));
}
async function openDisplay(initiatingTile) {
  if (initiatingTile) assertTile(initiatingTile);
  if (pendingOutputClears) throw new Error('正在隐藏展示，请稍候');
  if (displayWindow && !displayWindow.isDestroyed() && state.output) { if (outputHeld) await recoverOutput(); else displayWindow.show(); return; }
  const scope = context(), site = scope.site;
  stopObsPoller();
  closeOutput();
  const version = outputVersion;
  if (!activeTopic(site)) throw new Error('请先选择话题');
  const grant = await siteRequest(site, { path: '/control/grants', method: 'POST', body: { topicId: activeTopic(site), kind: 'display', label: '桌面展示窗口' } });
  assertCurrent(scope); if (initiatingTile) assertTile(initiatingTile); if (version !== outputVersion) throw new Error('展示请求已取消');
  state.output = grant;
  const partition = `windchime-display-${crypto.randomUUID()}`;
  displaySize = { width: 960, height: 640 };
  const savedPos = fitDisplayPosition(workspaceStore.get().displayBounds, displaySize, screen?.getAllDisplays().map(d => d.workArea));
  displayWindow = new BrowserWindow({
    width: 960,
    height: 640,
    ...savedPos,
    title: 'WindChime Display',
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload-display.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition, spellcheck: false, backgroundThrottling: false },
  });
  secureWindow(displayWindow, partition);
  const window = displayWindow;
  window.on('moved', () => {
    if (displayWindow !== window || window.isDestroyed()) return;
    clearTimeout(displayMoveTimer);
    displayMoveTimer = setTimeout(() => {
      if (displayWindow !== window || window.isDestroyed()) return;
      const b = window.getBounds?.();
      if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
        void workspaceStore.save({ displayBounds: { x: Math.round(b.x), y: Math.round(b.y) } }).catch(() => {});
      }
    }, 250);
    displayMoveTimer.unref?.();
  });
  window.on('closed', () => {
    if (displayWindow !== window) return;
    displayWindow = null; state.output = null; displaySize = { width: 960, height: 640 };
    outputAppearance = null; outputDeadline = 0; outputVersion++; lastLiveFrame = null;
    broadcastScrollState(null); broadcastOnAir(null);
    if (outputTestCard) broadcastTestCard(false);
    obsBridge.pushBlank();
    if (obsBridge.getClientCount() > 0 && isCurrent(scope)) void startObsPoller();
    else if (isCurrent(scope)) void hideSite(site).catch(() => {});
  });
  window.webContents.on('unresponsive', () => { if (!outputHeld) void recoverOutput(window); });
  window.webContents.on('render-process-gone', () => { if (!outputHeld) void recoverOutput(window, true); });
  await window.loadFile(path.join(__dirname, 'build/display.html'));
  assertCurrent(scope); if (displayWindow !== window || version !== outputVersion || window.isDestroyed()) throw new Error('展示窗口已关闭');
  liveContents(window)?.send?.('output:overlay', overlayStore.get());
  window.showInactive();
}

async function start() {
  const userDataDir = app.getPath('userData');
  vaultPath = path.join(userDataDir, 'devices.v1.enc');
  workspacePath = path.join(userDataDir, 'workspace.v1.json');
  historyPath = path.join(userDataDir, 'play-history.v1.json');
  overlayDir = path.join(userDataDir, 'local-overlay');
  updatesDir = path.join(userDataDir, 'updates');

  await vaultStore.read();
  const ws = await workspaceStore.read();
  await overlayStore.read();
  await sessionHistory.read();

  desktopTheme = ws.theme === 'dark' ? 'dark' : 'light';
  desktopPrefs = {
    randomDrawEnabled: ws.randomDrawEnabled === true,
    clearOnBlindDraw: ws.clearOnBlindDraw === true,
    chimeEnabled: ws.chimeEnabled === true,
    chimeVolume: Number.isFinite(ws.chimeVolume) ? ws.chimeVolume : 70,
    startupView: ws.startupView === 'inbox' || ws.startupView === 'studio' ? ws.startupView : 'last',
    lastView: ws.lastView ?? null,
    autoCheckUpdate: ws.autoCheckUpdate !== false,
    uiSurface: ws.uiSurface === 'standard' || ws.uiSurface === 'lite' ? ws.uiSurface : 'liquid',
  };

  if (ws.obsBridge) {
    try {
      await obsBridge.configure({
        enabled: ws.obsBridge.enabled === true,
        port: ws.obsBridge.port ?? 17420,
        key: ws.obsBridge.key,
      });
    } catch (error) {
      connectionError(error.message || '本地 OBS 浏览器源启动失败');
    }
  }

  const partition = 'persist:windchime-private';
  const controlUseAcrylic = desktopPrefs.uiSurface === 'liquid' && supportsWinAcrylic();
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 760,
    minHeight: 620,
    title: '风铃 · 私人控制台',
    icon: path.join(__dirname, 'build/icon.ico'),
    backgroundColor: controlUseAcrylic ? '#00000000' : desktopTheme === 'dark' ? '#101822' : '#e9f1f5',
    ...(controlUseAcrylic ? { backgroundMaterial: 'acrylic' } : {}),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: desktopTheme === 'dark' ? '#d0e4ee' : '#315262', height: 48 }, autoHideMenuBar: true } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload-control.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition, spellcheck: false },
  });
  controlAcrylicActive = applyWindowSurface(controlWindow, desktopTheme, desktopPrefs.uiSurface, { isControl: true, allowAcrylic: true });
  secureWindow(controlWindow, partition);
  controlWindow.on('close', event => { if (!quitting) { event.preventDefault(); controlWindow.hide(); } });
  for (const event of ['blur', 'hide', 'closed']) controlWindow.on(event, () => shortcuts.setRecording(false, () => performance.now()));

  ipcMain.handle('sites:list', async event => {
    try {
      const window = assertWindow(event, 'private');
      return { ok: true, data: { items: (tileFor(window) ? state.sites.filter(site => site.id === state.selected) : state.sites).map(publicSite), selectedId: state.selected } };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'DESKTOP_ERROR' };
    }
  });
  handle('sites:import-key', 'control', importConnectionKey);
  handle('sites:pair', 'control', async input => {
    const origin = normalizeOrigin(input.origin); const label = String(input.label || new URL(origin).hostname).slice(0, 80);
    const capability = await http(`${origin}/api/mail/live`, '/capabilities'); if (capability.protocolVersion !== 1) throw new Error('此网站尚未升级风铃直播功能');
    const secret = verifier(); const pending = await http(`${origin}/api/mail/live`, '/devices/request', 'POST', { deviceName: `${app.getName()} · ${require('node:os').hostname()}`, challenge: challenge(secret) });
    const id = crypto.randomUUID(); state.pairings.set(id, { ...pending, origin, label, verifier: secret, siteId: capability.siteId });
    const approval = new URL('/mail', origin); approval.searchParams.set('userCode', pending.userCode); await shell.openExternal(approval.href);
    return { id, userCode: pending.userCode, expiresAt: pending.expiresAt };
  });
  handle('sites:pair-status', 'control', async id => {
    const pairing = state.pairings.get(id); if (!pairing) return { status: 'expired' };
    const pendingIntent = vaultStore.getIntent(), pendingVersion = selectionVersion, pendingSites = state.sites;
    if (!pairing.approvedSite) {
      const result = await http(`${pairing.origin}/api/mail/live`, '/devices/poll', 'POST', { deviceCode: pairing.deviceCode, verifier: pairing.verifier });
      if (result.status !== 'approved') return { status: result.status };
      pairing.approvedSite = restoreSite({ id: crypto.randomUUID(), label: pairing.label, origin: pairing.origin, siteId: pairing.siteId, topicId: result.topicId, token: result.token, expiresAt: result.expiresAt });
    }
    const site = pairing.approvedSite;
    await vaultStore.waitForCommit();
    if (state.pairings.get(id) !== pairing) return { status: 'expired' };
    if (pendingIntent !== vaultStore.getIntent() || pendingVersion !== selectionVersion || pendingSites !== state.sites) throw vaultStore.connectionChanged();
    const assertConnection = vaultStore.beginAttempt();
    const assertAttempt = () => { assertConnection(); if (state.pairings.get(id) !== pairing) throw vaultStore.connectionChanged(); };
    await vaultStore.persistImported(site, assertAttempt);
    state.pairings.delete(id); return { status: 'approved', site: publicSite(site) };
  });
  handle('sites:pair-cancel', 'control', async id => {
    const approvedId = state.pairings.get(id)?.approvedSite?.id;
    state.pairings.delete(id);
    await vaultStore.waitForCommit();
    return { connected: !!approvedId && state.sites.some(site => site.id === approvedId) };
  });
  handle('sites:select', 'control', async id => { if (vaultStore.hasPendingCommit()) await vaultStore.waitForCommit(); return selectSite(id); });
  handle('sites:select-topic', 'control', selectTopic);
  handle('sites:forget', 'control', async id => {
    await vaultStore.waitForCommit();
    const assertAttempt = vaultStore.beginAttempt(), sites = state.sites.filter(site => site.id !== id);
    await vaultStore.persist(sites, id === state.selected ? sites[0]?.id ?? null : state.selected, assertAttempt);
  });
  handle('control:request', 'private', async (window, input) => {
    const initiatingTile = tileFor(window);
    const scope = context(), site = scope.site;
    if (input.connectionId !== undefined && input.connectionId !== site.id) throw new Error('网站已切换，旧操作已取消');
    const request = validateRequest(input, 'control', activeTopic(site), site.scope ?? 'topic');
    try {
      const execute = () => { assertCurrent(scope); if (initiatingTile) assertTile(initiatingTile); return siteRequest(site, request, { binary: request.path.startsWith('/control/assets/') }); };
      const perform = () => request.method === 'GET' ? execute() : writeCommand(execute);
      const result = await (request.body?.action === 'hide' || request.body?.action === 'end' ? clearOutputWith(perform) : perform());
      assertCurrent(scope);
      if (request.method === 'GET' && request.path.startsWith('/control/topics/') && typeof result?.title === 'string') {
        lastKnownTopicTitle = result.title;
      }
      return result;
    } catch (error) { if (isCurrent(scope) && (error.status === 401 || error.status === 403)) { blank(); state.output = null; } throw error; }
  }, true);
  handle('control:hide', 'private', hide);
  handle('control:upload', 'private', async input => {
    const scope = context(), site = scope.site;
    if (!input || typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.messageId) || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType)) throw new Error('请上传不超过 5 MiB 的静态 PNG、JPEG 或 WebP 图片');
    if (input.connectionId !== undefined && input.connectionId !== site.id) throw new Error('网站已切换，旧操作已取消');
    if (!activeTopic(site)) throw new Error('请先选择话题');
    const form = new FormData(); form.set('topicId', activeTopic(site)); form.set('messageId', input.messageId); form.set('file', new Blob([input.bytes], { type: input.mimeType }), 'review-image');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${site.origin}/api/mail/live/control/upload`, { method: 'POST', body: form, headers: { authorization: `Bearer ${site.token}` }, signal: controller.signal, redirect: 'error' });
      const body = await response.json(); assertCurrent(scope); if (!response.ok) throw new Error(body.error || '图片上传失败'); return body.attachments?.[0] ?? body;
    } finally { clearTimeout(timeout); }
  });
  handle('display:open', 'private', window => openDisplay(tileFor(window)), true);
  handle('display:scroll', 'private', command => { sendDisplayScroll(command); });
  handle('display:scroll-state', 'private', () => outputScrollState);
  handle('display:on-air', 'private', () => outputOnAir);
  handle('display:test-card-get', 'private', () => outputTestCard);
  handle('display:test-card', 'private', async (window, active) => {
    const enabled = Boolean(active);
    if (enabled) {
      if (outputSnapshotId) throw new Error('当前正在播出真实来信，请先一键隐藏后再发送测试卡');
      const hasObs = obsBridge.getClientCount() > 0;
      if (!hasObs && (!displayWindow || displayWindow.isDestroyed() || !state.output)) {
        await openDisplay(tileFor(window));
      }
      broadcastTestCard(true);
      return true;
    }
    broadcastTestCard(false);
    return false;
  }, true);
  handle('display:scroll-metrics', 'display', metrics => { broadcastScrollState(sanitizeScrollMetrics(metrics)); });
  handle('display:overlay-get', 'display', () => overlayStore.get());
  handle('display:request', 'display', async input => {
    const scope = context(), version = outputVersion;
    const request = validateRequest(input, 'display'); const output = state.output; if (!output) throw new Error('展示未连接');
    if (outputHeld && !recoveringWindows.has(displayWindow)) throw new Error('展示已隐藏');
    const opening = request.path === '/display/open';
    if (opening && outputSnapshotId) { void recoverOutput(); throw new Error('展示连接已更新'); }
    if (opening) { outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputDeadline = 0; }
    const receiverVersion = outputReceiverVersion;
    const requestUrl = new URL(request.path, 'https://local.invalid');
    const receiverId = requestUrl.searchParams.get('receiverId');
    if (!opening && (!outputReceiverId || receiverId !== outputReceiverId)) throw new Error('展示接收端已更新');
    const assetRequest = request.path.startsWith('/display/assets/');
    const assetSnapshotId = outputSnapshotId;
    const ownsAsset = () => !assetRequest || (assetSnapshotId === outputSnapshotId && requestUrl.searchParams.get('activation') === String(output.frameActivation));
    const startedAt = performance.now();
    try {
      const result = await http(`${scope.site.origin}/api/mail/live`, request.path, request.method, request.body, output.token, { binary: assetRequest, timeout: 2400 });
      assertCurrent(scope); if (version !== outputVersion || output !== state.output || receiverVersion !== outputReceiverVersion) throw new Error('展示连接已更新');
      if (!ownsAsset()) throw new Error('图片所属展示已切换');
      if (opening) {
        if (typeof result.receiverId !== 'string' || typeof result.epoch !== 'string') throw new Error('展示接收端无效');
        outputReceiverId = result.receiverId; outputEpoch = result.epoch;
        liveContents(displayWindow)?.send?.('output:overlay', overlayStore.get());
        if (outputTestCard) liveContents(displayWindow)?.send?.('output:test-card', { active: true, appearance: outputAppearance });
      }
      if (request.path.startsWith('/display/frame?')) {
        if (result.receiverId !== outputReceiverId || result.epoch !== outputEpoch) throw new Error('展示接收端已更新');
        if (outputSnapshotId && !result.snapshot) { void recoverOutput(); throw new Error('当前展示已撤下'); }
        output.frameActivation = result.activation;
        applyConfirmedFrame(result, scope.site, 'native');
        syncDisplaySize(result.appearance);
      }
      if (opening || request.path.startsWith('/display/frame?')) confirmOutputLease(result, startedAt);
      return result;
    } catch (error) {
      if (isCurrent(scope) && version === outputVersion && output === state.output && receiverVersion === outputReceiverVersion) {
        if (error.status === 401 || error.status === 403) { blank(); state.output = null; }
        else if (ownsAsset() && (outputSnapshotId || outputDeadline)) void recoverOutput();
      }
      throw error;
    }
  });

  ipcMain.handle('app:status', async event => {
    try {
      const window = assertWindow(event, 'private');
      const tile = tileFor(window);
      const sc = shortcuts.getStatus();
      const obs = obsBridge.getStatus();
      return {
        ok: true,
        data: {
          version: appVersion,
          connectionError: state.connectionError,
          displayOpen: !!displayWindow,
          obsRunning: obs.running,
          obsClients: obs.clientCount,
          ...sc,
          tiles: [...tiles.values()].map(tileMetadata),
          tile: tile ? tileMetadata(tile) : null,
          selectedMessageId,
          contextVersion: selectionVersion,
        },
      };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'DESKTOP_ERROR' };
    }
  });
  handle('tiles:open', 'control', openTile);
  ipcMain.handle('tiles:close', async (event, module) => { try { const window = assertWindow(event, 'private'), own = tileFor(window); if (own && own.module !== module) throw new Error('不可关闭其他磁贴'); await closeTile(module); return { ok: true }; } catch (error) { return { ok: false, error: error.message, code: error.code || 'DESKTOP_ERROR' }; } });
  ipcMain.handle('tiles:pin', async (event, module, pinned) => { try { const window = assertWindow(event, 'private'), own = tileFor(window), tile = tiles.get(module); if (!tile || typeof pinned !== 'boolean' || (own && own !== tile)) throw new Error('无效磁贴'); assertTile(tile); tile.pinned = pinned; tile.window.setAlwaysOnTop(pinned); rememberTile(tile); return { ok: true, data: tileMetadata(tile) }; } catch (error) { return { ok: false, error: error.message, code: error.code || 'DESKTOP_ERROR' }; } });
  ipcMain.handle('tiles:dirty', async (event, dirty) => {
    try {
      const window = assertWindow(event, 'private');
      const tile = tileFor(window);
      if (tile) {
        if (typeof dirty !== 'boolean') throw new Error('无效编辑状态');
        tile.dirty = dirty;
      } else if (typeof dirty === 'boolean') {
        mainReviewDirty = dirty; mainOtherDirty = false; mainDirty = dirty;
      } else if (dirty && typeof dirty === 'object' && typeof dirty.review === 'boolean' && typeof dirty.other === 'boolean') {
        mainReviewDirty = dirty.review; mainOtherDirty = dirty.other; mainDirty = dirty.review || dirty.other;
      } else {
        throw new Error('无效编辑状态');
      }
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message, code: error.code || 'DESKTOP_ERROR' }; }
  });
  handle('control:select-message', 'private', (window, id, connectionId, contextVersion) => chooseMessage(id, connectionId, contextVersion, window), true);
  handle('app:next-shortcut', 'control', value => shortcuts.configureNext(value, () => performance.now()));
  handle('app:scroll-shortcuts', 'control', () => shortcuts.getScrollStatus());
  handle('app:scroll-shortcuts-set', 'control', input => shortcuts.configureScroll(input));
  handle('app:shortcut-recording', 'control', recording => shortcuts.setRecording(recording, () => performance.now()));
  handle('app:theme-get', 'private', () => desktopTheme);
  handle('app:theme-set', 'private', async theme => {
    if (theme !== 'light' && theme !== 'dark') throw new Error('无效外观主题');
    desktopTheme = theme;
    applyWindowTheme(theme);
    await workspaceStore.save({ theme });
    broadcastPrivate('app:theme-changed', theme);
    return theme;
  });
  handle('app:prefs-get', 'private', () => prefsPayload());
  handle('app:prefs-set', 'private', async patch => {
    if (!patch || typeof patch !== 'object') throw new Error('无效偏好设置');
    const next = { ...desktopPrefs };
    for (const key of ['randomDrawEnabled', 'clearOnBlindDraw', 'chimeEnabled', 'autoCheckUpdate']) {
      if (key in patch) {
        if (typeof patch[key] !== 'boolean') throw new Error('无效偏好设置');
        next[key] = patch[key];
      }
    }
    if ('chimeVolume' in patch) {
      if (!Number.isFinite(patch.chimeVolume) || patch.chimeVolume < 0 || patch.chimeVolume > 100) throw new Error('无效提示音量');
      next.chimeVolume = Math.round(patch.chimeVolume);
    }
    if ('startupView' in patch) {
      if (!['inbox', 'studio', 'last'].includes(patch.startupView)) throw new Error('无效启动页');
      next.startupView = patch.startupView;
    }
    if ('lastView' in patch) {
      if (patch.lastView !== null && !['inbox', 'studio', 'topics', 'share', 'settings'].includes(patch.lastView)) throw new Error('无效页面记录');
      next.lastView = patch.lastView;
    }
    if ('uiSurface' in patch) {
      if (!['liquid', 'standard', 'lite'].includes(patch.uiSurface)) throw new Error('无效界面质感模式');
      next.uiSurface = patch.uiSurface;
    }
    const surfaceChanged = next.uiSurface !== desktopPrefs.uiSurface;
    desktopPrefs = next;
    if (surfaceChanged) applyWindowTheme(desktopTheme);
    await workspaceStore.save({
      randomDrawEnabled: next.randomDrawEnabled,
      clearOnBlindDraw: next.clearOnBlindDraw,
      chimeEnabled: next.chimeEnabled,
      chimeVolume: next.chimeVolume,
      startupView: next.startupView,
      lastView: next.lastView,
      autoCheckUpdate: next.autoCheckUpdate,
      uiSurface: next.uiSurface,
    });
    const out = prefsPayload();
    broadcastPrivate('app:prefs-changed', out);
    return out;
  });
  handle('app:badge-update', 'control', count => {
    const n = Number.isInteger(count) && count > 0 ? Math.min(9999, count) : 0;
    tray?.setToolTip?.(n > 0 ? `风铃 · 未拆 ${n} 封 · Ctrl+Shift+H 一键隐藏` : '风铃 · Ctrl+Shift+H 一键隐藏');
    return n;
  });

  // OBS local browser source IPC
  handle('obs:status', 'private', () => obsBridge.getStatus());
  handle('obs:configure', 'control', async patch => {
    const { status, persisted } = await obsBridge.configure(patch);
    await workspaceStore.save({ obsBridge: persisted });
    return status;
  });
  handle('obs:reset-key', 'control', async () => {
    const { status, persisted } = await obsBridge.resetKey();
    await workspaceStore.save({ obsBridge: persisted });
    return status;
  });

  // Local display overlay decoration IPC
  handle('overlay:get', 'private', () => overlayStore.get());
  handle('overlay:set', 'control', patch => overlayStore.update(patch));
  handle('overlay:pick', 'control', (window, slot) => overlayStore.pick(slot, window), true);
  handle('overlay:clear', 'control', slot => overlayStore.clear(slot));

  // Local session broadcast history IPC
  handle('history:list', 'private', () => sessionHistory.list());
  handle('history:export', 'control', async input => {
    const format = input?.format === 'csv' ? 'csv' : 'md';
    const dateKey = typeof input?.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dateKey) ? input.dateKey : undefined;
    const content = format === 'csv' ? sessionHistory.exportCsv(dateKey) : sessionHistory.exportMarkdown(dateKey);
    const defaultName = `风铃播报复盘-${dateKey || new Date().toISOString().slice(0, 10)}.${format}`;
    const result = await dialog.showSaveDialog(controlWindow, {
      title: '导出风铃播报复盘',
      defaultPath: defaultName,
      filters: [{ name: format === 'csv' ? 'CSV 表格' : 'Markdown 文档', extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, Buffer.from(content, 'utf8'));
    return true;
  });
  handle('history:clear', 'control', () => sessionHistory.clear());

  // In-app update check, download & install IPC
  handle('updater:info', 'private', () => updater.getInfo());
  handle('updater:check', 'control', () => updater.check());
  handle('updater:download', 'control', () => updater.download());
  handle('updater:cancel', 'control', () => updater.cancelDownload());
  handle('updater:install', 'control', () => updater.install());
  handle('updater:open-release', 'control', url => updater.openRelease(url));

  handle('app:confirm', 'private', async (window, input) => {
    if (!input || typeof input.message !== 'string' || input.message.length > 500) throw new Error('无效确认内容');
    const answer = await dialog.showMessageBox(window, { type: 'warning', title: '风铃', message: input.message, buttons: ['取消', '继续'], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1;
  }, true);
  handle('files:save', 'control', async input => {
    if (!input || !['png', 'csv', 'md'].includes(input.kind) || typeof input.name !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f]{1,100}$/.test(input.name)) throw new Error('无效导出文件');
    const bytes = (input.kind === 'csv' || input.kind === 'md') && typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.bytes instanceof Uint8Array ? Buffer.from(input.bytes) : null;
    if (!bytes || bytes.length > 20 * 1024 * 1024 || (input.kind === 'png' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw new Error('无效导出内容');
    const filterName = input.kind === 'png' ? 'PNG 图片' : input.kind === 'csv' ? 'CSV 表格' : 'Markdown 文档';
    const result = await dialog.showSaveDialog(controlWindow, { title: '保存风铃导出文件', defaultPath: input.name.replace(/\.(?:csv|png|md)$/i, '') + '.' + input.kind, filters: [{ name: filterName, extensions: [input.kind] }] });
    if (result.canceled || !result.filePath) return false; await fs.writeFile(result.filePath, bytes); return true;
  });
  handle('files:avatar', 'control', async () => {
    const choice = await dialog.showOpenDialog(controlWindow, { title: '选择海报头像', properties: ['openFile'], filters: [{ name: '静态图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const stat = await fs.stat(choice.filePaths[0]); if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('头像不能超过 5 MiB');
    const bytes = await fs.readFile(choice.filePaths[0]);
    const valid = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0]===255&&bytes[1]===216&&bytes[2]===255) || (bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
    if (!valid) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
    if (image.isEmpty() || size.width * size.height > 16000000) throw new Error('头像无法解码或像素过大');
    const scale = Math.min(1, 512 / Math.max(size.width, size.height));
    const normalized = image.resize({ width: Math.max(1,Math.round(size.width*scale)), height: Math.max(1,Math.round(size.height*scale)), quality: 'best' }).toPNG();
    return { image: normalized.toString('base64'), mimeType: 'image/png' };
  });
  handle('share:open', 'control', async () => {
    const scope = context(); if (!activeTopic(scope.site)) throw new Error('请先选择话题');
    const share = await siteRequest(scope.site, { path: `/control/share?topicId=${encodeURIComponent(activeTopic(scope.site))}`, method: 'GET' }); assertCurrent(scope);
    const url = new URL(share.submissionUrl); if (url.origin !== scope.site.origin || url.username || url.password || url.hash || url.search || !/^(?:\/|\/m\/[A-Za-z0-9_-]+)$/.test(url.pathname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('网站返回了不安全的投稿地址');
    await shell.openExternal(url.href); return true;
  });

  await controlWindow.loadFile(path.join(__dirname, 'build/control.html'));
  tray = new Tray(path.join(__dirname, 'build/tray.png'));
  tray.setToolTip('风铃 · Ctrl+Shift+H 一键隐藏');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开私人控制台', click: () => controlWindow.show() },
    { label: '■ 一键隐藏', click: () => void hide().catch(() => {}) },
    { label: '退出并结束展示', click: () => app.quit() },
  ]));
  tray.on('double-click', () => controlWindow.show());
  shortcuts.registerInitial(ws, () => performance.now());

  powerMonitor.on('suspend', blank);
  powerMonitor.on('resume', () => { const held = blank(false); void resumeOutput(held); });
  setInterval(() => {
    if (outputDeadline && performance.now() >= outputDeadline) {
      if (displayWindow && !displayWindow.isDestroyed()) void recoverOutput();
      else {
        outputDeadline = 0;
        outputSnapshotId = null;
        lastLiveFrame = null;
        broadcastScrollState(null);
        broadcastOnAir(null);
        obsBridge.pushBlank();
      }
    }
  }, 100).unref();
}

app.on('before-quit', event => {
  if (quitting) return; event.preventDefault(); quitting = true;
  const site = selected();
  stopObsPoller();
  void obsBridge.stop().catch(() => {});
  closeOutput();
  disposeTiles();
  Promise.race([hideSite(site).catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]).finally(() => { globalShortcut.unregisterAll(); app.quit(); });
});
app.on('window-all-closed', () => { if (!tray) app.quit(); });
