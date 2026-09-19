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
let window, activated = false, opens = 0, frames = 0, revision = 1;
const errors = [], checks = [];
const evaluate = source => window.webContents.executeJavaScript(source);
async function until(check, label, timeout = 10000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 50) { if (await check()) return; await pause(50); }
  throw new Error('Timed out: ' + label);
}
async function imageGeometry() {
  return evaluate(`(()=>{const a=document.querySelector('.wc-display'),v=a.querySelector('.wc-display-viewport'),ar=a.getBoundingClientRect(),vr=v.getBoundingClientRect(),m=a.querySelector('.wc-display-media'),mr=m.getBoundingClientRect();return [...a.querySelectorAll('img')].map(i=>{const r=i.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left-ar.left,top:r.top-ar.top,naturalWidth:i.naturalWidth,ratio:i.naturalWidth/i.naturalHeight,scrolling:v.contains(i),below:mr.top>=vr.bottom-1,contained:r.left>=mr.left-1&&r.right<=mr.right+1&&r.top>=mr.top-1&&r.bottom<=mr.bottom+1&&r.bottom<=innerHeight+1};});})()`);
}
function assertImages(geometry) {
  assert.equal(geometry.length,3);
  for(const image of geometry) {
    assert(image.width>0&&image.height>0&&image.contained&&image.below&&!image.scrolling,JSON.stringify(image));
    assert(Math.abs(image.width/image.height-image.ratio)<.03,JSON.stringify(image));
  }
}
function assertFixed(before,after) { before.forEach((image,index)=>{for(const key of ['left','top','width','height'])assert(Math.abs(image[key]-after[index][key])<1,'bottom images must not move when text scrolls');}); }
async function run() {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-output-size-')));
  await fs.mkdir(output, { recursive: true });
  const dimensions = [[400,650],[80,40],[400,400]], images = await Promise.all(dimensions.map(([width,height],index)=>sharp({ create: { width,height,channels:3,background:['#759cac','#d9ba83','#79987c'][index] } }).webp().toBuffer()));
  const appearance = { fontFamily: 'system-ui', fontSize: 32, textColor: '#ffffff', backgroundColor: '#102030', transparent: false, layout: 'sidebar', imageLayout: 'row', imageHeightPercent:45, animation: 'none', borderRadius: 18, padding: 24, theme: 'uliuli', accentColor: '#2de2e6', borderWidth: 1, lineHeight: 1.65, letterSpacing: 0, maxWidth: 1200, viewportHeight: 900, autoScroll: true, scrollSpeed: 120, scrollStartPauseMs: 500, scrollEndPauseMs: 2500 };
  const snapshot = { id: 'approved-output', messageId: 'approved-letter', text: '经过确认的原比例图片固定在下方。\n只有文字在固定采集窗口内循环。\n'.repeat(8), nickname: '合成测试来信', linkUrl: null, assets: dimensions.map(([width,height],index)=>({id:'approved-image-'+index,caption:'第'+(index+1)+'张：图片完整可见，说明随文字滚动。',mimeType:'image/webp',width,height,sha256:createHash('sha256').update(images[index]).digest('hex')})) };
  await app.whenReady();
  window = new BrowserWindow({ width: 640, height: 420, frame: false, show: false, title: 'WindChime Display Test', webPreferences: { preload: path.resolve(__dirname, '../preload-display.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition: 'display-size-fixture' } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  ipcMain.handle('display:request', (event, input) => {
    if (!window || window.isDestroyed()) return { ok: false, code: 'DISPLAY_CLOSED', error: 'Output fixture closed', status: 410 };
    assert.equal(event.sender, window.webContents);
    if (input.path === '/display/open') { activated = false; return { ok: true, data: { receiverId: `fixture-${++opens}`, epoch: 'fixture', leaseMs: 3000, pollIntervalMs: 500 } }; }
    if (input.path.startsWith('/display/frame?')) { frames++; return { ok: true, data: { receiverId: `fixture-${opens}`, epoch: 'fixture', revision, activation: activated ? revision : 0, leaseMs: 3000, appearance, snapshot: activated ? snapshot : null } }; }
    const imageIndex = /^\/display\/assets\/approved-image-(\d)\?/.exec(input.path)?.[1];
    if (imageIndex!==undefined && images[Number(imageIndex)] && activated) return { ok: true, data: { image: images[Number(imageIndex)].toString('base64'), mimeType: 'image/webp' } };
    throw new Error('Unexpected output request: ' + input.path);
  });
  await window.loadFile(path.resolve(__dirname, '../build/display.html')); window.showInactive();
  await until(() => opens === 1 && frames > 0, 'blank output handshake');
  assert.equal(await evaluate(`!!document.querySelector('.wc-display')`), false);
  assert.equal(await evaluate(`typeof window.windchimeDesktop`), 'undefined');
  activated = true;
  await until(() => evaluate(`document.querySelectorAll('.wc-display img').length===3`), 'approved images decoded');
  const initialImages = await imageGeometry(); assertImages(initialImages);
  assert(initialImages[1].width>80,'the 80px source image is enlarged to fit the available cell');
  const bounds = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),r=a.getBoundingClientRect();return {height:r.height,windowHeight:innerHeight,width:r.width,windowWidth:innerWidth,overflow:document.documentElement.scrollHeight>innerHeight+1};})()`);
  assert.equal(bounds.height, bounds.windowHeight); assert.equal(bounds.overflow, false);
  assert(bounds.height < 900); assert(bounds.width <= bounds.windowWidth);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'scroll starts before moving output to the background');
  const backgroundOffset = await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), backgroundFrames = frames;
  window.hide(); await pause(700);
  assert(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`) > backgroundOffset, 'an occluded or hidden native output must keep animating while its valid receiver is online');
  assert(frames > backgroundFrames, 'read-only receiver polling continues while the output window is hidden');
  assertFixed(initialImages,await imageGeometry());
  window.showInactive();
  checks.push('A hidden/background native window keeps its confirmed current letter scrolling and polling with background throttling disabled');
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'final image caption in a shorter native output window', 30000);
  assert(await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport').getBoundingClientRect(),c=document.querySelector('.wc-display-image-captions p:last-child').getBoundingClientRect();return c.top>=v.top&&c.bottom<=v.bottom+1&&c.bottom<=innerHeight;})()`));
  assertFixed(initialImages,await imageGeometry());
  await fs.writeFile(path.join(output, 'height900-window420-bottom.png'), (await window.webContents.capturePage()).toPNG());
  checks.push('Configured 900px output clamps to the native 420px capture window; three mixed-ratio images remain fully visible and fixed below scrolling text, including enlargement of an 80px source');
  window.setSize(520, 300);
  await pause(80);
  assert.equal(await evaluate(`document.querySelector('.wc-display').getBoundingClientRect().height`), await evaluate('innerHeight'));
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0, 'resizing restarts from the top with fresh geometry');
  const resizedImages = await imageGeometry(); assertImages(resizedImages);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'tail after native resize', 35000);
  assert(await evaluate(`document.querySelector('.wc-display-image-captions p:last-child').getBoundingClientRect().bottom<=document.querySelector('.wc-display-viewport').getBoundingClientRect().bottom+1`));
  assertFixed(resizedImages,await imageGeometry());
  await fs.writeFile(path.join(output, 'window300-bottom.png'), (await window.webContents.capturePage()).toPNG());
  checks.push('Shrinking to 300px resets the text loop; the final caption remains reachable and every image remains stationary and fully contained');
  appearance.viewportHeight=180;appearance.fontSize=96;appearance.padding=32;appearance.imageHeightPercent=70;revision++;
  await until(()=>evaluate(`document.querySelector('.wc-display')?.getBoundingClientRect().height===180`),'extreme short output update');
  assert(await evaluate(`document.querySelector('.wc-display-viewport').clientHeight>0`),'extreme settings preserve a nonzero text viewport');
  assertImages(await imageGeometry());
  checks.push('180px output with 96px type, 32px padding and 70% requested image area preserves positive text space and fully contained images');
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
