// Real localhost websites, browser-created keys, two independent Electron processes.
// Keys travel only in memory over loopback/IPC; reports and argv never contain them.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parseWindChimeConnectionKey, encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');
const password = process.env.WINDCHIME_SMOKE_PASSWORD;
assert(password && process.env.WINDCHIME_SMOKE_ALLOW_WRITES === '1', 'Disposable fixtures require explicit opt-in');
function localOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert(url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password);
  return url.origin;
}
const origins = [localOrigin(process.env.WINDCHIME_SMOKE_ULIULI_ORIGIN), localOrigin(process.env.WINDCHIME_SMOKE_MIA_ORIGIN)];
assert.notEqual(...origins);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let directory, server, stage = 'preparing', fixtures = [], actors = [], result;
const keys = new Map(), checks = [], observations = [];
const cookies = new Map();
let fanSequence = 0;
const report = value => console.log(JSON.stringify(value));
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now()-start < timeout) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
async function api(fixture, relative, method = 'GET', body, token, admin = token === undefined) {
  const response = await fetch(fixture.origin + '/api/mail/' + relative, { method, redirect:'error', headers:{ ...(admin?{cookie:cookies.get(fixture.origin)||''}:{}), ...(!admin&&!token?{'x-real-ip':`198.18.${Math.floor(Date.now()/1000)%250}.${++fanSequence%250}`} : {}), ...(token?{authorization:`Bearer ${token}`} : {}), ...(body===undefined?{}:{'content-type':'application/json'}) }, body:body===undefined?undefined:JSON.stringify(body) });
  const value = await response.json(); return { status:response.status, ok:response.ok, value };
}
async function admin(fixture, relative, method, body) {
  const result = await api(fixture, relative, method, body); assert(result.ok, `Fixture API ${method||'GET'} ${relative}: ${result.status}`); return result.value;
}
const webState = f => admin(f, 'live/control/state?topicId='+f.topicId);
async function command(f, actor, action, messageId, extra={}) {
  const state = actor ? await actor.call('request',{path:'/control/state',method:'GET'}) : await webState(f);
  const message = state.messages.find(m=>m.id===messageId);
  const body = {topicId:f.topicId, action, messageId, expectedRevision:state.revision, expectedDraftRevision:message?.draftRevision, operationId:randomUUID(), ...extra};
  return actor ? actor.call('request',{path:'/control/action',method:'POST',body}) : admin(f,'live/control/action','POST',body);
}
async function startActor(name) {
  await fs.mkdir(path.join(directory,name),{recursive:true});
  const child = spawn(require('electron'),[path.join(__dirname,'key-smoke-child.cjs')],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,WINDCHIME_KEY_SMOKE_USER_DATA:path.join(directory,name),WINDCHIME_KEY_SMOKE_ACTOR:name}});
  const pending = new Map(); let ready = false;
  child.on('message',message=>{
    if ('ready' in message) { ready=message.ready; return; }
    const request=pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
    message.ok ? request.resolve(message.value) : request.reject(Error(`Desktop ${name}: ${message.command} failed (${message.error})`));
  });
  child.on('exit',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error(`Desktop ${name} exited`));}pending.clear();});
  const actor = { name, child, send(command,more={}) { return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Desktop ${name}: ${command} timeout`));},20000);pending.set(id,{resolve,reject,timer});child.send({id,command,...more});}); }, async call(method,...args) { const value=await this.send('invoke',{method,args});assert(value.ok,`Desktop ${name} ${method}: ${value.code||'failed'}`);return value.data; } };
  actors.push(actor); await until(()=>ready,`desktop ${name} ready`,20000); return actor;
}
async function prepare() {
  for(const [index,origin] of origins.entries()) {
    const response=await fetch(origin+(index===0?'/api/mail/session':'/api/auth/session'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password,...(index?{scope:'mail'}:{})})});
    assert(response.ok,'fixture website login '+response.status);
    cookies.set(origin,response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '));
  }
  const runId = randomUUID().slice(0,8);
  for (const [index,origin] of origins.entries()) for (const suffix of ['A','B']) {
    const site=index===0?'UliUli':'Mia', name=`${site}-${suffix}`;
    const slug=`keys-${runId}-${name.toLowerCase()}`;
    const topic=await admin({origin},'topics','POST',{slug,title:`密钥验收 ${runId} ${name}`});
    const fixture={origin,topicId:topic.id,slug,name,label:`密钥验收 ${runId} ${name}`,marker:`REVIEWED_${runId}_${name}`};
    for(let i=1;i<=2;i++){const posted=await api(fixture,'messages','POST',{topicSlug:slug,text:`PRIVATE_${name}_${i}`,nickname:'合成粉丝',senderFingerprint:randomUUID()},undefined,false);assert(posted.ok,`Synthetic fan submission: ${posted.status} ${posted.value.code||''}`);}
    fixture.messageIds=(await webState(fixture)).messages.map(m=>m.id); fixtures.push(fixture);
  }
  await fs.writeFile(path.join(directory,'fixtures.json'),JSON.stringify(fixtures,null,2));
  server=http.createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');
    try {
      if(req.method==='GET'&&req.url==='/fixtures'){res.end(JSON.stringify({stage,fixtures,received:[...keys.keys()]}));return;}
      if(req.method==='POST'&&req.url==='/key' && !req.headers.origin) {
        let body='';for await (const chunk of req){body+=chunk;if(body.length>8192)throw Error('size');}
        const {name,key}=JSON.parse(body);const f=fixtures.find(f=>f.name===name);assert(f);
        const decoded=parseWindChimeConnectionKey(key);assert.equal(decoded.origin,f.origin);
        keys.set(name,key);res.end('{"accepted":true}');return;
      }
      res.statusCode=404;res.end('{}');
    }catch {res.statusCode=400;res.end('{"error":"Invalid fixture transfer"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  stage='awaiting-browser-keys';
  report({directory,fixtureBridge:`http://127.0.0.1:${server.address().port}`,stage,fixtures});
  await until(()=>keys.size===fixtures.length,'real browser key generation',900000);
}
async function blank(actor,label) { await until(async()=> (await actor.send('output')).blank,label,4000); }
async function visible(actor,text) { await until(async()=>{const output=await actor.send('output');return !output.blank&&output.text.includes(text);},'reviewed output',8000);const output=await actor.send('output');assert(!output.text.includes('PRIVATE_')&&!output.text.includes('合成粉丝'));return output; }
async function exercise(f,a,b,index) {
  stage=`exercising-${f.name}`;
  const key=keys.get(f.name), decoded=parseWindChimeConnectionKey(key);
  const selectedBefore=(await a.call('sites')).selectedId;
  await a.send('import-ui',{key});let firstSites=await a.call('sites');
  assert.equal(firstSites.items.length,index+1);let selected=firstSites.items.find(i=>i.id===firstSites.selectedId);assert.equal(selected.topicId,null);assert.equal(selected.scope,'site');
  await a.send('select-topic-ui',{topicId:f.topicId});firstSites=await a.call('sites');selected=firstSites.items.find(i=>i.id===firstSites.selectedId);assert.equal(selected.selectedTopicId,f.topicId);
  assert(!('token' in selected));
  await a.send('import-ui',{key});assert.deepEqual(await a.call('sites'),firstSites,'same key reuses connection without expiry extension');
  if(selectedBefore)await until(async()=>!(await a.send('output')).exists,'switch closes old native output',5000);
  await b.send('import-ui',{key});assert.equal((await b.call('sites')).items.length,index+1);
  await b.send('select-topic-ui',{topicId:f.topicId});
  assert((await a.send('private')).secretFieldEmpty);assert.equal((await a.send('private')).hasStoredCredential,false);
  for(const actor of [a,b]) {await actor.call('openDisplay');await blank(actor,'new output blank');}
  await pause(900);
  const [first,second]=f.messageIds;
  const original=(await webState(f)).messages.find(m=>m.id===first).source;
  const rejected=await a.send('invoke',{method:'request',args:[{path:'/control/action',method:'POST',body:{topicId:f.topicId,action:'show',messageId:first,expectedRevision:(await webState(f)).revision,operationId:randomUUID()}}]});assert.equal(rejected.ok,false);
  const bytes=await require('sharp')({create:{width:24,height:18,channels:4,background:'#72d7ce'}}).png().toBuffer();
  const asset=await a.call('upload',{messageId:first,fileName:'synthetic.png',mimeType:'image/png',bytes:[...bytes]});
  assert.equal(asset.mimeType,'image/webp');
  const draft={text:f.marker,nickname:'已审称呼',linkUrl:null,assets:[{id:asset.id,caption:'已审图片'}]};
  await command(f,null,'draft',first,{draft});await command(f,null,'approve',first);
  await pause(1000);for(const actor of [a,b])await blank(actor,'approve does not play');
  await command(f,null,'draft',second,{draft:{...draft,text:f.marker+'_SECOND',assets:[]}});await command(f,b,'approve',second);
  await command(f,a,'show',first);
  for(const actor of [a,b]){const output=await visible(actor,f.marker);assert(output.images.some(i=>i.width===24&&i.height===18&&i.alt==='已审图片'));}
  const bad=await a.send('invoke',{method:'importKey',args:['not-a-key']});assert.equal(bad.ok,false);assert.equal((await a.call('sites')).selectedId,selected.id);await visible(a,f.marker);
  await a.call('request',{path:'/control/message',method:'POST',body:{topicId:f.topicId,messageId:first,isRead:true,isFavorited:true}});
  await command(f,a,'reorder',undefined,{order:[second,first]});
  const before=Date.now();await a.call('hide');const response=Date.now();for(const actor of [a,b])await blank(actor,'hide blanks both');
  const hide={responseToBlankMs:Date.now()-response,commandToBlankMs:Date.now()-before};assert(hide.responseToBlankMs<=1000);
  await pause(800);await command(f,a,'show',first);for(const actor of [a,b])await visible(actor,f.marker);
  await command(f,null,'draft',first,{draft:{...draft,text:f.marker+'_EDIT',assets:[{id:asset.id,caption:'修改图片说明'}]}});for(const actor of [a,b])await blank(actor,'edit invalidates');
  assert.equal((await webState(f)).messages.find(m=>m.id===first).status,'pending');await command(f,b,'approve',first);for(const actor of [a,b])await blank(actor,'reapproval blank');
  // A dirty private draft survives an independent update and reports conflict.
  await a.send('draft-input',{text:'未保存的本机草稿',source:original.text});
  const stateForConflict=await webState(f), currentDraft=stateForConflict.messages.find(m=>m.id===first).draft;
  await command(f,b,'draft',first,{draft:{...currentDraft,text:f.marker+'_CONFLICT'}});
  await until(async()=> (await a.send('private')).text.includes('其他控制端更新'), 'live poll reports other editor conflict', 6000);
  assert.equal(await a.send('draft-value'),'未保存的本机草稿');
  await command(f,null,'approve',first);await command(f,null,'reorder',undefined,{order:[second,first]});await command(f,a,'end');await pause(900);
  await command(f,a,'next');for(const actor of [a,b])await visible(actor,f.marker+'_SECOND');
  await command(f,a,'next');for(const actor of [a,b])await visible(actor,f.marker+'_CONFLICT');
  await command(f,a,'next');for(const actor of [a,b])await blank(actor,'queue ends blank');
  const retained=await webState(f);assert.deepEqual(retained.queue,[second,first]);const message=retained.messages.find(m=>m.id===first);assert(message.isRead&&message.isFavorited);assert.deepEqual(message.source,original);
  const otherTopic=fixtures.find(other=>other.origin===f.origin&&other.topicId!==f.topicId);
  assert.equal((await api(f,'live/control/state?topicId='+otherTopic.topicId,'GET',undefined,decoded.token)).status,200,'site key includes other topics');
  const legacy=await admin(f,'live/control/grants','POST',{topicId:f.topicId,kind:'control',label:'legacy topic isolation fixture'});
  assert.equal((await api(f,'live/control/state?topicId='+otherTopic.topicId,'GET',undefined,legacy.token)).status,403);
  await admin(f,`live/control/grants/${legacy.id}?topicId=${f.topicId}`,'DELETE');
  assert.equal((await api({origin:origins.find(o=>o!==f.origin)},'live/control/identity','GET',undefined,decoded.token)).status,401);
  const identity=await api(f,'live/control/identity','GET',undefined,decoded.token);assert(identity.ok);f.grantId=identity.value.grantId;
  assert.equal((await api(f,'live/control/grants','POST',{topicId:f.topicId,kind:'control',label:'forbidden'},decoded.token)).status,403);
  await command(f,a,'show',first);for(const actor of [a,b])await visible(actor,f.marker+'_CONFLICT');
  await a.send('reload-output');await pause(1100);await blank(a,'refresh must not replay');
  await command(f,b,'show',first);for(const actor of [a,b])await visible(actor,f.marker+'_CONFLICT');
  checks.push(`${f.name}: browser key -> two desktop forms; repeat import; reviewed image; approve blank; show/hide/next; edit and dirty conflict; scope; refresh blank; flags/order preserved`);
  observations.push({name:f.name,hide,scope:{siteKeyOtherTopic:200,legacyKeyOtherTopic:403,crossSite:401},processes:[a.child.pid,b.child.pid]});
  report({stage,passed:true,name:f.name,hide});
}
async function run() {
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'windchime-key-smoke-'));await prepare();
  let a=await startActor('A'),b=await startActor('B');
  for(const [index,f] of fixtures.entries())await exercise(f,a,b,index);
  const f=fixtures.at(-1),key=keys.get(f.name),decoded=parseWindChimeConnectionKey(key);
  await a.send('crash');await until(()=>a.child.exitCode!==null,'first process exit');a=await startActor('A');
  assert.equal((await a.call('sites')).items.length,4);assert(!(await a.send('output')).exists);
  await a.call('openDisplay');await pause(1100);await blank(a,'actual restarted process blank while second process remains live');
  await command(f,b,'show',f.messageIds[0]);for(const actor of [a,b])await visible(actor,f.marker+'_CONFLICT');
  // A legacy topic key must remain useful after 0.7.0. In particular, ordinary
  // polling must not call site-only settings and accidentally blank its display.
  const oldGrant=await admin(f,'live/control/grants','POST',{topicId:f.topicId,kind:'control',label:'legacy compatibility actor'});
  const oldKey=encodeWindChimeConnectionKey({origin:f.origin,siteId:decoded.siteId,token:oldGrant.token});
  await a.send('import-ui',{key:oldKey});
  const oldConnection=(await a.call('sites')).items.find(item=>item.scope==='topic'&&item.topicId===f.topicId);assert(oldConnection);
  await a.call('openDisplay');await pause(1000);await command(f,a,'show',f.messageIds[0]);
  await a.send('focus');
  const networkStart=(await a.send('network')).length;
  await pause(7200);await visible(a,f.marker+'_CONFLICT');
  const oldRequests=(await a.send('network')).slice(networkStart);
  assert(!oldRequests.some(r=>r.path.endsWith('/control/settings')),'legacy topic key must not request site settings');
  assert(oldRequests.filter(r=>r.path.endsWith('/control/messages')).length>=2,'at least two actual legacy ordinary-data polls');
  await a.send('import-ui',{key});await a.call('openDisplay');await pause(1000);await command(f,a,'show',f.messageIds[0]);for(const actor of [a,b])await visible(actor,f.marker+'_CONFLICT');
  await admin(f,`live/control/grants/${oldGrant.id}?topicId=${f.topicId}`,'DELETE');
  checks.push('legacy topic key displays for 7.2 seconds across at least two management polls without requesting site settings');
  const unrelated=await admin(f,'live/control/grants','POST',{topicId:f.topicId,kind:'control',label:'unrelated fixture key'});
  stage='awaiting-browser-revocation';report({stage,name:f.name,label:f.label,origin:f.origin,topicId:f.topicId});
  await until(async()=> (await api(f,'live/control/identity','GET',undefined,decoded.token)).status===401,'browser revokes shared key',900000);
  for(const actor of [a,b]) {await blank(actor,'revoke blanks both outputs');const state=await actor.send('invoke',{method:'request',args:[{path:'/control/state',method:'GET'}]});assert.equal(state.status,401);}
  assert((await api(f,'live/control/identity','GET',undefined,unrelated.token)).ok,'other key remains valid');
  checks.push('actual encrypted vault restart stays blank while another receiver is active','browser revokes shared key: both processes lose control and output; other grant remains valid');
  stage='passed';result={passed:true,date:new Date().toISOString(),directory,checks,observations};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(result,null,2));report(result);
}
run().catch(error=>{stage='failed';report({passed:false,stage,error:error.message,directory});process.exitCode=1;}).finally(async()=>{
  for(const actor of actors)if(actor.child.exitCode===null){await actor.send('crash').catch(()=>{});}
  for(const f of fixtures)try{const grants=await admin(f,'live/control/grants');for(const grant of grants.items)if(!grant.revokedAt&&(grant.id===f.grantId||grant.topicId===f.topicId))await admin(f,`live/control/grants/${grant.id}`,'DELETE');}catch{}
  keys.clear();server?.close();
});
