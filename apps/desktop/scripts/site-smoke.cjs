// Real local Next.js adapters only; run via run-site-smoke.cjs. No mock server.
const { app, BrowserWindow, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = process.env.WINDCHIME_SITE_SMOKE_DIRECTORY;
const password = process.env.WINDCHIME_SMOKE_PASSWORD;
const phase = process.env.WINDCHIME_SITE_SMOKE_PHASE;
const displayTitle=process.env.WINDCHIME_SMOKE_DISPLAY_TITLE || 'WindChime Display';
assert(/^[A-Za-z0-9 -]{1,80}$/.test(displayTitle),'Use a plain fixture-only display window title');
if (!root || !password || process.env.WINDCHIME_SMOKE_ALLOW_WRITES !== '1' || !['first','restart'].includes(phase)) throw Error('Explicit disposable localhost fixture configuration required');
function testOrigin(value) {
  const url=new URL(value);
  assert(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'Only disposable loopback HTTP sites are allowed');
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname==='/', 'Use a plain local website origin');
  return url.origin;
}
const siteOrigins={UliUli:testOrigin(process.env.WINDCHIME_SMOKE_ULIULI_ORIGIN || 'http://localhost:3011'),Mia:testOrigin(process.env.WINDCHIME_SMOKE_MIA_ORIGIN || 'http://localhost:3012')};
const allowedOrigins=new Set(Object.values(siteOrigins));
assert.equal(allowedOrigins.size,2,'Two independent local sites are required');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks=[],observations=[],displayOpenCounts=new Map(),requestCounts=new Map(),blockedRequests=[];let control,manifest;
const report = value => console.log(JSON.stringify(value));
function networkObservation(){assert.deepEqual(blockedRequests,[],'No unexpected network attempts may be hidden by error handling');return {origins:Object.fromEntries(requestCounts),blockedRequests};}
async function until(check,label,timeout=15000) { const start=Date.now();while(Date.now()-start<timeout){if(await Promise.race([check(),delay(800).then(()=>false)]))return;await delay(100);}throw Error(`Timed out: ${label}`); }
async function api(origin,relative,method='GET',body,admin=true){
  assert(allowedOrigins.has(origin));
  const response=await fetch(origin+relative,{method,headers:{...(admin?{'x-mail-password':password}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error'});
  const value=await response.json();assert(response.ok,`${method} ${relative}: ${response.status} ${value.error||''}`);return value;
}
async function invoke(method,...args){const result=await control.webContents.executeJavaScript(`window.windchimeDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);assert(result.ok,result.error);return result.data;}
async function refreshUi(){control.webContents.reload();await until(()=>control.webContents.executeJavaScript('!!window.windchimeDesktop && document.body.innerText.includes("风铃桌面控制台")').catch(()=>false),'private reload');}
const webState=fixture=>api(fixture.origin,`/api/mail/live/control/state?topicId=${fixture.topicId}`);
async function command(fixture,side,action,messageId,more={}){
  const before=side==='desktop'?await invoke('request',{path:'/control/state',method:'GET'}):await webState(fixture);
  const message=before.messages.find(m=>m.id===messageId);
  const body={topicId:fixture.topicId,action,messageId,expectedRevision:before.revision,expectedDraftRevision:message?.draftRevision,operationId:randomUUID(),...more};
  return side==='desktop'?invoke('request',{path:'/control/action',method:'POST',body}):api(fixture.origin,'/api/mail/live/control/action','POST',body);
}
function output(){return BrowserWindow.getAllWindows().find(window=>window.getTitle()===displayTitle);}
async function closedOutput(previous,label){
  const returnedAt=Date.now();
  assert(control&&!control.isDestroyed()&&control.getTitle().includes('私人控制台'),'fixture title override must never rename the private controller');
  assert.notEqual(previous,control,'only the independent display may be closed');
  const current=output();
  assert(!current||current===previous,'switch cannot create an unrequested replacement output');
  if(previous&&!previous.isDestroyed())assert.equal(previous.isVisible(),false,`${label}: old native window must already be hidden when switching returns`);
  let shownAgain=false;const onShow=()=>{shownAgain=true;};previous?.on('show',onShow);
  try {
    await until(()=>{
      assert.equal(shownAgain,false,`${label}: old output must not reappear while closing`);
      if(previous&&!previous.isDestroyed())assert.equal(previous.isVisible(),false,`${label}: lingering native output must stay hidden`);
      return (!previous||previous.isDestroyed())&&!output();
    },`${label}: native closed event`,5000);
  } finally { previous?.removeListener('show',onShow); }
  return {nativeHiddenOnReturn:true,nativeClosedAfterReturnMs:Date.now()-returnedAt};
}
const blankExpression='document.body.innerText === "" && !document.querySelector("[data-windchime-snapshot], img")';
async function blankOutput(label){await until(()=>!output()||output().webContents.executeJavaScript(blankExpression).catch(()=>true),label);}
const openCount=fixture=>displayOpenCounts.get(fixture.origin)??0;
async function freshReceiver(fixture,before,label){await until(()=>openCount(fixture)>before,label,5000);}
async function displayed(fixture,text,{image=false,caption=''}={}){
  await until(()=>output()?.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(text)}) && ${image?`Array.from(document.images).some(img=>img.complete && img.naturalWidth===24 && img.naturalHeight===18 && img.alt===${JSON.stringify(caption)})`:'true'}`).catch(()=>false),`${fixture.name}: reviewed content${image?' and decoded image':''}`);
  const textNow=await output().webContents.executeJavaScript('document.body.innerText');
  assert(!textNow.includes('PRIVATE_'),'unreviewed source text never enters the output');
  assert(!textNow.includes('合成粉丝'),'only the reviewed nickname enters the output');
}
async function uploadImage(fixture,messageId){
  const bytes=await fs.readFile(fixture.imagePath);
  const result=await control.webContents.executeJavaScript(`window.windchimeDesktop.upload({messageId:${JSON.stringify(messageId)},fileName:'synthetic.png',mimeType:'image/png',bytes:Uint8Array.from(${JSON.stringify([...bytes])})})`);
  assert(result.ok,result.error);assert.equal(result.data.mimeType,'image/webp');assert.equal(result.data.width,24);assert.equal(result.data.height,18);
  return result.data;
}
async function measuredHide(fixture,side){
  const window=output();assert(window&&!window.isDestroyed());
  assert(await window.webContents.executeJavaScript('!!document.querySelector("[data-windchime-snapshot]")'),'measure hide only while a reviewed snapshot is visible');
  let nativeHiddenAt,hiddenAt;
  const onHidden=()=>{nativeHiddenAt??=Date.now();};
  const onDocument=()=>{void window.webContents.executeJavaScript(`({blank:${blankExpression},at:Date.now()})`).then(value=>{if(value.blank&&hiddenAt===undefined)hiddenAt=value.at;}).catch(()=>{});};
  window.on('hide',onHidden);window.webContents.on('did-finish-load',onDocument);
  const beforeOpen=openCount(fixture),commandAt=Date.now();
  try {
    if(side==='desktop')await invoke('hide');else await command(fixture,'web','hide');
    const responseAt=Date.now();
    await until(()=>typeof hiddenAt==='number',`${fixture.name}: ${side} replacement document blank observation`,4000);
    const result={side,responseToBlankMs:Math.max(0,hiddenAt-responseAt),blankBeforeResponse:hiddenAt<=responseAt,commandToBlankMs:hiddenAt-commandAt,nativeHideMs:nativeHiddenAt-commandAt};
    await freshReceiver(fixture,beforeOpen,'new receiver after native hide');
    assert.equal((await webState(fixture)).current,null);
    return result;
  } finally { window.removeListener('hide',onHidden);window.webContents.removeListener('did-finish-load',onDocument); }
}
async function prepare(){
  const runId=randomUUID().slice(0,8),fixtures=[];
  for(const [name,origin] of Object.entries(siteOrigins)){
    const imagePath=path.join(root,`synthetic-${name}.png`);
    await require('sharp')({create:{width:24,height:18,channels:4,background:name==='UliUli'?'#ee6699':'#6699ee'}}).png().toFile(imagePath);
    for(const suffix of ['A','B']){
    const slug=`desktop-${runId}-${name.toLowerCase()}-${suffix.toLowerCase()}`;
    const topic=await api(origin,'/api/mail/topics','POST',{slug,title:`桌面验收 ${runId} ${name} ${suffix}`});
    const fixture={origin,topicId:topic.id,slug,imagePath,name:`${name}-${suffix}`,marker:`APPROVED_${runId}_${name}_${suffix}`};
    for(let i=1;i<=2;i++)await api(origin,'/api/mail/messages','POST',{topicSlug:slug,text:`PRIVATE_${runId}_${name}_${suffix}_${i}`,nickname:`合成粉丝 ${i}`,senderFingerprint:randomUUID()},false);
    fixture.messageIds=(await webState(fixture)).messages.map(m=>m.id);fixtures.push(fixture);
    }
  }
  manifest={runId,fixtures};await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
}
async function exercise(fixture){
  await refreshUi();await until(()=>control.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(`PRIVATE_${manifest.runId}`)})`).catch(()=>false),'private source');
  const opening=openCount(fixture);await invoke('openDisplay');await freshReceiver(fixture,opening,'fresh receiver opened');await blankOutput('fresh receiver blank');
  const first=fixture.messageIds[0],second=fixture.messageIds[1],original=await webState(fixture);
  const sourceBefore=structuredClone(original.messages.find(m=>m.id===first).source);
  const asset=await uploadImage(fixture,first),caption=`已审核图片 ${fixture.name}`;
  const draft={...original.messages.find(m=>m.id===first).draft,text:fixture.marker,nickname:'已审核昵称',assets:[{id:asset.id,caption}]};
  await command(fixture,'web','draft',first,{draft});await command(fixture,'web','approve',first);
  await until(()=>control.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(fixture.marker)})`).catch(()=>false),'web to desktop sync');
  await delay(1100);await blankOutput('approval is not playback');
  await command(fixture,'web','draft',second,{draft:{...original.messages.find(m=>m.id===second).draft,text:fixture.marker+'_SECOND',nickname:'第二封已审昵称'}});
  await command(fixture,'desktop','approve',second);await command(fixture,'desktop','show',first);
  await displayed(fixture,fixture.marker,{image:true,caption});
  assert.equal((await webState(fixture)).current.messageId,first);
  assert.deepEqual((await webState(fixture)).messages.find(m=>m.id===first).source,sourceBefore,'private source is unchanged by reviewed text and image');
  await invoke('request',{path:'/control/message',method:'POST',body:{topicId:fixture.topicId,messageId:first,isRead:true,isFavorited:true}});
  const marked=(await webState(fixture)).messages.find(m=>m.id===first);assert(marked.isRead&&marked.isFavorited);
  await command(fixture,'desktop','reorder',undefined,{order:[second,first]});assert.deepEqual((await webState(fixture)).queue,[second,first]);
  const webHide=await measuredHide(fixture,'web');
  await command(fixture,'desktop','show',first);await displayed(fixture,fixture.marker,{image:true,caption});
  const desktopHide=await measuredHide(fixture,'desktop');
  await command(fixture,'desktop','show',first);await displayed(fixture,fixture.marker,{image:true,caption});
  await command(fixture,'web','revoke',first);await blankOutput('web revocation blanks desktop');
  await command(fixture,'desktop','approve',first);await delay(1100);await blankOutput('reapproval remains blank');
  await command(fixture,'desktop','show',first);await displayed(fixture,fixture.marker,{image:true,caption});
  const editedCaption=caption+' · 修改后重新审核';
  await command(fixture,'web','draft',first,{draft:{...draft,text:fixture.marker+'_EDITED',assets:[{id:asset.id,caption:editedCaption}]}});await blankOutput('caption and body editing require reapproval');
  assert.equal((await webState(fixture)).messages.find(m=>m.id===first).status,'pending');
  assert.deepEqual((await webState(fixture)).messages.find(m=>m.id===first).source,sourceBefore);
  await command(fixture,'desktop','approve',first);await delay(1100);await blankOutput('reapproval stays blank');
  await command(fixture,'desktop','reorder',undefined,{order:[second,first]});
  const endOpening=openCount(fixture);await command(fixture,'desktop','end');await freshReceiver(fixture,endOpening,'new receiver after end');await blankOutput('end blank');
  await command(fixture,'desktop','next');await displayed(fixture,fixture.marker+'_SECOND');
  await command(fixture,'desktop','next');await displayed(fixture,fixture.marker+'_EDITED',{image:true,caption:editedCaption});
  await command(fixture,'desktop','next');await blankOutput('queue end does not loop');
  await command(fixture,'desktop','next');await delay(1100);await blankOutput('repeated next at the end remains blank');
  const retained=await webState(fixture);assert.deepEqual(retained.queue,[second,first]);
  const retainedFirst=retained.messages.find(m=>m.id===first);assert(retainedFirst.isRead&&retainedFirst.isFavorited&&retainedFirst.status==='approved');
  const endAgain=openCount(fixture);await command(fixture,'desktop','end');await freshReceiver(fixture,endAgain,'new receiver after second end');await blankOutput('end retains blank');
  const beforeStale=await webState(fixture);
  await command(fixture,'web','appearance',undefined,{appearance:{fontSize:beforeStale.appearance.fontSize===32?34:32}});
  const beforeRejected=await webState(fixture);
  const staleBody={topicId:fixture.topicId,action:'show',messageId:first,expectedRevision:beforeStale.revision,operationId:randomUUID()};
  const rejected=await control.webContents.executeJavaScript(`window.windchimeDesktop.request({path:'/control/action',method:'POST',body:${JSON.stringify(staleBody)}})`);
  assert.equal(rejected.ok,false);assert.equal(rejected.status,409);assert.equal(rejected.code,'REVISION_CONFLICT');
  const afterRejected=await webState(fixture);
  for(const field of ['revision','messages','queue','appearance','current'])assert.deepEqual(afterRejected[field],beforeRejected[field],`stale command cannot change ${field}`);
  await blankOutput('stale show cannot display anything');
  await command(fixture,'desktop','show',first);await displayed(fixture,fixture.marker+'_EDITED',{image:true,caption:editedCaption});
  observations.push({fixture:fixture.name,topicId:fixture.topicId,image:{mimeType:asset.mimeType,width:asset.width,height:asset.height},hide:[webHide,desktopHide],staleCommand:{status:rejected.status,code:rejected.code},retainedQueue:afterRejected.queue,sourcePreserved:true});
  checks.push(`${fixture.name}: real private source, main-process image upload/decoded output, web-desktop sync, approve blank, flags/order, measured web/desktop hide, revoke, caption reapproval, next/end retention and stale revision rejection`);
}
async function firstRun(){
  await prepare();
  for(const fixture of manifest.fixtures){
    const pair=await invoke('pair',{origin:fixture.origin,label:`验收 ${manifest.runId} ${fixture.name}`});
    assert.deepEqual(Object.keys(pair).sort(),['expiresAt','id','userCode']);fixture.pairingId=pair.id;
    report({approvalNeeded:true,name:fixture.name,userCode:pair.userCode,topicId:fixture.topicId,url:`${fixture.origin}/mail/live?userCode=${encodeURIComponent(pair.userCode)}&topicId=${fixture.topicId}`});
  }
  for(const fixture of manifest.fixtures){
    const previousOutput=output();let paired;
    await until(async()=>{paired=await invoke('pairingStatus',fixture.pairingId);if(paired.status==='pending'){await delay(1900);return false;}return paired.status==='approved';},`browser approval ${fixture.name}`,600000);
    fixture.connectionId=paired.site.id;assert.equal(paired.site.topicId,fixture.topicId);assert(!('token' in paired.site));
    const closed=await closedOutput(previousOutput,`pairing ${fixture.name}`);
    if(manifest.fixtures.indexOf(fixture)>0){const previous=manifest.fixtures[manifest.fixtures.indexOf(fixture)-1];assert.equal((await webState(previous)).current,null);}
    const cross=await control.webContents.executeJavaScript(`window.windchimeDesktop.request({path:'/control/state?topicId=other',method:'GET'})`);assert.equal(cross.ok,false);
    await exercise(fixture);
    observations.at(-1).previousOutput=closed;
    await fs.writeFile(path.join(root,'progress-report.json'),JSON.stringify({passedFixtures:observations},null,2));
    report({phase:'first',stage:'fixture-complete',name:fixture.name,observation:observations.at(-1)});
  }
  const first=manifest.fixtures[0],last=manifest.fixtures.at(-1);
  const previousOutput=output();await invoke('selectSite',first.connectionId);await closedOutput(previousOutput,'explicit cross-site switch');assert.equal((await webState(last)).current,null);
  await refreshUi();await invoke('openDisplay');await delay(1200);await blankOutput('cross-site switch blank');
  const retained=await webState(first);manifest.restart={connectionId:first.connectionId,topicId:first.topicId,origin:first.origin,queue:retained.queue,messageId:first.messageIds[0]};
  await command(first,'desktop','show',first.messageIds[0]);await until(()=>output()?.webContents.executeJavaScript('document.body.innerText.length > 0').catch(()=>false),'active before process exit');
  checks.push('four browser-approved PKCE connections preserve topic scope; pairing and explicit cross-site switches blank');
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
  const network=networkObservation();
  await fs.writeFile(path.join(root,'first-report.json'),JSON.stringify({passed:true,checks,observations,network},null,2));
  report({phase:'first',passed:true,checks,observations,network,root});
  // Deliberate crash-style exit: server current stays active. Restart must not replay it.
  app.exit(0);
}
async function restartRun(){
  manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  const sites=await invoke('sites');assert.equal(sites.items.length,4);assert.equal(sites.selectedId,manifest.restart.connectionId);assert.equal(output(),undefined);
  const fixture=manifest.fixtures[0],state=await webState(fixture);assert.deepEqual(state.queue,manifest.restart.queue);assert.equal(state.messages.find(m=>m.id===manifest.restart.messageId).status,'approved');
  // Control current intentionally disappears when all old receivers expire.
  // Keep an independent authorized receiver active to make the stronger check:
  // a fresh desktop output must stay blank even while another output is playing.
  const observerGrant=await api(fixture.origin,'/api/mail/live/control/grants','POST',{topicId:fixture.topicId,kind:'display',label:'Restart fixture observer'});
  const observe=async(relative,method='GET',body)=>{
    const response=await fetch(fixture.origin+'/api/mail/live'+relative,{method,headers:{authorization:`Bearer ${observerGrant.token}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    assert(response.ok);return response.json();
  };
  const receiver=await observe('/display/open','POST',{});
  await command(fixture,'web','show',manifest.restart.messageId);
  assert.equal((await observe('/display/frame?receiverId='+receiver.receiverId)).snapshot.messageId,manifest.restart.messageId);
  const keepAlive=setInterval(()=>void observe('/display/frame?receiverId='+receiver.receiverId).catch(()=>{}),1000);
  await invoke('openDisplay');await delay(1300);await blankOutput('independent restarted process must not replay active snapshot');
  await command(fixture,'desktop','show',manifest.restart.messageId);await until(()=>output()?.webContents.executeJavaScript('document.body.innerText.length > 0').catch(()=>false),'restart manual show');
  await command(fixture,'web','hide');await blankOutput('web hide after restart');clearInterval(keepAlive);
  for(const item of manifest.fixtures){const grants=await api(item.origin,`/api/mail/live/control/grants?topicId=${item.topicId}`);for(const grant of grants.items)if(!grant.revokedAt)await api(item.origin,`/api/mail/live/control/grants/${grant.id}?topicId=${item.topicId}`,'DELETE');}
  checks.push('second Electron process reuses encrypted vault and four scoped connections','approval/order preserved across actual process exit','startup has no output; fresh output blank despite server active snapshot','manual show and web hide after restart','test-created grants revoked; synthetic topics retained for review');
  const result={phase:'restart',passed:true,checks,network:networkObservation(),root};await fs.writeFile(path.join(root,'restart-report.json'),JSON.stringify(result,null,2));report(result);app.exit(0);
}
async function run(){
  app.setPath('userData',path.join(root,'user-data'));await fs.mkdir(path.join(root,'user-data'),{recursive:true});
  app.on('browser-window-created',(_event,window)=>{
    if(window.getTitle()!=='WindChime Display')return;
    window.setTitle(displayTitle);
    window.webContents.on('page-title-updated',event=>{event.preventDefault();window.setTitle(displayTitle);});
  });
  // Capture launch URLs for the coordinating browser task; never auto-approve devices.
  shell.openExternal=async value=>{const url=new URL(value);assert(allowedOrigins.has(url.origin)&&url.pathname==='/mail/live'&&url.searchParams.has('userCode'));};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url);
    try {
      assert(allowedOrigins.has(url.origin),'Desktop must not contact a gateway, Bilibili, or any unconfigured host');
      assert(url.pathname.startsWith('/api/mail/')&&!/\/(gateway|binding-challenge|bind)(\/|$)/.test(url.pathname),'Only website mailbox APIs are expected');
      assert(!new Headers(options?.headers).has('x-windchime-platform-lease'));
    } catch(error) { blockedRequests.push(url.origin+url.pathname);throw error; }
    requestCounts.set(url.origin,(requestCounts.get(url.origin)??0)+1);
    const response=await originalFetch(input,options);
    if(response.ok&&url.pathname==='/api/mail/live/display/open'&&options?.method==='POST')displayOpenCounts.set(url.origin,(displayOpenCounts.get(url.origin)??0)+1);
    return response;
  };
  require('../main.cjs');await app.whenReady();await until(()=>{control=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('私人控制台'));return !!control;},'controller');
  await until(()=>control.webContents.executeJavaScript('!!window.windchimeDesktop').catch(()=>false),'preload');
  if(phase==='first')await firstRun();else await restartRun();
}
run().catch(async error=>{report({phase,passed:false,error:error.stack});app.exit(1);});
