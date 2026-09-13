// Second, independent Electron process reuses only the preceding temporary test profile.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../out/management-smoke');
let control;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<120;i++){try{if(await check())return;}catch{}await pause(100);}throw new Error('Timed out: '+label);}
async function evaluate(code){return control.webContents.executeJavaScript(code);}
async function run(){
  const previous=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));assert(previous.passed&&previous.profile.includes('windchime-management-'));
  app.setPath('userData',previous.profile);
  globalThis.fetch=async(input)=>{
    const url=new URL(typeof input==='string'?input:input.url),route=url.pathname.replace('/api/mail/live','');
    if(route==='/control/topics')return Response.json({items:[{id:'event-a',title:'深夜来信',slug:'event-a',isDefault:false,isEnabled:true,isEnabledNow:true,state:'active',archivedAt:null}]});
    if(route==='/control/settings')return Response.json({enabled:true,blockedTermsEnabled:false});
    if(route==='/control/messages')return Response.json({items:[],counts:{all:0,unread:0,favorited:0,flagged:0},blockedTermsEnabled:false});
    if(route==='/control/share')return Response.json({siteName:'重启测试站',origin:url.origin,topicId:'event-a',topicTitle:'深夜来信',submissionUrl:url.origin+'/m/event-a',posterDefaults:{title:'服务端默认标题',subtitle:'不应覆盖已保存偏好',signature:'默认署名'}});
    throw new Error('Offline restart fixture denies '+route);
  };
  const savedPath=path.join(output,'poster-after-process-restart.png');dialog.showSaveDialog=async()=>({canceled:false,filePath:savedPath});
  require('../main.cjs');await app.whenReady();
  await until(()=>{control=BrowserWindow.getAllWindows().find(window=>window.getTitle().includes('私人控制台'));return control;},'private controller');
  await until(()=>evaluate('!!document.querySelector("nav button[aria-label=投稿分享]")&&!document.querySelector("nav button[aria-label=投稿分享]").disabled'),'restored connection');
  await evaluate('document.querySelector("nav button[aria-label=投稿分享]").click()');
  await until(()=>evaluate('document.querySelector(".share-grid input[maxlength]")?.value==="私藏的海报标题"'),'persisted title in second process');
  assert.equal(await evaluate('document.querySelector("input[aria-label=海报署名]").value'),'桌面署名测试');
  await until(()=>evaluate('document.querySelector(".poster-avatar img")?.naturalWidth>0'),'persisted avatar in second process');
  await until(()=>evaluate('Array.from(document.querySelectorAll("button")).some(button=>button.textContent==="保存海报 PNG"&&!button.disabled)'),'poster render after restart');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="保存海报 PNG").click()');
  await until(async()=>{try{return (await fs.stat(savedPath)).size>10000;}catch{return false;}},'actual PNG saved after restart');
  assert.equal(BrowserWindow.getAllWindows().length,1,'restart does not open output');
  await fs.writeFile(path.join(output,'poster-restored-ui.png'),(await control.webContents.capturePage()).toPNG());
  const report={passed:true,electron:process.versions.electron,independentProcess:true,checks:['title/signature/avatar restored by shared poster configuration in second Electron process','default website values do not overwrite saved poster preferences','PNG actually written after restart','restart opens only private controller; no display opened'],savedPath,bytes:(await fs.stat(savedPath)).size};await fs.writeFile(path.join(output,'poster-restart-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}
run().catch(error=>{console.error(error.stack);app.exit(1);});
