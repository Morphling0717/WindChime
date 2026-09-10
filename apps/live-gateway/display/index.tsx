import { createRoot } from 'react-dom/client';
import { WindChimeLiveDisplay } from '../../../src/broadcast/Display';
import { createWindChimeDisplayClient } from '../../../src/client/live';
import { readDisplayBootstrap } from './bootstrap.mjs';

const root=createRoot(document.getElementById('root')!);
const bootstrap=readDisplayBootstrap(location.href);
history.replaceState(null,'',bootstrap.reloadUrl);
let displayToken=bootstrap.displayToken;
const {initialProof,gatewayOrigin,bridgeId,platformMode}=bootstrap;
let platformLease='';let platformDeadline=0;let dead=false;let mounted=false;
let proofQueue=Promise.resolve();let lastProof='';

function blank(permanent=false){
  if(permanent)dead=true;
  if(mounted){mounted=false;root.render(null);}
}
function liveLease(){return !!platformLease&&performance.now()<platformDeadline;}
try{
  const base=new URL(bootstrap.siteBaseUrl||'');
  const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if(base.username||base.password||base.hash||base.search||!(base.protocol==='https:'||(base.protocol==='http:'&&local)))throw new Error('Invalid display origin');
  if(platformMode&&(!bridgeId||gatewayOrigin!==location.origin||window.parent===window))throw new Error('Invalid bridge');
  if(!platformMode&&!/^wc_disp_[A-Za-z0-9_-]+$/.test(displayToken))throw new Error('Invalid display grant');
  const siteBaseUrl=base.href.replace(/\/$/,'');
  const client=createWindChimeDisplayClient({baseUrl:siteBaseUrl,getHeaders:()=>{
    if(dead||!displayToken||(platformMode&&!liveLease()))throw new Error('Display lease unavailable');
    return {Authorization:`Bearer ${displayToken}`,...(platformMode?{'X-WindChime-Platform-Lease':platformLease}:{})};
  }});
  function render(){
    if(dead||!displayToken||(platformMode&&!liveLease())){blank();return;}
    if(!mounted){mounted=true;root.render(<WindChimeLiveDisplay client={client}/>);}
  }
  async function consumeProof(proof:string){
    if(dead||proof===lastProof)return;
    lastProof=proof;
    const renew=!!displayToken;
    const response=await fetch(`${siteBaseUrl}/gateway/${renew?'renew':'exchange'}`,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',...(renew?{Authorization:`Bearer ${displayToken}`}:{})},body:JSON.stringify({proof}),signal:AbortSignal.timeout(2500)});
    if(!response.ok)throw new Error('Gateway proof rejected');
    const result=await response.json();
    if(!renew&&!/^wc_disp_[A-Za-z0-9_-]+$/.test(result.token||''))throw new Error('Invalid display grant');
    if(result.token)displayToken=result.token;
    render();
  }
  if(platformMode){
    if(initialProof)proofQueue=proofQueue.then(()=>consumeProof(initialProof)).catch(()=>blank(true));
    window.addEventListener('message',event=>{
      if(event.origin!==gatewayOrigin||event.source!==window.parent||event.data?.bridgeId!==bridgeId||dead)return;
      if(event.data.type==='windchime:gateway-ended'){blank(true);return;}
      if(event.data.type!=='windchime:gateway')return;
      try{
        const lease=event.data.platformLease;
        if(typeof lease!=='string'||lease.length>10000)throw new Error('Invalid lease');
        // This is only a rendering deadline. The site cryptographically validates every lease.
        const body=JSON.parse(atob(lease.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        const remaining=body.exp*1000-Date.now();
        if(body.kind!=='lease'||!Number.isInteger(body.exp)||remaining<=0||remaining>3500)throw new Error('Expired lease');
        platformLease=lease;platformDeadline=performance.now()+Math.min(remaining,3000);render();
        if(typeof event.data.displayProof==='string')proofQueue=proofQueue.then(()=>consumeProof(event.data.displayProof)).catch(()=>blank(true));
      }catch{platformLease='';blank();}
    });
    window.parent.postMessage({type:'windchime:gateway-ready',bridgeId,needsProof:!initialProof},gatewayOrigin!);
    setInterval(()=>{if(!liveLease())blank();},40);
  }else{render();}
  for(const event of ['offline','pagehide'])window.addEventListener(event,()=>blank(true));
  window.addEventListener('pageshow',event=>{if(event.persisted)blank(true);});
  document.addEventListener('freeze',()=>blank(true));document.addEventListener('resume',()=>blank(true));
}catch{blank(true);}
