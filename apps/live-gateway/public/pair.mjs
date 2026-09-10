const id=new URLSearchParams(location.search).get('id');
const form=document.querySelector('#pair-form');
const status=document.querySelector('#status');
let session=null;let timer;
const request=async(path,body,token)=> {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(5000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'连接失败');return data;
};
try{
  if(!id)throw new Error('连接地址无效');
  const pairing=await request(`/api/pairings/${encodeURIComponent(id)}`);
  document.querySelector('#destination').textContent=`连接到 ${pairing.siteOrigin} · ${pairing.topicName}。请核对目标站点和话题。`;
  form.hidden=false;
}catch{status.textContent='连接请求无效或已过期。请从风铃站点重新发起。';}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='正在由平台验证主播身份…';
  try{
    session=await request('/api/sessions/start',{channel:document.querySelector('#channel').value,code:document.querySelector('#code').value});
    document.querySelector('#code').value='';
    timer=setInterval(()=>{request(`/api/sessions/${session.sessionId}/keepalive`,{},session.sessionToken).catch(()=>clearInterval(timer));},1000);
    const result=await request(`/api/pairings/${encodeURIComponent(id)}/authorize`,{sessionId:session.sessionId},session.sessionToken);
    const link=document.querySelector('#return');link.href=result.returnUrl;link.hidden=false;form.hidden=true;
    status.textContent=`已验证 ${session.label}。请返回原站点，以管理员身份确认绑定。`;
  }catch(error){status.textContent=error.message==='invalid_app_id'||error.message==='platform_not_configured'?'网关尚未配置此渠道的平台密钥或项目 ID，请由网关维护者完成服务端配置。':'平台验证未完成。请检查身份码、项目权限及测试房间许可，然后从站点重新连接。';button.disabled=false;}
});
window.addEventListener('pagehide',()=>{
  clearInterval(timer);
  if(session)void fetch(`/api/sessions/${session.sessionId}/end`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.sessionToken}`},body:'{}',credentials:'omit',keepalive:true});
});
