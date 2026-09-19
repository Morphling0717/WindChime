// Second independent Electron process after tiles-smoke.cjs exits. Reuses only
// its explicitly marked temporary fixture profile, never the installed app.
const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const directory = path.resolve(__dirname, '../out/tiles-smoke');
const shortcuts = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const previous = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'));
  assert.equal(previous.passed, true, 'only a successful first fixture run can be resumed');
  const profile = path.resolve(previous.profile);
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
  assert(path.basename(profile).startsWith('windchime-tiles-'));
  app.setPath('userData', profile);
  globalShortcut.register = (key, callback) => { shortcuts.set(key, callback); return true; };
  globalShortcut.unregister = key => shortcuts.delete(key);
  globalShortcut.unregisterAll = () => shortcuts.clear();
  globalShortcut.isRegistered = key => shortcuts.has(key);
  // The first run’s disposable servers are stopped; no request leaves this
  // process. Private connection failure must not create an output or tile.
  globalThis.fetch = async () => { throw Error('Offline restart fixture'); };
  require('../main.cjs');
  await app.whenReady();
  let control, status;
  for (let attempt = 0; attempt < 150; attempt++) {
    control = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('私人控制台'));
    try {
      const result = await control?.webContents.executeJavaScript('window.windchimeDesktop.status()');
      if (result?.ok && result.data.nextShortcut === 'CommandOrControl+Alt+N') { status = result.data; break; }
    } catch {}
    await pause(100);
  }
  assert(control && status, 'new private controller starts');
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'restart opens no floating tile or output');
  assert.equal(status.displayOpen, false);
  assert.deepEqual(status.tiles, []);
  assert.equal(status.selectedMessageId, null);
  assert.equal(status.nextShortcut, 'CommandOrControl+Alt+N');
  assert(shortcuts.has(status.nextShortcut));
  shortcuts.get(status.nextShortcut)();
  await pause(500);
  status = (await control.webContents.executeJavaScript('window.windchimeDesktop.status()')).data;
  assert.equal(status.displayOpen, false, 'pressing next before output is ready never reopens it');
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.match(status.nextActionError, /未就绪|连接展示窗口/);
  const report = { passed: true, independentProcess: true, profile, checks: ['saved shortcut restored from preference file in a second independent Electron process', 'no floating tiles, prior review selection, or display restored', 'next callback with no output fails privately and cannot reopen or play old content'], at: new Date().toISOString() };
  await fs.writeFile(path.join(directory, 'restart-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(0);
}
run().catch(async error => { await fs.writeFile(path.join(directory, 'restart-failure.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2)); console.error(error.stack); app.exit(1); });
