// Runs with Electron. Uses only the self-contained design sample and its own profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.work/display-designs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], checks = [], cases = [];
const layouts = ['stack', 'split', 'banner', 'sidebar', 'portrait', 'focus'];
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
async function clickText(label) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  await pause(80);
}
async function imageGeometry() {
  return evaluate(`(()=>{const a=document.querySelector('.wc-display'),v=a.querySelector('.wc-display-viewport'),ar=a.getBoundingClientRect(),vr=v.getBoundingClientRect(),m=a.querySelector('.wc-display-media'),mr=m?.getBoundingClientRect();return [...a.querySelectorAll('img')].map(i=>{const r=i.getBoundingClientRect();return {left:r.left-ar.left,top:r.top-ar.top,width:r.width,height:r.height,ratio:i.naturalWidth/i.naturalHeight,scrolling:v.contains(i),below:mr.top>=vr.bottom-1,contained:r.left>=mr.left-1&&r.right<=mr.right+1&&r.top>=mr.top-1&&r.bottom<=mr.bottom+1&&r.bottom<=ar.bottom+1};});})()`);
}
function assertImages(geometry, count) {
  assert.equal(geometry.length, count);
  for (const image of geometry) {
    assert(image.width>0&&image.height>0&&image.contained&&image.below&&!image.scrolling, JSON.stringify(image));
    assert(Math.abs(image.width/image.height-image.ratio)<.025, 'approved images retain their original ratio: '+JSON.stringify(image));
  }
}
function assertStill(before, after) {
  assert.equal(after.length,before.length);
  before.forEach((image,index)=>{ for(const key of ['left','top','width','height']) assert(Math.abs(image[key]-after[index][key])<1,'images remain fixed while text scrolls'); });
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
    await select('图片数量', images ? '1' : '0');
    for (const theme of ['pure', 'uliuli', 'mia']) for (const layout of layouts) {
      await select('视觉主题', theme); await select('内容排版', layout);
      for (const width of [960, 640, 360]) {
        await select('展示宽度', String(width));
        await until(() => evaluate('document.querySelector(".design-stage").clientHeight>20'), 'scaled preview height');
        const frame = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),style=getComputedStyle(a),copy=a.querySelector('.wc-display-text');return {theme:a.dataset.theme,layout:a.dataset.layout,width:a.clientWidth,overflow:a.scrollWidth>a.clientWidth+1,text:copy.textContent,columns:getComputedStyle(copy).columnCount,bodyGrid:getComputedStyle(a.querySelector('.wc-display-grid')).gridTemplateColumns,images:a.querySelectorAll('img').length,imagesLoaded:[...a.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),background:style.backgroundColor,border:style.borderTopWidth,brand:!!a.querySelector('.wc-display-brand'),ornaments:a.querySelectorAll('.wc-display-ornament').length,links:a.querySelectorAll('a').length};})()`);
        assert.equal(frame.theme, theme); assert.equal(frame.layout, layout);
        if (layout === 'split') assert.equal(frame.columns, width > 520 ? '2' : '1', 'text columns adapt to available width independently of images');
        assert.equal(frame.overflow, false, JSON.stringify({ theme, layout, width, images, frame }));
        assert(frame.text.includes('愿你今晚有好梦')); assert.equal(frame.images, images ? 1 : 0); assert(frame.imagesLoaded); assert.equal(frame.links, 0);
        if (theme === 'pure') { assert.equal(frame.background, 'rgba(0, 0, 0, 0)'); assert.equal(frame.border, '0px'); assert(!frame.brand); assert.equal(frame.ornaments, 0); }
        else assert(!frame.brand && frame.ornaments > 0);
        assert.equal(await evaluate(`/ULIULI|MIA|星夜来信|来信频道/i.test(document.querySelector('.wc-display').innerText)`), false, 'theme branding never enters audience output');
        assertImages(await imageGeometry(), images ? 1 : 0);
        cases.push({ theme, layout, width, images, ...frame });
      }
    }
  }
  checks.push('3 themes × 6 layouts × 3 widths × text-only/image letters: 108 combinations render the full sample without horizontal overflow, extra links or audience branding; every image stays outside the text viewport and fully contained below it');
  await select('展示宽度', '960'); await select('展示高度','640'); await checkBox('长信示例', true);
  for (const layout of layouts) {
    await select('内容排版', layout);
    const long = await evaluate(`(()=>{const a=document.querySelector('.wc-display'),v=a.querySelector('.wc-display-viewport');return {text:a.querySelector('.wc-display-text').textContent.length,height:a.getBoundingClientRect().height,scroll:v.scrollHeight,viewport:v.clientHeight,width:a.scrollWidth,clientWidth:a.clientWidth};})()`);
    assert(long.text > 400); assert(long.scroll > long.viewport); assert(long.height <= 640.1); assert(long.width <= long.clientWidth + 1);
  }
  checks.push('Long letters retain all text inside a fixed 640px output; content overflows only the inner scrolling viewport, while ornaments and borders stay fixed');
  await select('图片数量', '1'); await select('内容排版', 'split'); await select('滚动速度', '120');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='从头预览').click()`);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='top'`), 'top pause');
  await pause(300); assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  const decorationTop = await evaluate(`document.querySelector('.wc-display-ornament').getBoundingClientRect().top-document.querySelector('.wc-display').getBoundingClientRect().top`);
  const fixedImages = await imageGeometry(), snapshotId = await evaluate(`document.querySelector('.wc-display').dataset.windchimeSnapshot`);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').scrollTop>20`), 'automatic movement', 5000);
  assert(Math.abs(await evaluate(`document.querySelector('.wc-display-ornament').getBoundingClientRect().top-document.querySelector('.wc-display').getBoundingClientRect().top`) - decorationTop) < .1);
  assertStill(fixedImages,await imageGeometry());
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'bottom pause', 30000);
  const atBottom = await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport');return {top:v.scrollTop,max:v.scrollHeight-v.clientHeight};})()`);
  assert(Math.abs(atBottom.top - atBottom.max) <= 1);
  assertStill(fixedImages,await imageGeometry());
  await captureOutput('long-letter-bottom');
  await pause(300); assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), atBottom.top);
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='top'&&document.querySelector('.wc-display-viewport').scrollTop===0`), 'automatic return to top', 5000);
  assert.equal(await evaluate(`document.querySelector('.wc-display').dataset.windchimeSnapshot`),snapshotId);
  assertStill(fixedImages,await imageGeometry());
  checks.push('Real animation reaches bottom, holds the last line, returns to top and loops the same snapshot; frame decoration and the complete bottom image never move');
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
  await select('图片数量','0'); await select('内容排版', 'stack'); await pause(2200);
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase`), 'still');
  assert.equal(await evaluate(`document.querySelector('.wc-display-viewport').scrollTop`), 0);
  checks.push('A short letter remains stationary after the initial pause');
  await select('图片数量','1');
  for (const portrait of [false, true]) {
    await checkBox('竖图示例', portrait);
    for (const layout of layouts) {
      await select('内容排版', layout);
      assertImages(await imageGeometry(),1);
    }
  }
  await select('内容排版','sidebar'); await clickText('使用推荐尺寸');
  assert.equal(await evaluate(`document.querySelector('.wc-display').offsetWidth`),360);
  assert.equal(await evaluate(`document.querySelector('.wc-display').offsetHeight`),800);
  await select('图片数量','3'); await checkBox('长信示例',true);
  const multi = await imageGeometry(); assertImages(multi,3);
  await until(()=>evaluate(`document.querySelector('.wc-display-viewport').scrollTop>30`),'long narrow text scroll',5000);
  assertStill(multi,await imageGeometry());
  for (const arrangement of ['row','column','grid']) {
    await select('图片排列',arrangement);
    for (const percent of ['20','45','70']) { await select('图片区域',percent); assertImages(await imageGeometry(),3); }
  }
  await select('图片排列','row');
  await select('图片区域','45'); await select('展示宽度','640');
  await until(() => evaluate(`document.querySelector('.wc-display-viewport').dataset.scrollPhase==='bottom'`), 'all numbered image captions at text end', 45000);
  assert(await evaluate(`(()=>{const v=document.querySelector('.wc-display-viewport'),c=v.querySelector('.wc-display-image-captions p:last-child'),b=c.getBoundingClientRect(),r=v.getBoundingClientRect();return b.bottom<=r.bottom+1&&b.top>=r.top;})()`));
  assertImages(await imageGeometry(),3);
  await captureOutput('portrait-bottom');
  checks.push('Landscape, portrait and mixed three-image letters stay entirely visible at their original ratios; row, column and grid arrangements at 20%, 45% and 70% image area fit a 360px sidebar while numbered captions scroll with the text');
  await checkBox('长信示例',false); await select('图片数量','1');
  for (const layout of ['sidebar','portrait','focus']) { await select('内容排版',layout); await clickText('使用推荐尺寸'); await captureOutput(layout+'-full'); }
  await checkBox('竖图示例', false); await select('滚动速度', '24');
  await select('内容排版', 'split');
  await clickText('使用推荐尺寸');
  for (const theme of ['pure', 'uliuli', 'mia']) { await select('视觉主题', theme); await capture(theme + '-split'); }
  await clickText('查看十八种组合');
  await until(() => evaluate('document.querySelectorAll(".wc-display").length===18'), 'eighteen-combination matrix');
  await pause(250);
  await evaluate(`document.querySelector('.design-controls').style.display='none';document.querySelector('.design-header').style.display='none';document.querySelector('.design-note').style.display='none';document.querySelector('footer').style.display='none';document.querySelector('.design-page').style.width='1400px';document.querySelector('.design-page').style.maxWidth='none';document.body.style.zoom=Math.min(1,innerHeight/document.documentElement.scrollHeight);`);
  await capture('eighteen-combinations');
  await evaluate(`document.body.style.zoom='';for(const tile of document.querySelectorAll('.design-tile')){const a=tile.querySelector('.wc-display');if(!['sidebar:uliuli','portrait:mia','focus:pure'].includes(a.dataset.layout+':'+a.dataset.theme))tile.style.display='none';}document.querySelector('.design-page').style.width='1400px';document.querySelector('.design-page').style.padding='20px';`);
  await pause(150); await capture('three-vertical-layouts');
  await evaluate(`document.querySelectorAll('.design-tile').forEach(e=>e.style.display='');document.querySelectorAll('.design-controls,.design-header,.design-note,footer').forEach(e=>e.style.display='');document.querySelector('.design-page').style.width='';document.querySelector('.design-page').style.maxWidth='';document.querySelector('.design-page').style.padding='';`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='隐藏示例').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".wc-display,.wc-display-brand,.wc-display-ornament").length'), 0);
  checks.push('Hiding removes all cards, background panels, borders and ornaments instead of hiding just the text');
  assert.equal(errors.length, 0, errors.join('\n'));
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), electron: process.versions.electron, checks, cases, consoleErrors: errors, limitations: ['Synthetic, self-contained design gallery; not a real production inbox or live-software capture test'] }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: cases.length, checks, errors, output }));
  app.exit(0);
}
run().catch(async error => { console.error(error.stack); await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.message,cases,errors},null,2)); app.exit(1); });
