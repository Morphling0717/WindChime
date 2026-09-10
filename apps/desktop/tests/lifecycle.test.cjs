const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function harness(options={}) {
  const deferredCrash=options.deferredCrash;
  const handlers=new Map(),windows=[],requests=[],intervals=[],vaultWrites=[],shortcuts=[];let sequence=0,route,blankLoadGate,trayIcon,quitCount=0,now=0;
  const app=new EventEmitter();Object.assign(app,{requestSingleInstanceLock:()=>true,whenReady:async()=>{},getPath:()=>'/fixture',getName:()=> 'Fixture',quit:()=>{quitCount++;}});
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.loadCount=0;this.hideCount=0;this.crashCount=0;this.showCount=0;this.webContents=new EventEmitter();Object.assign(this.webContents,{id:++sequence,mainFrame:{},setWindowOpenHandler:()=>{},isCrashed:()=>!!this.crashed,reload:()=>{void this.loadFile().then(()=>this.webContents.emit('did-finish-load'));},forcefullyCrashRenderer:()=>{this.crashCount++;if(!deferredCrash)this.finishCrash();}});windows.push(this);}
    finishCrash(){this.crashed=true;this.webContents.emit('render-process-gone');}
    async loadFile(){this.loadCount++;this.crashed=false;if(this.options.title==='WindChime Display')await handlers.get('display:request')({sender:this.webContents,senderFrame:this.webContents.mainFrame},{path:'/display/open',method:'POST',body:{}});this.webContents.emit('did-finish-load');}
    async loadURL(url){this.blankUrl=url;this.crashed=false;this.blankLoadCount=(this.blankLoadCount??0)+1;await blankLoadGate?.(this);this.webContents.emit('did-finish-load');}
    show(){}showInactive(){this.showCount++;}focus(){}hide(){this.hideCount++;}isDestroyed(){return !!this.destroyed;}
    close(){this.closeRequested=true;}finishClose(){this.destroyed=true;this.emit('closed');}
  }
  const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},shell:{openExternal:async()=>{}},safeStorage:{isEncryptionAvailable:()=>options.encryptionAvailable??true,encryptString:s=>Buffer.from(s),decryptString:bytes=>bytes.toString()},globalShortcut:{register:(key,callback)=>{shortcuts.push({key,callback});if(options.shortcutResult instanceof Error)throw options.shortcutResult;return options.shortcutResult??true;},unregisterAll:()=>{}},Tray:class {constructor(icon){trayIcon=icon;}setToolTip(){}setContextMenu(){}on(){}},Menu:{buildFromTemplate:x=>x},session:{fromPartition:()=>({setPermissionRequestHandler:()=>{},setPermissionCheckHandler:()=>{},webRequest:{onBeforeRequest:()=>{}}})},powerMonitor:new EventEmitter()};
  const fetch=async(url,options)=>{
    const request={url,body:options.body?JSON.parse(options.body):null,method:options.method,headers:options.headers};requests.push(request);
    const intercepted=route?.(request);if(intercepted)return intercepted;
    let value={};
    if(url.endsWith('/capabilities'))value={protocolVersion:1,siteId:new URL(url).port};
    if(url.endsWith('/devices/request'))value={deviceCode:'private',userCode:'CODE'+sequence,expiresAt:'future'};
    if(url.endsWith('/devices/poll'))value={status:'approved',topicId:new URL(url).port,token:'wc_ctl_private',expiresAt:'future'};
    if(url.endsWith('/control/grants'))value={token:'wc_disp_private',id:'grant'};
    if(url.includes('/display/frame'))value={snapshot:null,receiverId:'r',epoch:'epoch',leaseMs:3000};
    if(url.endsWith('/display/open'))value={receiverId:'r',epoch:'epoch',leaseMs:3000};
    return Response.json(value);
  };
  const fileSystem={readFile:async()=>{if(options.readError)throw options.readError;if(options.vault)return Buffer.from(JSON.stringify(options.vault));throw Object.assign(new Error(),{code:'ENOENT'});},writeFile:async(_path,bytes)=>{vaultWrites.push(JSON.parse(bytes.toString()));},rename:async()=>{}};
  const source=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  const wrapper=vm.runInNewContext(`(function(require,__dirname){${source}\n})`,{process:{...process,argv:[process.execPath,'main.cjs',...(options.argv??[])]},Buffer,URL,Uint8Array,FormData,Blob,AbortController,fetch,setTimeout,clearTimeout,setInterval:callback=>{intervals.push(callback);return {unref(){}};},console});
  wrapper(name=>name==='electron'?electron:name==='node:fs/promises'?fileSystem:name==='node:perf_hooks'?{performance:{now:()=>now}}:name==='./security.cjs'?require('../security.cjs'):require(name),path.join(__dirname,'..'));
  await flush();await flush();const control=windows[0];
  const invoke=(name,args=[],window=control)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  async function pair(port){const pending=await invoke('sites:pair',[{origin:`http://localhost:${port}`,label:`Site ${port}`}]);assert(pending.ok);const result=await invoke('sites:pair-status',[pending.data.id]);assert(result.ok,result.error);return result.data.site;}
  return {windows,requests,invoke,pair,handlers,app,vaultWrites,shortcuts,powerMonitor:electron.powerMonitor,get trayIcon(){return trayIcon;},get quitCount(){return quitCount;},tick:()=>intervals.forEach(callback=>callback()),advance:ms=>{now+=ms;intervals.forEach(callback=>callback());},setRoute:value=>{route=value;},setBlankLoadGate:value=>{blankLoadGate=value;},get output(){return windows.filter(w=>w.options.title==='WindChime Display').at(-1);}};
}
test('completing a new pairing clears the old output; its delayed close cannot hide the new mailbox',async()=>{
  const h=await harness();await h.pair(3011);assert((await h.invoke('display:open')).ok);const old=h.output;
  await h.pair(3012);assert(old.hideCount>0);assert(old.closeRequested);
  assert((await h.invoke('display:open')).ok);const next=h.output;assert.notEqual(next,old);
  const hidesBefore=h.requests.filter(r=>r.body?.action==='hide').length;old.finishClose();await flush();
  assert.equal(h.requests.filter(r=>r.body?.action==='hide').length,hidesBefore);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],next)).ok);
});
test('an old control authorization failure cannot clear a new connection output',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);
  const response=deferred();h.setRoute(r=>r.url.includes(':3011/api/mail/live/control/state')?response.promise:null);
  const old=h.invoke('control:request',[{path:'/control/state',method:'GET'}]);await flush();
  await h.invoke('sites:select',[b.id]);await h.invoke('display:open');const output=h.output;
  response.resolve(Response.json({error:'expired old device'},{status:401}));assert.equal((await old).ok,false);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
});
test('a delayed output grant never opens a window after changing the selected mailbox',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);
  const response=deferred();h.setRoute(r=>r.url.includes(':3011/api/mail/live/control/grants')?response.promise:null);
  const old=h.invoke('display:open');await flush();await h.invoke('sites:select',[b.id]);
  response.resolve(Response.json({id:'old',token:'wc_disp_old'}));assert.equal((await old).ok,false);assert.equal(h.output,undefined);
});
test('switching blanks immediately and orders the old mailbox hide after its in-flight show',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const output=h.output;
  const response=deferred();h.setRoute(r=>r.body?.action==='show'?response.promise:null);
  const show=h.invoke('control:request',[{path:'/control/action',method:'POST',body:{topicId:'3011',action:'show'}}]);await flush();
  const switchResult=h.invoke('sites:select',[b.id]);assert(output.hideCount>0);assert(output.closeRequested);
  const before=h.requests.length;await flush();assert.equal(h.requests.length,before,'hide must await the old write');
  response.resolve(Response.json({}));assert.equal((await show).ok,false);assert((await switchResult).ok);
  assert.equal(h.requests.at(-1).body.action,'hide');assert.equal(h.requests.at(-1).body.topicId,'3011');
});
test('old vault gateway fields and code arguments never initiate a platform request',async()=>{
  const legacy={id:'saved',label:'Saved',origin:'http://localhost:3011',siteId:'site',topicId:'topic',token:'wc_ctl_existing',expiresAt:'future',gatewayOrigin:'https://api.live.bilibili.com',bindingId:'old-binding'};
  const h=await harness({argv:['code=old-launch-code','--code=another-code'],vault:{version:1,sites:[legacy],selected:'saved'}});
  assert.equal(h.requests.length,0,'restoring a device does not reconnect any output or service');assert.equal(h.output,undefined);
  h.app.emit('second-instance',{},['WindChime.exe','code=another-launch-code']);h.tick();await flush();
  assert.equal(h.requests.length,0,'second-instance launch arguments cannot start a platform session');
  const restored=(await h.invoke('sites:list')).data;
  assert.equal(restored.selectedId,'saved');assert.equal(restored.items[0].topicId,'topic');
  assert(!('gatewayOrigin' in restored.items[0]));assert(!('bindingId' in restored.items[0]));assert(!('token' in restored.items[0]));
  for(const channel of ['gateway:connect','gateway:end','gateway:configure','display:copy-link'])assert.equal(h.handlers.has(channel),false);
  assert((await h.invoke('display:open')).ok);const current=h.output;
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],current)).ok);
  assert(h.requests.every(request=>request.url.startsWith('http://localhost:3011/api/mail/live/')));
  assert.equal(h.requests[0].body.kind,'display');assert.equal(h.requests[0].headers.authorization,'Bearer wc_ctl_existing');
  assert.equal(h.requests.at(-1).headers.authorization,'Bearer wc_disp_private');
  assert(h.requests.every(request=>!('x-windchime-platform-lease' in request.headers)));
  const denied=await h.invoke('display:request',[{path:'/control/action',method:'POST',body:{action:'show',topicId:'topic'}}],current);assert.equal(denied.ok,false);
  assert.equal((await h.invoke('control:request',[{path:'/control/state',method:'GET'}],current)).ok,false,'output cannot use the private control IPC channel');
  await h.invoke('sites:select',[null]);assert.equal(h.vaultWrites.at(-1).version,1);assert(!('gatewayOrigin' in h.vaultWrites.at(-1).sites[0]));
});

test('status reports both unreadable credentials and failed shortcut registration',async()=>{
  for(const shortcutResult of [false,new Error('occupied')]){
    const h=await harness({readError:new Error('corrupt ciphertext'),shortcutResult});
    const status=(await h.invoke('app:status')).data;
    assert.deepEqual(Object.keys(status).sort(),['connectionError','displayOpen','shortcut']);
    assert.match(status.connectionError,/加密凭据无法读取/);assert.match(status.connectionError,/快捷键注册失败/);
    assert.equal(status.shortcut,'Ctrl+Shift+H');assert.equal(status.displayOpen,false);assert.equal(h.requests.length,0);
  }
});

test('shortcut, suspend and resume blank only the independent output; application icons use packaged files',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  assert.equal(h.windows[0].options.icon,path.join(__dirname,'../build/icon.ico'));assert.equal(h.trayIcon,path.join(__dirname,'../build/tray.png'));
  assert.equal(h.shortcuts[0].key,'CommandOrControl+Shift+H');
  for(const event of ['suspend','resume']){const before=output.hideCount;h.powerMonitor.emit(event);assert(output.hideCount>before);}
  const beforeShortcut=output.hideCount;h.shortcuts[0].callback();assert(output.hideCount>beforeShortcut);await flush();
  assert(h.requests.some(request=>request.body?.action==='hide'));
  const before=h.requests.length;h.app.emit('second-instance',{},['WindChime.exe','--squirrel-uninstall']);
  assert.equal(h.quitCount,1,'uninstall still forwards quit to the existing instance');assert.equal(h.requests.length,before);
});

test('a late display response from an old mailbox cannot reach a new output',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');
  const response=deferred();h.setRoute(r=>r.url.includes(':3011/api/mail/live/display/frame')?response.promise:null);
  const old=h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],h.output);await flush();
  await h.invoke('sites:select',[b.id]);await h.invoke('display:open');const current=h.output;
  response.resolve(Response.json({snapshot:{text:'old private mailbox'}}));assert.equal((await old).ok,false);
  assert.equal(current.hideCount,0);assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],current)).ok);
});

test('display remains unthrottled; main-process lease expiry replaces a silent renderer before three seconds',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  assert.equal(output.options.webPreferences.backgroundThrottling,false);
  assert.equal(h.windows[0].options.webPreferences.backgroundThrottling,undefined,'private controller may still save background resources');
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  h.advance(2500);assert.equal(output.hideCount,0);
  h.advance(100);assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);
  await flush();assert.equal(output.loadCount,2);assert.equal(output.showCount,2,'only the fresh display document is revealed');
  h.advance(2000);assert.equal(output.crashCount,1,'fresh blank receiver gets its own lease');
});

test('watchdog invalidates late display results and an unresponsive renderer recovers without exposing controls',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);
  const response=deferred();h.setRoute(r=>r.url.includes('/display/frame')?response.promise:null);
  const old=h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);await flush();
  h.advance(3000);await flush();response.resolve(Response.json({snapshot:{text:'expired'},leaseMs:3000}));assert.equal((await old).ok,false);
  output.webContents.emit('unresponsive');await flush();assert.equal(output.crashCount,2);assert.equal(output.hideCount,2);
  assert.equal(h.windows.length,2,'recovery keeps the isolated output capture handle');
  assert.equal(h.windows[0].crashCount,0);
});

test('delayed responses and oversized leases cannot extend the last confirmed display',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const response=deferred();h.setRoute(r=>r.url.includes('/display/frame')?response.promise:null);
  const request=h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);await flush();
  h.advance(3000);response.resolve(Response.json({snapshot:{text:'late'},leaseMs:60000}));assert.equal((await request).ok,false);
  assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);
});

test('emergency hide paints an offline transparent surface while its website request is pending',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const response=deferred();h.setRoute(r=>r.body?.action==='hide'?response.promise:null);
  const hide=h.invoke('control:hide');assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);await flush();
  assert.equal(output.blankLoadCount,1);assert.equal(output.showCount,2,'WGC needs a newly painted transparent surface');
  const empty=decodeURIComponent(output.blankUrl.slice(output.blankUrl.indexOf(',')+1));
  assert.match(empty,/default-src 'none'/);assert.match(empty,/background:transparent/);assert.doesNotMatch(empty,/<script|\/api\/|<iframe|<img/);
  assert.equal(h.requests.filter(request=>request.url.endsWith('/display/open')).length,1,'static empty document cannot open a receiver before server hide');
  output.webContents.emit('unresponsive');await flush();assert.equal(output.loadCount,1,'late unresponsive event cannot reopen a held receiver');
  assert.equal((await h.invoke('display:open')).ok,false,'a click cannot reveal the held surface before hide completes');
  assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok,false);
  response.resolve(Response.json({}));assert((await hide).ok);assert.equal(output.crashCount,2);assert.equal(output.showCount,3);assert.equal(output.loadCount,2);
});

test('suspend invalidates in-flight frames without waiting for elapsed clock time; resume opens a blank document',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const response=deferred();h.setRoute(r=>r.url.includes('/display/frame')?response.promise:null);
  const frame=h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);await flush();
  h.powerMonitor.emit('suspend');assert.equal(output.hideCount,1);
  response.resolve(Response.json({snapshot:{text:'before sleep'},leaseMs:3000}));assert.equal((await frame).ok,false);
  h.powerMonitor.emit('resume');await flush();assert(output.crashCount>=1);assert.equal(output.loadCount,2);
});

test('a confirmed withdrawal clears the native renderer even if it keeps requesting frames',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  let snapshot={id:'approved-one',text:'approved'};
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({receiverId:'r',epoch:'epoch',leaseMs:3000,snapshot})):null);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  snapshot={id:'approved-two',text:'next'};assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  assert.equal(output.crashCount,0,'ordinary next keeps the existing receiver');
  snapshot=null;assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok,false);
  assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);await flush();
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);assert.equal(output.crashCount,1,'repeated empty frames do not cause recovery loops');
});

test('a same-window receiver replacement rejects the previous receiver late frame',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const old=deferred();h.setRoute(r=>r.url.includes('/display/frame')?old.promise:r.url.endsWith('/display/open')?Promise.resolve(Response.json({receiverId:'new-r',epoch:'epoch',leaseMs:3000})):null);
  const frame=h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);await flush();
  assert((await h.invoke('display:request',[{path:'/display/open',method:'POST',body:{}}],output)).ok);
  old.resolve(Response.json({receiverId:'r',epoch:'epoch',leaseMs:3000,snapshot:{id:'old',text:'late'}}));assert.equal((await frame).ok,false);
  assert.equal(output.crashCount,0,'old receiver response cannot reset the new receiver');
  assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok,false);
});

test('display authorization failure immediately discards the native surface and grant',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({error:'revoked'},{status:401})):null);
  assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok,false);
  assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);await flush();assert.equal(output.blankLoadCount,1);assert.equal(output.showCount,2);
  assert.equal((await h.invoke('display:request',[{path:'/display/open',method:'POST',body:{}}],output)).ok,false);
});

test('recovery waits for confirmed renderer termination instead of reloading the dying process',async()=>{
  const h=await harness({deferredCrash:true});await h.pair(3011);await h.invoke('display:open');const output=h.output;
  h.advance(3000);await flush();assert.equal(output.hideCount,1);assert.equal(output.crashCount,1);assert.equal(output.loadCount,1);
  output.finishCrash();await flush();assert.equal(output.loadCount,2);assert.equal(output.showCount,2);
});

test('a failed website hide leaves a painted offline blank and never creates another receiver',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  h.setRoute(r=>r.body?.action==='hide'?Promise.resolve(Response.json({error:'offline'},{status:503})):null);
  assert.equal((await h.invoke('control:hide')).ok,false);await flush();
  assert.equal(output.blankLoadCount,1);assert.equal(output.showCount,2);assert.equal(output.loadCount,1);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/display/open')).length,1);
  assert.equal((await h.invoke('display:request',[{path:'/display/open',method:'POST',body:{}}],output)).ok,false);
});

test('late blank document completion cannot show the old window after selecting another mailbox',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const old=h.output;
  const paint=deferred();h.setBlankLoadGate(window=>window===old?paint.promise:null);
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({error:'revoked'},{status:401})):null);
  await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],old);await flush();
  h.setRoute(null);await h.invoke('sites:select',[b.id]);await h.invoke('display:open');const current=h.output;
  paint.resolve();await flush();assert.equal(old.showCount,1);assert.equal(current.showCount,1);assert.equal(current.hideCount,0);
});

test('failed blank compositor creation closes the output instead of revealing a cached frame',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  h.setBlankLoadGate(()=>Promise.reject(new Error('renderer unavailable')));
  await h.invoke('control:hide');await flush();assert(output.closeRequested);assert.equal((await h.invoke('app:status')).data.displayOpen,false);
  assert.equal(output.showCount,1);assert.equal(h.requests.filter(r=>r.url.endsWith('/display/open')).length,1);
});
