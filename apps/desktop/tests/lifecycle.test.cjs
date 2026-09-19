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
  const handlers=new Map(),windows=[],requests=[],intervals=[],vaultWrites=[],vaultCommits=[],shortcuts=[],workspaceWrites=[],unregistered=[],confirmations=[];let sequence=0,route,blankLoadGate,trayIcon,quitCount=0,now=0,persistence={},temporaryVault,confirmation=options.confirmation??0;
  const app=new EventEmitter();Object.assign(app,{requestSingleInstanceLock:()=>true,whenReady:async()=>{},getPath:()=>'/fixture',getName:()=> 'Fixture',quit:()=>{quitCount++;}});
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.loadCount=0;this.hideCount=0;this.crashCount=0;this.showCount=0;this.webContents=new EventEmitter();Object.assign(this.webContents,{id:++sequence,mainFrame:{},setWindowOpenHandler:()=>{},isDestroyed:()=>!!this.contentsDestroyed,isCrashed:()=>{if(this.contentsDestroyed)throw new TypeError('Object has been destroyed');return !!this.crashed;},reload:()=>{void this.loadFile().then(()=>this.webContents.emit('did-finish-load'));},forcefullyCrashRenderer:()=>{if(this.contentsDestroyed)throw new TypeError('Object has been destroyed');this.crashCount++;if(!deferredCrash)this.finishCrash();}});windows.push(this);}
    finishCrash(){this.crashed=true;this.webContents.emit('render-process-gone');}
    async loadFile(file,loadOptions){this.loadedFile=file;this.loadOptions=loadOptions;this.loadCount++;this.crashed=false;if(this.options.title==='WindChime Display')await handlers.get('display:request')({sender:this.webContents,senderFrame:this.webContents.mainFrame},{path:'/display/open',method:'POST',body:{}});this.webContents.emit('did-finish-load');}
    async loadURL(url){this.blankUrl=url;this.crashed=false;this.blankLoadCount=(this.blankLoadCount??0)+1;await blankLoadGate?.(this);this.webContents.emit('did-finish-load');}
    show(){}showInactive(){this.showCount++;}focus(){}hide(){this.hideCount++;}isDestroyed(){return !!this.destroyed;}
    destroyContents(){this.contentsDestroyed=true;this.webContents.emit('destroyed');}
    close(){this.closeRequested=true;}finishClose(){this.destroyContents();this.destroyed=true;this.emit('closed');}
    getBounds(){return {x:50,y:60,width:this.options.width,height:this.options.height};}setAlwaysOnTop(pinned){this.pinned=pinned;}
  }
  const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},shell:{openExternal:async()=>{}},safeStorage:{isEncryptionAvailable:()=>options.encryptionAvailable??true,encryptString:s=>{persistence.encrypt?.();return Buffer.from(s);},decryptString:bytes=>bytes.toString()},globalShortcut:{register:(key,callback)=>{shortcuts.push({key,callback});if(options.shortcutResult instanceof Error)throw options.shortcutResult;return options.shortcutPolicy?options.shortcutPolicy(key):options.shortcutResult??true;},unregister:key=>unregistered.push(key),unregisterAll:()=>{}},dialog:{showMessageBox:async(_window,input)=>{confirmations.push(input);return {response:typeof confirmation==='function'?await confirmation():confirmation};}},Tray:class {constructor(icon){trayIcon=icon;}setToolTip(){}setContextMenu(){}on(){}},Menu:{buildFromTemplate:x=>x},session:{fromPartition:()=>({setPermissionRequestHandler:()=>{},setPermissionCheckHandler:()=>{},webRequest:{onBeforeRequest:()=>{}}})},powerMonitor:new EventEmitter()};
  const fetch=async(url,options)=>{
    const request={url,body:options.body?JSON.parse(options.body):null,method:options.method,headers:options.headers};requests.push(request);
    const intercepted=route?.(request);if(intercepted)return intercepted;
    let value={};
    if(url.endsWith('/capabilities'))value={protocolVersion:1,siteId:new URL(url).port,features:{connectionKeys:true}};
    if(url.endsWith('/control/identity'))value={siteId:new URL(url).port,topicId:new URL(url).port,topicTitle:'Topic '+new URL(url).port,label:'Shared key',expiresAt:'2099-01-01T00:00:00.000Z',grantId:'grant-'+new URL(url).port};
    if(url.endsWith('/devices/request'))value={deviceCode:'private',userCode:'CODE'+sequence,expiresAt:'future'};
    if(url.endsWith('/devices/poll'))value={status:'approved',topicId:new URL(url).port,token:'wc_ctl_private',expiresAt:'future'};
    if(url.endsWith('/control/grants'))value={token:'wc_disp_private',id:'grant'};
    if(url.includes('/display/frame'))value={snapshot:null,receiverId:'r',epoch:'epoch',leaseMs:3000};
    if(url.endsWith('/display/open'))value={receiverId:'r',epoch:'epoch',leaseMs:3000};
    return Response.json(value);
  };
  const fileSystem={readFile:async(file)=>{if(file.endsWith('workspace.v1.json')){if(options.workspace)return JSON.stringify(options.workspace);throw Object.assign(new Error(),{code:'ENOENT'});}if(options.readError)throw options.readError;if(options.vault)return Buffer.from(JSON.stringify(options.vault));throw Object.assign(new Error(),{code:'ENOENT'});},writeFile:async(file,bytes)=>{const candidate=JSON.parse(bytes.toString());if(file.endsWith('workspace.v1.json.tmp')){workspaceWrites.push(candidate);return;}await persistence.write?.(candidate);vaultWrites.push(candidate);temporaryVault=candidate;},rename:async(file)=>{if(file.endsWith('workspace.v1.json.tmp'))return;await persistence.rename?.(temporaryVault);vaultCommits.push(temporaryVault);}};
  const source=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  const wrapper=vm.runInNewContext(`(function(require,__dirname){${source}\n})`,{process:{...process,execPath:options.execPath??process.execPath,argv:[process.execPath,'main.cjs',...(options.argv??[])]},Buffer,URL,Uint8Array,FormData,Blob,AbortController,fetch,setTimeout,clearTimeout,setInterval:callback=>{intervals.push(callback);return {unref(){}};},console});
  wrapper(name=>name==='electron'?electron:name==='node:fs/promises'?fileSystem:name==='node:perf_hooks'?{performance:{now:()=>now}}:name.startsWith('./')?require(path.join(__dirname,'..',name)):require(name),path.join(__dirname,'..'));
  await flush();await flush();const control=windows[0];
  const invoke=(name,args=[],window=control)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  async function pair(port){const pending=await invoke('sites:pair',[{origin:`http://localhost:${port}`,label:`Site ${port}`}]);assert(pending.ok);const result=await invoke('sites:pair-status',[pending.data.id]);assert(result.ok,result.error);return result.data.site;}
  return {windows,requests,invoke,pair,handlers,app,vaultWrites,vaultCommits,shortcuts,workspaceWrites,unregistered,confirmations,setConfirmation:value=>{confirmation=value;},powerMonitor:electron.powerMonitor,get trayIcon(){return trayIcon;},get quitCount(){return quitCount;},tick:()=>intervals.forEach(callback=>callback()),advance:ms=>{now+=ms;intervals.forEach(callback=>callback());},setRoute:value=>{route=value;},setBlankLoadGate:value=>{blankLoadGate=value;},setPersistence:value=>{persistence=value;},get output(){return windows.filter(w=>w.options.title==='WindChime Display').at(-1);}};
}
test('private tiles have distinct isolated windows, selected-only sites and no credential or display authority',async()=>{
  const h=await harness();await h.pair(3012);await h.pair(3011);
  assert((await h.invoke('tiles:open',['review'])).ok);const tile=h.windows.at(-1);
  assert.equal(tile.options.title,'WindChime Private · 信件审阅');assert.equal(tile.options.alwaysOnTop,true);
  assert.equal(tile.options.webPreferences.sandbox,true);assert.equal(tile.options.webPreferences.contextIsolation,true);assert.equal(tile.options.webPreferences.nodeIntegration,false);assert.match(tile.options.webPreferences.partition,/^windchime-private-tile-/);
  assert.equal(tile.loadOptions.query.tile,'review');const count=h.windows.length;
  let titlePrevented=false;tile.emit('page-title-updated',{preventDefault:()=>{titlePrevented=true;}},'风铃 · 私人控制台');assert(titlePrevented,'HTML cannot overwrite the private module capture title');assert.equal(tile.options.frame,false);assert.equal(tile.options.resizable,true);
  assert((await h.invoke('tiles:open',['review'])).ok);assert.equal(h.windows.length,count);
  const sites=(await h.invoke('sites:list',[],tile)).data;assert.equal(sites.items.length,1);assert(!JSON.stringify(sites).includes('wc_ctl'));
  assert((await h.invoke('control:request',[{path:'/control/state',method:'GET'}],tile)).ok);
  for(const [channel,args] of [['sites:select',[null]],['sites:import-key',['secret']],['app:next-shortcut',['Ctrl+Alt+N']],['files:save',[{}]],['share:open',[]],['display:request',[{path:'/display/open',method:'POST',body:{}}]]])assert.equal((await h.invoke(channel,args,tile)).ok,false,channel);
  assert((await h.invoke('tiles:pin',['review',false],tile)).ok);assert.equal(tile.pinned,false);
  const status=(await h.invoke('app:status',[],tile)).data;assert.equal(status.tile.module,'review');assert.equal(status.tile.pinned,false);assert(!JSON.stringify(status).includes('wc_ctl'));
  await flush();assert(!JSON.stringify(h.workspaceWrites).includes('wc_ctl'));assert(!JSON.stringify(h.workspaceWrites).includes('信件原文'));
});

test('dirty tile close and mailbox switches cancel without hiding output or replacing credentials',async()=>{
  const h=await harness();const first=await h.pair(3011),second=await h.pair(3012);await h.invoke('sites:select',[first.id]);await h.invoke('display:open');const output=h.output;
  await h.invoke('tiles:open',['review']);const tile=h.windows.at(-1);await h.invoke('tiles:dirty',[true],tile);
  assert.equal((await h.invoke('tiles:close',['review'],tile)).code,'OPERATION_CANCELLED');assert.equal(tile.closeRequested,undefined);
  const before=h.requests.length,version=(await h.invoke('app:status')).data.contextVersion;
  assert.equal((await h.invoke('sites:select',[second.id])).code,'OPERATION_CANCELLED');assert.equal((await h.invoke('sites:list')).data.selectedId,first.id);assert.equal(h.requests.length,before);assert.equal(output.hideCount,0);
  h.setConfirmation(1);assert((await h.invoke('sites:select',[second.id])).ok);assert(tile.closeRequested);assert(output.hideCount>0);
  assert.equal((await h.invoke('control:request',[{path:'/control/state',method:'GET'}],tile)).ok,false);
  await h.invoke('tiles:open',['review']);const newer=h.windows.at(-1);tile.finishClose();assert.equal((await h.invoke('app:status',[],newer)).data.tile.module,'review');assert((await h.invoke('app:status')).data.contextVersion>version);
});

test('selected review identity synchronizes across private windows and protects main and tile drafts',async()=>{
  const h=await harness();const site=await h.pair(3011);await h.invoke('tiles:open',['inbox']);const inbox=h.windows.at(-1);await h.invoke('tiles:open',['review']);const review=h.windows.at(-1);
  const version=(await h.invoke('app:status')).data.contextVersion;
  assert((await h.invoke('control:select-message',['first',site.id,version],inbox)).ok);
  assert.equal((await h.invoke('app:status',[],review)).data.selectedMessageId,'first');
  await h.invoke('tiles:dirty',[true]);assert.equal((await h.invoke('control:select-message',['second',site.id,version],inbox)).code,'OPERATION_CANCELLED');
  assert.equal((await h.invoke('app:status')).data.selectedMessageId,'first');await h.invoke('tiles:dirty',[false]);await h.invoke('tiles:dirty',[true],review);
  assert.equal((await h.invoke('control:select-message',['second',site.id,version],inbox)).code,'OPERATION_CANCELLED');
  h.setConfirmation(1);assert((await h.invoke('control:select-message',['second',site.id,version],inbox)).ok);assert.equal((await h.invoke('app:status',[],review)).data.selectedMessageId,'second');
  assert.equal((await h.invoke('control:select-message',['third',site.id,version-1],inbox)).code,'CONNECTION_CHANGED');
});

test('closing a tile rejects its delayed reads and cancels queued writes without disturbing another tile',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('tiles:open',['review']);const tile=h.windows.at(-1);
  const pending=deferred();h.setRoute(r=>r.url.includes('/control/state')?pending.promise:null);
  const read=h.invoke('control:request',[{path:'/control/state',method:'GET'}],tile);await flush();await h.invoke('tiles:close',['review'],tile);pending.resolve(Response.json({messages:[{text:'old'}]}));assert.equal((await read).ok,false);
  await h.invoke('tiles:open',['review']);const replacement=h.windows.at(-1);assert((await h.invoke('app:status',[],replacement)).ok);
  const gate=deferred();h.setRoute(r=>r.body?.action==='show'?gate.promise:null);
  const first=h.invoke('control:request',[{path:'/control/action',method:'POST',body:{topicId:'3011',action:'show'}}]);await flush();
  const queued=h.invoke('control:request',[{path:'/control/action',method:'POST',body:{topicId:'3011',action:'next'}}],replacement);await flush();
  await h.invoke('tiles:close',['review'],replacement);gate.resolve(Response.json({}));await first;assert.equal((await queued).ok,false);assert(!h.requests.some(r=>r.body?.action==='next'));
});

test('closing a tile during message membership or display grant reads cancels side effects',async()=>{
  const h=await harness();const site=await h.pair(3011);await h.invoke('control:select-message',['first',site.id]);await h.invoke('tiles:open',['inbox']);const inbox=h.windows.at(-1);
  const member=deferred();h.setRoute(r=>r.url.includes('/control/messages/second')?member.promise:null);
  const selection=h.invoke('control:select-message',['second',site.id],inbox);await flush();await h.invoke('tiles:close',['inbox'],inbox);member.resolve(Response.json({id:'second'}));assert.equal((await selection).code,'CONNECTION_CHANGED');assert.equal((await h.invoke('app:status')).data.selectedMessageId,'first');
  h.setRoute(null);await h.invoke('tiles:open',['transport']);const transport=h.windows.at(-1),grant=deferred();h.setRoute(r=>r.url.endsWith('/control/grants')?grant.promise:null);
  const open=h.invoke('display:open',[],transport);await flush();await h.invoke('tiles:close',['transport'],transport);grant.resolve(Response.json({id:'late',token:'wc_disp_late'}));assert.equal((await open).code,'CONNECTION_CHANGED');assert.equal(h.output,undefined);
  h.setRoute(null);await h.invoke('display:open');const existing=h.output;await h.invoke('tiles:open',['transport']);const newer=h.windows.at(-1);assert((await h.invoke('display:open',[],newer)).ok);await h.invoke('tiles:close',['transport'],newer);assert.equal(h.output,existing);assert.equal(existing.closeRequested,undefined,'closing controls does not close an already established display');
});

test('edits created while a selected-message read is pending still require discard confirmation',async()=>{
  const h=await harness();const site=await h.pair(3011);await h.invoke('control:select-message',['first',site.id]);await h.invoke('tiles:open',['inbox']);const inbox=h.windows.at(-1);
  const response=deferred();h.setRoute(r=>r.url.includes('/control/messages/second')?response.promise:null);
  const next=h.invoke('control:select-message',['second',site.id],inbox);await flush();assert.equal(h.confirmations.length,0);await h.invoke('tiles:dirty',[true]);response.resolve(Response.json({id:'second'}));assert.equal((await next).code,'OPERATION_CANCELLED');assert.equal(h.confirmations.length,1);assert.equal((await h.invoke('app:status')).data.selectedMessageId,'first');
});

test('dirty tile native close and key import ask before closing or committing new credentials',async()=>{
  const h=await harness();const site=await h.pair(3011);await h.invoke('display:open');const output=h.output;await h.invoke('tiles:open',['appearance']);const tile=h.windows.at(-1);await h.invoke('tiles:dirty',[true],tile);
  let prevented=false;tile.emit('close',{preventDefault:()=>{prevented=true;}});await flush();assert(prevented);assert.equal(tile.closeRequested,undefined);
  const commits=h.vaultCommits.length;assert.equal((await h.invoke('sites:import-key',[keyFor(3012)])).code,'OPERATION_CANCELLED');assert.equal(h.vaultCommits.length,commits);assert.equal((await h.invoke('sites:list')).data.selectedId,site.id);assert.equal(output.hideCount,0);
  h.setConfirmation(1);assert((await h.invoke('sites:import-key',[keyFor(3012)])).ok);assert(tile.closeRequested);assert(output.hideCount>0);
});

test('hotkey recording temporarily releases only next, suppresses pending callbacks and restores on blur',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');await h.invoke('app:next-shortcut',['Ctrl+Alt+N']);const shortcut=h.shortcuts.at(-1),before=h.requests.length;
  assert((await h.invoke('app:shortcut-recording',[true])).ok);assert.equal((await h.invoke('app:status')).data.shortcutRecording,true);assert.deepEqual(h.unregistered,['CommandOrControl+Alt+N']);
  shortcut.callback();await flush();assert.equal(h.requests.length,before);assert.equal((await h.invoke('app:next-shortcut',['Ctrl+Alt+M'])).ok,false);
  await h.invoke('tiles:open',['transport']);const tile=h.windows.at(-1);assert.equal((await h.invoke('app:shortcut-recording',[false],tile)).ok,false);
  h.windows[0].emit('blur');assert.equal((await h.invoke('app:status')).data.shortcutRecording,false);assert.equal(h.shortcuts.at(-1).key,'CommandOrControl+Alt+N');
  assert((await h.invoke('app:shortcut-recording',[true])).ok);h.shortcuts[0].callback();await flush();assert(h.requests.some(r=>r.body?.action==='hide'),'emergency hide remains registered during recording');await h.invoke('app:shortcut-recording',[false]);
});

test('next shortcut registration is opt-in, conflict-safe and persists independently of the encrypted vault',async()=>{
  const h=await harness({shortcutPolicy:key=>!key.endsWith('+X')});assert.equal((await h.invoke('app:status')).data.nextShortcut,'');assert.equal(h.shortcuts.length,1);
  assert((await h.invoke('app:next-shortcut',['Ctrl+Alt+N'])).ok);assert.equal(h.workspaceWrites.at(-1).nextShortcut,'CommandOrControl+Alt+N');assert.equal(h.vaultWrites.length,0);
  assert.equal((await h.invoke('app:next-shortcut',['Ctrl+Alt+X'])).ok,false);assert.equal((await h.invoke('app:status')).data.nextShortcut,'CommandOrControl+Alt+N');assert.match((await h.invoke('app:status')).data.shortcutError,/占用/);assert.equal(h.unregistered.length,0);
  assert.equal((await h.invoke('app:next-shortcut',['Ctrl+Shift+H'])).ok,false);
  assert((await h.invoke('app:next-shortcut',[''])).ok);assert.deepEqual(h.unregistered,['CommandOrControl+Alt+N']);
  const restored=await harness({workspace:{version:1,nextShortcut:'Ctrl+Alt+N',tiles:{review:{pinned:true,bounds:{x:0,y:0,width:500,height:500}}}}});assert.equal(restored.windows.length,1);assert.equal(restored.requests.length,0);assert.equal((await restored.invoke('app:status')).data.nextShortcut,'CommandOrControl+Alt+N');
});

test('next hotkey reads fresh revision, debounces and does not replay after hide or reconnect',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('app:next-shortcut',['Ctrl+Alt+N']);const shortcut=h.shortcuts.at(-1);
  shortcut.callback();await flush();assert.match((await h.invoke('app:status')).data.nextActionError,/展示窗口/);assert(!h.requests.some(r=>r.body?.action==='next'));
  await h.invoke('display:open');h.advance(700);h.setRoute(r=>r.url.includes('/control/state')?Response.json({topicId:'3011',revision:37,receivers:1}):null);
  shortcut.callback();shortcut.callback();await flush();await flush();const next=h.requests.filter(r=>r.body?.action==='next');assert.equal(next.length,1);assert.equal(next[0].body.expectedRevision,37);assert.equal(typeof next[0].body.operationId,'string');
  h.advance(700);const pending=deferred();h.setRoute(r=>r.url.includes('/control/state')?pending.promise:null);shortcut.callback();await flush();const hide=h.invoke('control:hide');pending.resolve(Response.json({topicId:'3011',revision:38,receivers:1}));await hide;await flush();assert.equal(h.requests.filter(r=>r.body?.action==='next').length,1);
  h.advance(700);await h.invoke('display:open');await flush();assert.equal(h.requests.filter(r=>r.body?.action==='next').length,1,'reconnecting never replays the cancelled keystroke');
});

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
test('committed switching blanks before waiting for the old mailbox in-flight show',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const output=h.output;
  const response=deferred();h.setRoute(r=>r.body?.action==='show'?response.promise:null);
  const show=h.invoke('control:request',[{path:'/control/action',method:'POST',body:{topicId:'3011',action:'show'}}]);await flush();
  const switchResult=h.invoke('sites:select',[b.id]);await flush();assert(output.hideCount>0);assert(output.closeRequested);
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
    assert.deepEqual(Object.keys(status).sort(),['connectionError','contextVersion','displayOpen','nextActionError','nextPending','nextShortcut','selectedMessageId','shortcut','shortcutError','shortcutRecording','tile','tiles']);
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
  assert.equal(h.quitCount,0,'old Squirrel uninstall cannot quit the guided installation');assert.equal(h.requests.length,before);
});

test('legacy Squirrel layout still handles its own uninstall message',async()=>{
  const h=await harness({execPath:path.join(path.parse(process.execPath).root,'legacy-fixture','WindChime','app-0.8.0','WindChime.exe')});
  h.app.emit('second-instance',{},['WindChime.exe','--squirrel-uninstall']);
  assert.equal(h.quitCount,1);
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

test('WebContents destruction before native window close withdraws output without touching the destroyed renderer',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  output.destroyContents();assert.equal(output.isDestroyed(),false,'Electron destroys contents before the window closed event');
  const result=await h.invoke('control:hide');assert(result.ok,result.error);await flush();
  assert(output.closeRequested);assert.equal(output.crashCount,0);assert.equal(output.blankLoadCount,undefined);
  assert.equal((await h.invoke('app:status')).data.displayOpen,false);
});

test('destroying contents settles an in-flight termination; its late close cannot affect a replacement output',async()=>{
  const h=await harness({deferredCrash:true});await h.pair(3011);await h.invoke('display:open');const old=h.output;
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({error:'revoked'},{status:401})):null);
  assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],old)).ok,false);
  assert.equal(old.crashCount,1);old.destroyContents();await flush();
  assert(old.closeRequested);assert.equal(old.blankLoadCount,undefined);assert.equal(old.webContents.listenerCount('render-process-gone'),1,'only the application observer remains; termination listeners are removed');
  h.setRoute(null);assert((await h.invoke('display:open')).ok);const replacement=h.output;
  old.finishClose();await flush();assert.equal(replacement.hideCount,0);assert.equal(replacement.crashCount,0);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],replacement)).ok);
});

test('late blank failure from a destroyed old output cannot close or hide a new mailbox window',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const old=h.output;
  let rejectPaint;h.setBlankLoadGate(window=>window===old?new Promise((_,reject)=>{rejectPaint=reject;}):null);
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({error:'revoked'},{status:401})):null);
  await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],old);await flush();
  old.destroyContents();h.setRoute(null);await h.invoke('sites:select',[b.id]);await h.invoke('display:open');const current=h.output;
  rejectPaint(new Error('old compositor destroyed'));await flush();
  assert.equal(current.hideCount,0);assert.equal(current.crashCount,0);assert.equal(current.closeRequested,undefined);assert.equal(current.showCount,1);
});

test('quit during revoked-output painting closes the native output without starting a second paint or receiver',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  let rejectPaint;h.setBlankLoadGate(()=>new Promise((_,reject)=>{rejectPaint=reject;}));
  h.setRoute(r=>r.url.includes('/display/frame')?Promise.resolve(Response.json({error:'revoked'},{status:401})):null);
  await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output);await flush();
  let prevented=0;h.app.emit('before-quit',{preventDefault(){prevented++;}});assert.equal(prevented,1);assert(output.closeRequested);
  output.finishClose();rejectPaint(new Error('shutdown compositor destroyed'));await flush();await flush();
  assert.equal(h.quitCount,1);assert.equal(output.blankLoadCount,1,'quit did not start another asynchronous blank paint');
  assert.equal(output.loadCount,1,'quit did not reconnect a receiver');assert.equal((await h.invoke('app:status')).data.displayOpen,false);
  assert.equal(h.requests.at(-1).body.action,'hide');
});

const { encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');
const keyFor = (port, seed = 5) => encodeWindChimeConnectionKey({ origin: `http://localhost:${port}`, siteId: String(port), token: 'wc_ctl_' + Buffer.alloc(32,seed).toString('base64url') });

test('automatic browser pairing protects main drafts and retries the already redeemed approval',async()=>{
  const h=await harness(),old=await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const pending=await h.invoke('sites:pair',[{origin:'http://localhost:3012',label:'Second'}]);
  await h.invoke('tiles:dirty',[true]);const commits=h.vaultCommits.length;
  const denied=await h.invoke('sites:pair-status',[pending.data.id]);
  assert.equal(denied.code,'OPERATION_CANCELLED');assert.equal(h.confirmations.length,1);
  assert.equal((await h.invoke('sites:list')).data.selectedId,old.id);assert.equal(h.vaultCommits.length,commits);assert.equal(output.hideCount,0);
  h.setConfirmation(1);h.setPersistence({rename:()=>{throw new Error('secret disk failure');}});
  assert.equal((await h.invoke('sites:pair-status',[pending.data.id])).code,'CREDENTIAL_SAVE_FAILED');
  assert.equal((await h.invoke('sites:list')).data.items.length,1);assert.equal(output.hideCount,0);
  h.setPersistence({});const retry=await h.invoke('sites:pair-status',[pending.data.id]);assert(retry.ok,retry.error);
  assert.equal(h.requests.filter(r=>r.url.includes(':3012/')&&r.url.endsWith('/devices/poll')).length,1,'a redeemed approval remains in memory for retry');
  assert.equal((await h.invoke('sites:list')).data.items.length,2);assert(output.hideCount>0);
});

test('late pairing approval cannot override a newer manual site choice but can be explicitly retried',async()=>{
  const h=await harness(),a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);
  const pairing=await h.invoke('sites:pair',[{origin:'http://localhost:3013',label:'Pending C'}]),gate=deferred();
  h.setRoute(r=>r.url.includes(':3013/')&&r.url.endsWith('/devices/poll')?gate.promise:null);
  const polling=h.invoke('sites:pair-status',[pairing.data.id]);await flush();
  assert((await h.invoke('sites:select',[b.id])).ok);await h.invoke('display:open');const output=h.output;
  gate.resolve(Response.json({status:'approved',topicId:'3013',token:'wc_ctl_approved',expiresAt:'2099-01-01T00:00:00Z'}));
  assert.equal((await polling).code,'CONNECTION_CHANGED');assert.equal((await h.invoke('sites:list')).data.selectedId,b.id);assert.equal(output.hideCount,0);
  const retry=await h.invoke('sites:pair-status',[pairing.data.id]);assert(retry.ok,retry.error);assert.equal(retry.data.site.label,'Pending C');
  assert.equal(h.requests.filter(r=>r.url.includes(':3013/')&&r.url.endsWith('/devices/poll')).length,1);assert(output.hideCount>0);
});

test('pair cancellation waits for an atomic commit but cancels an uncommitted disk candidate',async()=>{
  for(const stage of ['write','rename']) {
    const h=await harness(),old=await h.pair(3011);
    const pairing=await h.invoke('sites:pair',[{origin:'http://localhost:3012',label:'Pending B'}]),gate=deferred();
    h.setPersistence({[stage]:()=>gate.promise});
    const polling=h.invoke('sites:pair-status',[pairing.data.id]);await flush();await flush();
    let cancellationDone=false;
    const cancellation=h.invoke('sites:pair-cancel',[pairing.data.id]).then(result=>{cancellationDone=true;return result;});
    await flush();assert.equal(cancellationDone,stage==='write');
    gate.resolve();const [cancelled,polled]=await Promise.all([cancellation,polling]);
    assert(cancelled.ok);assert.equal(cancelled.data.connected,stage==='rename');
    assert.equal(polled.ok,stage==='rename');
    assert.equal((await h.invoke('sites:list')).data.selectedId===old.id,stage==='write');
  }
});

test('site selection and forgetting are atomic when encrypt, write or rename fails',async()=>{
  for(const operation of ['select','forget-current','forget-other'])for(const stage of ['encrypt','write','rename']){
    const h=await harness(),a=await h.pair(3011),b=await h.pair(3012);await h.invoke('display:open');const output=h.output;
    const before=(await h.invoke('sites:list')).data,commits=h.vaultCommits.length;
    h.setPersistence({[stage]:()=>{throw new Error('SECRET_STORAGE');}});
    const result=await h.invoke(operation==='select'?'sites:select':'sites:forget',[operation==='forget-current'?b.id:a.id]);
    assert.equal(result.code,'CREDENTIAL_SAVE_FAILED',`${operation}/${stage}`);assert(!JSON.stringify(result).includes('SECRET_STORAGE'));
    assert.deepEqual((await h.invoke('sites:list')).data,before);assert.equal(h.vaultCommits.length,commits);assert.equal(output.hideCount,0);
  }
});

test('topic persistence failures and drafts created during disk writes preserve the old context',async()=>{
  const h=await harness();
  h.setRoute(r=>r.url.endsWith('/capabilities')?Response.json({protocolVersion:1,siteId:'3011',features:{connectionKeys:true,siteControl:true}}):r.url.endsWith('/control/identity')?Response.json({scope:'site',siteId:'3011',topicId:null,topicTitle:null,label:'Site',grantId:'grant',expiresAt:'2099-01-01T00:00:00Z'}):r.url.includes('/control/topics/')?Response.json({id:r.url.split('/').at(-1)}):null);
  const site=await h.invoke('sites:import-key',[keyFor(3011)]);assert(site.ok);await h.invoke('sites:select-topic',['A',site.data.id]);await h.invoke('display:open');const output=h.output;
  for(const stage of ['encrypt','write','rename']){
    h.setPersistence({[stage]:()=>{throw new Error('storage failed');}});
    assert.equal((await h.invoke('sites:select-topic',['B',site.data.id])).code,'CREDENTIAL_SAVE_FAILED');
    assert.equal((await h.invoke('sites:list')).data.items[0].selectedTopicId,'A');assert.equal(output.hideCount,0);
  }
  const disk=deferred();h.setPersistence({write:()=>disk.promise});
  const selecting=h.invoke('sites:select-topic',['B',site.data.id]);await flush();await h.invoke('tiles:dirty',[true]);
  disk.resolve();assert.equal((await selecting).code,'OPERATION_CANCELLED');assert.equal(h.confirmations.length,1);
  assert.equal((await h.invoke('sites:list')).data.items[0].selectedTopicId,'A');assert.equal(output.hideCount,0);
});
test('connection key validates identity before selection, saves v1 encrypted credentials and returns no token',async()=>{
  const h=await harness();const key=keyFor(3011);
  const first=await h.invoke('sites:import-key',[key]);assert(first.ok,first.error);
  assert.equal(first.data.topicId,'3011');assert.equal(first.data.label,'Shared key');assert(!('token' in first.data));
  assert.deepEqual(h.requests.map(r=>new URL(r.url).pathname),['/api/mail/live/capabilities','/api/mail/live/control/identity']);
  assert(!h.requests[0].headers.authorization);assert(h.requests[1].headers.authorization.startsWith('Bearer wc_ctl_'));
  assert(h.requests.every(r=>!r.url.includes('wc_ctl_')&&!r.url.includes('wc_conn_')));
  assert.equal(h.vaultWrites.at(-1).version,1);assert.equal(h.vaultWrites.at(-1).sites.length,1);
  assert.equal(h.output,undefined,'connection cannot automatically create output');
  const again=await h.invoke('sites:import-key',[key]);assert(again.ok,again.error);assert.equal(again.data.id,first.data.id);
  assert.equal(again.data.expiresAt,first.data.expiresAt,'import never extends server expiry');
  assert.equal((await h.invoke('sites:list')).data.items.length,1);
});
test('malformed key and a different site instance never receive an authenticated request',async()=>{
  const h=await harness();assert.equal((await h.invoke('sites:import-key',['not-a-key'])).ok,false);assert.equal(h.requests.length,0);
  h.setRoute(r=>r.url.endsWith('/capabilities')?Promise.resolve(Response.json({protocolVersion:1,siteId:'other',features:{connectionKeys:true}})):null);
  const result=await h.invoke('sites:import-key',[keyFor(3011)]);assert.equal(result.code,'CONNECTION_SITE_MISMATCH');
  assert.equal(h.requests.length,1);assert(!h.requests[0].headers.authorization);assert.equal(h.vaultWrites.length,0);
});
test('unsupported sites and an HTML 404 have actionable private errors',async()=>{
  for(const mode of ['old','404','html']){
    const h=await harness();h.setRoute(r=>r.url.endsWith('/capabilities')?Promise.resolve(mode==='old'?Response.json({protocolVersion:1,siteId:'3011',features:{pairing:true}}):new Response('<html>not a compatible API</html>',{status:mode==='404'?404:200,headers:{'content-type':'text/html'}})):null);
    const result=await h.invoke('sites:import-key',[keyFor(3011)]);assert.equal(result.ok,false);assert(!result.error.includes('<html>'));
    assert.match(result.error,mode==='old'?/0\.6\.1/:mode==='404'?/HTTP 404/:/无法识别/);assert.equal(h.vaultWrites.length,0);
  }
  const h=await harness();h.setRoute(()=>Promise.resolve(new Response('Missing',{status:404})));
  const result=await h.invoke('sites:pair',[{origin:'http://localhost:3011',label:'Old pairing'}]);assert.match(result.error,/HTTP 404/);
});
test('revoked or expired keys and connection failures preserve the selected mailbox and hide remote response secrets',async()=>{
  for(const code of ['CONNECTION_KEY_INVALID','CONNECTION_KEY_REVOKED','CONNECTION_KEY_EXPIRED']){
    const h=await harness();const old=await h.pair(3011);await h.invoke('display:open');const output=h.output,stored=h.vaultWrites.length;
    h.setRoute(r=>r.url.endsWith('/control/identity')?Promise.resolve(Response.json({code,error:keyFor(3012)},{status:401})):null);
    const result=await h.invoke('sites:import-key',[keyFor(3012)]);assert.equal(result.code,code);assert(!result.error.includes('wc_conn_'));assert(!result.error.includes('wc_ctl_'));
    assert.equal((await h.invoke('sites:list')).data.selectedId,old.id);assert.equal(h.vaultWrites.length,stored);assert.equal(output.hideCount,0);
  }
  const h=await harness();h.setRoute(()=>Promise.reject(new TypeError('fetch failed')));
  assert.equal((await h.invoke('sites:import-key',[keyFor(3012)])).code,'REMOTE_UNREACHABLE');assert.equal(h.vaultWrites.length,0);
});
test('successful key import uses the existing switch guard; stale identity cannot select an old site',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const old=h.output;
  assert((await h.invoke('sites:import-key',[keyFor(3012)])).ok);assert(old.closeRequested);assert(old.hideCount>0);
  await h.invoke('display:open');const current=h.output,hideCount=h.requests.filter(r=>r.body?.action==='hide').length;
  old.finishClose();await flush();assert.equal(h.requests.filter(r=>r.body?.action==='hide').length,hideCount);assert.equal(current.hideCount,0);
  const gate=deferred();h.setRoute(r=>r.url.includes(':3011/api/mail/live/control/identity')?gate.promise:null);
  const pending=h.invoke('sites:import-key',[keyFor(3011)]);await flush();
  const selected=await h.invoke('sites:import-key',[keyFor(3012)]);assert(selected.ok);
  gate.resolve(Response.json({siteId:'3011',topicId:'3011',topicTitle:'Old',label:'Old',expiresAt:'2099-01-01T00:00:00.000Z',grantId:'old'}));
  assert.equal((await pending).code,'CONNECTION_CHANGED');assert.equal((await h.invoke('sites:list')).data.selectedId,selected.data.id);
});
test('display cannot import a control key; encryption failure never sends the key to a website',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const before=h.requests.length;
  assert.equal((await h.invoke('sites:import-key',[keyFor(3012)],h.output)).ok,false);assert.equal(h.requests.length,before);
  const unavailable=await harness({encryptionAvailable:false});assert.equal((await unavailable.invoke('sites:import-key',[keyFor(3011)])).code,'CREDENTIAL_ENCRYPTION_UNAVAILABLE');assert.equal(unavailable.requests.length,0);
});

test('encryption, write and rename failures leave the old connection, vault and live output intact',async()=>{
  for(const stage of ['encrypt','write','rename']) {
    const h=await harness(),old=await h.pair(3011);await h.invoke('display:open');const output=h.output;
    const before=(await h.invoke('sites:list')).data,committed=h.vaultCommits.at(-1),commitCount=h.vaultCommits.length;
    h.setPersistence({[stage]:()=>{throw new Error('SECRET_STORAGE_DETAILS');}});
    const result=await h.invoke('sites:import-key',[keyFor(3012)]);
    assert.equal(result.ok,false);assert.equal(result.code,'CREDENTIAL_SAVE_FAILED');assert(!JSON.stringify(result).includes('SECRET_STORAGE_DETAILS'));
    assert.deepEqual((await h.invoke('sites:list')).data,before);assert.equal((await h.invoke('sites:list')).data.selectedId,old.id);
    assert.equal(h.vaultCommits.length,commitCount);assert.deepEqual(h.vaultCommits.at(-1),committed);
    assert.equal(output.hideCount,0);assert(!output.closeRequested);assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  }
});

test('failed reimport cannot replace current connection metadata or close its output',async()=>{
  const h=await harness(),first=await h.invoke('sites:import-key',[keyFor(3011)]);assert(first.ok);await h.invoke('display:open');const output=h.output;
  const before=(await h.invoke('sites:list')).data,committed=h.vaultCommits.at(-1);
  h.setRoute(r=>r.url.endsWith('/control/identity')?Promise.resolve(Response.json({siteId:'3011',topicId:'3011',topicTitle:'Changed title',label:'Changed label',expiresAt:'2099-01-01T00:00:00.000Z',grantId:'grant-3011'})):null);
  h.setPersistence({rename:()=>{throw new Error('EACCES');}});
  assert.equal((await h.invoke('sites:import-key',[keyFor(3011)])).code,'CREDENTIAL_SAVE_FAILED');
  assert.deepEqual((await h.invoke('sites:list')).data,before);assert.deepEqual(h.vaultCommits.at(-1),committed);assert.equal(output.hideCount,0);
});

test('a newer selection during candidate disk write cancels import before it can overwrite the vault',async()=>{
  const h=await harness(),a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const output=h.output;
  const gate=deferred();let writing=false;
  h.setPersistence({write:candidate=>{if(candidate.sites.some(site=>site.topicId==='3013')){writing=true;return gate.promise;}}});
  const importing=h.invoke('sites:import-key',[keyFor(3013)]);await flush();await flush();assert(writing);assert.equal(output.hideCount,0);
  const selecting=h.invoke('sites:select',[b.id]);await flush();assert.equal((await h.invoke('sites:list')).data.selectedId,a.id,'selection waits for encrypted commit');
  gate.resolve();assert.equal((await importing).code,'CONNECTION_CHANGED');assert((await selecting).ok);
  assert.equal(h.vaultCommits.at(-1).selected,b.id);assert(!h.vaultCommits.some(v=>v.sites.some(site=>site.topicId==='3013')));
  assert(!(await h.invoke('sites:list')).data.items.some(site=>site.topicId==='3013'));
});

test('forgetting an unselected mailbox during import cannot be undone by its pending vault candidate',async()=>{
  const h=await harness(),a=await h.pair(3011),b=await h.pair(3012),gate=deferred();let writing=false;
  h.setPersistence({write:candidate=>{if(candidate.sites.some(site=>site.topicId==='3013')){writing=true;return gate.promise;}}});
  const importing=h.invoke('sites:import-key',[keyFor(3013)]);await flush();await flush();assert(writing);
  const forgetting=h.invoke('sites:forget',[a.id]);await flush();assert.equal((await h.invoke('sites:list')).data.items.length,2,'removal waits for encrypted commit');
  gate.resolve();assert.equal((await importing).code,'CONNECTION_CHANGED');assert((await forgetting).ok);
  const final=(await h.invoke('sites:list')).data;assert.equal(final.selectedId,b.id);assert.deepEqual(Array.from(final.items,site=>site.id),[b.id]);
  assert.deepEqual(h.vaultCommits.at(-1).sites.map(site=>site.id),[b.id]);
});

test('selection arriving during atomic rename runs after import publication and owns the final vault',async()=>{
  const h=await harness(),a=await h.pair(3011),b=await h.pair(3012);await h.invoke('sites:select',[a.id]);await h.invoke('display:open');const output=h.output;
  const gate=deferred();let renaming=false;
  h.setPersistence({rename:candidate=>{if(!renaming&&candidate.sites.some(site=>site.topicId==='3013')){renaming=true;return gate.promise;}}});
  const importing=h.invoke('sites:import-key',[keyFor(3013)]);await flush();await flush();assert(renaming);assert.equal(output.hideCount,0);
  const selecting=h.invoke('sites:select',[b.id]);await flush();assert.equal((await h.invoke('sites:list')).data.selectedId,a.id);
  gate.resolve();const imported=await importing;if(!imported.ok)assert.equal(imported.code,'CONNECTION_CHANGED');assert((await selecting).ok);
  assert.equal((await h.invoke('sites:list')).data.selectedId,b.id);assert.equal(h.vaultCommits.at(-1).selected,b.id);
  assert(h.vaultCommits.at(-1).sites.some(site=>site.topicId==='3013'));assert(output.closeRequested);
});

test('untrusted remote error codes cannot echo a connection key or prototype properties into IPC',async()=>{
  const h=await harness();for(const code of [keyFor(3012),'wc_ctl_'+ 'A'.repeat(43),'constructor','__proto__',{secret:keyFor(3012)}]) {
    h.setRoute(r=>r.url.endsWith('/control/identity')?Promise.resolve(Response.json({code,error:keyFor(3012)},{status:401})):null);
    const result=await h.invoke('sites:import-key',[keyFor(3012)]);assert.equal(result.ok,false);assert.equal(result.code,'CONNECTION_FAILED');assert(!/wc_ctl_|wc_conn_/.test(JSON.stringify(result)));
  }
});

test('site keys import without a topic and only a verified topic can open the independent display',async()=>{
  const h=await harness();
  h.setRoute(r=>r.url.endsWith('/capabilities')?Response.json({protocolVersion:1,siteId:'3011',features:{connectionKeys:true,siteControl:true,mailManagement:true}}):r.url.endsWith('/control/identity')?Response.json({scope:'site',siteId:'3011',topicId:null,topicTitle:null,label:'Full site',grantId:'site-key',expiresAt:'2099-01-01T00:00:00Z'}):r.url.endsWith('/control/topics/topic-A')?Response.json({id:'topic-A'}):r.url.endsWith('/control/topics/topic-B')?Response.json({id:'topic-B'}):null);
  const imported=await h.invoke('sites:import-key',[keyFor(3011)]);assert(imported.ok,imported.error);assert.equal(imported.data.scope,'site');assert.equal(imported.data.topicId,null);assert.equal(imported.data.selectedTopicId,null);
  assert.equal((await h.invoke('display:open')).ok,false);assert.equal(h.output,undefined);
  const a=await h.invoke('sites:select-topic',['topic-A',imported.data.id]);assert(a.ok,a.error);assert.equal(a.data.selectedTopicId,'topic-A');assert((await h.invoke('display:open')).ok);const old=h.output;
  const b=await h.invoke('sites:select-topic',['topic-B',imported.data.id]);assert(b.ok,b.error);assert(old.closeRequested);assert(old.hideCount>0);assert.equal(h.requests.at(-1).body.topicId,'topic-A');assert.equal(h.requests.at(-1).body.action,'hide');
  assert((await h.invoke('display:open')).ok);const current=h.output;const before=h.requests.length;old.finishClose();await flush();assert.equal(h.requests.length,before);assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],current)).ok);
  const saved=h.vaultCommits.at(-1).sites[0];assert.equal(saved.topicId,null);assert.equal(saved.selectedTopicId,'topic-B');
});

test('management commands from an old site and old topic cannot write after switching',async()=>{
  const h=await harness();const a=await h.pair(3011),b=await h.pair(3012);const before=h.requests.length;
  assert.equal((await h.invoke('control:request',[{connectionId:a.id,path:'/control/messages/m?topicId=3011',method:'DELETE'}])).ok,false);
  assert.equal((await h.invoke('control:request',[{connectionId:b.id,path:'/control/messages/m?topicId=3011',method:'DELETE'}])).ok,false);
  assert.equal(h.requests.length,before);assert.equal((await h.invoke('sites:select-topic',['other-topic',b.id])).ok,false);assert.equal(h.requests.length,before);
  assert((await h.invoke('control:request',[{connectionId:b.id,path:'/control/messages/m?topicId=3012',method:'PATCH',body:{isRead:true}}])).ok);
  assert.equal(h.requests.at(-1).body.isRead,true);assert.equal(h.requests.at(-1).headers.authorization,'Bearer wc_ctl_private');
});

test('display window cannot access any new management, save, confirmation or external-link IPC',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');
  for(const [channel,args] of [['sites:select-topic',['3011']],['files:save',[{kind:'csv',name:'x',content:'x'}]],['app:confirm',[{message:'x'}]],['share:open',[]],['control:request',[{path:'/control/topics',method:'GET'}]]])assert.equal((await h.invoke(channel,args,h.output)).ok,false);
});

test('topic selection waits for an importing vault commit and rejects the old site callback',async()=>{
  const h=await harness(),old=await h.pair(3011);const gate=deferred();let renaming=false;
  h.setPersistence({rename:candidate=>{if(!renaming&&candidate.sites.some(site=>site.topicId==='3012')){renaming=true;return gate.promise;}}});
  const importing=h.invoke('sites:import-key',[keyFor(3012)]);await flush();await flush();assert(renaming);
  const changing=h.invoke('sites:select-topic',['3011',old.id]);await flush();assert.equal((await h.invoke('sites:list')).data.selectedId,old.id);
  gate.resolve();const result=await importing;assert(result.ok,result.error);assert.equal((await changing).ok,false);
  const final=(await h.invoke('sites:list')).data;assert.equal(final.selectedId,result.data.id);assert.equal(h.vaultCommits.at(-1).selected,result.data.id);
  assert(!h.requests.some(request=>request.url.endsWith('/control/topics/3011')));
});

test('topic membership arriving inside a new import rename cannot publish or persist its old selection',async()=>{
  const h=await harness();
  h.setRoute(r=>r.url.endsWith('/capabilities')&&r.url.includes(':3011')?Response.json({protocolVersion:1,siteId:'3011',features:{connectionKeys:true,siteControl:true}}):r.url.endsWith('/control/identity')&&r.url.includes(':3011')?Response.json({scope:'site',siteId:'3011',topicId:null,topicTitle:null,label:'Site A',grantId:'site-key',expiresAt:'2099-01-01T00:00:00Z'}):null);
  const old=await h.invoke('sites:import-key',[keyFor(3011)]);assert(old.ok,old.error);
  const membership=deferred(),rename=deferred();let renaming=false;
  h.setRoute(r=>r.url.endsWith('/control/topics/topic-A')?membership.promise:null);
  const selecting=h.invoke('sites:select-topic',['topic-A',old.data.id]);await flush();
  h.setPersistence({rename:candidate=>{if(!renaming&&candidate.sites.some(site=>site.topicId==='3012')){renaming=true;return rename.promise;}}});
  const importing=h.invoke('sites:import-key',[keyFor(3012)]);await flush();await flush();assert(renaming);
  const commits=h.vaultCommits.length;membership.resolve(Response.json({id:'topic-A'}));await flush();await flush();assert.equal(h.vaultCommits.length,commits);assert.equal((await h.invoke('sites:list')).data.items[0].selectedTopicId,null);
  rename.resolve();const imported=await importing;assert(imported.ok,imported.error);assert.equal((await selecting).ok,false);assert.equal(h.vaultCommits.at(-1).selected,imported.data.id);assert.equal((await h.invoke('sites:list')).data.selectedId,imported.data.id);
});


for (const outcome of ['conflict', 'timeout', 'success']) for (const replay of [false, true]) test('late image '+outcome+' cannot withdraw a newer '+(replay?'activation of the same snapshot':'letter'),async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const frame=(id,activation)=>Response.json({receiverId:'r',epoch:'epoch',leaseMs:3000,revision:activation+1,activation,snapshot:{id,text:id}});
  h.setRoute(r=>r.url.includes('/display/frame')?frame('A',1):null);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  let finish,fail;const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  h.setRoute(r=>r.url.includes('/display/assets/asset_A')?pending:r.url.includes('/display/frame')?frame(replay?'A':'B',2):null);
  const late=h.invoke('display:request',[{path:'/display/assets/asset_A?receiverId=r&activation=1',method:'GET'}],output);await flush();
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  if(outcome==='timeout')fail(Object.assign(new Error('synthetic timeout'),{code:'REMOTE_TIMEOUT',status:0}));
  else finish(outcome==='conflict'?Response.json({error:'old activation'},{status:409}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}}));
  assert.equal((await late).ok,false,'old bytes/errors are not delivered to the new activation');await flush();await flush();
  assert.equal(output.crashCount,0);assert.equal(output.loadCount,1);assert.equal(output.hideCount,0);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
});

for(const status of [401,403]) for(const switched of [false,true]) test('display grant '+status+' still blanks after '+(switched?'an activation switch':'a current image request'),async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  const frame=(id,activation)=>Response.json({receiverId:'r',epoch:'epoch',leaseMs:3000,revision:activation+1,activation,snapshot:{id,text:id}});
  h.setRoute(r=>r.url.includes('/display/frame')?frame('A',1):null);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  const pending=deferred();h.setRoute(r=>r.url.includes('/display/assets/')?pending.promise:r.url.includes('/display/frame')?frame('B',2):null);
  const request=h.invoke('display:request',[{path:'/display/assets/asset_A?receiverId=r&activation=1',method:'GET'}],output);await flush();
  if(switched)assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  pending.resolve(Response.json({error:'grant invalid'},{status}));assert.equal((await request).ok,false);await flush();await flush();
  assert.equal(output.crashCount,1);assert.equal((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok,false);
});

for(const outcome of ['conflict','timeout']) test('a current activation image '+outcome+' still clears output',async()=>{
  const h=await harness();await h.pair(3011);await h.invoke('display:open');const output=h.output;
  h.setRoute(r=>r.url.includes('/display/frame')?Response.json({receiverId:'r',epoch:'epoch',leaseMs:3000,revision:2,activation:1,snapshot:{id:'A',text:'A'}}):null);
  assert((await h.invoke('display:request',[{path:'/display/frame?receiverId=r',method:'GET'}],output)).ok);
  h.setRoute(r=>r.url.includes('/display/assets/')?(outcome==='conflict'?Response.json({error:'asset unavailable'},{status:409}):Promise.reject(Object.assign(new Error('synthetic timeout'),{code:'REMOTE_TIMEOUT',status:0}))):null);
  assert.equal((await h.invoke('display:request',[{path:'/display/assets/asset_A?receiverId=r&activation=1',method:'GET'}],output)).ok,false);
  await flush();await flush();assert.equal(output.crashCount,1);
});
