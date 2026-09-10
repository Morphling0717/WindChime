import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.WINDCHIME_SMOKE_URL || 'http://localhost:3011';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname) || process.env.WINDCHIME_SMOKE_ALLOW_WRITES !== '1')
  throw Error('Use a localhost disposable database and WINDCHIME_SMOKE_ALLOW_WRITES=1');
const password = process.env.WINDCHIME_SMOKE_PASSWORD;
assert(password, 'Set test-site password');
const auth = {'x-mail-password':password};
const prefix = '/api/mail/live';
let assertions = 0;
async function request(path, {method='GET',body,headers={},status=200}={}) {
  const response = await fetch(base+path,{method,headers:{...headers,...(body !== undefined && !(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body === undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,status,`${method} ${path}: ${await response.clone().text()}`); assertions++;
  if (response.headers.get('content-type')?.includes('application/json')) return response.json();
  return response.arrayBuffer();
}
const admin = (path, options={})=>request(path,{...options,headers:{...auth,...options.headers}});
const display = token=>({authorization:`Bearer ${token}`});
const slug='live-test-'+randomUUID().slice(0,8);
const topic=await admin('/api/mail/topics',{method:'POST',body:{slug,title:'Live acceptance fixture'},status:201});
const topicId=topic.id;
let otherTopicId;
let state;
const refresh=async()=>state=await admin(prefix+`/control/state?topicId=${topicId}`);
async function command(action,messageId,more={}) {
  const item=state?.messages.find(m=>m.id===messageId);
  return state=await admin(prefix+'/control/action',{method:'POST',body:{topicId,action,messageId,operationId:randomUUID(),expectedRevision:state.revision,expectedDraftRevision:item?.draftRevision,...more}});
}
try {
  const otherTopic=await admin('/api/mail/topics',{method:'POST',body:{slug:slug+'-other',title:'Live acceptance isolation fixture'},status:201});
  otherTopicId=otherTopic.id;
  await request(prefix+'/capabilities');
  await request(prefix+`/control/state?topicId=${topicId}`,{status:401});
  for(const [i,text] of ['first private letter','second private letter'].entries())
    await request('/api/mail/messages',{method:'POST',body:{text,nickname:`Fan ${i}`,topicSlug:slug,senderFingerprint:randomUUID()},headers:{'x-real-ip':`198.51.100.${i+1}`},status:201});
  await refresh(); assert.equal(state.messages.length,2); assert.equal(state.queue.length,0); assertions+=2;
  const first=state.messages.find(m=>m.source.text==='first private letter').id;
  const second=state.messages.find(m=>m.id!==first).id;
  const grant=await admin(prefix+'/control/grants',{method:'POST',body:{topicId,kind:'display',label:'Acceptance output'},status:201});
  await request(prefix+`/control/state?topicId=${topicId}`,{headers:display(grant.token),status:401});
  await request('/api/mail/messages?topicId='+topicId,{headers:display(grant.token),status:401});
  const receiver=await request(prefix+'/display/open',{method:'POST',body:{},headers:display(grant.token)});
  const frame=()=>request(prefix+`/display/frame?receiverId=${receiver.receiverId}`,{headers:display(grant.token)});
  assert.equal((await frame()).snapshot,null); assertions++;
  await command('show',first,{}).then(()=>{throw Error('Unapproved mail was displayed');},error=>{assert.match(error.message,/409|批准|APPROV/);assertions++;});
  await refresh(); await command('approve',first); assert.equal((await frame()).snapshot,null); assertions++;
  await command('approve',second); const retained=[...state.queue];
  await command('show',first); assert.equal((await frame()).snapshot.text,'first private letter'); assertions++;
  await command('next'); assert.equal((await frame()).snapshot.text,'second private letter'); assertions++;
  await command('hide'); assert.equal((await frame()).snapshot,null); assert.deepEqual(state.queue,retained); assertions+=2;
  await command('show',second); await command('revoke',second); assert.equal((await frame()).snapshot,null); assertions++;
  await command('show',first);
  const draft={...state.messages.find(m=>m.id===first).draft,text:'Edited private draft'};
  await command('draft',first,{draft}); assert.equal((await frame()).snapshot,null); assert.equal(state.messages.find(m=>m.id===first).status,'pending'); assertions+=2;
  await command('approve',first); await command('show',first);
  const reopened=await request(prefix+'/display/open',{method:'POST',body:{},headers:display(grant.token)});
  assert.equal((await request(prefix+`/display/frame?receiverId=${reopened.receiverId}`,{headers:display(grant.token)})).snapshot,null); assertions++;
  await command('end'); await refresh(); assert(state.queue.includes(first)); assertions++;
  const other=await admin(prefix+'/control/grants',{method:'POST',body:{topicId:otherTopicId,kind:'control'},status:201});
  await request(prefix+`/control/state?topicId=${topicId}`,{headers:display(other.token),status:403});
  await admin(prefix+`/control/grants/${other.id}?topicId=${otherTopicId}`,{method:'DELETE'});
  console.log(JSON.stringify({site:base,passed:assertions,scenarios:['unapproved denied','approve without play','show next hide','revoke removes current','edit reapproval','fresh receiver blank','retained approval/order','cross-topic denied','display never controls inbox']}));
} finally {
  for (const ownedTopicId of [topicId,otherTopicId].filter(Boolean)) {
    await admin(`/api/mail/topics/${ownedTopicId}`,{method:'DELETE',body:{markReadFirst:false}});
    await admin(`/api/mail/topics/${ownedTopicId}/purge`,{method:'DELETE'});
  }
}
