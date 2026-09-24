import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWindChimeSqlite } from "../dist/sqlite/index.js";
import { createWindChimeService } from "../dist/server/index.js";
import { createWindChimeLiveRouteHandlers, createWindChimeRouteHandlers } from "../dist/next/index.js";
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE } from "../dist/core/live.js";

async function fixture(t, options={}) {
  const directory=await mkdtemp(join(tmpdir(),"windchime-live-")),storage=createWindChimeSqlite({filename:join(directory,"mail.db")});
  let stamp=Date.parse("2026-09-10T12:00:00Z"), seq=0;
  const config={storage,hashSalt:"keep",now:()=>stamp,runtimeEpoch:"process-a",...options};
  const service=createWindChimeService(config); await service.ready();
  const auth=(req)=>req.headers.get("x-admin")==="yes"?null:false;
  const handler=createWindChimeLiveRouteHandlers({service,authorizeAdmin:auth,mediaDirectory:join(directory,"media"),now:()=>stamp,...options.routes});
  const legacy=createWindChimeRouteHandlers({service,authorizeAdmin:auth});
  t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
  function request(path,method="GET",payload,authority="admin",extra={}) {
    return new Request("https://site.test/api/mail/live/"+path,{method,headers:{...(authority==="admin"?{"x-admin":"yes"}:authority?{authorization:"Bearer "+authority}:{}),...(payload!==undefined?{"content-type":"application/json"}:{}),...extra},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
  }
  const call=(...args)=>{const req=request(...args);return handler[req.method](req);};
  async function submit(text="private-letter",topicSlug="default",extra={}) {
    const req=new Request("https://site.test/api/mail/messages",{headers:{"x-real-ip":"10.0.0."+(++seq)}});
    await service.submitMessage({text,nickname:"private-nick",topicSlug,...extra},req);
    return (await service.listMessages({topicId:topicSlug})).items.find((m)=>m.text===text)?.id ?? (await service.listMessages({topicId:topicSlug,filter:"flagged"})).items[0].id;
  }
  async function act(action,messageId,extra={},topicId="default") {
    const state=await service.broadcast.state(topicId),m=state.messages.find((m)=>m.id===messageId);
    return service.broadcast.action({topicId,action,messageId,expectedRevision:state.revision,expectedDraftRevision:m?.draftRevision,operationId:randomUUID(),...extra});
  }
  async function display(topic="default") {const issued=await service.broadcast.createGrant(topic,"display"),grant=await service.broadcast.authenticate(issued.token,"display"),opened=await service.broadcast.open(grant);return {...issued,grant,...opened};}
  return {directory,storage,service,handler,legacy,request,call,submit,act,display,config,now:()=>stamp,advance:(ms)=>stamp+=ms};
}

test("appearance theme and layout patches are independent, persist across restart, and reach display frames",async(t)=>{
  const f=await fixture(t),d=await f.display();
  const styled=await f.act("appearance",undefined,{appearance:{
    layout:"split",theme:"uliuli",fontFamily:"Georgia",fontSize:44,textColor:"#f0f0f0",backgroundColor:"#18202e88",
    transparent:false,imageLayout:"grid",animation:"slide",borderRadius:19,padding:38,
    accentColor:"#ab12ef80",borderWidth:3.5,lineHeight:1.8,letterSpacing:1.2,maxWidth:1080,
  }});
  let expected=styled.appearance;
  for(const theme of ["mia","pure","uliuli"]) {
    expected={...expected,theme};
    const changed=await f.act("appearance",undefined,{appearance:{theme}});
    assert.deepEqual(changed.appearance,expected,"theme patch must preserve layout and every custom style");
  }
  for(const layout of ["stack","banner","split"]) {
    expected={...expected,layout};
    assert.deepEqual((await f.act("appearance",undefined,{appearance:{layout}})).appearance,expected);
  }
  for(const edge of [
    {borderWidth:0,lineHeight:1.1,letterSpacing:-1,maxWidth:280},
    {borderWidth:8,lineHeight:2.4,letterSpacing:6,maxWidth:1920},
  ]) {
    expected={...expected,...edge};
    assert.deepEqual((await f.act("appearance",undefined,{appearance:edge})).appearance,expected);
  }
  const stored=await f.storage.get("SELECT appearance FROM mail_live_channels WHERE topic_id='default'");
  assert.deepEqual(JSON.parse(stored.appearance),expected);
  const response=await f.call("display/frame?receiverId="+d.receiverId,"GET",undefined,d.token);
  assert.equal(response.status,200);
  const frame=await response.json();assert.deepEqual(frame.appearance,expected);assert.equal(frame.snapshot,null);
  assert.deepEqual(Object.keys(frame).sort(),["receiverId","epoch","revision","activation","leaseMs","appearance","snapshot"].sort());
  assert.deepEqual(Object.keys(frame.appearance).sort(),Object.keys(DEFAULT_WINDCHIME_LIVE_APPEARANCE).sort());
  const copied=createWindChimeSqlite({filename:join(f.directory,"mail.db")});
  try {
    const restarted=createWindChimeService({...f.config,storage:copied,runtimeEpoch:"process-b"});await restarted.ready();
    assert.deepEqual((await restarted.broadcast.state("default")).appearance,expected);
    const grant=await restarted.broadcast.authenticate(d.token,"display"),receiver=await restarted.broadcast.open(grant);
    assert.deepEqual((await restarted.broadcast.frame(grant,receiver.receiverId)).appearance,expected);
  } finally { await copied.close(); }
});

test("appearance rejects CSS injection, unknown fields, invalid enums, nonfinite values and out-of-range numbers atomically",async(t)=>{
  const f=await fixture(t);await f.act("appearance",undefined,{appearance:{theme:"mia",layout:"banner",accentColor:"#123456"}});
  const before=await f.service.broadcast.state("default");
  const invalid=[
    {theme:"card"},{theme:"Mia"},{theme:["pure"]},{theme:null},{layout:"mia"},{layout:"split;display:none"},
    {accentColor:"red"},{accentColor:"#12345"},{accentColor:"#fff;background:url(https://evil.test)"},
    {textColor:"var(--secret)"},{backgroundColor:"url(javascript:alert(1))"},{fontFamily:"system-ui;display:none"},
  ];
  for(const [key,min,max] of [["borderWidth",0,8],["lineHeight",1.1,2.4],["letterSpacing",-1,6],["maxWidth",280,1920]]) {
    for(const value of [min-0.01,max+0.01,NaN,Infinity,-Infinity,"1",null]) invalid.push({[key]:value});
  }
  for(const patch of invalid) await assert.rejects(f.act("appearance",undefined,{appearance:patch}),e=>e.code==="INVALID_APPEARANCE");
  for(const patch of [{css:"body{display:none}"},{status:"approved"},{current:{messageId:"forged"}},{theme:"pure",senderHash:"private"}]) {
    await assert.rejects(f.act("appearance",undefined,{appearance:patch}),e=>e.code==="INVALID_FIELD");
  }
  const response=await f.call("control/action","POST",{topicId:"default",action:"appearance",expectedRevision:before.revision,operationId:randomUUID(),appearance:{accentColor:"#ffffff;opacity:0"}});
  assert.equal(response.status,400);
  assert.deepEqual(await f.service.broadcast.state("default"),before,"rejected styles must preserve the entire control state and revision");
  assert.equal((await f.storage.get("SELECT COUNT(*) AS total FROM mail_live_operations")).total,1);
});

test("historical empty and legacy appearances gain defaults on read without rewriting saved appearance or mail",async(t)=>{
  const f=await fixture(t),id=await f.submit("legacy-mail"),d=await f.display();
  await f.service.updateMessage(id,{isRead:true,isFavorited:true,isFlagged:true});
  await f.act("approve",id);await f.act("show",id);
  const legacyMessages=await f.storage.all("SELECT * FROM mail_messages ORDER BY id");
  const legacyDrafts=await f.storage.all("SELECT * FROM mail_live_drafts ORDER BY message_id");
  const legacySnapshots=await f.storage.all("SELECT * FROM mail_live_snapshots ORDER BY id");
  const legacyQueue=await f.storage.all("SELECT * FROM mail_live_queue ORDER BY message_id");
  for(const saved of [{},...["card","letter","minimal"].map(layout=>({layout,fontSize:27,padding:13,transparent:false}))]) {
    const json=JSON.stringify(saved);await f.storage.run("UPDATE mail_live_channels SET appearance=? WHERE topic_id='default'",[json]);
    const before=await f.storage.get("SELECT * FROM mail_live_channels WHERE topic_id='default'");
    const state=await f.service.broadcast.state("default"),frame=await f.service.broadcast.frame(d.grant,d.receiverId);
    const expected={...DEFAULT_WINDCHIME_LIVE_APPEARANCE,...saved};
    assert.deepEqual(state.appearance,expected);assert.deepEqual(frame.appearance,expected);
    assert.equal(state.appearance.theme,"pure");assert.equal(state.appearance.accentColor,"#2de2e6");
    assert.equal(state.appearance.borderWidth,0);assert.equal(state.appearance.lineHeight,1.65);
    assert.equal(state.appearance.letterSpacing,0);assert.equal(state.appearance.maxWidth,1200);
    assert.equal(frame.snapshot.messageId,id);
    assert.deepEqual(await f.storage.get("SELECT * FROM mail_live_channels WHERE topic_id='default'"),before);
  }
  assert.deepEqual(await f.storage.all("SELECT * FROM mail_messages ORDER BY id"),legacyMessages);
  assert.deepEqual(await f.storage.all("SELECT * FROM mail_live_drafts ORDER BY message_id"),legacyDrafts);
  assert.deepEqual(await f.storage.all("SELECT * FROM mail_live_snapshots ORDER BY id"),legacySnapshots);
  assert.deepEqual(await f.storage.all("SELECT * FROM mail_live_queue ORDER BY message_id"),legacyQueue);
});

test("style edits cannot approve, start playing, revoke or withdraw messages",async(t)=>{
  const f=await fixture(t),pending=await f.submit("pending"),approved=await f.submit("approved"),rejected=await f.submit("rejected"),d=await f.display();
  const initial=await f.service.broadcast.state("default");
  const themed=await f.act("appearance",undefined,{appearance:{theme:"uliuli",layout:"stack"}});
  assert.deepEqual(themed.messages,initial.messages);assert.deepEqual(themed.queue,[]);assert.equal(themed.current,null);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("approve",approved);await f.act("reject",rejected);
  const queued=await f.service.broadcast.state("default");
  const queueStyled=await f.act("appearance",undefined,{appearance:{theme:"mia",lineHeight:1.9}});
  assert.deepEqual(queueStyled.messages,queued.messages);assert.deepEqual(queueStyled.queue,[approved]);assert.equal(queueStyled.current,null);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("show",approved);
  const playing=await f.service.broadcast.state("default"),frame=await f.service.broadcast.frame(d.grant,d.receiverId);
  const liveStyled=await f.act("appearance",undefined,{appearance:{theme:"pure",layout:"banner",borderWidth:2,letterSpacing:-0.5,maxWidth:840}});
  const after=await f.service.broadcast.frame(d.grant,d.receiverId);
  assert.deepEqual(liveStyled.messages,playing.messages);assert.deepEqual(liveStyled.queue,playing.queue);assert.deepEqual(liveStyled.current,playing.current);
  assert.deepEqual(after.snapshot,frame.snapshot);assert.equal(after.activation,frame.activation);
  assert.equal(liveStyled.messages.find(m=>m.id===pending).status,"pending");
  assert.equal(liveStyled.messages.find(m=>m.id===rejected).status,"rejected");
  assert.equal(liveStyled.messages.find(m=>m.id===approved).status,"approved");
  assert.equal(after.appearance.theme,"pure");assert.equal(after.appearance.layout,"banner");
});

test("new/unflagged/read/favorited mail never broadcasts; approval queues without playing; display DTO has no private fields",async(t)=>{
  const f=await fixture(t),id=await f.submit(),d=await f.display();
  await f.service.updateMessage(id,{isRead:true,isFavorited:true,isFlagged:false});
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await assert.rejects(f.act("show",id),e=>e.code==="NOT_APPROVED");
  const approved=await f.act("approve",id);assert.deepEqual(approved.queue,[id]);assert.equal(approved.current,null);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("show",id);
  const frame=await f.service.broadcast.frame(d.grant,d.receiverId);assert.equal(frame.snapshot.text,"private-letter");
  assert.deepEqual(Object.keys(frame.snapshot).sort(),["assets","id","linkUrl","messageId","nickname","text"].sort());
  assert.ok(!JSON.stringify(frame).includes("senderHash"));assert.ok(!JSON.stringify(frame).includes("source_hash"));
  assert.deepEqual((await f.service.broadcast.state("default")).queue,[id]);
});

test("manual next/order/hide/end retain all approved messages, no auto-loop, revoked current is synchronously withdrawn",async(t)=>{
  const f=await fixture(t),a=await f.submit("A"),b=await f.submit("B"),d=await f.display();
  await f.act("approve",a);await f.act("approve",b);await f.act("reorder",undefined,{order:[b,a]});
  await f.act("next");assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot.messageId,b);
  await f.act("hide");assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("next");assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot.messageId,a);
  await f.act("next");assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("end");assert.deepEqual((await f.service.broadcast.state("default")).queue,[b,a]);
  await f.act("next");await f.act("revoke",b);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  assert.deepEqual((await f.service.broadcast.state("default")).queue,[a]);
});

test("draft/source changes require re-review, old preview revisions and queued late show commands are rejected",async(t)=>{
  const f=await fixture(t),id=await f.submit(),d=await f.display();
  await f.act("approve",id);await f.act("show",id);const old=await f.service.broadcast.state("default");
  await f.act("draft",id,{draft:{...old.messages[0].draft,nickname:"changed"}});
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await assert.rejects(f.act("approve",id,{expectedDraftRevision:old.messages[0].draftRevision}),e=>e.code==="DRAFT_CONFLICT");
  await f.act("approve",id);await f.act("show",id);
  await f.storage.run("UPDATE mail_messages SET text='changed-in-database' WHERE id=?",[id]);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  const current=await f.service.broadcast.state("default");assert.equal(current.messages[0].status,"pending");assert.equal(current.messages[0].source.text,"changed-in-database");
  await f.act("approve",id);const beforeHide=await f.service.broadcast.state("default");await f.act("hide");
  await assert.rejects(f.act("show",id,{expectedRevision:beforeHide.revision}),e=>e.code==="REVISION_CONFLICT");
});

test("receiver open/reload/reconnect and server epoch restart never restore current; queue and approval survive",async(t)=>{
  const f=await fixture(t),id=await f.submit(),d=await f.display();await f.act("approve",id);await f.act("show",id);
  const reloaded=await f.service.broadcast.open(d.grant);assert.equal((await f.service.broadcast.frame(d.grant,reloaded.receiverId)).snapshot,null);
  f.advance(3001);await assert.rejects(f.service.broadcast.frame(d.grant,d.receiverId),e=>e.code==="RECEIVER_EXPIRED");
  assert.equal((await f.service.broadcast.state("default")).current,null);
  const reconnected=await f.service.broadcast.open(d.grant);assert.equal((await f.service.broadcast.frame(d.grant,reconnected.receiverId)).snapshot,null);
  assert.equal((await f.service.broadcast.state("default")).current,null);
  const restarted=createWindChimeService({...f.config,runtimeEpoch:"process-b"});await restarted.ready();
  const s=await restarted.broadcast.state("default");assert.deepEqual(s.queue,[id]);assert.equal(s.messages[0].status,"approved");assert.equal(s.current,null);
  await assert.rejects(restarted.broadcast.frame(d.grant,reconnected.receiverId),e=>e.code==="RECEIVER_EXPIRED");
  const newReceiver=await restarted.broadcast.open(d.grant);assert.equal((await restarted.broadcast.frame(d.grant,newReceiver.receiverId)).snapshot,null);
});

test("a new display handshake invalidates delayed show commands without hiding a healthy existing receiver",async(t)=>{
  const f=await fixture(t),id=await f.submit("delayed-show"),d=await f.display();
  await f.act("approve",id);await f.act("show",id);
  const before=await f.service.broadcast.state("default");
  const delayed=f.request("control/action","POST",{topicId:"default",action:"show",messageId:id,expectedRevision:before.revision,operationId:randomUUID()});
  const joined=await f.service.broadcast.open(d.grant);
  assert.equal((await f.service.broadcast.frame(d.grant,joined.receiverId)).snapshot,null);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot.messageId,id,"joining must not interrupt an existing healthy output");
  const response=await f.handler.POST(delayed);
  assert.equal(response.status,409,"a command prepared before the new connection must be rejected");
  assert.equal((await response.json()).code,"REVISION_CONFLICT");
  assert.equal((await f.service.broadcast.frame(d.grant,joined.receiverId)).snapshot,null);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot.messageId,id);
  await f.act("show",id);
  assert.equal((await f.service.broadcast.frame(d.grant,joined.receiverId)).snapshot.messageId,id,"only a fresh manual command may activate the new receiver");
});

test("real Node process exit/restart preserves review/order but starts a blank output epoch",async(t)=>{
  const f=await fixture(t),db=join(f.directory,"mail.db");
  const prefix=`import {createWindChimeSqlite} from './dist/sqlite/index.js';import {createWindChimeService} from './dist/server/index.js';import {randomUUID} from 'node:crypto';const storage=createWindChimeSqlite({filename:process.argv[1]});const s=createWindChimeService({storage,hashSalt:'keep'});await s.ready();`;
  const writer=prefix+`await s.submitMessage({text:'process-persistent'},new Request('http://localhost'));let state=await s.broadcast.state('default');const id=state.messages[0].id;const grant=await s.broadcast.createGrant('default','display');const auth=await s.broadcast.authenticate(grant.token,'display');const receiver=await s.broadcast.open(auth);state=await s.broadcast.state('default');state=await s.broadcast.action({topicId:'default',action:'approve',messageId:id,expectedRevision:state.revision,expectedDraftRevision:state.messages[0].draftRevision,operationId:randomUUID()});await s.broadcast.action({topicId:'default',action:'show',messageId:id,expectedRevision:state.revision,operationId:randomUUID()});console.log(JSON.stringify({id,epoch:s.broadcast.epoch,token:grant.token,receiverId:receiver.receiverId}));await storage.close();`;
  const run=promisify(execFile),opts={cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,timeout:15000};
  const written=JSON.parse((await run(process.execPath,['--input-type=module','-e',writer,db],opts)).stdout.trim());
  const reader=prefix+`const state=await s.broadcast.state('default');const grant=await s.broadcast.authenticate(process.argv[2],'display');const receiver=await s.broadcast.open(grant);const frame=await s.broadcast.frame(grant,receiver.receiverId);console.log(JSON.stringify({state,frame}));await storage.close();`;
  const after=JSON.parse((await run(process.execPath,['--input-type=module','-e',reader,db,written.token],opts)).stdout.trim());
  assert.notEqual(after.state.epoch,written.epoch);assert.equal(after.state.current,null);assert.equal(after.frame.snapshot,null);assert.deepEqual(after.state.queue,[written.id]);assert.equal(after.state.messages[0].status,'approved');
});

test("display cannot access controls/legacy inbox, credentials are topic/site scoped, expired grants fail closed",async(t)=>{
  const f=await fixture(t),topic=await f.service.createTopic({slug:"second",title:"Second"}),id=await f.submit();
  const d=await f.display(),control=await f.service.broadcast.createGrant("default","control");
  assert.equal((await f.call("control/state", "GET",undefined,d.token)).status,401);
  assert.equal((await f.call("control/state?topicId="+topic.id,"GET",undefined,control.token)).status,403);
  assert.equal((await f.call("display/frame?receiverId="+d.receiverId,"GET",undefined,"admin")).status,401);
  const legacyReq=new Request("https://site.test/api/mail/messages",{headers:{authorization:"Bearer "+d.token}});
  assert.equal((await f.legacy.GET(legacyReq)).status,401);
  const other=await fixture(t);await assert.rejects(other.service.broadcast.authenticate(d.token,"display"),e=>e.code==="UNAUTHORIZED");
  await f.service.broadcast.revokeGrant(d.id,"default");assert.equal((await f.call("display/frame?receiverId="+d.receiverId,"GET",undefined,d.token)).status,401);
  assert.equal((await f.call("control/action","POST",{topicId:"default",action:"hide",expectedRevision:0,operationId:randomUUID()},"admin",{origin:"https://evil.test"})).status,403);
});

test("old delete/batch/block/archive/purge paths invalidate broadcast through database triggers",async(t)=>{
  for(const mode of ["delete","batch","block","archive","purge"]) {
    const f=await fixture(t),topic=await f.service.createTopic({slug:"event",title:"Event"}),id=await f.submit(mode,"event"),d=await f.display(topic.id);
    await f.act("approve",id,{},topic.id);await f.act("show",id,{},topic.id);
    if(mode==="delete")await f.service.deleteMessage(id,topic.id);
    if(mode==="batch")await f.service.batchMessages({action:"delete",ids:[id]},topic.id);
    if(mode==="block")await f.service.blockSender(id,topic.id);
    if(mode==="archive"||mode==="purge")await f.service.archiveTopic(topic.id);
    if(mode==="purge") {await f.service.deleteArchivedTopic(topic.id);await assert.rejects(f.service.broadcast.authenticate(d.token,"display"),e=>e.code==="UNAUTHORIZED");}
    else {assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);assert.deepEqual((await f.service.broadcast.state(topic.id)).queue,[]);}
  }
});

test("idempotent retry never replays an old show after hide; transactional failure preserves previous approval",async(t)=>{
  const f=await fixture(t),id=await f.submit(),d=await f.display();await f.act("approve",id);const s=await f.service.broadcast.state("default");
  const command={topicId:"default",action:"show",messageId:id,expectedRevision:s.revision,operationId:randomUUID()};
  await f.service.broadcast.action(command);await f.act("hide");await f.service.broadcast.action(command);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.storage.run("CREATE TRIGGER test_live_failure BEFORE UPDATE ON mail_live_drafts WHEN NEW.status='rejected' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await assert.rejects(f.act("reject",id),/injected failure/);assert.equal((await f.service.broadcast.state("default")).messages[0].status,"approved");
});

test("anonymous normalized image receipts are topic-bound/one-use; only current snapshot assets are readable",async(t)=>{
  const f=await fixture(t),topic=await f.service.createTopic({slug:"other",title:"Other"});
  const png=await sharp({create:{width:5,height:4,channels:4,background:"red"}}).png().toBuffer();
  const upload=await f.service.broadcast.upload(new Request("https://site.test",{headers:{"x-real-ip":"upload"}}),"default",[png],join(f.directory,"media"),null);
  assert.equal(upload.attachments[0].mimeType,"image/webp");const receipt=upload.attachments.map(({id,receipt})=>({id,receipt}));
  await assert.rejects(f.submit("cross","other",{attachments:receipt}),e=>e.code==="INVALID_RECEIPT");
  const id=await f.submit("image","default",{attachments:receipt});await assert.rejects(f.submit("reuse","default",{attachments:receipt}),e=>e.code==="INVALID_RECEIPT");
  const a=upload.attachments[0],d=await f.display();
  await f.act("approve",id);
  assert.equal((await f.call("display/assets/"+a.id+"?receiverId="+d.receiverId+"&activation=0","GET",undefined,d.token)).status,404);
  await f.act("show",id);const frame=await f.service.broadcast.frame(d.grant,d.receiverId);
  assert.equal(frame.snapshot.assets[0].sha256,a.sha256);
  const assetPath="display/assets/"+a.id+"?receiverId="+d.receiverId+"&activation="+frame.activation;
  const asset=await f.call(assetPath,"GET",undefined,d.token);assert.equal(asset.status,200);assert.equal(asset.headers.get("cache-control"),"no-store");
  const bytes=Buffer.from(await asset.arrayBuffer());assert.equal(createHash("sha256").update(bytes).digest("hex"),a.sha256);
  await assert.rejects(f.storage.run("UPDATE mail_live_assets SET sha256='tampered' WHERE id=?",[a.id]),/immutable/);
  await f.act("hide");assert.equal((await f.call(assetPath,"GET",undefined,d.token)).status,404);
  await f.act("show",id);await writeFile(join(f.directory,"media",a.id+".webp"),"tampered");
  const nowFrame=await f.service.broadcast.frame(d.grant,d.receiverId);
  assert.equal((await f.call("display/assets/"+a.id+"?receiverId="+d.receiverId+"&activation="+nowFrame.activation,"GET",undefined,d.token)).status,409);
  await assert.rejects(f.service.broadcast.controlAsset(topic.id,a.id),e=>e.code==="ASSET_NOT_FOUND");
});

test("batch upload spends Turnstile once, rejects SVG and oversized decoded images, receipt bypass cannot be forged",async(t)=>{
  let verifies=0;
  const f=await fixture(t,{turnstileSecret:"secret",fetch:async()=>{verifies++;return Response.json({success:true});}});
  const png=await sharp({create:{width:2,height:3,channels:3,background:"white"}}).png().toBuffer();
  const u=await f.service.broadcast.upload(new Request("https://site.test"),"default",[png,png],join(f.directory,"media"),"once");assert.equal(verifies,1);
  await f.submit("uploaded","default",{attachments:u.attachments.map(({id,receipt})=>({id,receipt}))});assert.equal(verifies,1);
  await assert.rejects(f.submit("fake","default",{attachments:[{id:randomUUID(),receipt:"forged"}]}),e=>e.code==="INVALID_RECEIPT");assert.equal(verifies,1);
  await assert.rejects(f.service.broadcast.upload(new Request("https://site.test"),"default",[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>')],join(f.directory,"media"),"two"),e=>e.code==="INVALID_IMAGE");
  const huge=await sharp({create:{width:4100,height:4100,channels:3,background:"white"}}).png().toBuffer();
  await assert.rejects(f.service.broadcast.upload(new Request("https://site.test"),"default",[huge],join(f.directory,"media"),"three"),e=>["INVALID_IMAGE","IMAGE_TOO_LARGE"].includes(e.code));
});

test("private moderator replacement images preserve original submission and require a new approved draft",async(t)=>{
  const f=await fixture(t),id=await f.submit("fan-original"),other=await f.submit("other"),d=await f.display();
  await f.act("approve",id);await f.act("show",id);
  const png=await sharp({create:{width:3,height:2,channels:3,background:"blue"}}).png().toBuffer();
  const form=new FormData();form.set("topicId","default");form.set("messageId",id);form.append("file",new Blob([png],{type:"image/png"}),"private.png");
  const req=new Request("https://site.test/api/mail/live/control/upload",{method:"POST",headers:{"x-admin":"yes"},body:form});
  const response=await f.handler.POST(req);assert.equal(response.status,201);const uploaded=await response.json(),asset=uploaded.attachments[0];
  assert.equal(asset.receipt,undefined);assert.equal(asset.mimeType,"image/webp");
  const state=await f.service.broadcast.state("default"),message=state.messages.find((m)=>m.id===id);
  assert.equal(message.source.text,"fan-original");assert.deepEqual(message.source.assets,[]);assert.equal(message.status,"approved");
  const current=await f.service.broadcast.frame(d.grant,d.receiverId);assert.equal(current.snapshot.assets.length,0);
  await assert.rejects(f.service.broadcast.displayAsset(d.grant,d.receiverId,current.activation,asset.id),e=>e.code==="ASSET_NOT_FOUND");
  const otherDraft=state.messages.find((m)=>m.id===other).draft;
  await assert.rejects(f.act("draft",other,{draft:{...otherDraft,assets:[{id:asset.id,caption:"wrong-message"}]}}),e=>e.code==="INVALID_ASSET");
  await f.act("draft",id,{draft:{...message.draft,assets:[{id:asset.id,caption:"reviewed replacement"}]}});
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot,null);
  await f.act("approve",id);await f.act("show",id);
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).snapshot.assets[0].caption,"reviewed replacement");
  await f.act("appearance",undefined,{appearance:{imageLayout:"grid"}});
  assert.equal((await f.service.broadcast.frame(d.grant,d.receiverId)).appearance.imageLayout,"grid");
  const forbidden=new FormData();forbidden.set("topicId","default");forbidden.set("messageId",id);forbidden.append("file",new Blob([png]),"blocked.png");
  assert.equal((await f.handler.POST(new Request("https://site.test/api/mail/live/control/upload",{method:"POST",headers:{authorization:"Bearer "+d.token},body:forbidden}))).status,401);
});

test("device pairing requires host approval and PKCE; redemption once; control cannot issue broader grants",async(t)=>{
  const f=await fixture(t),verifier="v".repeat(50),challenge=createHash("sha256").update(verifier).digest("base64url");
  const p=await f.service.broadcast.requestDevice("Desktop",challenge);assert.deepEqual(await f.service.broadcast.pollDevice(p.deviceCode,verifier),{status:"pending"});
  await assert.rejects(f.service.broadcast.pollDevice(p.deviceCode,"x".repeat(50)),e=>e.code==="INVALID_VERIFIER");
  await f.service.broadcast.approveDevice(p.userCode,"default");const redeemed=await f.service.broadcast.pollDevice(p.deviceCode,verifier);assert.equal(redeemed.status,"approved");
  await assert.rejects(f.service.broadcast.pollDevice(p.deviceCode,verifier),e=>e.code==="DEVICE_EXPIRED");
  assert.equal((await f.call("control/state","GET",undefined,redeemed.token)).status,200);
  assert.equal((await f.call("control/grants","POST",{topicId:"default",kind:"control"},redeemed.token)).status,403);
});

test("allowlisted gateway origins cannot use ambient administrator cookies on GET or writes",async(t)=>{
  const f=await fixture(t,{routes:{allowedOrigins:["https://gateway.test"]}});await f.submit("never-expose");
  for (const origin of ["https://gateway.test","https://evil.test"]) {
    const response=await f.call("control/state","GET",undefined,"admin",{origin,"sec-fetch-site":"same-site"});
    assert.equal(response.status,403);assert.ok(!(await response.text()).includes("never-expose"));
    assert.notEqual(response.headers.get("access-control-allow-credentials"),"true");
    assert.equal((await f.call("control/grants","POST",{topicId:"default",kind:"control"},"admin",{origin})).status,403);
  }
  const d=await f.display();assert.equal((await f.call("display/frame?receiverId="+d.receiverId,"GET",undefined,d.token,{origin:"https://gateway.test"})).status,200);
});

test("revoking or expiring a desktop control grant invalidates its derived display credentials",async(t)=>{
  const f=await fixture(t),id=await f.submit();
  const parent=await f.service.broadcast.createGrant("default","control","device",5000);
  const minted=await (await f.call("control/grants","POST",{topicId:"default",kind:"display"},parent.token)).json();
  const independent=await f.display();
  const childGrant=await f.service.broadcast.authenticate(minted.token,"display"),childReceiver=await f.service.broadcast.open(childGrant);
  await f.act("approve",id);await f.act("show",id);
  await f.service.broadcast.revokeGrant(parent.id,"default");
  await assert.rejects(f.service.broadcast.authenticate(minted.token,"display"),e=>e.code==="UNAUTHORIZED");
  await assert.rejects(f.service.broadcast.frame(childGrant,childReceiver.receiverId),e=>["RECEIVER_EXPIRED","UNAUTHORIZED"].includes(e.code));
  assert.equal((await f.service.broadcast.frame(independent.grant,independent.receiverId)).snapshot.messageId,id);
  const expiring=await f.service.broadcast.createGrant("default","control","short",1000),derived=await f.service.broadcast.createGrant("default","display","derived",10000,null,null,expiring.id);
  f.advance(1001);await assert.rejects(f.service.broadcast.authenticate(derived.token,"display"),e=>e.code==="UNAUTHORIZED");
});

test("competing commands from two control clients use optimistic revision and preserve database restart state",async(t)=>{
  const f=await fixture(t),a=await f.submit("one"),b=await f.submit("two"),d=await f.display();await f.act("approve",a);await f.act("approve",b);
  const before=await f.service.broadcast.state("default");
  const commands=[a,b].map((id)=>({topicId:"default",action:"show",messageId:id,expectedRevision:before.revision,operationId:randomUUID()}));
  const results=await Promise.allSettled(commands.map((c)=>f.service.broadcast.action(c)));
  assert.equal(results.filter((r)=>r.status==="fulfilled").length,1);
  assert.equal(results.find((r)=>r.status==="rejected").reason.code,"REVISION_CONFLICT");
  const copied=createWindChimeSqlite({filename:join(f.directory,"mail.db")});await copied.ready;
  try { assert.equal((await copied.all("SELECT * FROM mail_live_queue")).length,2);assert.equal((await copied.all("SELECT * FROM mail_live_drafts WHERE status='approved'")).length,2); }
  finally { await copied.close(); }
});

test("gateway cryptographic scope, proof replay, independent expiring platform lease, renewal and revocation",async(t)=>{
  const keys=generateKeyPairSync("ed25519"),issuer="https://gateway.test";
  const f=await fixture(t,{routes:{gatewayIssuer:issuer,gatewayPublicKeys:{k:keys.publicKey.export({type:"spki",format:"pem"})}}});
  const challenge=await f.service.broadcast.bindingChallenge("default","https://site.test"),sec=()=>Math.floor(f.now()/1000);
  const base={iss:issuer,aud:"https://site.test",siteId:challenge.siteId,topicId:"default",bindingId:"binding-1",biliSubject:"user-1",sessionId:"session-1"};
  const jwt=(kind,extra={},ttl=kind==="lease"?3:kind==="display"?60:300)=>{
    const h=Buffer.from(JSON.stringify({alg:"EdDSA",kid:"k"})).toString("base64url"),p=Buffer.from(JSON.stringify({...base,kind,jti:randomUUID(),iat:sec(),exp:sec()+ttl,...extra})).toString("base64url");return h+"."+p+"."+sign(null,Buffer.from(h+"."+p),keys.privateKey).toString("base64url");
  };
  const binding=jwt("binding",{nonce:challenge.nonce});assert.equal((await f.call("control/bind","POST",{topicId:"default",proof:binding})).status,200);
  assert.notEqual((await f.call("control/bind","POST",{topicId:"default",proof:binding})).status,200);
  const displayProof=jwt("display"),exchanged=await f.call("gateway/exchange","POST",{proof:displayProof},null);assert.equal(exchanged.status,200);const grant=await exchanged.json();
  assert.equal((await f.call("gateway/exchange","POST",{proof:displayProof},null)).status,409);
  assert.notEqual((await f.call("display/open","POST",{},grant.token)).status,200);
  const lease=jwt("lease"),opened=await (await f.call("display/open","POST",{},grant.token,{"x-windchime-platform-lease":lease})).json();assert.ok(opened.receiverId);
  const id=await f.submit();await f.act("approve",id);await f.act("show",id);
  const path="display/frame?receiverId="+opened.receiverId;
  assert.ok((await (await f.call(path,"GET",undefined,grant.token,{"x-windchime-platform-lease":lease})).json()).snapshot);
  f.advance(1500);
  const shortLeaseFrame=await (await f.call(path,"GET",undefined,grant.token,{"x-windchime-platform-lease":lease})).json();
  assert.equal(shortLeaseFrame.leaseMs,1500);
  assert.equal((await f.call("gateway/renew","POST",{proof:jwt("display")},grant.token)).status,200);
  f.advance(3100);assert.equal((await f.call(path,"GET",undefined,grant.token,{"x-windchime-platform-lease":lease})).status,401);
  assert.equal((await f.call("gateway/exchange","POST",{proof:jwt("display",{topicId:"other"})},null)).status,403);
  assert.equal((await f.call("control/bind?topicId=default","DELETE")).status,200);
  assert.equal((await f.call(path,"GET",undefined,grant.token,{"x-windchime-platform-lease":jwt("lease")})).status,401);
});
