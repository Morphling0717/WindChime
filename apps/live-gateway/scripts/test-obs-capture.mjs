// Explicit local acceptance helper: controls only a prepared portable OBS and disposable site.
// OBS must already be running with authenticated obs-websocket; this script never starts outputs.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const base=process.env.WINDCHIME_SMOKE_URL||'http://localhost:3011';
const gateway=process.env.WINDCHIME_OBS_DISPLAY_ORIGIN||'http://localhost:3390';
const portable=process.env.WINDCHIME_OBS_PORTABLE_DIRECTORY;
const password=process.env.WINDCHIME_SMOKE_PASSWORD;
assert.equal(process.env.WINDCHIME_SMOKE_ALLOW_WRITES,'1','Explicit disposable-site writes required');
for(const value of [base,gateway])assert(['localhost','127.0.0.1'].includes(new URL(value).hostname),'Only local acceptance sites allowed');
assert(portable&&password,'Set portable directory and disposable-site password');
await access(join(portable,'portable_mode.txt'));
const obsConfig=JSON.parse(await readFile(join(portable,'config/obs-studio/plugin_config/obs-websocket/config.json'),'utf8'));
assert(obsConfig.server_enabled&&obsConfig.auth_required&&obsConfig.server_password,'Authenticated prepared portable API required');
const output=resolve(process.env.WINDCHIME_OBS_OUTPUT||join(tmpdir(),`windchime-obs-capture-${Date.now()}`));
await mkdir(output,{recursive:true});
const report={date:new Date().toISOString(),site:base,output,checks:[],screenshots:[]};
const check=(label,condition,detail)=>{assert(condition,label);report.checks.push({label,pass:true,...(detail?{detail}:{})});};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const b64=value=>createHash('sha256').update(value).digest('base64');
const pending=new Map();let identifiedResolve,identifiedReject;
const identified=new Promise((resolve,reject)=>{identifiedResolve=resolve;identifiedReject=reject;});
const socket=new WebSocket(`ws://127.0.0.1:${obsConfig.server_port}`);
const identifyTimeout=setTimeout(()=>identifiedReject(new Error('OBS authentication timeout')),10000);
socket.addEventListener('error',()=>identifiedReject(new Error('OBS websocket unavailable')));
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.op===0){
    assert(message.d.authentication,'Expected authentication challenge');
    const {salt,challenge}=message.d.authentication;
    socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0,authentication:b64(b64(obsConfig.server_password+salt)+challenge)}}));
  }else if(message.op===2){clearTimeout(identifyTimeout);identifiedResolve();}
  else if(message.op===7){const item=pending.get(message.d.requestId);if(!item)return;pending.delete(message.d.requestId);clearTimeout(item.timer);message.d.requestStatus.result?item.resolve(message.d.responseData||{}):item.reject(new Error(`${message.d.requestType}: ${message.d.requestStatus.code} ${message.d.requestStatus.comment||''}`));}
});
function rpc(requestType,requestData={}){
  assert(!/^(Start|Toggle)(Stream|Record|Virtual|Replay)/.test(requestType),'Output starts forbidden in acceptance helper');
  const requestId=randomUUID();return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`OBS request timeout: ${requestType}`));},10000);
    pending.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));
  });
}
async function site(path,{method='GET',body,admin=false,token}={}){
  const response=await fetch(base+path,{method,headers:{...(admin?{'x-mail-password':password}:{}),...(token?{authorization:`Bearer ${token}`} : {}),...(body!==undefined&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  assert(response.ok,`${method} ${path} failed ${response.status}`);return response.json();
}
let topic,grant,state,messageId,sceneName;
const prefix='/api/mail/live';
const refresh=async()=>state=await site(`${prefix}/control/state?topicId=${topic.id}`,{admin:true});
async function command(action,extra={}){
  await refresh();const item=state.messages.find(item=>item.id===messageId);
  state=await site(`${prefix}/control/action`,{method:'POST',admin:true,body:{topicId:topic.id,action,messageId,operationId:randomUUID(),expectedRevision:state.revision,expectedDraftRevision:item?.draftRevision,...extra}});return state;
}
async function screenshot(sourceName,name){
  const result=await rpc('GetSourceScreenshot',{sourceName,imageFormat:'png',imageWidth:1280,imageHeight:720});
  assert(result.imageData.startsWith('data:image/png;base64,'));
  const bytes=Buffer.from(result.imageData.split(',')[1],'base64');await writeFile(join(output,name),bytes);
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let visible=0,transparent=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;else visible++;}
  report.screenshots.push({name,width:info.width,height:info.height,visible,transparent});return {bytes,data,info,visible,transparent};
}
try{
  await identified;const version=await rpc('GetVersion');report.obsVersion=version.obsVersion;report.obsWebSocketVersion=version.obsWebSocketVersion;
  const originalScene=(await rpc('GetSceneList')).currentProgramSceneName;
  const stream=await rpc('GetStreamStatus'),record=await rpc('GetRecordStatus'),virtual=await rpc('GetVirtualCamStatus');
  check('OBS not streaming, recording or running virtual camera',!stream.outputActive&&!record.outputActive&&!virtual.outputActive);
  const special=await rpc('GetSpecialInputs');for(const inputName of Object.values(special))if(inputName)await rpc('SetInputMute',{inputName,inputMuted:true});
  await rpc('SetVideoSettings',{baseWidth:1280,baseHeight:720,outputWidth:1280,outputHeight:720});
  const slug=`obs-capture-${randomUUID().slice(0,8)}`;
  topic=await site('/api/mail/topics',{method:'POST',admin:true,body:{slug,title:'OBS isolated capture fixture'}});
  await site('/api/mail/messages',{method:'POST',body:{text:'OBS_PRIVATE_SOURCE_DO_NOT_DISPLAY',nickname:'Original private sender',topicSlug:slug,senderFingerprint:randomUUID()}});
  await refresh();messageId=state.messages[0].id;
  const raw=Buffer.alloc(1280*720*3);for(let y=0;y<720;y++)for(let x=0;x<1280;x++){const tone=((x>>5)+(y>>5))%2?42:24;const i=(y*1280+x)*3;raw[i]=tone;raw[i+1]=tone;raw[i+2]=tone;}
  const checker=join(output,'checkerboard.png');await sharp(raw,{raw:{width:1280,height:720,channels:3}}).png().toFile(checker);
  const asset=await sharp({create:{width:160,height:96,channels:4,background:'#56b6f5'}}).png().toBuffer();
  const form=new FormData();form.set('topicId',topic.id);form.set('messageId',messageId);form.append('file',new Blob([asset],{type:'image/png'}),'capture-fixture.png');
  const uploaded=await site(`${prefix}/control/upload`,{method:'POST',admin:true,body:form});
  await command('draft',{draft:{text:'WindChime OBS capture verified',nickname:'Synthetic reviewed sender',linkUrl:'',assets:uploaded.attachments.map(item=>({id:item.id,caption:'Reviewed immutable image'}))}});
  await command('appearance',{appearance:{...state.appearance,transparent:true,textColor:'#ffffff',fontSize:48,animation:'none'}});
  grant=await site(`${prefix}/control/grants`,{method:'POST',admin:true,body:{topicId:topic.id,kind:'display',label:'OBS disposable browser source'}});
  const displayUrl=new URL('/display',gateway);displayUrl.hash=new URLSearchParams({siteBaseUrl:base+prefix,token:grant.token}).toString();
  sceneName=`WindChime capture ${slug}`;const browserName=`WindChime output ${slug}`;
  await rpc('CreateScene',{sceneName});
  await rpc('CreateInput',{sceneName,inputName:`Checkerboard ${slug}`,inputKind:'image_source',inputSettings:{file:checker},sceneItemEnabled:true});
  await rpc('CreateInput',{sceneName,inputName:browserName,inputKind:'browser_source',inputSettings:{url:displayUrl.href,width:1280,height:720,shutdown:false,restart_when_active:false,css:'body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }'},sceneItemEnabled:true});
  await rpc('SetCurrentProgramScene',{sceneName});
  report.browserSourceActive=await rpc('GetSourceActive',{sourceName:browserName});
  await screenshot(sceneName,'00-initial-checkerboard.png');
  for(let i=0;i<30;i++){await refresh();if(state.receivers>0)break;await sleep(250);}
  check('OBS browser source connected to display-only receiver',state.receivers>0);
  const initial=await screenshot(browserName,'01-initial-transparent.png');check('Unapproved initial source is completely transparent',initial.visible===0);
  await command('approve');await sleep(1200);
  const approved=await screenshot(browserName,'02-approved-not-playing.png');check('Approval does not display in OBS',approved.visible===0);
  await command('show');let shown;for(let i=0;i<20;i++){await sleep(250);shown=await screenshot(browserName,'03-manual-show-source.png');if(shown.visible>0)break;}
  check('Manual show reaches OBS browser renderer',shown.visible>0);
  check('Rendered source retains transparent background',shown.transparent>1280*720/2);
  const composite=await screenshot(sceneName,'04-manual-show-composite.png');
  const sample=(data,x,y)=>Array.from(data.subarray((y*1280+x)*4,(y*1280+x)*4+4));
  const bgA=sample(composite.data,1100,650),bgB=sample(composite.data,1132,650);
  check('Transparent output exposes both checkerboard shades in OBS composition',bgA[3]===255&&bgB[3]===255&&bgA[0]!==bgB[0],{bgA,bgB});
  const hideStart=performance.now();await command('hide');const committed=performance.now();let hidden;
  for(let i=0;i<25;i++){hidden=await screenshot(browserName,'05-hidden-source.png');if(hidden.visible===0)break;await sleep(80);}
  check('One-click hide clears OBS source',hidden.visible===0,{commandToEmptyMs:Math.round(performance.now()-hideStart),responseToEmptyMs:Math.round(performance.now()-committed)});
  await screenshot(sceneName,'06-hidden-checkerboard.png');
  await command('show');await sleep(1200);await command('revoke');await sleep(1200);
  const revoked=await screenshot(browserName,'07-revoked-source.png');check('Revoking current approval clears OBS source',revoked.visible===0);
  const finalStream=await rpc('GetStreamStatus'),finalRecord=await rpc('GetRecordStatus'),finalVirtual=await rpc('GetVirtualCamStatus');
  check('No output started during capture test',!finalStream.outputActive&&!finalRecord.outputActive&&!finalVirtual.outputActive);
  report.result='passed';report.originalPortableScene=originalScene;
}catch(error){report.result='failed';report.error=error.message;process.exitCode=1;}
finally{
  if(topic){try{await command('hide');}catch{}if(grant)try{await site(`${prefix}/control/grants/${grant.id}?topicId=${topic.id}`,{method:'DELETE',admin:true});}catch{}try{await site(`/api/mail/topics/${topic.id}`,{method:'DELETE',admin:true,body:{markReadFirst:false}});await site(`/api/mail/topics/${topic.id}/purge`,{method:'DELETE',admin:true});report.fixturePurged=true;}catch(error){report.cleanupError=error.message;}}
  clearTimeout(identifyTimeout);socket.close();for(const item of pending.values())clearTimeout(item.timer);
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,passed:report.checks.length,output,error:report.error,fixturePurged:report.fixturePurged}));
}
