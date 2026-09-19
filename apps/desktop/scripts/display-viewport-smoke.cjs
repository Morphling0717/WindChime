// Real isolated output entry, preload and receiver. Synthetic approved frames; no user profile or credentials.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const output = path.resolve(__dirname, '../out/display-viewport-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, activated = false, opens = 0, frames = 0;
const errors = [], checks = [];
const evaluate = source => window.webContents.executeJavaScript(source);
async function until(check, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 50) { if (await check()) return; await pause(50); }
  throw new Error('Timed out: ' + label);
}
async function run() {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-output-size-')));
  await fs.mkdir(output, { recursive: true });
  const image = await sharp({ create: { width: 400, height: 650, channels: 3, background: '#759cac' } }).webp().toBuffer();
  const appearance = { fontFamily: 'system-ui', fontSize: 32, textColor: '#ffffff', backgroundColor: '#102030', transparent: false, layout: 'stack', imageLayout: 'column', animation: 'none', borderRadius: 18, padding: 24, theme: 'uliuli', accentColor: '#2de2e6', borderWidth: 1, lineHeight: 1.65, letterSpacing: 0, maxWidth: 1200, viewportHeight: 900, autoScroll: true, scrollSpeed: 120, scrollStartPauseMs: 500, scrollEndPauseMs: 2500 };
  const snapshot = { id: 'approved-output', messageId: 'approved-letter', text: '经过确认的原比例竖图。\n固定采集窗口内显示完整内容。', nickname: '合成测试来信', linkUrl: null, assets: [{ id: 'approved-image', caption: '这是图片最后的说明，必须完整可见。', mimeType: 'image/webp', width: 400, height: 650, sha256: createHash('sha256').update(image).digest('hex') }] };
  await app.whenReady();
  window = new BrowserWindow({ width: 640, height: 420, frame: false, show: false, title: 'WindChime Display Test', webPreferences: { preload: path.resolve(__dirname, '../preload-display.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition: 'display-size-fixture' } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  ipcMain.handle('display:request', (event, input) => {
    if (!window || window.isDestroyed()) return { ok: false, code: 'DISPLAY_CLOSED', error: 'Output fixture closed', status: 410 };
    assert.equal(event.sender, window.webContents);
    if (input.path === '/display/open') { activated = false; return { ok: true, data: { receiverId: `fixture-${++opens}`, epoch: 'fixture', leaseMs: 3000, pollIntervalMs: 500 } }; }
    if (input.path.startsWith('/display/frame?')) { frames++; return { ok: true, data: { receiverId: `fixture-${opens}`, epoch: 'fixture', revision: 1, activation: activated ? 1 : 0, leaseMs: 3000, appearance, snapshot: activated ? snapshot : null } }; }
    if (input.path.startsWith('/display/assets/approved-image?') && activated) return { ok: true, data: { image: image.toString('base64'), mimeType: 'image/webp' } };
    throw new Error('Unexpected output request: ' + input.path);
  });
  await window.loadFile(path.resolve(__dirname, '../build/display.html')); window.showInactive();
  await until(() => opens === 1 && frames > 0, 'blank output handshake');
  assert.equal(await evaluate(`!!document.querySelector('.wc-display')`), false);
  assert.equal(await evaluate(`typeof window.windchimeDesktop`), 'undefined');
  activated = true;
  await until(() => evaluate(`!!document.querySelector('.wc-display img')`), 'approved image decoded');
  const bounds = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),r=a.getBoundingClientRect();return {height:r.height,windowHeight:innerHeight,width:r.width,windowWidth:innerWidth,overflow:document.documentElement.scrollHeight>innerHeight+1};})()`);
  assert.equal(bounds.height, bounds.windowHeight); assert.equal(bounds.overflow, false);
  assert(bounds.height < 900); assert(bounds.width <= bounds.windowWidth);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'scroll starts before moving output to the background');
  const backgroundOffset = await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), backgroundFrames = frames;
  window.hide(); await pause(700);
  assert(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`) > backgroundOffset, 'an occluded or hidden native output must keep animating while its valid receiver is online');
  assert(frames > backgroundFrames, 'read-only receiver polling continues while the output window is hidden');
  window.showInactive();
  checks.push('A hidden/background native window keeps its confirmed current letter scrolling and polling with background throttling disabled');
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'full tall image in a shorter native output window', 25000);
  assert(await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport').getBoundingClientRect(),c=document.querySelector('figcaption').getBoundingClientRect();return c.top>=v.top&&c.bottom<=v.bottom+1&&c.bottom<=innerHeight;})()`));
  await fs.writeFile(path.join(output, 'height900-window420-bottom.png'), (await window.webContents.capturePage()).toPNG());
  checks.push('Configured 900px output clamps to the native 420px capture window; approved portrait scrolls to its fully visible final caption');
  window.setSize(520, 300);
  await pause(80);
  assert.equal(await evaluate(`document.querySelector('.wc-display').getBoundingClientRect().height`), await evaluate('innerHeight'));
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0, 'resizing restarts from the top with fresh geometry');
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'tail after native resize', 25000);
  assert(await evaluate(`document.querySelector('figcaption').getBoundingClientRect().bottom<=innerHeight`));
  await fs.writeFile(path.join(output, 'window300-bottom.png'), (await window.webContents.capturePage()).toPNG());
  checks.push('Shrinking to 300px resets the loop and still reveals the final caption at the actual end');
  window.webContents.send('output:blank');
  await until(() => evaluate(`!document.querySelector('.wc-display')`), 'emergency blank removes card and scroll loop');
  await pause(1000); assert.equal(await evaluate(`!!document.querySelector('.wc-display')`), false);
  checks.push('Output blank destroys the animation, reopens a blank receiver and never restores the previous letter');
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { passed: true, at: new Date().toISOString(), electron: process.versions.electron, checks, bounds, frames, opens, consoleErrors: errors, limitations: ['Synthetic read-only IPC frames; no production inbox, OBS or live-software capture'] };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(0);
}
run().catch(async error => { console.error(error.stack); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors, frames, opens }, null, 2)); app.exit(1); });
