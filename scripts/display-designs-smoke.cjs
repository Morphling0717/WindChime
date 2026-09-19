// Runs with Electron. Uses only the self-contained design sample and its own profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.work/display-designs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], checks = [], cases = [];
let window;
async function evaluate(code) { return window.webContents.executeJavaScript(code); }
async function until(check, label, timeout = 5000) {
  for (let attempt = 0; attempt < timeout / 50; attempt++) { if (await check()) return; await pause(50); }
  throw new Error('Timed out: ' + label);
}
async function select(label, value) {
  await evaluate(`(()=>{const select=document.querySelector('select[aria-label="${label}"]');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(80);
}
async function checkBox(label, value) {
  await evaluate(`(()=>{const node=document.querySelector('input[aria-label="${label}"]');if(node.checked!==${value})node.click();})()`);
  await pause(80);
}
async function capture(name) {
  await evaluate('window.scrollTo(0,0)'); await pause(200);
  await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
}
async function captureOutput(name) {
  await evaluate(`document.querySelector('.wc-display').scrollIntoView({block:'center'})`); await pause(50);
  const bounds = await evaluate(`(()=>{const r=document.querySelector('.wc-display').getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),width:Math.floor(r.width),height:Math.floor(r.height)};})()`);
  await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage(bounds)).toPNG());
}
async function run() {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-designs-')));
  await app.whenReady();
  window = new BrowserWindow({ width: 1440, height: 1000, show: false, backgroundColor: '#111c27', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  await window.loadFile(path.join(output, 'WindChime-Display-Designs.html'));
  window.showInactive();
  await until(() => evaluate('!!document.querySelector(".wc-display")'), 'gallery renderer');
  assert.equal(await evaluate('typeof require'), 'undefined');
  for (const images of [false, true]) {
    await checkBox('包含图片', images);
    for (const theme of ['pure', 'uliuli', 'mia']) for (const layout of ['stack', 'split', 'banner']) {
      await select('视觉主题', theme); await select('内容排版', layout);
      for (const width of [960, 640, 360]) {
        await select('展示宽度', String(width));
        await until(() => evaluate('document.querySelector(".design-stage").clientHeight>20'), 'scaled preview height');
        const frame = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),style=getComputedStyle(a),copy=a.querySelector('.wc-display-text');return {theme:a.dataset.theme,layout:a.dataset.layout,width:a.clientWidth,overflow:a.scrollWidth>a.clientWidth+1,text:copy.textContent,columns:getComputedStyle(copy).columnCount,bodyGrid:getComputedStyle(a.querySelector('.wc-display-grid')).gridTemplateColumns,images:a.querySelectorAll('img').length,imagesLoaded:[...a.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),background:style.backgroundColor,border:style.borderTopWidth,brand:!!a.querySelector('.wc-display-brand'),ornaments:a.querySelectorAll('.wc-display-ornament').length,links:a.querySelectorAll('a').length};})()`);
        assert.equal(frame.theme, theme); assert.equal(frame.layout, layout);
        if (layout === 'split' && !images) assert.equal(frame.columns, width > 520 ? '2' : '1', 'text columns adapt to available width');
        assert.equal(frame.overflow, false, JSON.stringify({ theme, layout, width, images, frame }));
        assert(frame.text.includes('愿你今晚有好梦')); assert.equal(frame.images, images ? 1 : 0); assert(frame.imagesLoaded); assert.equal(frame.links, 0);
        if (theme === 'pure') { assert.equal(frame.background, 'rgba(0, 0, 0, 0)'); assert.equal(frame.border, '0px'); assert(!frame.brand); assert.equal(frame.ornaments, 0); }
        else assert(!frame.brand && frame.ornaments > 0);
        assert.equal(await evaluate(`/ULIULI|MIA|星夜来信|来信频道/i.test(document.querySelector('.wc-display').innerText)`), false, 'theme branding never enters audience output');
        cases.push({ theme, layout, width, images, ...frame });
      }
    }
  }
  checks.push('3 themes × 3 layouts × 3 widths × text-only/image letters: 54 combinations render full sample text without horizontal overflow or extra links');
  await select('展示宽度', '960'); await checkBox('长信示例', true);
  for (const layout of ['stack', 'split', 'banner']) {
    await select('内容排版', layout);
    const long = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),v=a.querySelector('.wc-display-viewport');return {text:a.querySelector('.wc-display-text').textContent.length,height:a.getBoundingClientRect().height,scroll:v.scrollHeight,viewport:v.clientHeight,width:a.scrollWidth,clientWidth:a.clientWidth};})()`);
    assert(long.text > 500); assert(long.scroll > long.viewport); assert(long.height <= 640.1); assert(long.width <= long.clientWidth + 1);
  }
  checks.push('Long letters retain all text inside a fixed 640px output; content overflows only the inner scrolling viewport, while ornaments and borders stay fixed');
  await checkBox('包含图片', false); await select('内容排版', 'split'); await select('滚动速度', '120');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='从头预览').click()`);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='top'`), 'top pause');
  await pause(300); assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  const decorationTop = await evaluate(`document.querySelector('.wc-display-ornament').getBoundingClientRect().top-document.querySelector('.wc-display').getBoundingClientRect().top`);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'automatic movement', 5000);
  assert(Math.abs(await evaluate(`document.querySelector('.wc-display-ornament').getBoundingClientRect().top-document.querySelector('.wc-display').getBoundingClientRect().top`) - decorationTop) < .1);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'bottom pause', 30000);
  const atBottom = await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport');return {top:v.scrollTop,max:v.scrollHeight-v.clientHeight};})()`);
  assert(Math.abs(atBottom.top - atBottom.max) <= 1);
  await captureOutput('long-letter-bottom');
  await pause(300); assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), atBottom.top);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='top'&&document.querySelector('.wc-display-viewport').scrollTop===0`), 'automatic return to top', 5000);
  checks.push('Real animation reaches bottom, holds the last line, returns to top and loops the same snapshot; frame decoration does not move');
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'second cycle movement', 5000);
  await evaluate(`window.oldScrollViewport=document.querySelector('.wc-display-viewport');`);
  await select('视觉主题', 'uliuli');
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  assert.equal(await evaluate(`window.oldScrollViewport.isConnected`), false);
  const oldOffset = await evaluate(`window.oldScrollViewport.scrollTop`);
  await pause(200); assert.equal(await evaluate(`window.oldScrollViewport.scrollTop`), oldOffset);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'movement before snapshot replacement', 5000);
  await evaluate(`window.oldScrollViewport=document.querySelector('.wc-display-viewport');Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='从头预览').click()`);
  await pause(30);
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  assert.equal(await evaluate(`window.oldScrollViewport.isConnected`), false);
  checks.push('Appearance and snapshot replacement reset immediately at the top and cancel the detached old animation');
  await checkBox('长信示例', false);
  await select('内容排版', 'stack'); await pause(2200);
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase`), 'still');
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  checks.push('A short letter remains stationary after the initial pause');
  await checkBox('包含图片', true);
  for (const portrait of [false, true]) {
    await checkBox('竖图示例', portrait);
    for (const layout of ['stack', 'split', 'banner']) {
      await select('内容排版', layout);
      const dimensions = await evaluate(`(()=>{const i=document.querySelector('.wc-display img'),f=i.closest('figure'),m=i.closest('.wc-display-media');return {width:i.clientWidth,height:i.clientHeight,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,figure:f.clientWidth,media:m.clientWidth};})()`);
      assert(Math.abs(dimensions.width / dimensions.height - dimensions.naturalWidth / dimensions.naturalHeight) < .02, JSON.stringify(dimensions));
      assert(Math.abs(dimensions.width - dimensions.figure) <= 1, 'images fill the available figure width');
      assert(dimensions.width > 400, 'even the split layout gives images a readable width');
      if (!portrait && layout === 'banner') assert(dimensions.height > 180, 'banner no longer shrinks images to the old 180px cap');
    }
  }
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'portrait final caption at bottom', 30000);
  assert(await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport'),c=v.querySelector('figcaption'),b=c.getBoundingClientRect(),r=v.getBoundingClientRect();return b.bottom<=r.bottom+1&&b.top>=r.top;})()`));
  await captureOutput('portrait-bottom');
  checks.push('Landscape and portrait images fill their columns without cropping or distortion in every layout; tall images scroll fully through their final caption');
  await checkBox('竖图示例', false); await select('滚动速度', '24');
  await select('内容排版', 'split');
  for (const theme of ['pure', 'uliuli', 'mia']) { await select('视觉主题', theme); await capture(theme + '-split'); }
  await checkBox('包含图片', false);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查看九种组合').click()`);
  await until(() => evaluate('document.querySelectorAll(".wc-display").length===9'), 'nine-combination matrix');
  await pause(250); await capture('nine-combinations');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='隐藏示例').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".wc-display,.wc-display-brand,.wc-display-ornament").length'), 0);
  checks.push('Hiding removes all cards, background panels, borders and ornaments instead of hiding just the text');
  assert.equal(errors.length, 0, errors.join('\n'));
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), electron: process.versions.electron, checks, cases, consoleErrors: errors, limitations: ['Synthetic, self-contained design gallery; not a real production inbox or live-software capture test'] }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: cases.length, checks, errors, output }));
  app.exit(0);
}
run().catch(async error => { console.error(error.stack); await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.message,cases,errors},null,2)); app.exit(1); });
