globalThis.wcReport = {startedAt:new Date().toISOString(), checks:[], errors:[], timing:[]};
globalThis.wcPages = [];
for (const f of wcFixtures) {
  const p=context.pages().find(p=>p.url().startsWith(f.base+'/')) ?? await context.newPage();
  p.on('pageerror',e=>wcReport.errors.push(e.message));
  await p.goto(f.base+'/mail',{waitUntil:'domcontentloaded'});
  if (await p.locator('input[type=password]').count()) {
    await p.getByPlaceholder('请输入管理员密码').fill(wcTestPassword);
    await p.getByRole('button',{name:'ENTER',exact:true}).click();
    await p.waitForFunction(()=>!document.querySelector('input[type=password]'));
  }
  await p.goto(f.base+'/mail/live?topicId='+f.topicId,{waitUntil:'domcontentloaded'});
  await p.locator('.wc-mail').filter({hasText:'收尾粉丝 A'}).waitFor();
  await expect(p.locator('.wc-queue li')).toHaveCount(0);
  await p.getByRole('button',{name:'生成只读展示链接',exact:true}).click();
  await p.locator('.wc-grant-url').waitFor();
  const out=await context.newPage();
  out.on('pageerror',e=>wcReport.errors.push(e.message));
  const paths=[];out.on('request',r=>paths.push(new URL(r.url()).pathname));
  await out.goto(await p.locator('.wc-grant-url').innerText(),{waitUntil:'domcontentloaded'});
  await expect(p.getByText('1 个展示端就绪',{exact:true})).toBeVisible({timeout:15000});
  await expect(out.locator('article')).toHaveCount(0);
  globalThis.wcPages.push({p,out,f,paths});
  wcReport.checks.push({site:f.base,check:'real website login, fresh synthetic inbox and display blank'});
}
return {checks:wcReport.checks,errors:wcReport.errors};
