import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
const base=process.env.WINDCHIME_SMOKE_URL || 'http://localhost:3011';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)||process.env.WINDCHIME_SMOKE_ALLOW_WRITES!=='1')throw Error('Disposable localhost only');
const password=process.env.WINDCHIME_SMOKE_PASSWORD; assert(password);
async function call(path,body,admin=false){const r=await fetch(base+path,{method:'POST',headers:{...(body instanceof FormData?{}:{'content-type':'application/json'}),...(admin?{'x-mail-password':password}:{})},body:body instanceof FormData?body:JSON.stringify(body)});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;}
const slug='browser-'+randomUUID().slice(0,8),topic=await call('/api/mail/topics',{slug,title:'直播验收 · 合成来信'},true);
const form=new FormData();form.set('topicId',topic.id);
for(const [i,color] of ['#73cec0','#a4c3ef'].entries()){const bytes=await sharp({create:{width:640,height:360,channels:3,background:color}}).png().toBuffer();form.append('file',new Blob([bytes],{type:'image/png'}),`fixture-${i+1}.png`);}
const upload=await call('/api/mail/live/upload',form);
await call('/api/mail/messages',{topicSlug:slug,text:'第一封：谢谢今天的陪伴。愿你今晚也有好梦。',nickname:'测试粉丝 A',attachments:upload.attachments.map(a=>({id:a.id,receipt:a.receipt})),senderFingerprint:randomUUID()});
await call('/api/mail/messages',{topicSlug:slug,text:'第二封：这一封只有主播手动选择后才会出现。',nickname:'测试粉丝 B',senderFingerprint:randomUUID()});
console.log(JSON.stringify({base,topicId:topic.id,slug,controlUrl:base+'/mail/live?topicId='+topic.id,fanUrl:base+'/m/'+slug}));
