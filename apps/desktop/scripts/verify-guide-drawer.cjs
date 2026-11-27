// End-to-end Electron 2K verification for v1.4.0:
// 1) Verifies Guide Drawer opens via sidebar button & F1, displays clean minimalist styling (no glass blur)
// 2) Verifies ALL 8 2K (1920x1200) VP9 WebM demo videos decode cleanly with zero errors
// 3) Verifies search filter, 2K zoom lightbox, Esc layering, and chapter CTA jump navigation
// 4) Captures 2K HiDPI screenshots (Light Mode, Dark Mode, and Zoom Lightbox) for visual review

const { app, BrowserWindow, dialog, shell, globalShortcut } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');

const OUT_DIR = process.env.WINDCHIME_VERIFY_OUT || path.resolve(__dirname, '../out/guide-verify');
const TOKEN = 'wc_ctl_' + Buffer.alloc(32, 5).toString('base64url');
const pause = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const route = url.pathname.replace('/api/mail/live', '');
  const json = v => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(v));
  };
  if (route === '/capabilities') return json({ protocolVersion: 1, siteId: 'verify-site', features: { connectionKeys: true, siteControl: true, mailManagement: true, keywordFilterToggle: true, displayThemes: true } });
  if (route === '/control/identity') return json({ siteId: 'verify-site', scope: 'site', topicId: null, topicTitle: null, grantId: 'g1', label: 'UliUli 提问箱', expiresAt: '2099-01-01T00:00:00Z' });
  const topic = { id: 'daily', title: '日常杂谈提问箱', slug: 'daily', description: '', note: '', isDefault: true, isEnabled: true, startsAt: null, endsAt: null, archivedAt: null, sortOrder: 0, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', state: 'default', isEnabledNow: true, unreadCount: 1, flaggedCount: 0 };
  if (route === '/control/topics') return json({ items: [topic] });
  if (route === '/control/topics/daily') return json(topic);
  if (route === '/control/settings') return json({ enabled: true, blockedTermsEnabled: false });
  if (route === '/control/messages') return json({ items: [], counts: { all: 0, unread: 0, favorited: 0, flagged: 0 }, blockedTermsEnabled: false });
  if (route === '/control/state') return json({ topicId: 'daily', revision: 1, epoch: 'e', messages: [], queue: [], current: null, appearance: { fontFamily: 'system-ui', fontSize: 30, textColor: '#fff', backgroundColor: '#18202eee', transparent: true, layout: 'stack', theme: 'pure' }, receivers: 0 });
  return json({ ok: true });
});

async function waitFor(win, expr, label, timeout = 12000) {
  for (let i = 0; i < timeout / 100; i++) {
    try {
      if (await win.webContents.executeJavaScript(`Boolean(${expr})`)) return;
    } catch {}
    await pause(100);
  }
  throw new Error('Timed out: ' + label);
}

app.whenReady().then(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-guide-verify-'));
  app.setPath('userData', userData);
  await fs.writeFile(
    path.join(userData, 'workspace.v1.json'),
    JSON.stringify({ version: 1, nextShortcut: '', tiles: {}, autoCheckUpdate: false, obsBridge: { port: 17498 } }),
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  dialog.showMessageBox = async () => ({ response: 1 });
  shell.openExternal = async () => {};
  globalShortcut.register = () => true;
  globalShortcut.unregister = () => {};
  globalShortcut.unregisterAll = () => {};

  const consoleErrors = [];
  require('../main.cjs');

  let win;
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (win) break;
    await pause(100);
  }
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) consoleErrors.push(msg);
  });
  win.setSize(1280, 800);
  win.center();

  await waitFor(win, `document.querySelector('input[type="password"]')`, 'connect input');
  const key = encodeWindChimeConnectionKey({ origin, siteId: 'verify-site', token: TOKEN });
  const imp = await win.webContents.executeJavaScript(`window.windchimeDesktop.importKey(${JSON.stringify(key)})`);
  assert(imp.ok, 'importKey succeeded');
  win.webContents.reload();
  await waitFor(win, `document.querySelector('#desktop-topic')?.value === 'daily'`, 'topic selected');

  // 1) Verify OBS bridge auto-enabled on startup with persisted key
  const obs = await win.webContents.executeJavaScript(`window.windchimeDesktop.getObsStatus()`);
  assert(obs.ok && obs.data.enabled === true && obs.data.running === true, 'OBS browser source auto-enabled on launch');
  console.log('OBS default-on verified:', obs.data.url);

  // 2) Open Guide Drawer via bottom-left sidebar button
  await win.webContents.executeJavaScript(`document.querySelector('.sidebar-guide-btn').click()`);
  await waitFor(win, `document.querySelector('.guide-drawer')`, 'guide drawer opened');

  // Verify minimalist non-glass drawer surface (no backdrop-filter blur on .guide-overlay or .guide-drawer)
  const drawerStyle = await win.webContents.executeJavaScript(`(() => {
    const ov = getComputedStyle(document.querySelector('.guide-overlay'));
    const dr = getComputedStyle(document.querySelector('.guide-drawer'));
    return { ovBlur: ov.backdropFilter, drBlur: dr.backdropFilter, drBg: dr.backgroundColor };
  })()`);
  assert.equal(drawerStyle.ovBlur, 'none', 'overlay has no glass blur');
  assert.equal(drawerStyle.drBlur, 'none', 'drawer has no glass blur');

  // 3) Verify ALL 8 chapters decode 1920x1200 VP9 WebM cleanly with zero errors
  const chapterCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item').length`);
  assert.equal(chapterCount, 8, 'all 8 chapters rendered');
  for (let i = 0; i < chapterCount; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item')[${i}].click()`);
    await waitFor(win, `(() => { const v = document.querySelector('.guide-media-visual'); return v && v.tagName === 'VIDEO' && v.readyState >= 2 && v.videoWidth === 1920 && v.videoHeight === 1200 && !v.error; })()`, `video 2K decoded for chapter ${i + 1}`);
    const info = await win.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('.guide-media-visual');
      return { w: v.videoWidth, h: v.videoHeight, d: Number(v.duration.toFixed(2)), src: v.getAttribute('src') };
    })()`);
    console.log(`Chapter ${i + 1} verified:`, JSON.stringify(info));
  }

  // Verify TOC numbers are strictly sequential 01..08 top-to-bottom
  const tocNums = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.guide-toc-num')).map(el => el.textContent.trim())`);
  assert.deepEqual(tocNums, ['01', '02', '03', '04', '05', '06', '07', '08'], 'TOC chapter numbers strictly sequential');

  // Verify inline video player is NOT flex-collapsed (must have >= 350px logical height)
  const playerHeight = await win.webContents.executeJavaScript(`document.querySelector('.guide-media-viewport').getBoundingClientRect().height`);
  assert(playerHeight >= 350, 'Inline 2K video viewport must not collapse, got height=' + playerHeight);

  // Switch to Chapter 03 (Redactor) & seek to mid-action for Light Mode screenshot
  await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item')[2].click()`);
  await waitFor(win, `(() => { const v = document.querySelector('.guide-media-visual'); return v && v.readyState >= 2 && v.duration > 1; })()`, 'ch03 ready');
  await win.webContents.executeJavaScript(`(() => { const v = document.querySelector('.guide-media-visual'); v.currentTime = v.duration * 0.62; v.pause(); })()`);
  await pause(300);
  await fs.writeFile(path.join(OUT_DIR, 'guide-drawer-light.png'), (await win.webContents.capturePage()).toPNG());

  // 4) Open 2K Zoom Lightbox & capture screenshot, then test Esc layering
  await win.webContents.executeJavaScript(`document.querySelector('.guide-zoom-fab').click()`);
  await waitFor(win, `document.querySelector('.guide-lightbox video')?.readyState >= 2`, 'lightbox video ready');
  await win.webContents.executeJavaScript(`(() => { const v = document.querySelector('.guide-lightbox video'); v.currentTime = v.duration * 0.62; v.pause(); })()`);
  await pause(300);
  await fs.writeFile(path.join(OUT_DIR, 'guide-lightbox-2k.png'), (await win.webContents.capturePage()).toPNG());

  // Press Esc -> closes lightbox ONLY, drawer stays open
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pause(150);
  assert(await win.webContents.executeJavaScript(`!document.querySelector('.guide-lightbox') && Boolean(document.querySelector('.guide-drawer'))`), 'Esc closes lightbox before drawer');

  // 5) Switch to Dark Mode and capture Chapter 04 (OBS Setup) screenshot
  await win.webContents.executeJavaScript(`window.windchimeDesktop.setTheme('dark')`);
  await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item')[3].click()`);
  await waitFor(win, `(() => { const v = document.querySelector('.guide-media-visual'); return v && v.readyState >= 2 && v.duration > 1; })()`, 'ch04 dark ready');
  await win.webContents.executeJavaScript(`(() => { const v = document.querySelector('.guide-media-visual'); v.currentTime = v.duration * 0.55; v.pause(); })()`);
  await pause(300);
  await fs.writeFile(path.join(OUT_DIR, 'guide-drawer-dark.png'), (await win.webContents.capturePage()).toPNG());

  // 6) Verify search filter works
  await win.webContents.executeJavaScript(`(() => {
    const inp = document.querySelector('.guide-search-wrap input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '打码');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(150);
  const filteredCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item').length`);
  assert.equal(filteredCount, 1, 'search "打码" filters to 1 matching chapter');
  await win.webContents.executeJavaScript(`(() => {
    const inp = document.querySelector('.guide-search-wrap input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(150);

  // 7) Verify Chapter 04 (OBS Setup) CTA button ("打开 OBS 采集设置 ↗") closes drawer & opens ObsGuidePanel in Studio
  await win.webContents.executeJavaScript(`document.querySelectorAll('.guide-toc-item')[3].click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`document.querySelector('.guide-jump-primary').click()`);
  await waitFor(win, `!document.querySelector('.guide-drawer') && Boolean(document.querySelector('.obs-guide-card'))`, 'CTA jumped to Studio + opened OBS guide');

  // 8) Verify F1 opens drawer again
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))`);
  await waitFor(win, `document.querySelector('.guide-drawer')`, 'F1 opened guide drawer');

  assert.equal(consoleErrors.length, 0, 'Zero console errors: ' + consoleErrors.join(' | '));
  console.log('ALL GUIDE DRAWER E2E CHECKS PASSED WITH 0 CONSOLE ERRORS!');
  server.close();
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  app.exit(0);
}).catch(err => {
  console.error('VERIFY FAILED:', err);
  app.exit(1);
});
