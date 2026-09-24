import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,createHmac } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../src/server.mjs';
import { BilibiliClient,encodeStart,signedHeaders } from '../src/bilibili.mjs';
import { GatewayState,loadSigningKey } from '../src/state.mjs';
import { createSigner,generateSigningKey,verifyH5Launch,verifyProof } from '../src/security.mjs';

const START=1750000000;
const config={origin:'https://gateway.example',development:false,accessKey:'server-access-id',secret:'server-only-secret',h5SignSecret:'h5-secret',h5AppId:'9223372036854775807',desktopAppId:'1234567890123456'};
function signedQuery(overrides={},secret=config.h5SignSecret){
  const fields={Caller:'bilibili',Code:'alice',Mid:'123',Timestamp:String(START),...overrides};
  fields.CodeSign=createHmac('sha256',secret).update(['Caller','Code','Mid','Timestamp'].map(key=>`${key}:${fields[key]}`).join('\n')).digest('hex');
  return new URLSearchParams(fields).toString();
}
async function fixture(t,{state=new GatewayState(),clock={value:START},signingKey=generateSigningKey()}={}){
  const calls=[];const failures={};
  const client={
    async start(channel,code){calls.push({kind:'start',channel});if(failures.start)throw new Error('PRIVATE PLATFORM FAILURE');return {gameId:`game-${calls.length}`,appId:channel==='h5'?config.h5AppId:config.desktopAppId,subject:`bili:${code}`,uid:code==='wrong-mid'?'999':'123',label:'Test anchor'};},
    async heartbeat(gameId){calls.push({kind:'heartbeat',gameId});if(failures.heartbeat)throw new Error('PRIVATE PLATFORM FAILURE');},
    async end(gameId){calls.push({kind:'end',gameId});if(failures.end)throw new Error('PRIVATE PLATFORM FAILURE');}
  };
  const gateway=createGateway({config,signingKey,state,client,now:()=>clock.value});
  await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${gateway.server.address().port}`;
  t.after(()=>gateway.close());
  async function request(path,body={},token,method='POST'){
    const result=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:method==='GET'?undefined:JSON.stringify(body)});
    return {status:result.status,data:await result.json(),headers:result.headers};
  }
  return {gateway,request,calls,failures,clock,base};
}
async function boundSession(f,code='alice'){
  const session=(await f.request('/api/sessions/start',{channel:'desktop',code})).data;
  const challenge={nonce:'site-generated-private-nonce',siteId:'site-a',topicId:'topic-a',siteOrigin:'https://site.example'};
  const binding=(await f.request(`/api/sessions/${session.sessionId}/bind`,{challenge},session.sessionToken)).data;
  const completed=await f.request(`/api/pairings/${binding.pairingId}/complete`,{bindingId:binding.bindingId},binding.completionToken);
  assert.equal(completed.status,200);
  return {session,binding,challenge};
}

test('official H5 CodeSign example, expiry, signed fields and duplicate rejection',()=>{
  const sample={Timestamp:'1650012983',Code:'460803',Mid:'110000345',Caller:'bilibili',CodeSign:'8c1fa83955d83960680277122bd31fd6f209a82787d57912c1d3817487bfc2ef'};
  assert.equal(verifyH5Launch(sample,'NPRZADNURSKNGYDFMDKJOOTLQMGDHL',1650012983).code,'460803');
  assert.throws(()=>verifyH5Launch({...sample,Code:'other'},'NPRZADNURSKNGYDFMDKJOOTLQMGDHL',1650012983),/invalid_launch_signature/);
  assert.throws(()=>verifyH5Launch(sample,'NPRZADNURSKNGYDFMDKJOOTLQMGDHL',1650014000),/launch_expired/);
  const duplicate=new URLSearchParams(sample);duplicate.append('Code','attacker');
  assert.throws(()=>verifyH5Launch(duplicate,'NPRZADNURSKNGYDFMDKJOOTLQMGDHL',1650012983),/invalid_launch/);
  assert.equal(verifyH5Launch({...sample,plug_env:'1'},'NPRZADNURSKNGYDFMDKJOOTLQMGDHL',1650012983).mid,sample.Mid);
});

test('Bili exact body, int64, seconds, nonce and JSON business errors',async()=>{
  const body=encodeStart('test"\ncode','9223372036854775807');
  assert.equal(body,'{"code":"test\\\"\\ncode","app_id":9223372036854775807}');
  assert.throws(()=>encodeStart('x','9223372036854775808'),/invalid_app_id/);
  const headers=signedHeaders(body,'key','secret',1750000000,'unique-nonce');
  assert.equal(headers['x-bili-timestamp'],'1750000000');
  assert.equal(headers['x-bili-content-md5'],createHash('md5').update(body).digest('hex'));
  const canonical=Object.keys(headers).filter(key=>key.startsWith('x-bili-')).sort().map(key=>`${key}:${headers[key]}`).join('\n');
  assert.equal(headers.Authorization,createHmac('sha256','secret').update(canonical).digest('hex'));
  const seen=[];
  const client=new BilibiliClient({...config,now:()=>1750000000,fetchImpl:async(url,options)=>{seen.push({url,options});return {ok:true,json:async()=>({code:5004,message:'PRIVATE',data:{}})};}});
  await assert.rejects(()=>client.start('h5','test'),error=>error.code==='platform_rejected'&&error.platformCode===5004);
  assert.equal(seen[0].url,'https://live-open.biliapi.com/v2/app/start');
  assert.match(seen[0].options.body,/"app_id":9223372036854775807/);
  assert.equal(seen[0].options.redirect,'error');
});

test('Ed25519 proof scope, expiry and signature cannot be changed',()=>{
  const signer=createSigner(generateSigningKey(),config.origin,()=>START);
  const proof=signer.sign({kind:'display',aud:'https://site.example',siteId:'s',topicId:'t'},60);
  const opts={issuer:config.origin,audience:'https://site.example',kind:'display',now:START};
  assert.equal(verifyProof(proof,signer.publicJwk,opts).topicId,'t');
  assert.throws(()=>verifyProof(proof,signer.publicJwk,{...opts,audience:'https://attacker.example'}));
  assert.throws(()=>verifyProof(proof,signer.publicJwk,{...opts,now:START+60}));
  const parts=proof.split('.');const claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.topicId='another';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');
  assert.throws(()=>verifyProof(parts.join('.'),signer.publicJwk,opts));
});

test('H5 verifies before platform API and blocks repeated launch across persistent state',async t=>{
  const f=await fixture(t);
  f.gateway.state.data.bindings['approved-h5-binding']={bindingId:'approved-h5-binding',siteId:'site-a',topicId:'topic-a',siteOrigin:'https://site.example',siteBaseUrl:'https://site.example/api/mail/live',displayUrl:config.origin+'/display',biliSubject:'bili:alice',revoked:false};
  let result=await f.request('/api/h5/launch',{query:signedQuery({},'wrong-secret')});
  assert.equal(result.status,401);assert.equal(f.calls.length,0);
  result=await f.request('/api/h5/launch',{query:signedQuery()});assert.equal(result.status,201);
  assert.equal(result.data.channel,'h5');assert.equal(f.calls.length,1);
  result=await f.request('/api/h5/launch',{query:signedQuery()});assert.equal(result.status,401);assert.equal(result.data.error,'launch_replayed');
  assert.equal(f.calls.length,1);
  const restarted=await fixture(t,{state:new GatewayState(null,JSON.parse(JSON.stringify(f.gateway.state.data)))});
  assert.equal((await restarted.request('/api/h5/launch',{query:signedQuery()})).status,401);
  assert.equal(restarted.gateway.sessions.size,0);
});

test('H5 launch is pinned to one topic and cannot change bindings or select another display',async t=>{
  const f=await fixture(t);const {session,binding,challenge}=await boundSession(f);
  const second=(await f.request(`/api/sessions/${session.sessionId}/bind`,{challenge:{...challenge,topicId:'topic-b',nonce:'another-private-nonce'}},session.sessionToken)).data;
  await f.request(`/api/pairings/${second.pairingId}/complete`,{bindingId:second.bindingId},second.completionToken);
  const launched=await f.request('/api/h5/launch',{query:signedQuery({bindingId:binding.bindingId})});assert.equal(launched.status,201);
  const displaySession=launched.data;assert.equal(displaySession.bindings.length,1);assert.equal(displaySession.bindings[0].bindingId,binding.bindingId);
  assert.equal((await f.request(`/api/sessions/${displaySession.sessionId}/display`,{bindingId:binding.bindingId},displaySession.sessionToken)).status,200);
  assert.equal((await f.request(`/api/sessions/${displaySession.sessionId}/display`,{bindingId:second.bindingId},displaySession.sessionToken)).status,403);
  assert.equal((await f.request(`/api/sessions/${displaySession.sessionId}/bind`,{challenge},displaySession.sessionToken)).status,403);
  assert.equal((await f.request(`/api/sessions/${displaySession.sessionId}/select`,{bindingId:binding.bindingId},displaySession.sessionToken)).status,403);
  assert.equal((await f.request(`/api/pairings/${binding.pairingId}/authorize`,{sessionId:displaySession.sessionId},displaySession.sessionToken)).status,403);
});

test('explicit re-binding retires stale metadata and selects only a future H5 destination',async t=>{
  const f=await fixture(t);const first=await boundSession(f);const second=await boundSession(f);
  assert.equal(f.gateway.state.data.bindings[first.binding.bindingId].revoked,true);
  assert.equal(f.gateway.state.data.selectedBindings[first.session.subject],second.binding.bindingId);
  const launched=await f.request('/api/h5/launch',{query:signedQuery()});assert.equal(launched.status,201);
  assert.equal(launched.data.selectedBindingId,second.binding.bindingId);
  assert.equal(launched.data.bindings.length,1);
  assert.equal((await f.request(`/api/sessions/${first.session.sessionId}/display`,{bindingId:first.binding.bindingId},first.session.sessionToken)).status,403);
});

test('signed Mid mismatch closes the upstream session and grants nothing',async t=>{
  const f=await fixture(t);const response=await f.request('/api/h5/launch',{query:signedQuery({Code:'wrong-mid'})});
  assert.equal(response.status,401);assert.equal(f.gateway.sessions.size,0);assert.deepEqual(f.calls.map(x=>x.kind),['start','end']);
});

test('site/topic binding, leases and different identities cannot cross scope',async t=>{
  const f=await fixture(t);const {session,binding,challenge}=await boundSession(f);
  const requestProof=(kind,extra={},token=session.sessionToken)=>f.request(`/api/sessions/${session.sessionId}/${kind}`,{bindingId:binding.bindingId,...extra},token);
  const result=await requestProof('display');assert.equal(result.status,200);
  assert.equal(result.data.displayUrl,'https://gateway.example/display');
  assert.equal(result.data.siteBaseUrl,'https://site.example/api/mail/live');
  const claims=verifyProof(result.data.proof,f.gateway.signer.publicJwk,{issuer:config.origin,audience:challenge.siteOrigin,kind:'display',now:START});
  assert.equal(claims.topicId,challenge.topicId);assert.equal(claims.sessionId,session.sessionId);
  assert.equal(claims.exp-claims.iat,60);
  assert.equal((await requestProof('display',{topicId:'another-topic'})).status,403);
  assert.equal((await requestProof('display',{siteId:'another-site'})).status,403);
  assert.equal((await requestProof('display',{siteOrigin:'https://other.example'})).status,403);
  assert.equal((await requestProof('display',{},'wrong-token')).status,401);
  const other=(await f.request('/api/sessions/start',{channel:'desktop',code:'bob'})).data;
  assert.equal((await f.request(`/api/sessions/${other.sessionId}/display`,{bindingId:binding.bindingId},other.sessionToken)).status,403);
  const lease=await requestProof('lease');assert.equal(lease.status,200);
  const leaseClaims=verifyProof(lease.data.proof,f.gateway.signer.publicJwk,{issuer:config.origin,audience:challenge.siteOrigin,kind:'lease',now:START});
  assert.equal(leaseClaims.exp-leaseClaims.iat,3);
  const finished=await f.request(`/api/pairings/${binding.pairingId}/complete`,{bindingId:binding.bindingId},binding.completionToken);assert.equal(finished.status,200);
});

test('pairing never fetches arbitrary sites; callbacks stay on declared origin',async t=>{
  const f=await fixture(t);
  const body={nonce:'local-challenge',siteId:'self-hosted',topicId:'default',siteOrigin:'https://nonexistent.private-test.example',returnUrl:'https://nonexistent.private-test.example/mail/connect'};
  let result=await f.request('/api/pairings',body);assert.equal(result.status,201);assert.equal(f.calls.length,0);
  result=await f.request('/api/pairings',{...body,returnUrl:'https://attacker.example/callback'});assert.equal(result.status,400);
  result=await f.request('/api/pairings',{...body,siteOrigin:'http://127.0.0.1'});assert.equal(result.status,400);
  const pairing=await f.request('/api/pairings',body);
  assert.equal((await f.request(`/api/pairings/${pairing.data.pairingId}/complete`,{},pairing.data.completionToken)).status,409);
  assert.equal((await f.request(`/api/pairings/${pairing.data.pairingId}/complete`,{},'wrong-token')).status,401);
});

test('heartbeat failure, explicit end and idle timeout prevent all future leases',async t=>{
  const f=await fixture(t);const {session,binding}=await boundSession(f);
  f.clock.value+=19; // Simulate valid consumer keepalives up to the due platform heartbeat.
  f.gateway.sessions.get(session.sessionId).lastConsumerSeen=f.clock.value;
  f.clock.value+=1;f.failures.heartbeat=true;f.failures.end=true;
  await f.gateway.tick();
  assert.equal((await f.request(`/api/sessions/${session.sessionId}/lease`,{bindingId:binding.bindingId},session.sessionToken)).status,410);
  assert.ok(f.calls.some(c=>c.kind==='heartbeat'));assert.ok(f.calls.some(c=>c.kind==='end'));
  const second=await boundSession(f,'second');
  assert.equal((await f.request(`/api/sessions/${second.session.sessionId}/end`,{},second.session.sessionToken)).status,200);
  assert.equal((await f.request(`/api/sessions/${second.session.sessionId}/lease`,{bindingId:second.binding.bindingId},second.session.sessionToken)).status,410);
  const third=await boundSession(f,'third');f.clock.value+=10;
  assert.equal((await f.request(`/api/sessions/${third.session.sessionId}/lease`,{bindingId:third.binding.bindingId},third.session.sessionToken)).status,410);
});

test('gateway restart preserves bindings/key/replay barriers but cannot restore a session',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'windchime-gateway-'));
  const state=await GatewayState.open(directory);const signingKey=await loadSigningKey(directory);
  const f=await fixture(t,{state,signingKey});const {session,binding}=await boundSession(f);
  await state.save();
  const saved=await readFile(join(directory,'gateway-state.json'),'utf8');
  assert.ok(!saved.includes(session.sessionToken));assert.ok(!saved.includes('server-only-secret'));
  assert.ok(!saved.includes('sourceText'));assert.ok(!saved.includes('game-'));
  assert.equal(await loadSigningKey(directory),signingKey);
  await f.gateway.close();
  const next=await fixture(t,{state:await GatewayState.open(directory),signingKey});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  assert.equal((await next.request(`/api/sessions/${session.sessionId}/lease`,{bindingId:binding.bindingId},session.sessionToken)).status,401);
  const fresh=(await next.request('/api/sessions/start',{channel:'desktop',code:'alice'})).data;
  assert.equal((await next.request(`/api/sessions/${fresh.sessionId}/display`,{bindingId:binding.bindingId},fresh.sessionToken)).status,200);
});

test('H5 output is a blank static document and never embeds private platform errors',async t=>{
  const f=await fixture(t);
  const response=await fetch(f.base+'/h5?plug_env=0');const html=await response.text();
  assert.match(html,/background|gateway.css/);assert.ok(!html.includes('server-only-secret'));
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.match(response.headers.get('content-security-policy'),/frame-src 'self'/);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  f.failures.start=true;
  const failed=await f.request('/api/sessions/start',{channel:'desktop',code:'test'});
  assert.ok(!JSON.stringify(failed.data).includes('PRIVATE'));
});
