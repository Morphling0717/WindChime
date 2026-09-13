// Disposable acceptance process. Never included in the packaged application.
const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.env.WINDCHIME_KEY_SMOKE_USER_DATA;
assert(directory && process.send && process.env.WINDCHIME_SMOKE_ALLOW_WRITES === '1');
app.setPath('userData', directory);
// This disposable actor accepts draft-discard confirmations; management-smoke
// separately verifies the cancel path through the same restricted dialog IPC.
dialog.showMessageBox = async () => ({ response: 1 });
const network = [], originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  network.push({ path: url.pathname, method: options?.method || 'GET' });
  return originalFetch(input, options);
};
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
async function handle({ command, method, args, key, text, source, topicId }) {
  if (['import-ui','select-topic-ui','draft-input'].includes(command)) { control.show(); control.focus(); }
  if (command === 'focus') { control.show(); control.focus(); return true; }
  if (command === 'invoke') return invoke(method, args);
  if (command === 'network') return network;
  if (command === 'select-topic-ui') {
    // Import first selects the default topic through the renderer. Wait until
    // that real transition completes, then exercise the user's dropdown path.
    await until(async () => {
      const result = await invoke('sites');
      const selected = result.data?.items.find(item => item.id === result.data.selectedId);
      const value = await control.webContents.executeJavaScript(`document.querySelector('select[aria-label="当前话题"]')?.value`);
      return !!value && value === selected?.selectedTopicId;
    }, 'initial site selection reaches renderer');
    await control.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('select[aria-label="当前话题"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(topicId)});
      select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await until(async () => {
      const result = await invoke('sites');
      const selected = result.data?.items.find(item => item.id === result.data.selectedId);
      return selected?.selectedTopicId === topicId && await control.webContents.executeJavaScript(`document.querySelector('select[aria-label="当前话题"]')?.value === ${JSON.stringify(topicId)} && !document.querySelector('select[aria-label="当前话题"]')?.disabled`);
    }, 'selected topic reaches renderer and main');
    return true;
  }
  if (command === 'import-ui') {
    // Exercise the bundled React form and its real preload/main-process path.
    await control.webContents.executeJavaScript(`(() => {
      Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('网站连接'))?.click();
    })()`);
    await pause(100);
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
  if (command === 'private') return control.webContents.executeJavaScript(`({text:document.body.innerText,secretFieldEmpty:document.querySelector('input[type=password]')?.value==='',storedKeys:Object.keys(localStorage),hasStoredCredential:Object.keys(localStorage).some(key=>/wc_conn_v1\\.|wc_ctl_/.test(localStorage.getItem(key)||''))})`);
  if (command === 'reload-output') { display()?.webContents.reload(); return true; }
  if (command === 'draft-input') {
    await control.webContents.executeJavaScript(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('直播工作台'))?.click()`);
    await until(() => control.webContents.executeJavaScript(`!!document.querySelector('.wc-mail')`), 'studio navigation');
    await until(() => control.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.wc-mail')).some(button => button.querySelector('.wc-snippet')?.textContent === ${JSON.stringify(source)})`), 'target source letter');
    await control.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.wc-mail')).find(button => button.querySelector('.wc-snippet')?.textContent === ${JSON.stringify(source)}).click()`);
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
    catch (error) { process.send({ id: request.id, ok: false, error: error.message?.startsWith('Timed out:') ? error.message : 'Desktop acceptance command failed', command: request.command }); }
  });
  process.send({ ready: true, pid: process.pid });
}
run().catch(() => { process.send({ ready: false, error: 'Desktop acceptance startup failed' }); app.exit(1); });
