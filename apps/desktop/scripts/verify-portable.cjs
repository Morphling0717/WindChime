// Isolated verification of the new portable archive. No installer runs.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn,execFileSync} = require('node:child_process');
const desktop = path.resolve(__dirname,'..');
const {version} = require('../package.json');
const out = path.join(desktop,'out/installers');
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child, socket;
async function run(){
 const temporary = await fs.mkdtemp(path.join(os.tmpdir(),`windchime-portable-${version}-`));
 const appDir=path.join(temporary,'portable'),profile=path.join(temporary,'profile');
 await fs.mkdir(appDir);await fs.mkdir(profile);
 const sevenZip=path.join(path.dirname(require.resolve('electron-winstaller/package.json',{paths:[desktop]})),'vendor/7z-x64.exe');
 const archive=path.join(out,`WindChime-win32-x64-${version}.zip`);
 execFileSync(sevenZip,['x','-y','-bd','-bb0',archive,'-o'+appDir],{windowsHide:true,stdio:'pipe',timeout:60000});
 const exe=path.join(appDir,'WindChime.exe');await fs.stat(exe);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(exe,['--user-data-dir='+profile,'--inspect=127.0.0.1:0'],{cwd:appDir,windowsHide:true,env,stdio:['ignore','pipe','pipe']});
 let stderr='',stdout='';child.stderr.on('data',data=>stderr+=data);child.stdout.on('data',data=>stdout+=data);
 let endpoint;for(let i=0;i<200;i++){endpoint=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0];if(endpoint)break;if(child.exitCode!==null)throw Error('Portable process exited early: '+child.exitCode);await pause(100);}assert(endpoint,'Node inspector available only on loopback');
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let next=1;const pending=new Map();socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);pending.delete(message.id);if(message.error)item.reject(Error(JSON.stringify(message.error)));else item.resolve(message.result);}};
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 async function evaluate(expression){const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result?.value;}
 await rpc('Runtime.enable');
 const req="process.mainModule.require('electron')";
 let ready=false;for(let i=0;i<200;i++){try{ready=await evaluate(`(()=>{const e=${req};return e.app.isReady()&&e.BrowserWindow.getAllWindows().length===1&&!e.BrowserWindow.getAllWindows()[0].webContents.isLoading();})()`);}catch{}if(ready)break;await pause(100);}assert(ready,'Packaged private window finished loading');
 const meta=await evaluate(`(()=>{const e=${req},w=e.BrowserWindow.getAllWindows()[0],p=w.webContents.getLastWebPreferences();return {version:e.app.getVersion(),electron:process.versions.electron,node:process.versions.node,packaged:e.app.isPackaged,userData:e.app.getPath('userData'),exe:process.execPath,windows:e.BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),visible:w.isVisible(),url:w.webContents.getURL()})),preferences:{sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration},storagePath:w.webContents.session.storagePath};})()`);
 assert.equal(meta.version,version);assert(meta.packaged);assert.equal(path.resolve(meta.userData),profile);assert.equal(path.resolve(meta.exe),exe);assert.equal(meta.windows.length,1);assert(meta.windows[0].title.includes('私人控制台'));assert(meta.windows[0].url.includes('app.asar/build/control.html'));assert.deepEqual(meta.preferences,{sandbox:true,contextIsolation:true,nodeIntegration:false});
 const renderer=code=>evaluate(`${req}.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(code)})`);
 let ui;for(let i=0;i<100;i++){ui=await renderer(`({text:document.body.innerText,images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),inputs:[...document.querySelectorAll('input,textarea')].map(i=>({placeholder:i.placeholder,value:i.value})),hasNode:typeof process!=='undefined'||typeof require!=='undefined',hasBridge:!!window.windchimeDesktop})`);if(ui.text.includes('连接密钥')&&ui.images.some(i=>i.loaded&&i.src.includes('brand-header')))break;await pause(100);}
 assert(ui.text.includes('连接密钥'),'Connection UI is rendered');assert(ui.images.some(i=>i.loaded&&i.src.includes('brand-header')),'Approved logo loaded from archive');assert(!ui.hasNode,'No Node globals in private renderer');assert(ui.hasBridge,'Sandboxed preload bridge ready');assert(ui.inputs.every(i=>i.value===''),'Fresh profile contains no prior input or authorization');
 await evaluate(`${req}.BrowserWindow.getAllWindows()[0].showInactive();true`);await pause(400);
 const screenshot=await evaluate(`${req}.BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image=>image.toPNG().toString('base64'))`);
 const screenshotPath=path.join(out,'portable-startup.png');await fs.writeFile(screenshotPath,Buffer.from(screenshot,'base64'));
 // Close the new private window once: the process should stay in its own tray.
 await evaluate(`${req}.BrowserWindow.getAllWindows()[0].close();true`);await pause(300);
 assert.equal(await evaluate(`${req}.BrowserWindow.getAllWindows()[0].isVisible()`),false);assert.equal(child.exitCode,null);
 await evaluate(`${req}.BrowserWindow.getAllWindows()[0].show();true`);await pause(200);
 assert.equal(await evaluate(`${req}.BrowserWindow.getAllWindows()[0].isVisible()`),true,'Private window can reopen from tray lifecycle');
 const profileFiles=await fs.readdir(profile);assert(!profileFiles.includes('devices.v1.enc'),'Startup does not import or manufacture a management vault');
 const report={passed:true,testedAt:new Date().toISOString(),hostNode:process.version,os:{platform:os.platform(),release:os.release(),arch:os.arch()},archive,temporary,profile,processId:child.pid,...meta,screenshotPath,checks:['New portable ZIP extracted into a unique temporary directory; no installer or uninstall executed',`Packaged version ${version} launches its own isolated userData, not an installed application profile`,'Exactly one private control window; no automatic display output opened','Approved brand asset and connection-key interface render from packaged ASAR','Private renderer sandbox/context isolation enabled; Node integration disabled','Closing private window retains independent tray process; reopening works','Fresh profile has no prior connection inputs or encrypted device vault'],limitations:['Does not verify installer execution or uninstall','Does not verify real OBS or LiveHime window capture']};
 // app.quit uses the packaged graceful shutdown path; closing our debugger lets it finish.
 await evaluate(`${req}.app.quit();true`);socket.close();socket=null;
 for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);assert.equal(child.exitCode,0,'Portable process exits gracefully');
 assert(!/UnhandledPromiseRejection|Uncaught|Object has been destroyed/.test(stderr),'Portable shutdown has no unhandled runtime error');
 report.gracefulExit=true;report.unhandledRuntimeErrors=false;
 await fs.writeFile(path.join(out,'portable-startup-verification.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{socket?.close();if(child&&child.exitCode===null)child.kill();});
