// Disposable acceptance process. Never included in the packaged application.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.env.WINDCHIME_KEY_SMOKE_USER_DATA;
assert(directory && process.send && process.env.WINDCHIME_SMOKE_ALLOW_WRITES === '1');
app.setPath('userData', directory);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let control;
const title = `WindChime Key Test ${process.env.WINDCHIME_KEY_SMOKE_ACTOR}`;
app.on('browser-window-created', (_, window) => {
  if (window.getTitle() !== 'WindChime Display') return;
  window.setTitle(title);
  window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title); });
});
async function until(check, label) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
const display = () => BrowserWindow.getAllWindows().find(w => w.getTitle() === title);
const invoke = (method, args = []) => control.webContents.executeJavaScript(`(() => { const args=${JSON.stringify(args)}; ${method==='upload'?'args[0].bytes=Uint8Array.from(Object.values(args[0].bytes));':''} return window.windchimeDesktop[${JSON.stringify(method)}](...args); })()`);
async function handle({ command, method, args, key, text }) {
  if (command === 'invoke') return invoke(method, args);
  if (command === 'import-ui') {
    // Exercise the bundled React form and its real preload/main-process path.
    await control.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[type=password]');
      input.closest('details').open = true;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await until(() => control.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='使用密钥连接'&&!b.disabled)`), 'key form enabled');
    await control.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='使用密钥连接').click()`);
    await until(() => control.webContents.executeJavaScript(`document.querySelector('input[type=password]').value===''`), 'successful key form clears key');
    return invoke('sites');
  }
  if (command === 'output') {
    const window = display();
    if (!window) return { exists: false, blank: true };
    return Promise.race([
      window.webContents.executeJavaScript(`({exists:true,blank:document.body.innerText===''&&!document.querySelector('[data-windchime-snapshot], img'),text:document.body.innerText,images:Array.from(document.images).map(i=>({width:i.naturalWidth,height:i.naturalHeight,alt:i.alt}))})`).catch(() => ({ exists: true, blank: false, unconfirmed: true })),
      pause(750).then(()=>({exists:!window.isDestroyed(),blank:window.isDestroyed(),unconfirmed:true})),
    ]);
  }
  if (command === 'private') return control.webContents.executeJavaScript(`({text:document.body.innerText,secretFieldEmpty:document.querySelector('input[type=password]').value==='',storedKeys:Object.keys(localStorage)})`);
  if (command === 'reload-output') { display()?.webContents.reload(); return true; }
  if (command === 'draft-input') {
    await control.webContents.executeJavaScript(`document.querySelector('.wc-mail')?.click()`);
    await until(() => control.webContents.executeJavaScript(`!!document.querySelector('textarea[maxlength="1000"]')`), 'review editor');
    await control.webContents.executeJavaScript(`(() => {const input=document.querySelector('textarea[maxlength="1000"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    return true;
  }
  if (command === 'draft-value') return control.webContents.executeJavaScript(`document.querySelector('textarea[maxlength="1000"]')?.value`);
  if (command === 'crash') { setTimeout(() => app.exit(0), 100); return true; }
  throw Error('Unknown fixture command');
}
async function run() {
  require('../main.cjs');
  await app.whenReady();
  await until(() => { control = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('私人控制台')); return !!control; }, 'controller');
  await until(() => control.webContents.executeJavaScript(`!!window.windchimeDesktop && !!document.querySelector('input[type=password]')`).catch(() => false), 'private key form');
  process.on('message', async request => {
    try { process.send({ id: request.id, ok: true, value: await handle(request) }); }
    catch { process.send({ id: request.id, ok: false, error: 'Desktop acceptance command failed', command: request.command }); }
  });
  process.send({ ready: true, pid: process.pid });
}
run().catch(() => { process.send({ ready: false, error: 'Desktop acceptance startup failed' }); app.exit(1); });
