// Visual verification of the real private renderer and main-process IPC.
// From apps/desktop: npm run build && node_modules/.bin/electron scripts/glass-preview.cjs
// Optional: WINDCHIME_GLASS_SCENARIO=empty|connected|both (default both).
// No real website, account, installed app, or saved connection is used.
const { app, BrowserWindow, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { deflateSync } = require('node:zlib');
const { encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');

const scenario = process.env.WINDCHIME_GLASS_SCENARIO || 'both';
assert(['empty', 'connected', 'both'].includes(scenario), 'Unknown preview scenario');
const results = path.resolve(__dirname, '../out/glass-preview');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const token = `wc_ctl_${Buffer.alloc(32, 97).toString('base64url')}`;
const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
const appearance = { fontFamily: 'system-ui', fontSize: 24, textColor: '#ebfff9', backgroundColor: '#183d42ed', transparent: true, layout: 'letter', animation: 'none', borderRadius: 24, padding: 24, imageLayout: 'column' };
const attachment = { id: 'fixture-night-sky', caption: '下播回家的路上，也抬头看看月亮吧。' };
const message = (id, nickname, text, status, age, assets = []) => ({
  id, createdAt: new Date(Date.now() - age * 60000).toISOString(), isRead: age > 40, isFavorited: id === 'letter-2', isFlagged: false,
  source: { nickname, text, linkUrl: null, assets }, draft: { nickname, text, linkUrl: null, assets },
  draftRevision: 1, status, snapshotId: status === 'approved' ? `snapshot-${id}` : null,
});
const state = {
  topicId: 'late-night-letters', revision: 1, epoch: 'glass-preview-fixture', current: null, appearance, receivers: 0,
  messages: [
    message('letter-1', '路过的小岛', '今天下班很晚，打开直播间就听到了熟悉的声音。\n\n像是有人在很远的地方，为我留了一盏灯。谢谢你，也希望你记得照顾自己。', 'pending', 8, [attachment]),
    message('letter-2', '薄荷汽水', '考试通过啦！想把这份小小的开心寄给你。\n也祝正在努力的大家，都能等到属于自己的好消息。', 'approved', 27),
    message('letter-3', '一颗晚星', '最近开始学习画画了，第一张画的是窗边的小猫。\n慢一点也没关系，能够坚持喜欢的事情，本身就很棒。', 'approved', 55),
    message('letter-4', '匿名来信', '想听你分享一下最近循环播放的一首歌。\n如果有空的话，也可以聊聊小时候最喜欢的夏天。', 'pending', 74),
    message('letter-5', '云朵收藏家', '周末去了海边，捡到一枚颜色很漂亮的贝壳。\n把今天的海风寄给直播间，愿大家今晚都做个好梦。', 'pending', 96),
  ],
  queue: ['letter-2', 'letter-3'],
};

// A deterministic, synthetic landscape fixture; no external or unreviewed image.
function fixtureImage() {
  const width = 384, height = 216, raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = y * (width * 3 + 1), at = row + 1 + x * 3;
    const moon = (x - 280) ** 2 + (y - 55) ** 2 < 20 ** 2;
    const hill = y > 135 + Math.sin(x / 60) * 24;
    const front = y > 180 + Math.cos(x / 85) * 20;
    const color = moon ? [230, 240, 207] : front ? [36, 84, 81] : hill ? [64, 122, 114] : [33 + Math.round(y / 12), 68 + Math.round(y / 7), 93 + Math.round(y / 9)];
    raw[at] = color[0]; raw[at + 1] = color[1]; raw[at + 2] = color[2];
  }
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, value) => { const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(value.length); checksum.writeUInt32BE(crc(Buffer.concat([type, value]))); return Buffer.concat([size, type, value, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const image = fixtureImage();
const requests = [], actions = [], unexpectedRequests = [], consoleErrors = [], pageErrors = [];
let origin, control, userData, finished = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace('/api/mail/live', '');
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  requests.push(`${req.method} ${route}`);
  if (route === '/capabilities') return json({ protocolVersion: 1, siteId: 'glass-preview-site', basePath: '/api/mail/live', features: { connectionKeys: true, broadcast: true, images: true }, pollIntervalMs: 1000, leaseMs: 3000 });
  if (req.headers.authorization !== `Bearer ${token}`) return json({ error: 'Fixture requires its synthetic control credential' }, 401);
  if (route === '/control/identity') return json({ siteId: 'glass-preview-site', topicId: state.topicId, topicTitle: '深夜来信', label: 'UliUli · 深夜来信', expiresAt, grantId: 'glass-preview-grant' });
  if (route === '/control/state') return json(state);
  if (route === '/control/grants' && req.method === 'GET') return json({ items: [{ id: 'glass-preview-grant', kind: 'control', label: '本机预览连接', topicId: state.topicId, expiresAt, revokedAt: null }] });
  if (route === '/control/assets/fixture-night-sky') { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(image); }
  if (route === '/control/action' && ['hide', 'end'].includes(body.action)) { actions.push(body.action); state.current = null; state.revision++; return json(state); }
  unexpectedRequests.push(`${req.method} ${route}`);
  return json({ error: 'Visual fixture forbids broadcast or business mutations' }, 409);
});

async function until(check, label) {
  for (let i = 0; i < 150; i++) { try { if (await check()) return; } catch { /* Renderer can be navigating. */ } await pause(100); }
  throw new Error(`Visual preview timed out: ${label}`);
}
async function evaluate(source) { return control.webContents.executeJavaScript(source); }
async function navigate(view, label) {
  await evaluate(`Array.from(document.querySelectorAll('nav[aria-label="桌面导航"] button')).find(button=>button.textContent===${JSON.stringify(label)})?.click()`);
  await until(() => evaluate(`document.querySelector('.wc-desktop')?.dataset.view===${JSON.stringify(view)}`), `navigation ${view}`);
}
async function capture(name, width, height, { select = false, focusSelector } = {}) {
  control.setSize(width, height);
  if (select) await evaluate(`document.querySelector('.wc-mail')?.click()`);
  if (select) await until(() => evaluate(`!!document.querySelector('textarea[maxlength="1000"]') && Array.from(document.images).some(image => image.naturalWidth === 384)`), 'real reviewer and image');
  await evaluate(focusSelector ? `(() => {const target=document.querySelector(${JSON.stringify(focusSelector)});if(target)window.scrollTo(0,target.getBoundingClientRect().top+scrollY-72);})()` : `window.scrollTo(0, 0)`);
  await pause(450);
  const layout = await evaluate(`(() => {
    const width=document.documentElement.clientWidth;
    const hideButton=document.querySelector('.desktop-hide'),hide=hideButton?.getBoundingClientRect();
    const endButton=[...document.querySelectorAll('button')].find(button=>button.textContent==='结束展示'),end=endButton?.getBoundingClientRect();
    const clickable=(button,box)=>!!box && box.width>0 && box.top>=0 && box.bottom<=innerHeight && box.left>=0 && box.right<=width && button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    return {
      width, height:innerHeight, scrollWidth:document.documentElement.scrollWidth,
      horizontalOverflow:document.documentElement.scrollWidth > width + 1,
      overflowingElements:[...document.querySelectorAll('main,section,aside,input,select,textarea,button,img')].flatMap(node => {const box=node.getBoundingClientRect();return box.width && (box.right > width + 2 || box.left < -2) ? [{tag:node.tagName,className:node.className,label:node.getAttribute('aria-label'),left:Math.round(box.left),right:Math.round(box.right)}] : []}).slice(0,20),
      images:[...document.images].map(image=>({alt:image.alt,width:image.naturalWidth,height:image.naturalHeight})),
      brandLoaded:!!document.querySelector('.brand-mark img')?.naturalWidth,
      brandAsset:document.querySelector('.brand-mark img')?.currentSrc.split('/').at(-1),
      alertCount:document.querySelectorAll('[role=alert]').length,
      alerts:[...document.querySelectorAll('[role=alert]')].map(node=>node.textContent),
      emergencyHideVisible:!!hide && hide.top>=0 && hide.bottom<=innerHeight && hide.left>=0 && hide.right<=width,
      emergencyHideClickable:clickable(hideButton,hide),
      endDisplayClickable:endButton?clickable(endButton,end):null,
      navigationLabels:[...document.querySelectorAll('nav[aria-label="桌面导航"] button')].map(button=>button.getAttribute('aria-label')),
      colorInputHeights:[...document.querySelectorAll('input[type=color]')].map(input=>input.getBoundingClientRect().height),
      keyFieldEmpty:!document.querySelector('input[type=password]')?.value,
      studioPresent:!!document.querySelector('[aria-label="风铃私人审核控制台"]'),
      queueCount:document.querySelectorAll('.wc-queue > li').length,
      outputBlank:document.body.innerText.includes('观众画面为空白')
    };
  })()`);
  const filename = `${name}.png`;
  await fs.writeFile(path.join(results, filename), (await control.webContents.capturePage()).toPNG());
  return { name, filename, ...layout };
}

async function run() {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-glass-preview-'));
  app.setPath('userData', userData);
  await fs.mkdir(results, { recursive: true });
  shell.openExternal = async () => { throw new Error('External navigation disabled in visual fixture'); };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(target.origin, origin, 'Visual fixture cannot access any real website');
    assert(target.pathname.startsWith('/api/mail/live/'), 'Visual fixture only uses WindChime endpoints');
    return originalFetch(input, options);
  };
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('console-message', (_event, level, message) => { if (level === 3) consoleErrors.push(message); });
    window.webContents.on('render-process-gone', (_event, details) => pageErrors.push(details.reason));
  });
  require('../main.cjs');
  await app.whenReady();
  await until(() => { control = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('私人控制台')); return !!control; }, 'private controller');
  await until(() => evaluate(`!!window.windchimeDesktop && !!document.querySelector('input[type=password]')`), 'real key form');
  control.setTitle('风铃 · 私人控制台 · 玻璃预览');
  const captures = [];
  if (scenario !== 'connected') {
    captures.push(await capture('empty-wide', 1440, 1000));
    captures.push(await capture('empty-narrow', 760, 900));
    assert.equal(requests.length, 0, 'Unconnected startup must not initiate network requests');
  }
  if (scenario !== 'empty') {
    const key = encodeWindChimeConnectionKey({ origin, siteId: 'glass-preview-site', token });
    await evaluate(`(() => {
      const input=document.querySelector('input[type=password]');
      if(input.closest('details'))input.closest('details').open=true;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='使用密钥连接'&&!button.disabled)`), 'real key form accepts synthetic key');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='使用密钥连接').click()`);
    await until(() => evaluate(`document.querySelectorAll('.wc-mail').length === 5`), 'synthetic inbox through the real client');
    assert.equal(await evaluate(`document.querySelector('input[type=password]').value`), '', 'Successful form connection clears the key');
    const imported = await evaluate('window.windchimeDesktop.sites()');
    assert(imported.ok && imported.data.items.length === 1, 'Real form and import IPC save exactly one synthetic connection');
    captures.push(await capture('connected-wide', 1440, 1000));
    captures.push(await capture('review-wide', 1440, 1000, { select: true }));
    captures.push(await capture('review-medium', 1050, 920));
    captures.push(await capture('review-narrow', 760, 900));
    captures.push(await capture('review-narrow-editor', 760, 900, { focusSelector: '.wc-columns > .wc-panel:nth-child(2)' }));
    await navigate('appearance', '展示外观');
    captures.push(await capture('appearance-wide', 1440, 1000));
    captures.push(await capture('appearance-narrow', 760, 900));
    await navigate('connections', '信箱连接');
    captures.push(await capture('connections-wide', 1440, 1000));
    captures.push(await capture('connections-narrow', 760, 900));
    await navigate('studio', '来信工作台');
    const localDraft = '尚未保存的本机审阅草稿。切换导航后应继续保留。';
    await evaluate(`(() => {const input=document.querySelector('textarea[maxlength="1000"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(localDraft)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(100);
    await navigate('connections', '信箱连接');
    await navigate('appearance', '展示外观');
    await navigate('studio', '来信工作台');
    assert.equal(await evaluate(`document.querySelector('textarea[maxlength="1000"]').value`), localDraft, 'Private unsaved draft survives navigation');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='结束展示').click()`);
    await until(() => actions.includes('end'), 'existing shared end-display handler');
    await evaluate(`document.querySelector('.desktop-hide').click()`);
    await until(() => actions.includes('hide'), 'fixed emergency-hide handler');
    await pause(200);
    assert.equal(await evaluate(`document.querySelector('textarea[maxlength="1000"]').value`), localDraft, 'Safety actions preserve the unsaved private draft');
    assert.equal(state.current, null, 'Visual verification never activates output');
    assert.deepEqual(state.queue, ['letter-2', 'letter-3'], 'Reviewing preserves approved queue');
    assert.equal(state.messages[0].status, 'pending', 'Previewing does not approve the selected letter');
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'Only the private window is opened');
  }
  assert.equal(unexpectedRequests.length, 0, 'Visual fixture must not receive unsupported mutations');
  const report = {
    passed: consoleErrors.length === 0 && pageErrors.length === 0 && captures.every(item => item.brandLoaded && !item.horizontalOverflow && item.keyFieldEmpty && item.emergencyHideVisible && item.emergencyHideClickable && item.endDisplayClickable !== false),
    scenario, electron: process.versions.electron, platform: process.platform, capturedAt: new Date().toISOString(),
    captures, consoleErrors, pageErrors, requestCount: requests.length, actions,
    checks: ['temporary userData', 'real password form and connect button through main-process import and encrypted vault', 'successful form clears the key', 'loopback-only synthetic website', 'real private UI and shared review components', 'original image and preview image share bytes', 'no display opened or letter approved', 'wide/medium/minimum window layouts', 'studio/connection/appearance navigation', 'unsaved private draft preserved through navigation', 'emergency hide and end-display stay visible and clickable when scrolling', 'existing end-display and emergency-hide handlers reach server'],
  };
  await fs.writeFile(path.join(results, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  finished = true;
  server.closeAllConnections(); server.close();
  app.exit(report.passed ? 0 : 1);
}
run().catch(async error => {
  // Only a fixed fixture error is logged; credentials never appear in reports.
  console.error(`Glass visual preview failed: ${error.message}`);
  if (!finished) await fs.writeFile(path.join(results, 'failure.json'), JSON.stringify({ passed: false, error: error.message })).catch(() => {});
  server.closeAllConnections(); server.close(); app.exit(1);
});
