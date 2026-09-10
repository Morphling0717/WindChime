// Local capture acceptance only. Uses the real desktop and a disposable website
// topic. OBS must be an already prepared, authenticated portable test instance.
const { app, BrowserWindow, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp');
const origin = process.env.WINDCHIME_SMOKE_ULIULI_ORIGIN || 'http://localhost:3021';
const password = process.env.WINDCHIME_SMOKE_PASSWORD;
const portable = process.env.WINDCHIME_OBS_PORTABLE_DIRECTORY;
assert.equal(process.env.WINDCHIME_SMOKE_ALLOW_WRITES, '1');
assert(password && portable, 'Set disposable site password and prepared portable OBS directory');
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const faultsOnly = process.env.WINDCHIME_CAPTURE_MODE === 'faults';
const resultDir = path.resolve(__dirname, faultsOnly ? '../out/window-capture-faults' : '../out/window-capture');
const occlusionMs = faultsOnly ? 0 : Number(process.env.WINDCHIME_CAPTURE_OCCLUSION_MS || 70000);
assert(Number.isInteger(occlusionMs) && (faultsOnly || occlusionMs >= 70000) && occlusionMs <= 1200000);
const report = { date: new Date().toISOString(), site: origin, checks: [], screenshots: [], platformRequests: 0 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let control, topic, messageId, socket, sceneName, inputName;
let receiverOpens = 0, heldHide = null, silentDisconnect = false, lastConfirmedFrame = 0;
const check = (label, condition, details) => { report.checks.push({ label, passed: !!condition, ...(details ? { details } : {}) }); assert(condition, label); };
async function until(predicate, label, timeout = 10000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(80); }
  throw Error(`Timed out: ${label}`);
}
async function api(relative, method = 'GET', body, admin = true) {
  const response = await fetch(origin + relative, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { ...(admin ? { 'x-mail-password': password } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  assert(response.ok, `${method} ${relative}: ${response.status}`); return response.json();
}
const state = () => api(`/api/mail/live/control/state?topicId=${topic.id}`);
async function invoke(method, ...args) {
  const result = await control.webContents.executeJavaScript(`window.windchimeDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  assert(result.ok, result.error); return result.data;
}
async function command(action, more = {}) {
  const before = await state(), message = before.messages.find(item => item.id === messageId);
  return invoke('request', { path: '/control/action', method: 'POST', body: { topicId: topic.id, action, messageId,
    expectedRevision: before.revision, expectedDraftRevision: message?.draftRevision, operationId: randomUUID(), ...more } });
}
const display = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'WindChime Display');
const pending = new Map();
async function connectObs() {
  await fs.access(path.join(portable, 'portable_mode.txt'));
  const config = JSON.parse(await fs.readFile(path.join(portable, 'config/obs-studio/plugin_config/obs-websocket/config.json'), 'utf8'));
  assert(config.server_enabled && config.auth_required && config.server_password, 'Portable OBS must require authentication');
  const hash = value => createHash('sha256').update(value).digest('base64');
  await new Promise((resolve, reject) => {
    socket = new WebSocket(`ws://127.0.0.1:${config.server_port}`);
    const timer = setTimeout(() => reject(Error('OBS authentication timeout')), 10000);
    socket.addEventListener('error', () => reject(Error('OBS websocket unavailable')));
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.op === 0) {
        assert(message.d.authentication); const { salt, challenge } = message.d.authentication;
        socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, authentication: hash(hash(config.server_password + salt) + challenge) } }));
      } else if (message.op === 2) { clearTimeout(timer); resolve(); }
      else if (message.op === 7) {
        const job = pending.get(message.d.requestId); if (!job) return;
        pending.delete(message.d.requestId); clearTimeout(job.timer);
        message.d.requestStatus.result ? job.resolve(message.d.responseData || {}) : job.reject(Error(`${message.d.requestType}: ${message.d.requestStatus.comment}`));
      }
    });
  });
}
function rpc(requestType, requestData = {}) {
  assert(!/^(Start|Toggle)(Stream|Record|Virtual|Replay)/.test(requestType), 'Never start outputs');
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`OBS timeout: ${requestType}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}
async function noOutputs(label) {
  const values = await Promise.all(['GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus'].map(type => rpc(type)));
  const replay = await rpc('GetReplayBufferStatus').catch(error => {
    if (!error.message.includes('Replay buffer is not available')) throw error;
    return { outputActive: false, available: false };
  });
  values.push(replay);
  check(label, values.every(value => !value.outputActive));
}
async function screenshot(source, name) {
  const result = await rpc('GetSourceScreenshot', { sourceName: source, imageFormat: 'png', imageWidth: 960, imageHeight: 640 });
  assert(result.imageData.startsWith('data:image/png;base64,')); const bytes = Buffer.from(result.imageData.split(',')[1], 'base64');
  await fs.writeFile(path.join(resultDir, name), bytes);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0, transparent = 0; for (let index = 3; index < data.length; index += 4) { if (data[index] === 0) transparent++; else visible++; }
  report.screenshots.push({ name, width: info.width, height: info.height, visible, transparent }); return { visible, transparent, data, info };
}
async function cleanup() {
  if (topic) {
    try {
      await api('/api/mail/live/control/action', 'POST', { topicId: topic.id, action: 'end', expectedRevision: 0, operationId: randomUUID() });
      const grants = await api(`/api/mail/live/control/grants?topicId=${topic.id}`);
      for (const grant of grants.items) if (!grant.revokedAt) await api(`/api/mail/live/control/grants/${grant.id}?topicId=${topic.id}`, 'DELETE');
      report.fixtureGrantsRevoked = true;
    } catch (error) { report.fixtureGrantsRevoked = false; report.cleanupError = error.message; report.result = 'failed'; }
  }
  if (socket?.readyState === WebSocket.OPEN) { await noOutputs('No output started during capture').catch(error => { report.outputCheckError = error.message; report.result = 'failed'; }); socket.close(); }
}
async function run() {
  await fs.mkdir(resultDir, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-window-capture-')); app.setPath('userData', temporary);
  await app.whenReady();
  await connectObs(); const version = await rpc('GetVersion'); report.obsVersion = version.obsVersion; report.obsWebSocketVersion = version.obsWebSocketVersion;
  await noOutputs('OBS initially has no active outputs');
  const slug = `window-${randomUUID().slice(0, 8)}`;
  topic = await api('/api/mail/topics', 'POST', { slug, title: 'Disposable native window capture' }); report.topicId = topic.id;
  await api('/api/mail/messages', 'POST', { topicSlug: slug, text: 'PRIVATE_ORIGINAL_NEVER_CAPTURE', nickname: 'Private sender', senderFingerprint: randomUUID() }, false);
  messageId = (await state()).messages[0].id;
  const capability = await api('/api/mail/live/capabilities', 'GET', undefined, false);
  const grant = await api('/api/mail/live/control/grants', 'POST', { topicId: topic.id, kind: 'control', label: 'Disposable native capture controller' });
  const connection = { id: randomUUID(), label: '窗口捕获验收', origin, siteId: capability.siteId, topicId: topic.id, token: grant.token, expiresAt: grant.expiresAt };
  assert(safeStorage.isEncryptionAvailable());
  await fs.writeFile(path.join(temporary, 'devices.v1.enc'), safeStorage.encryptString(JSON.stringify({ version: 1, sites: [connection], selected: connection.id })));
  // Observe all real desktop traffic; Bilibili/gateway traffic is forbidden.
  const siteFetch = globalThis.fetch;
  globalThis.fetch = async (input, ...rest) => {
    const target = new URL(typeof input === 'string' ? input : input.url || input.href);
    if (target.origin !== origin) { report.platformRequests++; throw Error('Desktop attempted non-site traffic'); }
    if (silentDisconnect && target.pathname.startsWith('/api/mail/live/display/')) {
      return new Promise((_, reject) => {
        const signal = rest[0]?.signal, abort = () => reject(new DOMException('Synthetic silent disconnect', 'AbortError'));
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (heldHide && target.pathname === '/api/mail/live/control/action' && typeof rest[0]?.body === 'string' && JSON.parse(rest[0].body).action === 'hide') {
      const gate = heldHide; heldHide = null; gate.seen = true; await gate.wait;
    }
    const dispatched = performance.now(); const response = await siteFetch(input, ...rest);
    if (response.ok && target.pathname === '/api/mail/live/display/open') receiverOpens++;
    if (response.ok && target.pathname === '/api/mail/live/display/frame') lastConfirmedFrame = dispatched;
    return response;
  };
  require('../main.cjs');
  control = await until(() => BrowserWindow.getAllWindows().find(window => window.getTitle().includes('私人控制台')), 'private controller');
  await until(() => control.webContents.executeJavaScript('!!window.windchimeDesktop').catch(() => false), 'private preload');
  await invoke('openDisplay'); await until(() => display(), 'display window');
  await until(async () => (await state()).receivers > 0, 'receiver online');
  const image = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#8fe1d5' } }).png().toBuffer();
  const upload = await control.webContents.executeJavaScript(`window.windchimeDesktop.upload({messageId:${JSON.stringify(messageId)},fileName:'synthetic.png',mimeType:'image/png',bytes:new Uint8Array(${JSON.stringify([...image])})})`);
  assert(upload.ok, upload.error); const asset = upload.data;
  await command('draft', { draft: { text: 'WindChime window capture\n审核后手动展示', nickname: 'Reviewed sender', linkUrl: null, assets: [{ id: asset.id, caption: 'Reviewed immutable picture' }] } });
  const current = await state(); await command('appearance', { appearance: { ...current.appearance, transparent: true, textColor: '#ffffff', animation: 'none' } });
  sceneName = `WindChime native ${slug}`; inputName = `Window ${slug}`;
  await rpc('SetVideoSettings', { baseWidth: 960, baseHeight: 640, outputWidth: 960, outputHeight: 640 });
  await rpc('CreateScene', { sceneName });
  const captured = await rpc('CreateInput', { sceneName, inputName, inputKind: 'window_capture', inputSettings: { method: 2, priority: 1, cursor: false, client_area: true, capture_audio: false, force_sdr: true }, sceneItemEnabled: true });
  const windows = await rpc('GetInputPropertiesListPropertyItems', { inputName, propertyName: 'window' });
  const choices = windows.propertyItems.filter(item => item.itemEnabled && /WindChime Display/.test(item.itemName));
  assert.equal(choices.length, 1, 'OBS must enumerate exactly one display window');
  report.selectedWindow = choices[0].itemName;
  await rpc('SetInputSettings', { inputName, inputSettings: { window: choices[0].itemValue, method: 2, priority: 1, force_sdr: true }, overlay: true });
  await rpc('SetSceneItemTransform', {sceneName, sceneItemId:captured.sceneItemId, sceneItemTransform:{positionX:0,positionY:0,rotation:0,alignment:5,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:960,boundsHeight:640,boundsAlignment:5,cropLeft:0,cropRight:0,cropTop:0,cropBottom:0}});
  await rpc('SetCurrentProgramScene', { sceneName });
  await screenshot(sceneName, '00-initial-scene.png'); await delay(1500);
  const initial = await screenshot(inputName, '01-initial-source.png'); check('Unreviewed window captures blank', initial.visible === 0);
  await command('approve'); await delay(1200);
  check('Approval alone stays blank in window capture', (await screenshot(inputName, '02-approved-blank.png')).visible === 0);
  await command('show'); await until(() => display().webContents.executeJavaScript('document.body.innerText.includes("WindChime window capture")'), 'manual display');
  const shown = await until(async () => { const frame = await screenshot(inputName, '03-show-source.png'); return frame.visible > 0 ? frame : null; }, 'OBS captures shown content');
  check('Manual show reaches real OBS window capture', shown.visible > 0);
  check('Window capture preserves transparent background', shown.transparent > 960 * 640 / 2);
  const raw = Buffer.alloc(960 * 640 * 3); for (let y = 0; y < 640; y++) for (let x = 0; x < 960; x++) { const value = ((x >> 5) + (y >> 5)) % 2 ? 42 : 24; raw.fill(value, (y * 960 + x) * 3, (y * 960 + x) * 3 + 3); }
  const checkerboard = path.join(resultDir, 'checkerboard.png'); await sharp(raw, { raw: { width: 960, height: 640, channels: 3 } }).png().toFile(checkerboard);
  const backgroundName = `Checkerboard ${slug}`;
  const created = await rpc('CreateInput', { sceneName, inputName: backgroundName, inputKind: 'image_source', inputSettings: { file: checkerboard }, sceneItemEnabled: true });
  await rpc('SetSceneItemIndex', { sceneName, sceneItemId: created.sceneItemId, sceneItemIndex: 0 });
  await delay(300); await screenshot(sceneName, '04-show-composite.png');
  const beforeHideReceiver = receiverOpens;
  const committed = performance.now(); await invoke('hide'); const responded = performance.now();
  await until(async () => (await screenshot(inputName, '05-hidden-source.png')).visible === 0, 'captured window hide');
  check('Hide clears the captured source', true, { responseToBlankMs: Math.round(performance.now() - responded), commandToBlankMs: Math.round(performance.now() - committed) });
  await until(() => receiverOpens > beforeHideReceiver, 'fresh receiver after hide');
  await command('show'); await delay(1200); const beforeRevoke = receiverOpens; await command('revoke');
  await until(async () => (await screenshot(inputName, '06-revoked-source.png')).visible === 0, 'captured revocation'); check('Revocation clears captured window', true);
  await until(() => receiverOpens > beforeRevoke, 'fresh receiver after revocation');
  await command('approve'); await command('show'); await delay(1200);
  display().close(); await delay(1500);
  check('Closing output never captures private controller', (await screenshot(inputName, '07-closed-source.png')).visible === 0);
  await invoke('openDisplay'); await delay(2000);
  check('Reopened display stays blank', (await screenshot(inputName, '08-reopened-source.png')).visible === 0);
  await command('show'); await until(async () => (await screenshot(inputName, '09-reopened-show.png')).visible > 0, 'manual show after reopening');
  check('Reopened window is captured after new manual show', true);
  // A capture source normally sits behind a private controller or live software.
  // Keep it fully covered long enough to expose Chromium background throttling.
  control.setBounds(display().getBounds()); control.show(); control.moveTop(); control.focus();
  console.log(JSON.stringify({ phase: 'occluded-window', seconds: occlusionMs / 1000 }));
  const occludedStarted = Date.now();
  await delay(occlusionMs);
  check('Covered display retains a live receiver after extended occlusion', (await state()).receivers > 0, { durationMs: Date.now() - occludedStarted });
  const hideState = await state(), beforeRemoteHide = receiverOpens;
  await api('/api/mail/live/control/action', 'POST', { topicId: topic.id, action: 'hide', expectedRevision: hideState.revision, operationId: randomUUID() });
  const backgroundResponded = performance.now();
  await until(async () => (await screenshot(inputName, '10-occluded-hidden.png')).visible === 0, 'covered window clears after remote hide', 3000);
  const backgroundLatency = Math.round(performance.now() - backgroundResponded);
  check('Remote hide clears covered OBS window within one second', backgroundLatency <= 1000, { responseToBlankMs: backgroundLatency });
  await until(() => receiverOpens > beforeRemoteHide, 'fresh receiver after covered remote hide');
  await command('show');
  await until(async () => (await screenshot(inputName, '11-occluded-show.png')).visible > 0, 'manual show while covered');
  // Local emergency hide must clear the captured pixels even if its site write
  // has not returned. This checks the native capture, not only the DOM.
  const gate = { seen: false }; gate.wait = new Promise(resolve => { gate.release = resolve; }); heldHide = gate;
  const beforeStalledHide = receiverOpens, stalledStarted = performance.now();
  const pendingHide = invoke('hide'); pendingHide.catch(() => {});
  try {
    await until(() => gate.seen, 'delayed website hide request');
    await until(async () => (await screenshot(inputName, '12-network-stalled-hide.png')).visible === 0, 'native clear while hide response is pending', 1000);
    const elapsed = Math.round(performance.now() - stalledStarted);
    check('Emergency hide clears capture before delayed website response', elapsed <= 1000, { commandToBlankMs: elapsed });
    check('Pending hide paints blank without opening a new receiver', receiverOpens === beforeStalledHide);
  } finally { gate.release(); heldHide = null; await pendingHide; }
  await until(() => receiverOpens > beforeStalledHide, 'fresh receiver after delayed hide');
  await command('show');
  await until(async () => (await screenshot(inputName, '13-final-manual-show.png')).visible > 0, 'manual show after delayed hide');
  if (faultsOnly) {
    const beforeDisconnect = receiverOpens, disconnectedAt = performance.now(); silentDisconnect = true;
    await until(async () => (await screenshot(inputName, '14-silent-disconnect.png')).visible === 0, 'silent disconnect clears captured pixels', 3100);
    const disconnectedMs = Math.round(performance.now() - disconnectedAt);
    check('Silent disconnect clears actual capture within three seconds', disconnectedMs <= 3000, { elapsedMs: disconnectedMs });
    silentDisconnect = false;
    await until(() => receiverOpens > beforeDisconnect, 'new connection after silent disconnect');
    await delay(1100);
    check('Silent connection recovery does not replay old content', (await screenshot(inputName, '15-reconnected-blank.png')).visible === 0);
    await command('show');
    await until(async () => (await screenshot(inputName, '16-before-frozen-renderer.png')).visible > 0, 'manual show before renderer freeze');
    const beforeFreeze = receiverOpens, awaitedFrame = lastConfirmedFrame;
    await until(() => lastConfirmedFrame > awaitedFrame, 'recent confirmed frame before renderer freeze');
    const leaseStarted = lastConfirmedFrame, frozenAt = performance.now();
    void display().webContents.executeJavaScript('setTimeout(() => { while (true) {} }, 0)').catch(() => {});
    await until(async () => (await screenshot(inputName, '17-frozen-renderer-blank.png')).visible === 0, 'frozen renderer capture clears within lease', 3100);
    const freezeMs = Math.round(performance.now() - frozenAt), leaseMs = Math.round(performance.now() - leaseStarted);
    check('Frozen renderer cannot retain captured pixels beyond lease', leaseMs <= 3000, { fromFreezeMs: freezeMs, fromLastFrameDispatchMs: leaseMs });
    await until(() => receiverOpens > beforeFreeze, 'fresh receiver after frozen renderer');
    await delay(1100);
    check('Frozen renderer recovery stays blank', (await screenshot(inputName, '18-frozen-recovered-blank.png')).visible === 0);
    await command('show');
    await until(async () => (await screenshot(inputName, '19-faults-final-manual-show.png')).visible > 0, 'new manual show after renderer recovery');
  }
  check('No Bilibili or gateway traffic', report.platformRequests === 0);
  report.result = 'passed';
  if (process.env.WINDCHIME_CAPTURE_HOLD === '1') {
    const finishFile=path.join(resultDir, `finish-${process.pid}`);
    await fs.writeFile(path.join(resultDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ captureReady: true, pid: process.pid, topicId: topic.id, resultDir, finishFile }));
    const deadline=Date.now()+15*60*1000;
    while(Date.now()<deadline) { if(await fs.access(finishFile).then(()=>true,()=>false)) break; await delay(500); }
  }
}
run().catch(error => { report.result = 'failed'; report.error = error.message; process.exitCode = 1; }).finally(async () => {
  await cleanup(); await fs.mkdir(resultDir, { recursive: true }); await fs.writeFile(path.join(resultDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.result === 'passed' ? 0 : 1);
});
