import test from 'node:test';
import assert from 'node:assert/strict';
import { WindChimeDisplayReceiver } from '../dist/broadcast/receiver.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let now = 0; let nextFrame; let opens = 0; const values = [];
  const makeFrame = (snapshot = null, revision = 1, activation = 0) => ({receiverId:`receiver-${opens}`,epoch:'epoch-1',revision,activation,leaseMs:3000,appearance,snapshot});
  const client = {open:async()=>({receiverId:`receiver-${++opens}`,epoch:'epoch-1',leaseMs:3000,pollIntervalMs:1000}),frame:async()=> typeof nextFrame==='function' ? nextFrame() : nextFrame,asset:async()=>new Blob(['safe'],{type:'image/png'})};
  const receiver = new WindChimeDisplayReceiver(client,{now:()=>now,prepareAsset:async()=> 'blob:test',releaseAsset:()=>{}});
  return {receiver,client,values,makeFrame,setFrame:value=>{nextFrame=value},setNow:value=>{now=value},get opens(){return opens},async start(){receiver.start(value=>values.push(value));await flush()},get last(){return values.at(-1)}};
}
const letter = {id:'snapshot-1',messageId:'mail-1',text:'APPROVED',nickname:'Checked nickname',linkUrl:null,assets:[]};
test('initial connection blank; explicit active snapshot appears; error blanks and rejoins without replay', async t => {
  const h=harness();t.after(()=>h.receiver.stop());await h.start();assert.equal(h.last,null);
  h.setFrame(h.makeFrame());await h.receiver.tick();assert.equal(h.last,null);
  h.setFrame(h.makeFrame(letter,2,1));await h.receiver.tick();await flush();assert.equal(h.last.frame.snapshot.text,'APPROVED');
  h.setFrame(()=>{throw new Error('disconnected')});await h.receiver.tick();assert.equal(h.last,null);
  await h.receiver.tick();assert.equal(h.opens,2);assert.equal(h.last,null);
});
test('expired lease blanks within watchdog; stale delayed response cannot restore it', async t => {
  const h=harness();t.after(()=>h.receiver.stop());await h.start();h.setFrame(h.makeFrame(letter,2,1));await h.receiver.tick();await flush();assert(h.last);
  let resolve;h.setFrame(()=>new Promise(r=>{resolve=r}));const pending=h.receiver.tick();
  h.setNow(3001);await new Promise(r=>setTimeout(r,80));assert.equal(h.last,null);
  resolve(h.makeFrame(letter,3,2));await pending;assert.equal(h.last,null);
});
test('hide cancels delayed image decode and it cannot flash after revocation', async t => {
  const h=harness();t.after(()=>h.receiver.stop());await h.start();let finish;
  h.client.asset=()=>new Promise(resolve=>{finish=resolve});
  h.setFrame(h.makeFrame({...letter,assets:[{id:'asset-1',caption:'checked',mimeType:'image/png',width:1,height:1,sha256:'hash'}]},2,1));await h.receiver.tick();await flush();assert.equal(h.last,null);
  h.setFrame(h.makeFrame(null,3,2));await h.receiver.tick();finish(new Blob(['safe'],{type:'image/png'}));await flush();assert.equal(h.last,null);
});
test('out-of-order revision or different epoch fails closed', async t => {
  const h=harness();t.after(()=>h.receiver.stop());await h.start();h.setFrame(h.makeFrame(letter,8,2));await h.receiver.tick();await flush();assert(h.last);
  h.setFrame(h.makeFrame(letter,7,2));await h.receiver.tick();assert.equal(h.last,null);
  await h.receiver.tick();h.setFrame({...h.makeFrame(letter,9,3),epoch:'old-epoch'});await h.receiver.tick();assert.equal(h.last,null);
});
test('suspend reset and restarted receiver begin blank while approvals remain server-side', async t => {
  const h=harness();t.after(()=>h.receiver.stop());await h.start();h.setFrame(h.makeFrame(letter,2,1));await h.receiver.tick();await flush();assert(h.last);
  h.receiver.reset();assert.equal(h.last,null);await h.receiver.tick();assert.equal(h.opens,2);assert.equal(h.last,null);
  h.receiver.stop();await h.start();assert.equal(h.last,null);assert.equal(h.opens,3);
});

for (const [label, configured, expected] of [['default',undefined,1000],['desktop',500,500],['lower bound',1,250],['upper bound',5000,1000],['NaN',NaN,1000],['Infinity',Infinity,1000]]) {
  test(`scheduled polling uses ${label} cadence and stop cancels further requests`, async t => {
    t.mock.timers.enable({apis:['setInterval','setTimeout']});
    let clock=0,opens=0,frames=0;const values=[];
    const client={open:async()=>({receiverId:`receiver-${++opens}`,epoch:'epoch',leaseMs:3000,pollIntervalMs:1000}),frame:async receiverId=>{frames++;return {receiverId,epoch:'epoch',revision:1,activation:0,leaseMs:3000,appearance,snapshot:null};}};
    const receiver=new WindChimeDisplayReceiver(client,{pollIntervalMs:configured,now:()=>clock});t.after(()=>receiver.stop());
    const advance=async ms=>{clock+=ms;t.mock.timers.tick(ms);await flush();};
    receiver.start(value=>values.push(value));await flush();assert.equal(opens,1);assert.equal(frames,0);assert.equal(values.at(-1),null,'joining never fetches or shows an old frame');
    await advance(expected-1);assert.equal(frames,0);
    await advance(1);assert.equal(frames,1);
    await advance(expected);assert.equal(frames,2);
    receiver.stop();await advance(2000);assert.equal(frames,2);assert.equal(opens,1);assert.equal(values.at(-1),null);
  });
}

test('faster polling does not overlap a slow request or replay a late response after reset', async t => {
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  let clock=0,opens=0,frames=0,resolveFrame;const values=[];
  const client={open:async()=>({receiverId:`receiver-${++opens}`,epoch:'epoch',leaseMs:3000,pollIntervalMs:1000}),frame:receiverId=>{frames++;return new Promise(resolve=>{resolveFrame=()=>resolve({receiverId,epoch:'epoch',revision:1,activation:1,leaseMs:3000,appearance,snapshot:letter});});}};
  const receiver=new WindChimeDisplayReceiver(client,{pollIntervalMs:250,now:()=>clock});t.after(()=>receiver.stop());
  const advance=async ms=>{clock+=ms;t.mock.timers.tick(ms);await flush();};
  receiver.start(value=>values.push(value));await flush();await advance(250);assert.equal(frames,1);
  await advance(1000);assert.equal(frames,1,'only one frame request may be in flight');
  receiver.reset();resolveFrame();await flush();assert.equal(values.at(-1),null);
  await advance(250);assert.equal(opens,2);assert.equal(frames,1);assert.equal(values.at(-1),null,'reconnect only joins a fresh blank receiver');
});
