// Real Electron windows + main/preload IPC + WindChime HTTP handlers and SQLite.
// All letters, credentials, storage and sites are disposable local fixtures.
// Dialog choices and global-shortcut registration are instrumented; this does
// not register a real OS shortcut, install software, or touch a running app.
const { app, BrowserWindow, dialog, globalShortcut, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const results = path.resolve(__dirname, '../out/tiles-smoke');
const moduleLabels = { inbox: '来信列表', review: '审阅与预览', queue: '待播顺序', transport: '快捷播控', appearance: '展示外观' };
const checks = [], screenshots = [], consoleErrors = [], requests = [], dialogs = [], shortcuts = new Map(), tileGeometry = [];
let userData, control, fixture, confirmResponse = 1, blockedShortcut = '', fixtures = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Electron can dispose the old frame during an intentional safety reset.
    // Its executeJavaScript promise may never settle, so every observation has
    // a bounded lifetime rather than hanging the entire verification process.
    try { if (await Promise.race([Promise.resolve().then(test), pause(800).then(() => false)])) return; } catch {}
    await pause(80);
  }
  throw new Error('Timed out: ' + label);
}
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
async function invoke(window, method, ...args) {
  const result = await evaluate(window, `window.windchimeDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  assert.equal(result.ok, true, result.error);
  return result.data;
}
async function click(window, label, selector = 'button') {
  await evaluate(window, `(()=>{const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!node)throw Error('Missing button');if(node.disabled)throw Error('Disabled button');node.click()})()`);
  await pause(120);
}
async function input(window, selector, value) {
  await evaluate(window, `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing input');Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
  await pause(100);
}
async function labeledInput(window, label, value) {
  const selector = await evaluate(window, `(()=>{const node=Array.from(document.querySelectorAll('label')).find(item=>item.firstChild?.textContent.trim()===${JSON.stringify(label)})?.querySelector('input,textarea,select');if(!node)throw Error('Missing labeled input');node.dataset.smokeInput='selected';return '[data-smoke-input="selected"]'})()`);
  await input(window, selector, value);
  await evaluate(window, `document.querySelector('[data-smoke-input="selected"]').removeAttribute('data-smoke-input')`);
}
function tile(module) {
  return BrowserWindow.getAllWindows().find(window => {
    try { return new URL(window.webContents.getURL()).searchParams.get('tile') === module; } catch { return false; }
  });
}
function output() { return BrowserWindow.getAllWindows().find(window => window.getTitle() === 'WindChime Display'); }
async function capture(window, name) {
  // Bring this test window forward before capturing: an occluded Electron
  // compositor can retain its initial frame even after the DOM has updated.
  window.show();
  window.focus();
  await until(() => evaluate(window, 'document.visibilityState === "visible"'), name + ' is visible for capture');
  await Promise.race([
    evaluate(window, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'),
    pause(2000).then(() => { throw new Error(name + ' did not paint for capture'); }),
  ]);
  await pause(200);
  assert.equal(await evaluate(window, 'document.documentElement.scrollWidth>innerWidth+1'), false, name + ' has no horizontal page overflow');
  await fs.writeFile(path.join(results, name + '.png'), (await window.webContents.capturePage()).toPNG());
  screenshots.push(name + '.png');
}
async function assertTransportButtons(window, label) {
  for (const text of ['下一封 →', '■ 一键隐藏']) {
    const geometry = await evaluate(window, `(()=>{const node=Array.from(document.querySelectorAll('button')).find(item=>item.textContent.trim()===${JSON.stringify(text)});if(!node)return {missing:true};const rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,uncovered:hit===node||node.contains(hit)}})()`);
    assert.equal(geometry.missing, undefined);
    assert(geometry.width > 100 && geometry.height >= 36, label + ' offers a useful ' + text + ' target');
    assert(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= geometry.viewportWidth && geometry.bottom <= geometry.viewportHeight, label + ' keeps ' + text + ' visible without scrolling: ' + JSON.stringify(geometry));
    assert.equal(geometry.uncovered, true, label + ' does not cover ' + text);
    tileGeometry.push({ label, button: text, ...geometry });
  }
}
async function createFixture(name) {
  const imported = await Promise.all(['sqlite', 'server', 'next', 'core'].map(part => import(pathToFileURL(path.resolve(__dirname, '../../../dist/' + part + '/index.js')).href)));
  const [sql, serverApi, adapter, core] = imported;
  const directory = path.join(userData, name);
  const storage = sql.createWindChimeSqlite({ filename: path.join(directory, 'mail.db') });
  const service = serverApi.createWindChimeService({ storage, hashSalt: 'tiles-smoke-only-' + name, runtimeEpoch: 'tiles-' + name + '-' + randomUUID() });
  await service.ready();
  const event = await service.createTopic({ title: name + ' 活动话题', slug: 'event-' + name.toLowerCase() });
  const topics = [await service.getDefaultTopic(), event];
  const messages = [];
  for (const [at, topic] of topics.entries()) for (let i = 0; i < 2; i++) {
    const text = `${name}_${at}_${i} 原投稿仅供私人审阅。`;
    await service.submitMessage({ topicSlug: topic.slug, nickname: `${name} 合成来信 ${at}-${i}`, text, senderFingerprint: randomUUID() }, new Request('http://localhost/api/mail/messages', { headers: { 'x-real-ip': `127.10.${at}.${i + 1}` } }));
    messages.push((await service.listMessages({ topicId: topic.id })).items.find(item => item.text === text));
  }
  let handler, origin;
  const http = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const data = body && request.headers['content-type']?.startsWith('application/json') ? JSON.parse(body.toString()) : {};
      const route = new URL(request.url, origin).pathname;
      const observation = { site: name, route, method: request.method, action: data.action, topicId: data.topicId, messageId: data.messageId, expectedRevision: data.expectedRevision };
      requests.push(observation);
      const wrapped = new Request(origin + request.url, { method: request.method, headers: request.headers, ...(body ? { body } : {}) });
      const result = await handler[request.method](wrapped);
      observation.status = result.status;
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${http.address().port}`;
  handler = adapter.createWindChimeLiveRouteHandlers({ service, authorizeAdmin: () => false, publicOrigin: origin, mediaDirectory: path.join(directory, 'media'), siteName: name });
  const grant = await service.broadcast.createGrant(null, 'control', name + ' 合成站点', undefined, null, null, null, 'site');
  const key = core.encodeWindChimeConnectionKey({ origin, siteId: await service.broadcast.siteId(), token: grant.token });
  const result = { name, origin, directory, storage, service, topics, messages, http, key };
  fixtures.push(result);
  return result;
}
async function state(topicId = fixture.topics[0].id) { return fixture.service.broadcast.state(topicId); }
async function action(action, messageId, extra = {}, topicId = fixture.topics[0].id) {
  const before = await state(topicId);
  return fixture.service.broadcast.action({ topicId, action, messageId, expectedRevision: before.revision, expectedDraftRevision: before.messages.find(message => message.id === messageId)?.draftRevision, operationId: randomUUID(), ...extra });
}
async function importSite(site) {
  control.show();
  control.focus();
  await until(() => evaluate(control, 'document.visibilityState==="visible"'), 'connection form is visible for topic polling');
  await click(control, '网站连接');
  await until(() => evaluate(control, '!!document.querySelector("input[type=password]")'), 'connection form');
  await input(control, 'input[type=password]', site.key);
  await click(control, '使用密钥连接');
  await until(async () => (await invoke(control, 'sites')).items.some(item => item.origin === site.origin), 'site connected');
  await until(async () => {
    const metadata = await invoke(control, 'sites');
    return metadata.items.find(item => item.id === metadata.selectedId)?.selectedTopicId === site.topics[0].id;
  }, 'default topic selected');
}
async function openModule(module) {
  // Root launch UI uses these stable labels; bridge is checked separately too.
  await evaluate(control, `(()=>{const node=document.querySelector('[aria-label=${JSON.stringify('打开' + moduleLabels[module] + '磁贴')} ]');if(!node)throw Error('Missing tile launcher ${module}');node.click()})()`);
  await until(() => tile(module), module + ' native tile exists');
  const window = tile(module);
  await until(() => evaluate(window, '!!window.windchimeDesktop&&document.body.innerText.length>10'), module + ' renderer loaded');
  return window;
}
async function selectedMessage(window, id) {
  await until(async () => (await invoke(window, 'status')).selectedMessageId === id, 'shared selected message ' + id);
}
async function displayBlank(label) {
  await until(() => !output() || evaluate(output(), '!document.querySelector("[data-windchime-snapshot]")&&document.body.innerText===""'), label);
}
async function displayed(text) {
  await until(() => output() && evaluate(output(), `document.body.innerText.includes(${JSON.stringify(text)})`), 'approved text displayed');
  const displayedText = await evaluate(output(), 'document.body.innerText');
  assert(!displayedText.includes('PRIVATE STUDIO'));
  assert(!displayedText.includes('私人控制'));
  assert(!displayedText.includes('展示正文'));
  assert(!displayedText.includes('UliUli'));
  assert(!displayedText.includes('MIA'));
}
async function run() {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-tiles-'));
  app.setPath('userData', userData);
  await fs.mkdir(results, { recursive: true });
  dialog.showMessageBox = async (_window, options) => { dialogs.push({ message: options?.message, response: confirmResponse }); return { response: confirmResponse, checkboxChecked: false }; };
  shell.openExternal = async () => { throw Error('This fixture must not open an external website'); };
  // Capture exact production callbacks without occupying the user’s system shortcuts.
  globalShortcut.register = (key, callback) => { if (key === blockedShortcut) return false; shortcuts.set(key, callback); return true; };
  globalShortcut.unregister = key => shortcuts.delete(key);
  globalShortcut.unregisterAll = () => shortcuts.clear();
  globalShortcut.isRegistered = key => shortcuts.has(key);
  fixture = await createFixture('Alpha');
  const second = await createFixture('Beta');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    assert(fixtures.some(item => item.origin === new URL(typeof input === 'string' ? input : input.url).origin), 'Only the two disposable loopback sites may receive requests');
    return originalFetch(input, init);
  };
  app.on('browser-window-created', (_, window) => window.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) consoleErrors.push(event.message); }));
  require('../main.cjs');
  await app.whenReady();
  await until(() => { control = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('私人控制台')); return control; }, 'private control window');
  control.show();
  control.focus();
  await until(() => evaluate(control, 'document.visibilityState==="visible"'), 'test controller is visible for normal site polling');
  await until(() => evaluate(control, '!!document.querySelector("input[type=password]")'), 'initial key form');
  // Initial view is the connection form, so importing directly also verifies its default entry point.
  await input(control, 'input[type=password]', fixture.key);
  await click(control, '使用密钥连接');
  await until(() => evaluate(control, 'document.querySelectorAll(".inbox-row").length===2'), 'real HTTP inbox loaded');
  const metadata = await invoke(control, 'sites');
  const connectionId = metadata.selectedId;
  assert(!JSON.stringify(metadata).includes('wc_ctl_'));
  await click(control, '直播工作台');
  await until(() => evaluate(control, 'document.querySelectorAll(".wc-mail").length===2'), 'main studio loaded');
  for (const module of Object.keys(moduleLabels)) {
    const window = await openModule(module);
    assert.equal(window.isAlwaysOnTop(), true, module + ' is initially topmost');
    assert(window.getTitle().startsWith('WindChime Private'), module + ' is unmistakably a private window');
    await invoke(control, 'openTile', module);
    assert.equal(tile(module), window, 'opening ' + module + ' again focuses the same native window');
    assert.equal(BrowserWindow.getAllWindows().filter(item => item === tile(module)).length, 1);
    const status = await invoke(window, 'status');
    assert.equal(status.tile.module, module);
    assert.equal(status.tile.connectionId, connectionId);
    assert.equal(status.tile.topicId, fixture.topics[0].id);
    assert.equal(await evaluate(window, 'typeof window.windchimeOutput'), 'undefined');
    assert.equal(await evaluate(window, 'typeof window.require'), 'undefined');
    if (module === 'transport') {
      await assertTransportButtons(window, 'default transport dimensions');
      const previous = window.getBounds();
      window.setSize(340, 260);
      await pause(250);
      await assertTransportButtons(window, 'minimum transport dimensions');
      window.setBounds(previous);
      await pause(200);
    }
    await capture(window, 'tile-' + module);
  }
  checks.push('all five modules launch from the actual private studio UI as separate sandboxed topmost native windows; reopening a module reuses its window');
  const review = tile('review'), inbox = tile('inbox'), queue = tile('queue'), transport = tile('transport');
  await evaluate(review, 'document.querySelector("[aria-label=取消置顶]").click()');
  await until(() => !review.isAlwaysOnTop(), 'pin button disables native topmost');
  assert.equal(review.isAlwaysOnTop(), false);
  await until(() => evaluate(review, '!!document.querySelector("[aria-label=固定在最上方]")&&!document.querySelector("[aria-label=固定在最上方]").disabled'), 'pin button renders its next action');
  await evaluate(review, 'document.querySelector("[aria-label=固定在最上方]").click()');
  await until(() => review.isAlwaysOnTop(), 'pin button enables native topmost');
  assert.equal(review.isAlwaysOnTop(), true);
  checks.push('review tile native always-on-top state can be disabled and re-enabled');
  for (const [method, args] of [
    ['importKey', ['not-a-key']],
    ['selectSite', [connectionId]],
    ['selectTopic', [fixture.topics[1].id, connectionId]],
    ['setNextShortcut', ['Ctrl+Alt+N']],
    ['openTile', ['queue']],
    ['request', [{ path: '/control/state?topicId=' + fixture.topics[1].id, method: 'GET', connectionId }]],
    ['request', [{ path: second.origin + '/api/mail/live/control/state', method: 'GET', connectionId }]],
  ]) {
    const denied = await evaluate(review, `window.windchimeDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    assert.equal(denied.ok, false, 'tile cannot use ' + method + ' to escalate or change scope');
  }
  assert.equal((await invoke(review, 'sites')).items.length, 1, 'tile only receives its selected connection metadata');
  checks.push('tile IPC denies credential import, connection/topic changes, opening another tile, editing global shortcut and requests targeting another topic or origin');

  const [first, next] = fixture.messages;
  await evaluate(inbox, `Array.from(document.querySelectorAll('.wc-mail')).find(node=>node.textContent.includes(${JSON.stringify(first.text)})).click()`);
  await selectedMessage(control, first.id);
  await selectedMessage(review, first.id);
  await until(() => evaluate(review, '!!document.querySelector("textarea")'), 'selected letter opens in review tile');
  await labeledInput(review, '展示正文', 'APPROVED_FROM_PRIVATE_TILE');
  await until(async () => (await invoke(control, 'status')).tiles.find(item => item.module === 'review')?.dirty, 'unsaved tile is tracked by main');
  confirmResponse = 0;
  const confirmsBefore = dialogs.length;
  review.close();
  await until(() => dialogs.length > confirmsBefore, 'native close prompts for dirty tile');
  assert.equal(review.isDestroyed(), false);
  assert.equal(await evaluate(review, 'document.querySelector("textarea").value'), 'APPROVED_FROM_PRIVATE_TILE');
  const deniedSelection = await evaluate(inbox, `window.windchimeDesktop.selectMessage(${JSON.stringify(next.id)},${JSON.stringify(connectionId)})`);
  assert.equal(deniedSelection.ok, false);
  assert.equal(deniedSelection.code, 'OPERATION_CANCELLED');
  await selectedMessage(review, first.id);
  const deniedTopic = await evaluate(control, `window.windchimeDesktop.selectTopic(${JSON.stringify(fixture.topics[1].id)},${JSON.stringify(connectionId)})`);
  assert.equal(deniedTopic.ok, false);
  assert.equal(deniedTopic.code, 'OPERATION_CANCELLED');
  assert.equal((await invoke(control, 'sites')).items.find(item => item.id === connectionId).selectedTopicId, fixture.topics[0].id);
  checks.push('unsaved review drafts survive native close, selected-letter change and topic-change cancellation; main enforces each guard');

  confirmResponse = 1;
  const originalDraft = (await state()).messages.find(item => item.id === first.id).draft;
  await action('draft', first.id, { draft: { ...originalDraft, text: 'REMOTE_REVIEW_REVISION_FROM_ANOTHER_CONTROL' } });
  await until(() => evaluate(review, 'document.body.innerText.includes("展示稿已在其他控制端更新为版本")'), 'concurrent editor conflict visible');
  assert.equal(await evaluate(review, 'document.querySelector("textarea").value'), 'APPROVED_FROM_PRIVATE_TILE');
  assert.equal(await evaluate(review, 'Array.from(document.querySelectorAll("button")).find(node=>node.textContent.trim()==="保存展示稿").disabled'), true);
  await click(review, '确认新版本，保留我的编辑');
  await click(review, '保存展示稿');
  await until(async () => (await state()).messages.find(item => item.id === first.id).draft.text === 'APPROVED_FROM_PRIVATE_TILE', 'tile saves through real business API');
  await until(async () => !(await invoke(control, 'status')).tiles.find(item => item.module === 'review').dirty, 'saved draft clears dirty marker');
  checks.push('a concurrent server draft revision is reported inside the review tile, preserves local unsaved text, blocks stale save, and requires explicit reconciliation before saving');
  await click(review, '批准进入待播');
  await until(async () => (await state()).queue.includes(first.id), 'approval persists');
  assert.equal((await state()).current, null);
  assert.equal(output(), undefined);
  await until(() => evaluate(queue, 'document.querySelectorAll(".wc-queue li").length===1'), 'approved queue synchronizes to tile');
  await capture(review, 'tile-review-approved');
  await capture(queue, 'tile-queue-approved');
  await click(transport, '打开独立展示窗口');
  await until(() => output(), 'independent output opened from tile');
  await displayBlank('opening a receiver remains blank');
  assert.equal(await evaluate(output(), 'typeof window.windchimeDesktop'), 'undefined');
  await until(async () => (await state()).receivers > 0, 'real receiver online');
  await until(() => evaluate(queue, 'Array.from(document.querySelectorAll("button")).some(node=>node.textContent.trim()==="上屏"&&!node.disabled)'), 'queue learns receiver ready');
  await click(queue, '上屏');
  await displayed('APPROVED_FROM_PRIVATE_TILE');
  await capture(transport, 'tile-transport-playing');
  await capture(output(), 'display-approved-tile');
  const opensBeforeHide = requests.filter(item => item.route === '/api/mail/live/display/open').length;
  await click(transport, '■ 一键隐藏');
  await displayBlank('transport emergency hide clears output');
  await until(() => requests.filter(item => item.route === '/api/mail/live/display/open').length > opensBeforeHide, 'new display handshake completes after hide');
  await until(async () => (await state()).receivers > 0, 'new receiver ready after native emergency hide');
  await until(() => evaluate(queue, '!document.querySelector(".wc-queue li[aria-current=true]")&&Array.from(document.querySelectorAll("button")).some(node=>node.textContent.trim()==="上屏"&&!node.disabled)'), 'queue synchronizes the new revision after emergency hide');
  const afterHideRequest = requests.length;
  await click(queue, '上屏');
  await until(() => requests.slice(afterHideRequest).some(item => item.action === 'show' && item.status), 'manual show result after receiver replacement');
  const afterHideShow = requests.slice(afterHideRequest).find(item => item.action === 'show');
  if (afterHideShow.status === 409) {
    await until(() => evaluate(queue, 'document.body.innerText.includes("其他控制端已更新")'), 'revision conflict is visible');
    await pause(2200);
    assert(await evaluate(queue, 'document.body.innerText.includes("其他控制端已更新")'), 'successful background polls retain operation conflict');
    assert.equal(requests.slice(afterHideRequest).filter(item => item.action === 'show').length, 1, 'no automatic retry');
    assert.equal((await state()).current, null);
    await click(queue, '上屏'); // A second deliberate user action, never an app retry.
  } else assert.equal(afterHideShow.status, 200);
  await displayed('APPROVED_FROM_PRIVATE_TILE');
  await click(review, '撤销批准并撤下');
  await displayBlank('tile revocation withdraws the approved snapshot');
  checks.push('review tile saves and approves using the shared real SQLite service; approval stays blank, queue manual show reaches only independent output, revocation removes the active snapshot');

  await action('approve', first.id);
  await action('approve', next.id);
  await action('reorder', undefined, { order: [first.id, next.id] });
  await action('end');
  await until(() => evaluate(transport, 'document.body.innerText.includes("2 封已批准")&&Array.from(document.querySelectorAll("button")).some(node=>node.textContent.includes("下一封")&&!node.disabled)'), 'transport next ready with latest approved queue');
  await pause(1100);
  await click(transport, '下一封 →');
  await displayed('APPROVED_FROM_PRIVATE_TILE');
  await click(transport, '下一封 →');
  await displayed(next.text);
  await click(transport, '下一封 →');
  await displayBlank('transport next clears at queue end');
  assert.deepEqual((await state()).queue, [first.id, next.id]);
  checks.push('transport tile next uses persisted approved order, clears at queue end and retains the approved queue');

  // Shortcut UI and callback verification is completed below once the settings
  // page is loaded; a callback is production code, but no OS keypress is sent.
  await click(control, '设置与外观');
  await until(() => evaluate(control, '!!document.querySelector("[aria-label=下一封热键]")'), 'custom next shortcut setting');
  await input(control, '[aria-label=下一封热键]', 'Ctrl+Alt+N');
  await click(control, '保存热键');
  await until(async () => (await invoke(control, 'status')).nextShortcut === 'CommandOrControl+Alt+N', 'shortcut setting saved');
  const callbackEntry = [...shortcuts].find(([key]) => key.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl') === 'Ctrl+Alt+N');
  assert(callbackEntry, 'main registered the requested accelerator callback');
  await action('end');
  await until(async () => (await state()).receivers > 0, 'fresh output receiver after end');
  const beforeNext = requests.filter(item => item.action === 'next').length;
  callbackEntry[1]();
  await displayed('APPROVED_FROM_PRIVATE_TILE');
  assert.equal(requests.filter(item => item.action === 'next').length, beforeNext + 1);
  await pause(650);
  callbackEntry[1]();
  await displayed(next.text);
  await pause(650);
  callbackEntry[1]();
  await displayBlank('shortcut next clears at end');
  await click(control, '录制组合键');
  await until(() => evaluate(control, 'document.querySelector("[aria-label=下一封热键]").readOnly'), 'shortcut recording active');
  const duringRecording = requests.filter(item => item.action === 'next').length;
  callbackEntry[1]();
  await pause(700);
  assert.equal(requests.filter(item => item.action === 'next').length, duringRecording, 'old next callback is suspended while recording');
  await evaluate(control, 'document.querySelector("[aria-label=下一封热键]").dispatchEvent(new KeyboardEvent("keydown",{key:"N",code:"KeyN",ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))');
  assert.equal((await invoke(control, 'status')).shortcutRecording, true, 'capturing a candidate cannot restore next while its keys are held');
  assert.equal(await evaluate(control, 'document.querySelector("[aria-label=下一封热键]").readOnly'), true);
  callbackEntry[1]();
  await pause(700);
  assert.equal(requests.filter(item => item.action === 'next').length, duringRecording, 'held-key repeat cannot execute the old next callback after candidate capture');
  await evaluate(control, 'document.querySelector("[aria-label=下一封热键]").dispatchEvent(new KeyboardEvent("keyup",{key:"N",code:"KeyN",ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))');
  assert.equal((await invoke(control, 'status')).shortcutRecording, true, 'releasing the letter while modifiers remain held keeps next suspended');
  await evaluate(control, 'document.querySelector("[aria-label=下一封热键]").dispatchEvent(new KeyboardEvent("keyup",{key:"Control",code:"ControlLeft",ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,bubbles:true,cancelable:true}))');
  await until(async () => !(await invoke(control, 'status')).shortcutRecording && await evaluate(control, '!document.querySelector("[aria-label=下一封热键]").readOnly&&document.querySelector("[aria-label=下一封热键]").value.endsWith("Shift+N")'), 'only releasing all modifiers restores next after recording');
  await click(control, '保存热键');
  await until(async () => (await invoke(control, 'status')).nextShortcut === 'CommandOrControl+Shift+N', 'recorded combination saves');
  assert.equal(shortcuts.has('CommandOrControl+Alt+N'), false);
  assert.equal(shortcuts.has('CommandOrControl+Shift+N'), true);
  blockedShortcut = 'CommandOrControl+Alt+B';
  await input(control, '[aria-label=下一封热键]', 'Ctrl+Alt+B');
  await click(control, '保存热键');
  await until(async () => (await invoke(control, 'status')).shortcutError.includes('占用'), 'occupied accelerator is reported privately');
  assert.equal((await invoke(control, 'status')).nextShortcut, 'CommandOrControl+Shift+N');
  assert(shortcuts.has('CommandOrControl+Shift+N'), 'failed replacement retains existing callback');
  await displayBlank('shortcut failure cannot expose error text in output');
  await click(control, '清除热键');
  await until(async () => (await invoke(control, 'status')).nextShortcut === '', 'clear shortcut disables next callback');
  assert.equal(shortcuts.has('CommandOrControl+Shift+N'), false);
  await input(control, '[aria-label=下一封热键]', 'Ctrl+Alt+N');
  await click(control, '保存热键');
  await until(async () => (await invoke(control, 'status')).nextShortcut === 'CommandOrControl+Alt+N', 'shortcut saved again for independent restart verification');
  await evaluate(control, 'document.querySelector("[aria-label=直播热键]").scrollIntoView({block:"center"})');
  await capture(control, 'hotkey-settings');
  checks.push('actual private settings UI persists a custom next accelerator; captured production callback fetches and advances the shared approved queue exactly once per trigger, without a real OS keypress');
  checks.push('recording suspends the existing next callback through candidate keydown and partial keyup; held-key repeat cannot advance the queue, and next resumes only after every modifier is released; recorded Ctrl+Shift+N saves, occupied replacement keeps old binding, clear unregisters it, and shortcut errors stay private');

  await action('show', first.id);
  await displayed('APPROVED_FROM_PRIVATE_TILE');
  const previousOutput = output();
  await invoke(control, 'selectTopic', fixture.topics[1].id, connectionId);
  assert(!previousOutput || previousOutput.isDestroyed() || !previousOutput.isVisible(), 'topic switch removes the previous native output immediately');
  await until(() => Object.keys(moduleLabels).every(module => !tile(module)), 'old topic tiles closed');
  await until(() => previousOutput.isDestroyed(), 'old output closes');
  assert.equal((await state()).current, null);
  const eventState = await state(fixture.topics[1].id);
  assert.equal(eventState.current, null);
  checks.push('topic switch clears previous native output, closes all context-bound tiles and leaves the next topic blank');

  await importSite(second);
  await click(control, '直播工作台');
  const betaInbox = await openModule('inbox');
  await until(() => evaluate(betaInbox, 'document.body.innerText.includes("Beta_")'), 'second site tile loads only its messages');
  assert.equal(await evaluate(betaInbox, 'document.body.innerText.includes("Alpha_")'), false);
  assert.equal(output(), undefined);
  checks.push('a second independent site imports and its new tile displays only that site’s messages; connection switching does not reopen output');

  await invoke(control, 'closeTile', 'inbox');
  await until(() => !tile('inbox'), 'clean tile closes');
  const settingsFile = JSON.parse(await fs.readFile(path.join(userData, 'workspace.v1.json'), 'utf8'));
  assert(!JSON.stringify(settingsFile).includes('wc_ctl_'));
  assert(!JSON.stringify(settingsFile).includes('APPROVED_FROM_PRIVATE_TILE'));
  assert.deepEqual(consoleErrors, [], 'real renderers log no console errors');
  const report = { passed: true, environment: { electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, architecture: process.arch, backingService: 'real WindChime SQLite service and HTTP handlers', osShortcutRegistration: 'instrumented; callbacks exercised; no OS keystroke sent' }, checks, screenshots, tileGeometry, requests: requests.length, consoleErrors, profile: userData, at: new Date().toISOString() };
  await fs.writeFile(path.join(results, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  for (const item of fixtures) { item.http.closeAllConnections(); item.http.close(); await item.storage.close(); }
  app.exit(0);
}
run().catch(async error => {
  await fs.mkdir(results, { recursive: true });
  const windows = [];
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      windows.push({ title: window.getTitle(), visible: window.isVisible(), text: await evaluate(window, 'document.body.innerText'), visibilityState: await evaluate(window, 'document.visibilityState') });
      await fs.writeFile(path.join(results, 'failure-' + window.id + '.png'), (await window.webContents.capturePage()).toPNG());
    } catch {}
  }
  await fs.writeFile(path.join(results, 'failure.json'), JSON.stringify({ passed: false, error: error.stack, checks, requests, windows, consoleErrors, profile: userData }, null, 2));
  console.error(error.stack);
  for (const item of fixtures) { item.http.closeAllConnections(); item.http.close(); await item.storage.close().catch(() => {}); }
  app.exit(1);
});
