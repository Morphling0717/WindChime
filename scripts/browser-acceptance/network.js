assert(Array.isArray(globalThis.wcPages) && wcPages.length === wcFixtures.length, 'Run open phase and preserve the browser task first');
for (const {p,out,f} of wcPages) {
  const check=name=>wcReport.checks.push({site:f.base,check:name});
  const action=async(name,id)=>p.evaluate(async({topicId,name,id})=>{
    const r=await fetch('/api/mail/live/control/state?topicId='+topicId,{cache:'no-store'});if(!r.ok)throw Error('state '+r.status);const s=await r.json();
    const response=await fetch('/api/mail/live/control/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topicId,action:name,messageId:id,expectedRevision:s.revision,operationId:crypto.randomUUID()})});
    const received=performance.timeOrigin+performance.now();if(!response.ok)throw Error('action '+response.status);await response.json();return received;
  },{topicId:f.topicId,name,id});
  const s=await p.evaluate(async topicId=>(await fetch('/api/mail/live/control/state?topicId='+topicId)).json(),f.topicId);
  const simple=s.messages.find(m=>m.source.text.startsWith('第二封')).id;
  const observe=()=>out.evaluate(()=>{window.wcRemoval?.disconnect();window.wcRemovedAt=0;window.wcRemoval=new MutationObserver(()=>{if(!document.querySelector('article')&&!window.wcRemovedAt)window.wcRemovedAt=performance.timeOrigin+performance.now();});window.wcRemoval.observe(document.body,{childList:true,subtree:true});});
  await action('show',simple);await expect(out.locator('article')).toContainText('第二封');
  await p.getByRole('button',{name:'■ 一键隐藏',exact:true}).click();await expect(out.locator('article')).toHaveCount(0);check('visible emergency hide button clears live output');
  for(let i=wcReport.timing.filter(t=>t.site===f.base && t.type==='hide response to DOM removal').length;i<8;i++) {
    await action('show',simple);await expect(out.locator('article')).toContainText('第二封');await observe();
    const responseAt=await action('hide');await expect(out.locator('article')).toHaveCount(0);
    const removedAt=await out.evaluate(()=>window.wcRemovedAt);assert(removedAt>0);const elapsed=removedAt-responseAt;
    wcReport.timing.push({site:f.base,type:'hide response to DOM removal',sample:i,ms:Math.round(elapsed*10)/10});assert(elapsed<=1000,`Hide exceeds target: ${elapsed}ms`);
  }
  check('8 hide response-to-DOM samples <=1000ms');
  await action('show',simple);await expect(out.locator('article')).toContainText('第二封');
  await out.route('**/api/mail/live/display/**',route=>route.abort());await expect(out.locator('article')).toHaveCount(0,{timeout:4000});
  const rejoined=out.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/display/open') && r.ok());
  await out.unroute('**/api/mail/live/display/**');await rejoined;
  await expect(p.getByText('1 个展示端就绪',{exact:true})).toBeVisible({timeout:15000});await expect(out.locator('article')).toHaveCount(0);check('explicit network failure blanks and reconnect never replays');
  await action('show',simple);await expect(out.locator('article')).toContainText('第二封');await observe();
  const held=[];await out.route('**/api/mail/live/display/frame*',route=>new Promise(resolve=>held.push({route,resolve})));
  const cutAt=await out.evaluate(()=>performance.timeOrigin+performance.now());
  await expect(out.locator('article')).toHaveCount(0,{timeout:4000});const removedAt=await out.evaluate(()=>window.wcRemovedAt);
  wcReport.timing.push({site:f.base,type:'silent disconnect to DOM removal',ms:Math.round((removedAt-cutAt)*10)/10});assert(removedAt-cutAt<=3000,'Silent network expiry exceeds 3s');
  const reopened=out.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/display/open') && r.ok());
  await out.unroute('**/api/mail/live/display/frame*');for(const h of held){await h.route.abort().catch(()=>{});h.resolve();}await reopened;
  await expect(p.getByText('1 个展示端就绪',{exact:true})).toBeVisible({timeout:15000});await expect(out.locator('article')).toHaveCount(0);check('silent network loss <=3000ms and no delayed replay');
  await action('show',simple);await expect(out.locator('article')).toContainText('第二封');
  await out.evaluate(()=>document.dispatchEvent(new Event('freeze')));await expect(out.locator('article')).toHaveCount(0);
  await out.evaluate(()=>document.dispatchEvent(new Event('resume')));await expect(out.locator('article')).toHaveCount(0);
  await expect(p.getByText('1 个展示端就绪',{exact:true})).toBeVisible({timeout:15000});check('browser freeze/resume event handlers blank; not a physical OS sleep test');
}
return wcReport;
