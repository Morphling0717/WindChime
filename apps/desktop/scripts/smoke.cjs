// Run with: npm run build && node_modules/.bin/electron scripts/smoke.cjs
// This verifies the real packaged renderer and native IPC against a disposable
// local fixture. Service invariants are tested separately in WindChime's suite.
const { app, BrowserWindow, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const displayTitle=process.env.WINDCHIME_SMOKE_DISPLAY_TITLE || 'WindChime Recovery Smoke';
const appearance = {fontFamily:'system-ui',fontSize:32,textColor:'#ffffff',backgroundColor:'#18202eee',transparent:true,layout:'card',animation:'none',borderRadius:24,padding:32};
const original = {text:'PRIVATE_UNREVIEWED\n这是一封需要先审核的原始来信。',nickname:'原始称呼',linkUrl:null,assets:[]};
const message = {id:'mail-1',createdAt:new Date().toISOString(),isRead:false,isFavorited:false,isFlagged:false,source:original,draft:{...original,text:'APPROVED_FOR_AUDIENCE\n今天也辛苦了，希望这封信给你带来一点快乐。'},draftRevision:1,status:'pending',snapshotId:null};
const state = {topicId:'topic-A',revision:1,epoch:'smoke-epoch',messages:[message],queue:[],current:null,appearance,receivers:0};
let activation=0, receiverCount=0, active=false, lastBrowser;
const receivers=new Map();
shell.openExternal=async url=>{lastBrowser=url;};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let body={};for await(const chunk of req) body=typeof body==='string'?body+chunk.toString():chunk.toString();if(typeof body==='string')body=JSON.parse(body);
  const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const p=url.pathname.replace('/api/mail/live','');
  if(p==='/capabilities')return json({protocolVersion:1,siteId:'fixture-site',features:{broadcast:true}});
  if(p==='/devices/request')return json({deviceCode:'PRIVATE_DEVICE_CODE',userCode:'ABCD-EFGH',expiresAt:new Date(Date.now()+600000).toISOString(),interval:2});
  if(p==='/devices/poll')return json({status:'approved',token:'wc_ctl_PRIVATE_CONTROL_TOKEN',topicId:'topic-A',expiresAt:new Date(Date.now()+86400000).toISOString()});
  const control=req.headers.authorization==='Bearer wc_ctl_PRIVATE_CONTROL_TOKEN';const display=req.headers.authorization==='Bearer wc_disp_PRIVATE_DISPLAY_TOKEN';
  if(p.startsWith('/control/')&&!control)return json({error:'no control'},401);
  if(p.startsWith('/display/')&&!display)return json({error:'no display'},401);
  if(p==='/control/state')return json(state);
  if(p==='/control/grants'&&req.method==='GET')return json({items:[]});
  if(p==='/control/grants'&&req.method==='POST')return json({id:'grant-1',token:'wc_disp_PRIVATE_DISPLAY_TOKEN',topicId:'topic-A',expiresAt:new Date(Date.now()+86400000).toISOString(),kind:'display'});
  if(p==='/control/action'){
    const a=body.action;
    if(a==='approve'){message.status='approved';message.snapshotId='snapshot-1';state.queue=['mail-1'];}
    if(a==='show'&&message.status==='approved'){active=true;activation++;state.current={messageId:'mail-1',snapshotId:'snapshot-1'};}
    if(['hide','end','revoke','reject'].includes(a)){active=false;activation++;state.current=null;}
    if(a==='revoke'){message.status='pending';state.queue=[];message.snapshotId=null;}
    state.revision++;return json(state);
  }
  if(p==='/display/open'){const receiverId=`r-${++receiverCount}`;receivers.set(receiverId,activation);state.receivers=receivers.size;return json({receiverId,epoch:state.epoch,leaseMs:3000,pollIntervalMs:1000});}
  if(p==='/display/frame'){const receiverId=url.searchParams.get('receiverId');return json({receiverId,epoch:state.epoch,revision:state.revision,activation,leaseMs:3000,appearance,snapshot:active&&receivers.get(receiverId)<activation?{...message.draft,id:'snapshot-1',messageId:'mail-1'}:null});}
  return json({error:'not found'},404);
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<100;i++){try{const result=await Promise.race([check(),delay(500).then(()=>false)]);if(result)return result;}catch{/* renderer may be replaced while observing */}await delay(100);}throw new Error(`Timed out: ${label}`);}
async function transparentPixels(window){const image=await window.webContents.capturePage();const bytes=image.toBitmap();let visible=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i])visible++;return {image,visible};}
async function run(){
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-electron-smoke-'));app.setPath('userData',data);
  app.on('browser-window-created',(_event,window)=>{if(window.getTitle()==='WindChime Display'){window.setTitle(displayTitle);window.webContents.on('page-title-updated',event=>{event.preventDefault();window.setTitle(displayTitle);});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const network=[],originalFetch=globalThis.fetch;
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url);
    assert.equal(url.origin,origin,'No gateway, Bilibili, or other host is allowed');
    assert(url.pathname.startsWith('/api/mail/live/')&&!/\/(gateway|binding-challenge|bind)(\/|$)/.test(url.pathname));
    assert(!new Headers(options?.headers).has('x-windchime-platform-lease'));
    network.push(url.pathname);return originalFetch(input,options);
  };
  process.argv.push('code=ignored-platform-code','--code=also-ignored');
  require('../main.cjs');
  await app.whenReady();const control=await until(()=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('私人控制台')),'control window');
  await until(()=>control.webContents.executeJavaScript('!!window.windchimeDesktop').catch(()=>false),'preload');
  const removed=await control.webContents.executeJavaScript('JSON.stringify(["copyDisplayLink","gatewayConnect","gatewayConfigure","gatewayEnd"].filter(name=>name in window.windchimeDesktop))');assert.equal(removed,'[]');
  const status=await control.webContents.executeJavaScript('window.windchimeDesktop.status()');assert(status.ok);assert.deepEqual(Object.keys(status.data).sort(),['connectionError','displayOpen','shortcut']);
  assert.equal(network.length,0,'code arguments cannot initiate a connection');
  const errors=[];control.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const pair=await control.webContents.executeJavaScript(`window.windchimeDesktop.pair({origin:${JSON.stringify(origin)},label:'测试信箱'})`);assert(pair.ok);assert(!JSON.stringify(pair).includes('PRIVATE_DEVICE_CODE'));assert(lastBrowser.includes('/mail/live?userCode='));
  const paired=await control.webContents.executeJavaScript(`window.windchimeDesktop.pairingStatus(${JSON.stringify(pair.data.id)})`);assert(paired.ok);assert(!JSON.stringify(paired).includes('PRIVATE_CONTROL_TOKEN'));
  await control.webContents.reload();await until(()=>control.webContents.executeJavaScript('document.body.innerText.includes("PRIVATE_UNREVIEWED")').catch(()=>false),'private data');
  const leakage=await control.webContents.executeJavaScript('JSON.stringify(window.windchimeDesktop)');assert(!leakage.includes('token'));
  const cross=await control.webContents.executeJavaScript('window.windchimeDesktop.request({path:"/control/state?topicId=other-topic",method:"GET"})');assert.equal(cross.ok,false);
  const tokenCreation=await control.webContents.executeJavaScript('window.windchimeDesktop.request({path:"/control/grants",method:"POST",body:{topicId:"topic-A",kind:"control"}})');assert.equal(tokenCreation.ok,false);
  const open=await control.webContents.executeJavaScript('window.windchimeDesktop.openDisplay()');assert(open.ok);
  const output=await until(()=>BrowserWindow.getAllWindows().find(w=>w.getTitle()===displayTitle),'display window');
  await delay(1300);assert.equal(await output.webContents.executeJavaScript('document.body.innerText'), '');
  const denied=await output.webContents.executeJavaScript('window.windchimeOutput.request({path:"/control/state",method:"GET"})');assert.equal(denied.ok,false);
  assert.equal(await output.webContents.executeJavaScript('typeof window.windchimeDesktop'),'undefined');
  const command=action=>control.webContents.executeJavaScript(`window.windchimeDesktop.request({path:'/control/action',method:'POST',body:{topicId:'topic-A',action:${JSON.stringify(action)},messageId:'mail-1',expectedRevision:1,expectedDraftRevision:1,operationId:'smoke-command-${action}'}})`);
  await command('approve');await delay(1100);assert.equal(await output.webContents.executeJavaScript('document.body.innerText'),'');
  await command('show');await until(()=>output.webContents.executeJavaScript('document.body.innerText.includes("APPROVED_FOR_AUDIENCE")'),'manual show');
  const outputText=await output.webContents.executeJavaScript('document.body.innerText');assert(!outputText.includes('PRIVATE_UNREVIEWED'));
  const results=path.join(__dirname,'../out/smoke');await fs.mkdir(results,{recursive:true});
  await control.webContents.executeJavaScript('document.querySelector(".wc-mail")?.click()');await delay(200);
  await fs.writeFile(path.join(results,'control.png'),(await control.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(results,'display.png'),(await output.webContents.capturePage()).toPNG());
  const revokeReceiver=receiverCount;await command('revoke');await until(()=>output.webContents.executeJavaScript('document.body.innerText === ""'),'revoke blank');await until(()=>receiverCount>revokeReceiver,'fresh receiver after revocation');
  await command('approve');await command('show');await until(()=>output.webContents.executeJavaScript('document.body.innerText.includes("APPROVED_FOR_AUDIENCE")'),'reshow');
  output.webContents.reload();await delay(1500);assert.equal(await output.webContents.executeJavaScript('document.body.innerText'),'');
  await command('show');await until(()=>output.webContents.executeJavaScript('document.body.innerText.includes("APPROVED_FOR_AUDIENCE")'),'after reload manual show');
  // An opaque foreground window covers every output pixel for longer than a
  // minute. Do not inspect/capture the output during the hold (that could wake it).
  assert.equal(output.webContents.getBackgroundThrottling(),false);
  const bounds=output.getBounds();const cover=new BrowserWindow({x:bounds.x-20,y:bounds.y-20,width:bounds.width+40,height:bounds.height+40,frame:false,alwaysOnTop:true,skipTaskbar:true,backgroundColor:'#172130',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  await cover.loadURL('data:text/html,<body style="background:%23172130;color:white;font:24px sans-serif">WindChime automated occlusion verification</body>');cover.show();cover.focus();
  const framesBefore=network.filter(p=>p.endsWith('/display/frame')).length,holdStarted=Date.now();
  console.log(JSON.stringify({stage:'occluded-output',holdMs:65000}));await delay(65000);
  const occlusion={holdMs:Date.now()-holdStarted,frames:network.filter(p=>p.endsWith('/display/frame')).length-framesBefore};
  assert(occlusion.frames>=40,'output must keep confirming leases while fully covered');
  const hideReceiver=receiverCount;let nativeHideAt=0;output.once('hide',()=>{nativeHideAt=Date.now();});
  const observedBlank=new Promise(resolve=>output.webContents.once('did-finish-load',()=>{void output.webContents.executeJavaScript(`({blank:document.body.innerText==='',at:Date.now()})`).then(value=>{assert(value.blank);resolve(value.at);});}));
  const hideStarted=Date.now();const hideResponse=await fetch(origin+'/api/mail/live/control/action',{method:'POST',headers:{authorization:'Bearer wc_ctl_PRIVATE_CONTROL_TOKEN','content-type':'application/json'},body:JSON.stringify({topicId:'topic-A',action:'hide'})});assert(hideResponse.ok);await hideResponse.json();const hideResponseAt=Date.now();
  const blankAt=await Promise.race([observedBlank,delay(4000).then(()=>{throw Error('Covered output did not clear after web hide');})]);
  occlusion.hide={commandToBlankMs:blankAt-hideStarted,responseToBlankMs:Math.max(0,blankAt-hideResponseAt),nativeHideMs:nativeHideAt-hideStarted};
  const hiddenPixels=await transparentPixels(output);assert.equal(hiddenPixels.visible,0,'covered compositor must contain no old pixels after hide');await fs.writeFile(path.join(results,'occluded-hide.png'),hiddenPixels.image.toPNG());
  await until(()=>receiverCount>hideReceiver,'fresh receiver after covered hide');
  await command('show');await until(()=>output.webContents.executeJavaScript('document.body.innerText.includes("APPROVED_FOR_AUDIENCE")'),'covered manual show');
  // Deliberately block only the isolated output renderer. The main-process
  // watchdog must recover without needing a renderer timer or IPC response.
  const frozenAt=Date.now();let nativeHiddenAt=0;output.once('hide',()=>{nativeHiddenAt=Date.now();});
  const terminated=new Promise(resolve=>output.webContents.once('render-process-gone',resolve));
  void output.webContents.executeJavaScript('while (true) {}').catch(()=>{});
  await Promise.race([terminated,delay(4000).then(()=>{throw Error('Main process did not recover frozen renderer');})]);
  assert(nativeHiddenAt&&nativeHiddenAt-frozenAt<=3100,'native window must hide within the last lease');
  await until(()=>output.webContents.executeJavaScript('!!window.windchimeOutput && document.body.innerText === ""').catch(()=>false),'new renderer blank');
  await delay(1200);assert.equal(await output.webContents.executeJavaScript('document.body.innerText'),'','fresh renderer cannot restore old server snapshot');
  const recoveredPixels=await transparentPixels(output);assert.equal(recoveredPixels.visible,0);await fs.writeFile(path.join(results,'watchdog-recovered.png'),recoveredPixels.image.toPNG());
  occlusion.frozenRenderer={nativeHideMs:nativeHiddenAt-frozenAt,recoveredTransparentPixels:recoveredPixels.visible};
  await command('show');await until(()=>output.webContents.executeJavaScript('document.body.innerText.includes("APPROVED_FOR_AUDIENCE")'),'manual show after watchdog recovery');
  const disconnectAt=Date.now();await new Promise(resolve=>server.close(resolve));await until(()=>output.webContents.executeJavaScript('document.body.innerText === ""').catch(()=>false),'disconnect blank');
  occlusion.disconnectBlankMs=Date.now()-disconnectAt;const disconnectedPixels=await transparentPixels(output);assert.equal(disconnectedPixels.visible,0);cover.destroy();
  const report={passed:true,checks:['private controller only','PKCE secrets absent from renderer','control/display separate preload and origin','cross-topic rejected','grant creation forbidden by generic IPC','initial blank','approval stays blank','manual show','original body absent from output','revocation blanks','reload requires fresh show','disconnect blanks','removed platform and copy-link bridge methods absent','standalone status contract','code arguments ignored and every fetch restricted to the connected website','65 second complete occlusion preserves display polling','web hide clears occluded DOM and transparent compositor','main-process watchdog recovers a frozen renderer within lease','renderer recovery requires a fresh manual show'],occlusion,consoleErrors:errors,requestCount:network.length};
  await fs.writeFile(path.join(results,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  app.exit(0);
}
run().catch(error=>{console.error(error);app.exit(1);});
