// This module handles only platform identity and display proofs. It never calls a control/inbox API.
const query=location.search.slice(1);const params=new URLSearchParams(query);
const settings=params.get('plug_env')==='1';const requestedBinding=params.get('bindingId');
history.replaceState(null,'',location.pathname); // Never retain platform codes in subsequent URLs or Referer.
let session=null;let frame=null;let timer=null;let alive=true;let inflight=false;let outputStarted=false;let bridgeRefreshing=false;let activeBindingId=null;let lastProofAt=0;let lastSuccess=performance.now();
const bridgeId=crypto.randomUUID();let lastPacket=null;
async function post(path,body,token){
  const response=await fetch(path,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(2000)});
  if(!response.ok)throw new Error('Unavailable');return response.json();
}
function send(packet){if(frame?.contentWindow)frame.contentWindow.postMessage(packet,location.origin);}
function blank(){
  if(!alive)return;alive=false;clearInterval(timer);
  send({type:'windchime:gateway-ended',bridgeId});frame?.remove();frame=null;
  if(session)void fetch(`/api/sessions/${session.sessionId}/end`,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.sessionToken}`},body:'{}',keepalive:true}).catch(()=>{});
}
window.addEventListener('offline',blank);window.addEventListener('pagehide',blank);
window.addEventListener('pageshow',event=>{if(event.persisted)blank();});
document.addEventListener('freeze',blank);document.addEventListener('resume',blank);
const watchdog=setInterval(()=>{if(alive&&outputStarted&&!settings&&performance.now()-lastSuccess>2500)blank();},50);
window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.bridgeId!==bridgeId)return;
  if(event.data?.type!=='windchime:gateway-ready'||!alive||!session)return;
  if(!event.data.needsProof){if(lastPacket)send(lastPacket);return;}
  if(bridgeRefreshing||!activeBindingId)return;bridgeRefreshing=true;
  try{
    const [display,lease]=await Promise.all([
      post(`/api/sessions/${session.sessionId}/display`,{bindingId:activeBindingId},session.sessionToken),
      post(`/api/sessions/${session.sessionId}/lease`,{bindingId:activeBindingId},session.sessionToken)
    ]);
    if(!alive)return;
    lastProofAt=performance.now();lastSuccess=lastProofAt;
    lastPacket={type:'windchime:gateway',bridgeId,displayProof:display.proof,platformLease:lease.proof};send(lastPacket);
  }catch{blank();}finally{bridgeRefreshing=false;}
});
try{
  if(settings){
    // The unsigned settings scene is informational only. In particular it must not consume
    // a CodeSign that the platform may also send to the actual output in the same second.
    clearInterval(watchdog);document.body.classList.add('private');document.querySelector('#setup').hidden=false;
    document.querySelector('#setup-status').textContent='先从风铃站点的直播控制台发起 B 站连接并批准话题绑定，再使用平台提供的实际展示启动入口。设置弹窗不会启动展示场次，也不会允许任何信件上屏。';
  }else{
    session=await post('/api/h5/launch',{query});
    if(!alive)throw new Error('Stopped');
    const desired=requestedBinding||session.selectedBindingId;
    const binding=session.bindings.find(value=>value.bindingId===desired) || (!desired&&session.bindings.length===1?session.bindings[0]:null);
    if(!binding)throw new Error('No binding');
    activeBindingId=binding.bindingId;
    const initial=await post(`/api/sessions/${session.sessionId}/display`,{bindingId:binding.bindingId},session.sessionToken);
    const firstLease=await post(`/api/sessions/${session.sessionId}/lease`,{bindingId:binding.bindingId},session.sessionToken);
    if(!alive)throw new Error('Stopped');
    lastSuccess=performance.now();lastProofAt=lastSuccess;outputStarted=true;
    frame=document.createElement('iframe');frame.id='output';frame.title='风铃独立直播展示';frame.sandbox='allow-scripts allow-same-origin';
    const display=new URL('/display',location.origin);
    display.hash=new URLSearchParams({siteBaseUrl:binding.siteBaseUrl,gatewayOrigin:location.origin,gatewayDisplayProof:initial.proof,gatewayBridgeId:bridgeId,gatewayBindingId:binding.bindingId}).toString();
    lastPacket={type:'windchime:gateway',bridgeId,platformLease:firstLease.proof,displayProof:initial.proof};
    frame.src=display.href;document.body.append(frame);
    timer=setInterval(async()=>{
      if(inflight||!alive)return;inflight=true;
      try{
        const lease=await post(`/api/sessions/${session.sessionId}/lease`,{bindingId:binding.bindingId},session.sessionToken);
        if(!alive)return;
        const packet={type:'windchime:gateway',bridgeId,platformLease:lease.proof};
        if(performance.now()-lastProofAt>=45000){const renewed=await post(`/api/sessions/${session.sessionId}/display`,{bindingId:binding.bindingId},session.sessionToken);if(!alive)return;packet.displayProof=renewed.proof;lastProofAt=performance.now();}
        lastSuccess=performance.now();lastPacket=packet;send(packet);
      }catch{blank();}finally{inflight=false;}
    },1000);
  }
}catch{blank();}
