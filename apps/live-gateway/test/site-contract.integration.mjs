import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSigner,generateSigningKey } from '../src/security.mjs';
import { createWindChimeSqlite } from '../../../dist/sqlite/index.js';
import { createWindChimeService } from '../../../dist/server/index.js';
import { createWindChimeLiveRouteHandlers,verifyWindChimeGatewayProof } from '../../../dist/next/index.js';

test('real gateway signer interoperates with site binding, display, renewal and expiring lease enforcement',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'windchime-gateway-contract-'));
  const storage=createWindChimeSqlite({filename:join(directory,'test.db')});
  t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
  let stamp=1750000000000;
  const signer=createSigner(generateSigningKey(),'https://gateway.example',()=>Math.floor(stamp/1000));
  const service=createWindChimeService({storage,hashSalt:'isolated-test-only',now:()=>stamp,runtimeEpoch:'contract-test'});await service.ready();
  const options={publicKeys:{[signer.kid]:signer.publicKeyPem},issuer:'https://gateway.example',audience:'https://site.example',now:stamp};
  const handler=createWindChimeLiveRouteHandlers({service,authorizeAdmin:req=>req.headers.get('x-test-admin')==='yes'?null:false,gatewayIssuer:options.issuer,gatewayPublicKeys:options.publicKeys,now:()=>stamp});
  async function call(path,body,token='admin',lease,method='POST'){
    const req=new Request(`https://site.example/api/mail/live/${path}`,{method,headers:{...(token==='admin'?{'x-test-admin':'yes'}:token?{Authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'}),...(lease?{'X-WindChime-Platform-Lease':lease}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const response=await handler[method](req);return {status:response.status,data:await response.json()};
  }
  const challenge=(await call('control/binding-challenge',{topicId:'default'})).data;
  const claims={aud:challenge.siteOrigin,siteId:challenge.siteId,topicId:challenge.topicId,bindingId:randomUUID(),biliSubject:'bilibili:developer:union:alice',sessionId:randomUUID()};
  const binding=signer.sign({...claims,nonce:challenge.nonce,kind:'binding'},120);
  assert.equal(verifyWindChimeGatewayProof(binding,{...options,kind:'binding'}).bindingId,claims.bindingId);
  assert.equal((await call('control/bind',{topicId:'default',proof:binding})).status,200);
  assert.notEqual((await call('control/bind',{topicId:'default',proof:binding})).status,200);
  const display=signer.sign({...claims,kind:'display'},60);
  const exchanged=await call('gateway/exchange',{proof:display},null);assert.equal(exchanged.status,200);
  const token=exchanged.data.token;assert.match(token,/^wc_disp_/);
  assert.equal((await call('gateway/exchange',{proof:display},null)).status,409);
  assert.notEqual((await call('control/state?topicId=default',undefined,token,undefined,'GET')).status,200);
  const lease=signer.sign({...claims,kind:'lease'},3);
  assert.notEqual((await call('display/open',{},token)).status,200);
  const opened=await call('display/open',{},token,lease);assert.equal(opened.status,200);
  const framePath=`display/frame?receiverId=${opened.data.receiverId}`;
  assert.equal((await call(framePath,undefined,token,lease,'GET')).data.snapshot,null);
  await service.submitMessage({text:'Approved contract test letter',nickname:'Reviewed nickname',topicSlug:'default'},new Request('https://site.example/api/mail/messages',{headers:{'x-real-ip':'127.0.0.1'}}));
  const state=await service.broadcast.state('default');const message=state.messages[0];
  let current=await service.broadcast.action({topicId:'default',action:'approve',messageId:message.id,expectedRevision:state.revision,expectedDraftRevision:message.draftRevision,operationId:randomUUID()});
  assert.equal((await call(framePath,undefined,token,lease,'GET')).data.snapshot,null);
  await service.broadcast.action({topicId:'default',action:'show',messageId:message.id,expectedRevision:current.revision,operationId:randomUUID()});
  assert.equal((await call(framePath,undefined,token,lease,'GET')).data.snapshot.text,'Approved contract test letter');
  const renewal=await call('gateway/renew',{proof:signer.sign({...claims,kind:'display'},60)},token);
  assert.equal(renewal.status,200);
  assert.equal((await call(framePath,undefined,token,lease,'GET')).data.snapshot.text,'Approved contract test letter');
  for(const mismatch of [{topicId:'other-topic'},{siteId:'other-site'},{sessionId:'other-session'},{biliSubject:'bilibili:another-anchor'}]){
    const wrong=signer.sign({...claims,...mismatch,kind:'lease'},3);
    assert.notEqual((await call(framePath,undefined,token,wrong,'GET')).status,200);
  }
  stamp+=3100;
  assert.notEqual((await call(framePath,undefined,token,lease,'GET')).status,200);
  const nextLease=signer.sign({...claims,kind:'lease'},3);
  const nextOpen=await call('display/open',{},token,nextLease);assert.equal(nextOpen.status,200);
  assert.equal((await call(`display/frame?receiverId=${nextOpen.data.receiverId}`,undefined,token,nextLease,'GET')).data.snapshot,null);
  assert.equal((await call('control/bind?topicId=default',undefined,'admin',undefined,'DELETE')).status,200);
  assert.notEqual((await call('gateway/exchange',{proof:signer.sign({...claims,kind:'display'},60)},null)).status,200);
});
