const { app, BrowserWindow, ipcMain, shell, safeStorage, globalShortcut, Tray, Menu, session, powerMonitor } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { normalizeOrigin, validateRequest, restoreSite, verifier, challenge, publicSite } = require('./security.cjs');
const { parseWindChimeConnectionKey } = require('./build/connection-key.cjs');
const state = { sites: [], selected: null, pairings: new Map(), output: null, connectionError: '' };
let controlWindow, displayWindow, tray, quitting = false, vaultPath;
let selectionVersion = 0, outputVersion = 0, switching = false;
let importVersion = 0;
let connectionCommit = null;
let writeTail = Promise.resolve(), vaultTail = Promise.resolve();
let outputDeadline = 0, outputHeld = false, pendingOutputClears = 0;
let outputReceiverVersion = 0, outputReceiverId = null, outputEpoch = null, outputSnapshotId = null;
const recoveringWindows = new WeakSet();
const rendererTerminations = new WeakMap();
const blankDocument = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>WindChime Display</title><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}</style></head><body></body></html>');
const squirrelEvent = process.argv.find(arg => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(arg));
if (squirrelEvent) {
  if (squirrelEvent !== '--squirrel-obsolete') {
    // Notify a running tray instance before Squirrel tries deleting its files.
    if (squirrelEvent === '--squirrel-uninstall') app.requestSingleInstanceLock();
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    const command = squirrelEvent === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
    const child = require('node:child_process').spawn(updateExe, [command, path.basename(process.execPath)], { detached: false, windowsHide: true, stdio: 'ignore' });
    const finish = () => squirrelEvent === '--squirrel-uninstall' ? setTimeout(() => app.quit(), 3000) : app.quit();
    child.on('close', finish); child.on('error', finish); setTimeout(() => app.quit(), 5000);
  } else app.quit();
  return;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => {
    if (argv.includes('--squirrel-uninstall')) { app.quit(); return; }
    controlWindow?.show(); controlWindow?.focus();
  });
  app.whenReady().then(start).catch(error => { console.error('WindChime startup failed:', error.message); app.quit(); });
}
function selected() { return state.sites.find(site => site.id === state.selected); }
function connectionError(message) { state.connectionError = [state.connectionError, message].filter(Boolean).join('\n'); }
function encryptVault(sites, selectedId) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密暂不可用，无法保存设备授权');
  return safeStorage.encryptString(JSON.stringify({ version: 1, sites, selected: selectedId }));
}
function queueVault(operation) {
  const write = vaultTail.then(operation);
  vaultTail = write.catch(() => {}); return write;
}
function saveVault() {
  const ciphertext = encryptVault(state.sites, state.selected);
  return queueVault(async () => { const temporary = `${vaultPath}.tmp`; await fs.writeFile(temporary, ciphertext); await fs.rename(temporary, vaultPath); });
}
async function waitForConnectionCommit() { while (connectionCommit) await connectionCommit; }
function persistImportedSite(site, assertAttempt) {
  return queueVault(async () => {
    assertAttempt();
    const sites = state.sites.some(item => item.id === site.id) ? state.sites.map(item => item.id === site.id ? site : item) : [...state.sites, site];
    const temporary = `${vaultPath}.tmp`;
    try { await fs.writeFile(temporary, encryptVault(sites, site.id)); }
    catch { throw Object.assign(new Error(), { code: 'CREDENTIAL_SAVE_FAILED' }); }
    // Any newer selection/import/list edit during the write cancels this candidate.
    assertAttempt();
    let release;
    connectionCommit = new Promise(resolve => { release = resolve; });
    try {
      try { await fs.rename(temporary, vaultPath); }
      catch { throw Object.assign(new Error(), { code: 'CREDENTIAL_SAVE_FAILED' }); }
      // Other connection mutations wait through the atomic rename and publication.
      state.sites = sites;
      return { transition: selectSite(site.id, { persist: false }) };
    } finally { connectionCommit = null; release(); }
  });
}
async function readVault() {
  try {
    const ciphertext = await fs.readFile(vaultPath);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密暂不可用');
    const stored = JSON.parse(safeStorage.decryptString(ciphertext));
    if (stored.version !== 1 || !Array.isArray(stored.sites)) throw new Error('未知设备凭据格式');
    let invalid = false;
    state.sites = stored.sites.flatMap(site => { try { return [restoreSite(site)]; } catch { invalid = true; return []; } });
    state.selected = state.sites.some(site => site.id === stored.selected) ? stored.selected : null;
    if (invalid) connectionError('部分本机加密凭据无法读取，请重新连接相应信箱');
  } catch (error) { if (error.code !== 'ENOENT') connectionError('本机加密凭据无法读取，请重新连接信箱'); }
}
async function http(base, relative, method = 'GET', body, token, { binary = false, timeout = 8000 } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
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
  } finally { clearTimeout(timer); }
}
function connectionFailure(error) {
  const messages = {
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
  await waitForConnectionCommit();
  const attempt = ++importVersion, selectedVersion = selectionVersion, sites = state.sites;
  const assertAttempt = () => { if (attempt !== importVersion || selectedVersion !== selectionVersion || sites !== state.sites || switching) throw Object.assign(new Error(), { code: 'CONNECTION_CHANGED' }); };
  try {
    if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error(), { code: 'CREDENTIAL_ENCRYPTION_UNAVAILABLE' });
    const capability = await http(`${key.origin}/api/mail/live`, '/capabilities'); assertAttempt();
    if (capability.protocolVersion !== 1 || capability.features?.connectionKeys !== true) throw Object.assign(new Error(), { code: 'CONNECTION_KEYS_UNSUPPORTED' });
    if (capability.siteId !== key.siteId) throw Object.assign(new Error(), { code: 'CONNECTION_SITE_MISMATCH' });
    const identity = await http(`${key.origin}/api/mail/live`, '/control/identity', 'GET', undefined, key.token); assertAttempt();
    if (identity.siteId !== key.siteId) throw Object.assign(new Error(), { code: 'CONNECTION_SITE_MISMATCH' });
    for (const field of ['topicId', 'grantId', 'topicTitle', 'label']) if (typeof identity[field] !== 'string' || identity[field].length > 200 || (field === 'topicId' && !identity[field])) throw Object.assign(new Error(), { code: 'REMOTE_INVALID_RESPONSE' });
    if (!Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now()) throw Object.assign(new Error(), { code: 'CONNECTION_KEY_EXPIRED' });
    const existing = state.sites.find(site => site.origin === key.origin && site.siteId === key.siteId && site.token === key.token && site.topicId === identity.topicId);
    const site = restoreSite({ id: existing?.id ?? crypto.randomUUID(), origin: key.origin, siteId: identity.siteId, topicId: identity.topicId, token: key.token, label: identity.label || identity.topicTitle, expiresAt: identity.expiresAt });
    const committed = await persistImportedSite(site, assertAttempt);
    await committed.transition;
    return publicSite(site);
  } catch (error) { throw connectionFailure(error); }
}
function requireSite() { if (switching) throw new Error('正在切换信箱，请稍候'); const site = selected(); if (!site) throw new Error('请先连接并选择信箱'); return site; }
function context() { return { site: requireSite(), version: selectionVersion }; }
function isCurrent(value) { return !switching && value.version === selectionVersion && value.site.id === state.selected; }
function assertCurrent(value) { if (!isCurrent(value)) { const error = new Error('信箱已切换，旧操作已取消'); error.code = 'CONNECTION_CHANGED'; throw error; } }
function writeCommand(operation) { const result = writeTail.then(operation); writeTail = result.catch(() => {}); return result; }
function siteRequest(site, request, options) { return http(`${site.origin}/api/mail/live`, request.path, request.method, request.body, site.token, options); }
function assertWindow(event, kind) {
  const window = kind === 'display' ? displayWindow : controlWindow;
  if (!window || event.sender.id !== window.webContents.id || event.senderFrame !== window.webContents.mainFrame) throw new Error('未经授权的窗口');
}
function handle(channel, kind, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { assertWindow(event, kind); return { ok: true, data: await operation(...args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败', code: error.code || 'DESKTOP_ERROR', status: error.status || 0 }; }
  });
}
function terminateRenderer(window) {
  const pending = rendererTerminations.get(window); if (pending) return pending;
  if (window.webContents.isCrashed()) return Promise.resolve();
  let finish, fail;
  const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const contents = window.webContents;
  const cleanup = () => { clearTimeout(timer); contents.removeListener('render-process-gone', gone); rendererTerminations.delete(window); };
  const gone = () => { cleanup(); finish(); };
  const timer = setTimeout(() => { cleanup(); fail(new Error('展示进程未及时退出')); }, 2000); timer.unref();
  rendererTerminations.set(window, promise); contents.once('render-process-gone', gone);
  contents.forcefullyCrashRenderer(); return promise;
}
async function paintHeldOutput(held) {
  const window = held.window;
  if (!window || window.isDestroyed()) return false;
  const current = () => window === displayWindow && held.version === outputVersion && outputHeld && !window.isDestroyed();
  let timer;
  try {
    await terminateRenderer(window); if (!current()) return false;
    // WGC can cache a hidden/crashed window's last frame. Paint a new empty
    // surface while the website write is pending, with no receiver or script.
    await Promise.race([window.loadURL(blankDocument), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('空白画面加载超时')), 500); })]);
    if (!current()) return false;
    window.showInactive(); return true;
  } catch {
    // If an empty compositor cannot be established, remove the capture HWND.
    if (current()) closeOutput(); return false;
  } finally { clearTimeout(timer); }
}
function blank(paint = true) {
  const held = { window: displayWindow, version: ++outputVersion, painted: Promise.resolve(false) };
  outputDeadline = 0; outputHeld = true;
  outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputSnapshotId = null;
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.hide();
    // Discard the backing renderer immediately, even if the site's hide request
    // is still pending. No new receiver is opened until that request succeeds.
    void terminateRenderer(displayWindow).catch(() => {});
  }
  if (paint) held.painted = paintHeldOutput(held);
  return held;
}
async function resumeOutput(held) {
  await held.painted;
  if (!quitting && !pendingOutputClears && held.version === outputVersion && held.window === displayWindow) await recoverOutput(held.window);
}
async function clearOutputWith(operation) {
  const held = blank(); pendingOutputClears++;
  let result;
  try { result = await operation(); } finally { pendingOutputClears--; }
  // Keep the native surface hidden until the server has processed preceding
  // writes and the hide/end action. Failure intentionally leaves it hidden.
  await resumeOutput(held); return result;
}
async function recoverOutput(window = displayWindow, crashed = false) {
  if (quitting || pendingOutputClears || !window || window !== displayWindow || window.isDestroyed() || recoveringWindows.has(window)) return;
  recoveringWindows.add(window); outputDeadline = 0; outputHeld = true;
  outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputSnapshotId = null;
  const version = ++outputVersion;
  // A renderer timer or IPC message cannot clear a frozen compositor. Hide the
  // native window first, then discard its renderer and return with a fresh,
  // blank receiver in the same capture window. Display partitions are unique.
  window.hide();
  try {
    if (!crashed) await terminateRenderer(window);
    if (window !== displayWindow || version !== outputVersion || pendingOutputClears || window.isDestroyed()) return;
    // Wait for render-process-gone before reloading: immediate reload can race
    // asynchronous termination and leave Chromium's replacement frame dead.
    await new Promise((resolve, reject) => {
      const contents = window.webContents;
      const cleanup = () => { clearTimeout(timer); contents.removeListener('did-finish-load', loaded); contents.removeListener('did-fail-load', failed); };
      const loaded = () => { cleanup(); resolve(); };
      const failed = (_event, code, _description, _url, isMainFrame) => { if (isMainFrame) { cleanup(); reject(new Error(`展示加载失败 (${code})`)); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('展示加载超时')); }, 5000); timer.unref();
      contents.once('did-finish-load', loaded); contents.on('did-fail-load', failed);
      void window.loadFile(path.join(__dirname, 'build/display.html')).catch(error => { cleanup(); reject(error); });
    });
    if (window === displayWindow && version === outputVersion && !window.isDestroyed()) { outputHeld = false; window.showInactive(); }
  } catch (error) {
    // Failed recovery stays hidden; it must not reveal a stale backing surface.
    console.error('WindChime display recovery failed:', error.message);
    if (window === displayWindow && version === outputVersion) closeOutput();
  } finally { recoveringWindows.delete(window); }
}
function confirmOutputLease(result, startedAt) {
  if (!Number.isFinite(result?.leaseMs) || result.leaseMs <= 0) throw new Error('展示租期无效');
  // Start at request dispatch, not response receipt, so a delayed response
  // cannot prolong the last confirmed frame. Reserve time for renderer startup
  // and native capture to receive the replacement transparent compositor frame.
  outputDeadline = startedAt + Math.min(result.leaseMs, 3000) - 400;
  if (performance.now() >= outputDeadline) { void recoverOutput(); throw new Error('展示租期已失效'); }
}
function closeOutput() {
  const old = displayWindow; blank(false); displayWindow = null; state.output = null; outputDeadline = 0; outputHeld = false; outputVersion++;
  if (old && !old.isDestroyed()) old.close();
}
function hideSite(site) {
  if (!site) return Promise.resolve();
  return writeCommand(() => siteRequest(site, { path: '/control/action', method: 'POST', body: { topicId: site.topicId, action: 'hide', expectedRevision: 0, operationId: crypto.randomUUID() } }));
}
async function selectSite(id, { persist = true } = {}) {
  if (id !== null && !state.sites.some(site => site.id === id)) throw new Error('信箱不存在');
  if (!switching && state.selected === id) return selected() ? publicSite(selected()) : null;
  const oldSite = selected();
  const version = ++selectionVersion; switching = true; closeOutput(); state.selected = id;
  await hideSite(oldSite).catch(() => {});
  if (version !== selectionVersion) throw Object.assign(new Error('信箱选择已更新'), { code: 'CONNECTION_CHANGED' });
  switching = false; if (persist) await saveVault();
  return selected() ? publicSite(selected()) : null;
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
  // Local renderers never make network requests. The main process has an allowlist.
  isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, callback) => callback({ cancel: true }));
}
async function openDisplay() {
  if (pendingOutputClears) throw new Error('正在隐藏展示，请稍候');
  if (displayWindow && !displayWindow.isDestroyed() && state.output) { if (outputHeld) await recoverOutput(); else displayWindow.show(); return; }
  const scope = context(), site = scope.site; closeOutput(); const version = outputVersion;
  const grant = await siteRequest(site, { path: '/control/grants', method: 'POST', body: { topicId: site.topicId, kind: 'display', label: '桌面展示窗口' } });
  assertCurrent(scope); if (version !== outputVersion) throw new Error('展示请求已取消');
  state.output = grant;
  const partition = `windchime-display-${crypto.randomUUID()}`;
  displayWindow = new BrowserWindow({ width: 960, height: 640, title: 'WindChime Display', transparent: true, backgroundColor: '#00000000', show: false, frame: false, webPreferences: { preload: path.join(__dirname, 'preload-display.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition, spellcheck: false, backgroundThrottling: false } });
  secureWindow(displayWindow, partition);
  const window = displayWindow;
  window.on('closed', () => { if (displayWindow !== window) return; displayWindow = null; state.output = null; outputDeadline = 0; outputVersion++; if (isCurrent(scope)) void hideSite(site).catch(() => {}); });
  window.webContents.on('unresponsive', () => { if (!outputHeld) void recoverOutput(window); });
  window.webContents.on('render-process-gone', () => { if (!outputHeld) void recoverOutput(window, true); });
  await window.loadFile(path.join(__dirname, 'build/display.html'));
  assertCurrent(scope); if (displayWindow !== window || version !== outputVersion || window.isDestroyed()) throw new Error('展示窗口已关闭');
  window.showInactive();
}
async function start() {
  vaultPath = path.join(app.getPath('userData'), 'devices.v1.enc'); await readVault();
  const partition = 'windchime-private';
  controlWindow = new BrowserWindow({ width: 1440, height: 1000, minWidth: 760, minHeight: 620, title: '风铃 · 私人控制台', icon: path.join(__dirname, 'build/icon.ico'), backgroundColor: '#e9f1f5',
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#46616f', height: 48 }, autoHideMenuBar: true } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload-control.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition, spellcheck: false } });
  secureWindow(controlWindow, partition);
  controlWindow.on('close', event => { if (!quitting) { event.preventDefault(); controlWindow.hide(); } });
  handle('sites:list', 'control', () => ({ items: state.sites.map(publicSite), selectedId: state.selected }));
  handle('sites:import-key', 'control', importConnectionKey);
  handle('sites:pair', 'control', async input => {
    const origin = normalizeOrigin(input.origin); const label = String(input.label || new URL(origin).hostname).slice(0, 80);
    const capability = await http(`${origin}/api/mail/live`, '/capabilities'); if (capability.protocolVersion !== 1) throw new Error('此网站尚未升级风铃直播功能');
    const secret = verifier(); const pending = await http(`${origin}/api/mail/live`, '/devices/request', 'POST', { deviceName: `${app.getName()} · ${require('node:os').hostname()}`, challenge: challenge(secret) });
    const id = crypto.randomUUID(); state.pairings.set(id, { ...pending, origin, label, verifier: secret, siteId: capability.siteId });
    const approval = new URL('/mail/live', origin); approval.searchParams.set('userCode', pending.userCode); await shell.openExternal(approval.href);
    return { id, userCode: pending.userCode, expiresAt: pending.expiresAt };
  });
  handle('sites:pair-status', 'control', async id => {
    const pairing = state.pairings.get(id); if (!pairing) return { status: 'expired' };
    const result = await http(`${pairing.origin}/api/mail/live`, '/devices/poll', 'POST', { deviceCode: pairing.deviceCode, verifier: pairing.verifier });
    if (result.status !== 'approved') return { status: result.status };
    const site = { id: crypto.randomUUID(), label: pairing.label, origin: pairing.origin, siteId: pairing.siteId, topicId: result.topicId, token: result.token, expiresAt: result.expiresAt };
    await waitForConnectionCommit();
    if (state.pairings.get(id) !== pairing) return { status: 'expired' };
    state.sites.push(site); state.pairings.delete(id); await selectSite(site.id); return { status: 'approved', site: publicSite(site) };
  });
  handle('sites:pair-cancel', 'control', id => { state.pairings.delete(id); });
  handle('sites:select', 'control', async id => { if (connectionCommit) await waitForConnectionCommit(); return selectSite(id); });
  handle('sites:forget', 'control', async id => { if (connectionCommit) await waitForConnectionCommit(); if (id === state.selected) await selectSite(state.sites.find(site => site.id !== id)?.id ?? null); if (connectionCommit) await waitForConnectionCommit(); state.sites = state.sites.filter(site => site.id !== id); await saveVault(); });
  handle('control:request', 'control', async input => {
    const scope = context(), site = scope.site; const request = validateRequest(input, 'control', site.topicId);
    try {
      const execute = () => { assertCurrent(scope); return siteRequest(site, request, { binary: request.path.startsWith('/control/assets/') }); };
      const perform = () => request.method === 'GET' ? execute() : writeCommand(execute);
      const result = await (request.body?.action === 'hide' || request.body?.action === 'end' ? clearOutputWith(perform) : perform()); assertCurrent(scope); return result;
    } catch (error) { if (isCurrent(scope) && (error.status === 401 || error.status === 403)) { blank(); state.output = null; } throw error; }
  });
  handle('control:hide', 'control', hide);
  handle('control:upload', 'control', async input => {
    const scope = context(), site = scope.site;
    if (!input || typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.messageId) || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType)) throw new Error('请上传不超过 5 MiB 的静态 PNG、JPEG 或 WebP 图片');
    const form = new FormData(); form.set('topicId', site.topicId); form.set('messageId', input.messageId); form.set('file', new Blob([input.bytes], { type: input.mimeType }), 'review-image');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${site.origin}/api/mail/live/control/upload`, { method: 'POST', body: form, headers: { authorization: `Bearer ${site.token}` }, signal: controller.signal, redirect: 'error' });
      const body = await response.json(); assertCurrent(scope); if (!response.ok) throw new Error(body.error || '图片上传失败'); return body.attachments?.[0] ?? body;
    } finally { clearTimeout(timeout); }
  });
  handle('display:open', 'control', openDisplay);
  handle('display:request', 'display', async input => {
    const scope = context(), version = outputVersion;
    const request = validateRequest(input, 'display'); const output = state.output; if (!output) throw new Error('展示未连接');
    if (outputHeld && !recoveringWindows.has(displayWindow)) throw new Error('展示已隐藏');
    const opening = request.path === '/display/open';
    if (opening && outputSnapshotId) { void recoverOutput(); throw new Error('展示连接已更新'); }
    if (opening) { outputReceiverVersion++; outputReceiverId = null; outputEpoch = null; outputDeadline = 0; }
    const receiverVersion = outputReceiverVersion;
    const receiverId = new URL(request.path, 'https://local.invalid').searchParams.get('receiverId');
    if (!opening && (!outputReceiverId || receiverId !== outputReceiverId)) throw new Error('展示接收端已更新');
    const startedAt = performance.now();
    try {
      const result = await http(`${scope.site.origin}/api/mail/live`, request.path, request.method, request.body, output.token, { binary: request.path.startsWith('/display/assets/'), timeout: 2400 });
      assertCurrent(scope); if (version !== outputVersion || output !== state.output || receiverVersion !== outputReceiverVersion) throw new Error('展示连接已更新');
      if (opening) { if (typeof result.receiverId !== 'string' || typeof result.epoch !== 'string') throw new Error('展示接收端无效'); outputReceiverId = result.receiverId; outputEpoch = result.epoch; }
      if (request.path.startsWith('/display/frame?')) {
        if (result.receiverId !== outputReceiverId || result.epoch !== outputEpoch) throw new Error('展示接收端已更新');
        // Do not trust a running JS timer as evidence that an old GPU surface
        // was cleared. Withdrawals replace the native renderer as well.
        if (outputSnapshotId && !result.snapshot) { void recoverOutput(); throw new Error('当前展示已撤下'); }
        outputSnapshotId = result.snapshot?.id ?? null;
      }
      if (opening || request.path.startsWith('/display/frame?')) confirmOutputLease(result, startedAt);
      return result;
    } catch (error) {
      if (isCurrent(scope) && version === outputVersion && output === state.output && receiverVersion === outputReceiverVersion) {
        if (error.status === 401 || error.status === 403) { blank(); state.output = null; }
        else if (outputSnapshotId || outputDeadline) void recoverOutput();
      }
      throw error;
    }
  });
  handle('app:status', 'control', () => ({ connectionError: state.connectionError, displayOpen: !!displayWindow, shortcut: 'Ctrl+Shift+H' }));
  await controlWindow.loadFile(path.join(__dirname, 'build/control.html'));
  tray = new Tray(path.join(__dirname, 'build/tray.png')); tray.setToolTip('风铃 · Ctrl+Shift+H 一键隐藏');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开私人控制台', click: () => controlWindow.show() }, { label: '■ 一键隐藏', click: () => void hide().catch(() => {}) }, { label: '退出并结束展示', click: () => app.quit() }]));
  tray.on('double-click', () => controlWindow.show());
  try { if (!globalShortcut.register('CommandOrControl+Shift+H', () => void hide().catch(() => {}))) connectionError('Ctrl+Shift+H 快捷键注册失败，请使用一键隐藏按钮或托盘菜单'); }
  catch { connectionError('Ctrl+Shift+H 快捷键注册失败，请使用一键隐藏按钮或托盘菜单'); }
  powerMonitor.on('suspend', blank);
  powerMonitor.on('resume', () => { const held = blank(false); void resumeOutput(held); });
  // Main-process timers keep running if renderer timers/compositing stall.
  setInterval(() => { if (outputDeadline && performance.now() >= outputDeadline) void recoverOutput(); }, 100).unref();
}
app.on('before-quit', event => {
  if (quitting) return; event.preventDefault(); quitting = true; blank();
  Promise.race([hide().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]).finally(() => { globalShortcut.unregisterAll(); app.quit(); });
});
app.on('window-all-closed', () => { if (!tray) app.quit(); });
