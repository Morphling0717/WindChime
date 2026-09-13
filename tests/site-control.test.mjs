import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { createWindChimeSqlite } from '../dist/sqlite/index.js';
import { createWindChimeService } from '../dist/server/index.js';
import { createWindChimeLiveRouteHandlers } from '../dist/next/index.js';
import { createWindChimeLiveClient } from '../dist/client/live.js';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'windchime-site-control-')), storage=createWindChimeSqlite({filename:join(directory,'mail.db')});
  let stamp=Date.parse('2026-09-13T12:00:00Z'),submission=0;
  const service=createWindChimeService({storage,hashSalt:'test-site',now:()=>stamp,runtimeEpoch:randomUUID()});await service.ready();
  const handler=createWindChimeLiveRouteHandlers({service,now:()=>stamp,publicOrigin:'https://site.test',allowedOrigins:['https://display.site.test'],siteName:'测试风铃',posterDefaults:{title:'私信箱',signature:'主播'},authorizeAdmin:req=>req.headers.get('x-test-admin')==='yes'?null:false});
  const call=(path,authority,method='GET',body,headers={})=>handler[method](new Request('https://site.test/api/mail/live/'+path,{method,headers:{...(authority==='admin'?{'x-test-admin':'yes'}:authority?{authorization:'Bearer '+authority}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  async function grant(kind='control',scope='site',topicId) {const response=await call('control/grants','admin','POST',{kind,scope,label:'测试授权',...(topicId?{topicId}:{})});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return response.json();}
  async function submit(topicSlug='default',text='原文-'+(++submission),senderFingerprint=randomUUID(),ip='10.0.0.'+(++submission)) {await service.submitMessage({topicSlug,text,senderFingerprint},new Request('https://site.test/',{headers:{'x-real-ip':ip}}));return (await service.listMessages({topicId:topicSlug})).items.find(m=>m.text===text);}
  async function act(topicId,action,messageId) {const state=await service.broadcast.state(topicId);return service.broadcast.action({topicId,action,messageId,expectedRevision:state.revision,expectedDraftRevision:state.messages.find(m=>m.id===messageId)?.draftRevision,operationId:randomUUID()});}
  async function output(parent,topicId) {const response=await call('control/grants',parent.token,'POST',{kind:'display',topicId});assert.equal(response.status,201);const value=await response.json();const opened=await(await call('display/open',value.token,'POST',{})).json();return {...value,...opened};}
  t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
  return {directory,storage,service,call,grant,submit,act,output,advance:ms=>stamp+=ms};
}

test('site grants are explicit, cookie-admin issued, nullable in identity and reusable for future topics',async t=>{
  const f=await fixture(t),site=await f.grant(),old=await f.grant('control','topic','default');
  assert.equal(site.scope,'site');assert.equal(site.topicId,null);assert.equal(old.scope,'topic');assert.equal(old.topicId,'default');
  const identity=await(await f.call('control/identity',site.token)).json();
  assert.deepEqual(identity,{scope:'site',siteId:await f.service.broadcast.siteId(),topicId:null,topicTitle:null,label:'测试授权',expiresAt:site.expiresAt,grantId:site.id});
  assert.equal((await(await f.call('control/identity',old.token)).json()).topicId,'default');
  for(const authority of [site.token,old.token,undefined])for(const scope of ['site','topic'])assert.equal((await f.call('control/grants',authority,'POST',{kind:'control',scope,...(scope==='topic'?{topicId:'default'}:{})})).status,authority?403:401);
  assert.equal((await f.call('control/grants','admin','POST',{kind:'display',scope:'site'})).status,400);
  assert.equal((await f.call('control/grants','admin','POST',{kind:'control',scope:'site',topicId:'default'})).status,400);
  assert.equal((await f.call('devices/approve',site.token,'POST',{userCode:'CODE',topicId:'default'})).status,403);
  assert.equal((await f.call('control/grants/'+site.id+'/renew',site.token,'POST',{})).status,404);
  const capability=await(await f.call('capabilities')).json();for(const flag of ['siteControl','mailManagement','keywordFilterToggle'])assert.equal(capability.features[flag],true);
});

test('site topic discovery includes new, scheduled and ended activities while old keys only see their topic',async t=>{
  const f=await fixture(t),site=await f.grant(),old=await f.grant('control','topic','default');
  const initial=await(await f.call('control/topics',site.token)).json();assert.equal(initial.items.length,1);
  const created=await f.call('control/topics',site.token,'POST',{slug:'future',title:'新活动',startsAt:'2026-10-01T00:00:00Z',note:'仅管理员备注'});assert.equal(created.status,201);const topic=await created.json();
  const list=await(await f.call('control/topics',site.token)).json();assert.equal(list.items.length,2);assert.equal(list.items.find(item=>item.id===topic.id).state,'scheduled');
  assert.deepEqual((await(await f.call('control/topics',old.token)).json()).items.map(item=>item.id),['default']);
  assert.equal((await f.call('control/topics/'+topic.id,old.token)).status,403);
  assert.equal((await f.call('control/topics',old.token,'POST',{slug:'denied',title:'Denied'})).status,403);
  assert.equal((await f.call('control/topics/default',old.token,'PATCH',{title:'Denied'})).status,403);
  assert.equal((await f.call('control/topics/'+topic.id,site.token,'PATCH',{startsAt:null,endsAt:'2026-01-01T00:00:00Z'})).status,200);
  assert.equal((await(await f.call('control/topics/'+topic.id,site.token)).json()).state,'ended');
});

test('scoped inbox mutation reuses legacy rules and cannot cross topics, even with conflicting body/query scope',async t=>{
  const f=await fixture(t),site=await f.grant(),a=await f.service.createTopic({slug:'a',title:'A'}),b=await f.service.createTopic({slug:'b',title:'B'}),old=await f.grant('control','topic',a.id),ma=await f.submit('a'),mb=await f.submit('b');
  assert.equal((await f.call('control/messages',old.token)).status,200);
  assert.equal((await f.call('control/messages?topicId=all',old.token)).status,403);
  assert.equal((await(await f.call('control/messages?topicId=all',site.token)).json()).items.length,2);
  assert.equal((await f.call('control/messages/'+mb.id+'?topicId='+a.id,old.token)).status,404);
  assert.equal((await f.call('control/messages/'+mb.id+'?topicId='+b.id,old.token)).status,403);
  assert.equal((await f.call('control/messages/'+ma.id+'?topicId='+a.id,old.token,'PATCH',{isRead:true,isFavorited:true})).status,200);
  assert.equal((await f.service.getMessage(ma.id,a.id)).isFavorited,true);
  assert.equal((await f.call('control/messages/'+ma.id+'?topicId='+a.id,site.token,'PATCH',{topicId:b.id,isRead:false})).status,400);
  assert.equal((await f.call('control/messages/batch?topicId='+a.id,old.token,'POST',{action:'delete',ids:[ma.id,mb.id]})).status,404);
  assert.equal((await f.service.getMessage(ma.id,a.id)).isRead,true);
  assert.equal((await f.call('control/messages/'+ma.id+'?topicId='+a.id,old.token,'DELETE')).status,200);
  assert.equal((await f.service.listMessages({topicId:b.id})).items.length,1);
});

test('site-only sender blocking removes its messages across topics; topic keys cannot perform global operations',async t=>{
  const f=await fixture(t),site=await f.grant(),old=await f.grant('control','topic','default'),topic=await f.service.createTopic({slug:'event',title:'活动'});
  const ma=await f.submit('default','one','same-fan','10.0.0.50'),mb=await f.submit('event','two','same-fan','10.0.0.50');
  assert.equal(ma.senderHash,mb.senderHash,'blocking fixture represents the same IP, browser and fingerprint');
  for(const [path,method,body] of [['control/blocklist','GET'],['control/blocked-terms','GET'],['control/settings','GET'],['control/messages/'+ma.id+'/block','POST',{}]])assert.equal((await f.call(path,old.token,method,body)).status,403);
  assert.equal((await f.call('control/messages/'+ma.id+'/block',site.token,'POST',{})).status,200);
  assert.equal((await f.service.listMessages()).items.length,0);assert.equal((await f.service.listMessages({topicId:topic.id})).items.length,0);
  const blocked=await(await f.call('control/blocklist',site.token)).json();assert.equal(blocked.length,1);
  assert.equal((await f.call('control/blocklist/'+blocked[0].hash,old.token,'DELETE')).status,403);
  assert.equal((await f.call('control/blocklist/'+blocked[0].hash,site.token,'DELETE')).status,200);
  assert.equal((await f.service.listMessages({topicId:topic.id})).items.length,0,'unblocking does not restore deleted mail');
});

test('keyword switch is default off and only site Bearer settings PATCH can change it',async t=>{
  const f=await fixture(t),site=await f.grant(),old=await f.grant('control','topic','default'),display=await f.grant('display','topic','default');
  assert.equal((await(await f.call('control/settings',site.token)).json()).blockedTermsEnabled,false);
  for(const authority of ['admin',old.token,display.token,undefined])assert.equal((await f.call('control/settings',authority,'PATCH',{blockedTermsEnabled:true})).status,authority==='admin'||authority===old.token?403:401);
  assert.equal((await f.call('control/settings',site.token,'PUT',{blockedTermsEnabled:true})).status,400);
  assert.equal((await f.call('control/settings',site.token,'PATCH',{blockedTermsEnabled:true,enabled:false})).status,400);
  assert.equal((await f.call('control/settings',site.token,'PATCH',{blockedTermsEnabled:true})).status,200);
  assert.equal((await f.call('control/blocked-terms',site.token,'PUT',{terms:['blocked']})).status,200);
  await f.submit('default','blocked');assert.equal((await f.service.listMessages({filter:'flagged'})).items.length,1);
  assert.equal((await f.call('control/settings',site.token,'PATCH',{blockedTermsEnabled:false})).status,200);
  assert.equal((await(await f.call('control/messages',site.token)).json()).items[0].text,'blocked');
  assert.deepEqual((await(await f.call('control/blocked-terms',site.token)).json()).terms,['blocked']);
});

test('a revoked site control parent invalidates display children in multiple topics without revoking other site keys',async t=>{
  const f=await fixture(t),site=await f.grant(),independent=await f.grant(),topic=await f.service.createTopic({slug:'event',title:'Event'}),a=await f.submit(),b=await f.submit('event');
  const oa=await f.output(site,'default'),ob=await f.output(site,topic.id),other=await f.output(independent,'default');
  await f.act('default','approve',a.id);await f.act(topic.id,'approve',b.id);await f.act('default','show',a.id);await f.act(topic.id,'show',b.id);
  assert.equal((await(await f.call('display/frame?receiverId='+ob.receiverId,ob.token)).json()).snapshot.messageId,b.id);
  assert.equal((await f.call('control/grants/'+site.id,independent.token,'DELETE')).status,200);
  for(const child of [oa,ob])assert.equal((await f.call('display/frame?receiverId='+child.receiverId,child.token)).status,401);
  assert.equal((await f.call('control/identity',site.token)).status,401);assert.equal((await f.call('control/identity',independent.token)).status,200);
  assert.equal((await(await f.call('display/frame?receiverId='+other.receiverId,other.token)).json()).snapshot.messageId,a.id);
  const listed=(await(await f.call('control/grants',independent.token)).json()).items;assert(listed.some(g=>g.id===site.id&&g.revokedAt));assert(!JSON.stringify(listed).includes(site.token));
});

test('archive, restore and purge retain service constraints and cannot delete a site grant anchored outside topics',async t=>{
  const f=await fixture(t),site=await f.grant(),topic=await f.service.createTopic({slug:'past',title:'Past'}),old=await f.grant('control','topic',topic.id),mail=await f.submit('past'),output=await f.output(site,topic.id);
  await f.act(topic.id,'approve',mail.id);await f.act(topic.id,'show',mail.id);
  assert.equal((await f.call('control/topics/'+topic.id+'/purge',site.token,'DELETE')).status,409);
  const archive=await f.call('control/topics/'+topic.id,site.token,'DELETE',{markReadFirst:true});assert.equal(archive.status,200);
  assert.equal((await(await f.call('display/frame?receiverId='+output.receiverId,output.token)).json()).snapshot,null);
  assert.equal((await f.service.getMessage(mail.id,topic.id)).isRead,true);
  assert.equal((await f.call('control/topics/'+topic.id+'/restore',site.token,'POST',{})).status,200);
  assert.equal((await f.call('control/topics/'+topic.id+'/archive',site.token,'POST',{})).status,200);
  assert.equal((await f.call('control/topics/'+topic.id+'/purge',site.token,'DELETE')).status,200);
  assert.equal((await f.call('control/identity',old.token)).status,401);assert.equal((await f.call('control/identity',site.token)).status,200);
  assert.equal((await f.call('control/topics/default',site.token,'DELETE')).status,400);
});

test('management and share endpoints reject display authority and never include private content in share data',async t=>{
  const f=await fixture(t),site=await f.grant(),display=await f.grant('display','topic','default'),topic=await f.service.createTopic({slug:'sharing',title:'分享活动',note:'PRIVATE_NOTE'});await f.submit('sharing','PRIVATE_BODY');
  for(const path of ['control/topics','control/messages','control/settings','control/blocklist','control/blocked-terms','control/share','control/grants'])assert.equal((await f.call(path,display.token)).status,401);
  const response=await f.call('control/share?topicId='+topic.id,site.token),share=await response.json();
  assert.equal(share.submissionUrl,'https://site.test/m/sharing');assert.equal(share.siteName,'测试风铃');assert.deepEqual(share.posterDefaults,{title:'私信箱',signature:'主播'});
  assert(!JSON.stringify(share).includes('PRIVATE_'));assert(!JSON.stringify(share).includes(site.token));
  const other=await fixture(t);assert.equal((await other.call('control/topics',site.token)).status,401);
});

test('typed management client uses topic scopes and site grant creation without broadening display client',async t=>{
  const f=await fixture(t),site=await f.grant(),client=createWindChimeLiveClient({transport:async request=>{const response=await f.call(request.path.replace(/^\//,''),site.token,request.method,request.body);if(!response.ok)throw new Error('HTTP '+response.status);return response.json();}});
  const topic=await client.topics.create({slug:'client',title:'Client'});assert((await client.topics.list()).items.some(item=>item.id===topic.id));
  assert.equal((await client.share(topic.id)).submissionUrl,'https://site.test/m/client');
  assert.equal((await client.settings.get()).blockedTermsEnabled,false);assert.equal((await client.settings.setBlockedTermsEnabled(true)).blockedTermsEnabled,true);
  assert.equal((await client.grants()).items.length,1);await assert.rejects(client.createSiteGrant('not allowed from desktop'),/HTTP 403/);
});

test('ambiguous scopes and encoded paths cannot redirect a topic key to another mailbox',async t=>{
  const f=await fixture(t),site=await f.grant(),a=await f.service.createTopic({slug:'scope-a',title:'A'}),b=await f.service.createTopic({slug:'scope-b',title:'B'}),old=await f.grant('control','topic',a.id),mail=await f.submit('scope-a');
  const route='control/messages/'+mail.id;
  for(const [path,body] of [
    [route+'?topicId='+a.id+'&topicId='+a.id,{isRead:true}],
    [route+'?topicId='+a.id+'&topicId='+b.id,{isRead:true}],
    [route+'?topicId='+a.id,{topicId:b.id,isRead:true}],
    [route+'?topicId='+a.id,{topicId:null,isRead:true}],
    [route,{topicId:[a.id,b.id],isRead:true}],
  ])assert.equal((await f.call(path,old.token,'PATCH',body)).status,400);
  assert.equal((await f.service.getMessage(mail.id,a.id)).isRead,false);
  assert.equal((await f.call('control/topics/'+b.id+'?topicId='+a.id,old.token)).status,403,'the path target is authorized, not a decoy query');
  assert.equal((await f.call('control/share?topicId='+b.id,old.token)).status,403);
  assert.equal((await f.call('control/grants?topicId='+b.id,old.token)).status,403);
  for(const path of ['control/topics/'+a.id+'%2f..%2f'+b.id,'control/messages/%5c'+mail.id,'control/grants/%00'+site.id])assert.equal((await f.call(path,site.token,'DELETE')).status,400);
  assert.equal((await f.call('control/identity?scope=site',old.token)).status,400);
  assert.equal((await(await f.call('control/identity',old.token)).json()).scope,'topic');
});

test('Bearer authority takes precedence over admin cookies and cannot mint or approve management credentials',async t=>{
  const f=await fixture(t),site=await f.grant(),old=await f.grant('control','topic','default'),display=await f.grant('display','topic','default');
  const adminCookie={'x-test-admin':'yes',cookie:'admin=synthetic'};
  for(const token of [site.token,old.token,display.token]) {
    assert.equal((await f.call('control/grants',token,'POST',{kind:'control',scope:'site'},adminCookie)).status,token===display.token?401:403);
    assert.equal((await f.call('devices/approve',token,'POST',{userCode:'unused',topicId:'default'},adminCookie)).status,403);
  }
  assert.equal((await f.call('control/settings',old.token,'PATCH',{blockedTermsEnabled:true},adminCookie)).status,403);
  assert.equal((await f.call('control/settings','admin','PATCH',{blockedTermsEnabled:true})).status,403);
  assert.equal((await f.service.getSettings()).blockedTermsEnabled,false);
  assert.equal((await f.call('control/grants','admin','POST',{kind:'control',scope:'site',label:'网页签发'})).status,201,'same-origin website admins remain the explicit issuing authority');
  const cross={'origin':'https://display.site.test','sec-fetch-site':'same-site'};
  for(const [path,method,body] of [['control/topics','GET'],['control/grants','POST',{kind:'control',scope:'site'}]]) {
    const response=await f.call(path,'admin',method,body,cross);assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-credentials'),null);
  }
  assert.equal((await f.call('control/topics',site.token,'GET',undefined,cross)).status,200,'an explicitly allowed origin may use its own Bearer authority without cookies');
  assert.equal((await f.call('control/grants','admin','POST',{kind:'control',scope:'site'},{'origin':'https://attacker.invalid'})).status,403);
});

test('unsupported HTTP methods never apply settings, grants, blocklist or topic mutations',async t=>{
  const f=await fixture(t),site=await f.grant(),topic=await f.service.createTopic({slug:'method',title:'Unchanged'});
  for(const [path,method,body] of [
    ['control/settings','POST',{blockedTermsEnabled:true}],
    ['control/settings','DELETE',{enabled:false}],
    ['control/blocked-terms','PATCH',{terms:['must-not-save']}],
    ['control/grants/'+site.id,'PATCH',{revokedAt:new Date().toISOString()}],
    ['control/topics/'+topic.id,'PUT',{title:'Changed'}],
    ['control/topics/'+topic.id+'/archive','GET'],
    ['control/topics/'+topic.id+'/purge','POST',{}],
  ])assert.equal((await f.call(path,site.token,method,body)).status,404,path+' '+method);
  assert.equal((await f.call('control/identity',site.token,'POST',{})).status,405);
  assert.equal((await f.service.getSettings()).blockedTermsEnabled,false);assert.deepEqual(await f.service.getBlockedTerms(),[]);
  assert.equal((await f.service.getTopicById(topic.id)).title,'Unchanged');assert.equal((await f.service.getTopicById(topic.id)).archivedAt,null);
  assert.equal((await f.call('control/identity',site.token)).status,200);
});

test('parent expiry invalidates otherwise-live multi-topic output while independent grants retain authority',async t=>{
  const f=await fixture(t),site=await f.service.broadcast.createGrant(null,'control','Short',2000,null,null,null,'site'),independent=await f.grant(),topic=await f.service.createTopic({slug:'expiry',title:'Expiry'}),mail=await f.submit();
  const output=await f.output(site,'default'),second=await f.output(site,topic.id),other=await f.output(independent,'default');
  await f.act('default','approve',mail.id);await f.act('default','show',mail.id);
  f.advance(2001);
  for(const child of [output,second])assert.equal((await f.call('display/frame?receiverId='+child.receiverId,child.token)).status,401);
  assert.equal((await(await f.call('control/identity',site.token)).json()).code,'CONNECTION_KEY_EXPIRED');
  assert.equal((await f.call('control/grants',site.token,'POST',{kind:'display',topicId:'default'})).status,401);
  assert.equal((await(await f.call('display/frame?receiverId='+other.receiverId,other.token)).json()).snapshot.messageId,mail.id);
  assert.equal((await f.call('control/topics',independent.token)).status,200);
});

test('topic keys cannot revoke site or other topic grants and revocation does not depend on an active topic',async t=>{
  const f=await fixture(t),site=await f.grant(),otherSite=await f.grant(),a=await f.service.createTopic({slug:'grant-a',title:'A'}),b=await f.service.createTopic({slug:'grant-b',title:'B'}),old=await f.grant('control','topic',a.id),ownOutput=await f.output(old,a.id),foreignOutput=await f.output(site,b.id);
  assert.equal((await f.call('control/grants/'+site.id,old.token,'DELETE')).status,404);
  assert.equal((await f.call('control/grants/'+foreignOutput.id,old.token,'DELETE')).status,404);
  assert.equal((await f.call('control/grants/'+old.id,old.token,'DELETE')).status,403);
  assert.equal((await f.call('control/grants/'+ownOutput.id,old.token,'DELETE')).status,200);
  await f.service.archiveTopic(a.id);await f.service.deleteArchivedTopic(a.id);
  assert.equal((await f.call('control/identity',site.token)).status,200);
  assert.equal((await f.call('control/grants/'+site.id,otherSite.token,'DELETE')).status,200);
  assert.equal((await f.call('display/open',foreignOutput.token,'POST',{})).status,401);
  assert.equal((await f.call('control/identity',otherSite.token)).status,200);
});

test('0.6 grant migration preserves hashes, IDs, revocation triggers and old topic scope across repeated startup',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'windchime-grant-upgrade-')),filename=join(directory,'mail.db');t.after(()=>rm(directory,{recursive:true,force:true}));
  const controlToken='wc_ctl_'+Buffer.alloc(32,7).toString('base64url'),displayToken='wc_disp_'+Buffer.alloc(32,8).toString('base64url');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const native=await new Promise((resolve,reject)=>{const database=new sqlite3.Database(filename,error=>error?reject(error):resolve(database));});
  await new Promise((resolve,reject)=>native.exec(`CREATE TABLE mail_live_grants(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,topic_id TEXT NOT NULL,label TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,binding_id TEXT,platform_session TEXT,parent_grant_id TEXT);
    INSERT INTO mail_live_grants VALUES('old-control','${hash(controlToken)}','control','default','Old',4102444800000,NULL,NULL,NULL,NULL);
    INSERT INTO mail_live_grants VALUES('old-output','${hash(displayToken)}','display','default','Output',4102444800000,NULL,NULL,NULL,'old-control');
    CREATE TABLE observer(id TEXT);
    CREATE TRIGGER observer_grants AFTER INSERT ON observer BEGIN UPDATE mail_live_grants SET label=label WHERE id=NEW.id; END;
    CREATE TRIGGER live_grant_revoked AFTER UPDATE OF revoked_at ON mail_live_grants WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL BEGIN UPDATE mail_live_grants SET revoked_at=NEW.revoked_at WHERE parent_grant_id=OLD.id AND revoked_at IS NULL; END;`,error=>error?reject(error):resolve()));
  await new Promise((resolve,reject)=>native.close(error=>error?reject(error):resolve()));
  for(let pass=0;pass<2;pass++) {
    const storage=createWindChimeSqlite({filename}),service=createWindChimeService({storage,hashSalt:'unchanged'});await service.ready();
    try {
      const identity=await service.broadcast.controlIdentity(controlToken);assert.equal(identity.scope,'topic');assert.equal(identity.topicId,'default');assert.equal(identity.grantId,'old-control');
      const columns=await storage.all('PRAGMA table_info(mail_live_grants)');assert.equal(columns.find(c=>c.name==='topic_id').notnull,0);
      assert.equal((await storage.get('SELECT token_hash FROM mail_live_grants WHERE id=?',['old-control'])).token_hash,hash(controlToken));
      await storage.run('INSERT INTO observer VALUES(?)',['old-control']);
      const site=await service.broadcast.createGrant(null,'control','Site',undefined,null,null,null,'site');assert.equal(site.topicId,null);
      if(pass===1){await service.broadcast.revokeGrant('old-control','default');assert((await storage.get('SELECT revoked_at FROM mail_live_grants WHERE id=?',['old-output'])).revoked_at);await assert.rejects(service.broadcast.authenticate(displayToken,'display'));}
    } finally {await storage.close();}
  }
});
