// Helpers for a browser-owned Playwright runtime or a test runner with logged-in
// local pages. Do not use on production. Return receipts, never raw keys.
const assert = require('node:assert/strict');
function loopbackOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  return url.origin;
}
async function fixtureState(bridge) {
  const response = await fetch(loopbackOrigin(bridge) + '/fixtures');
  assert(response.ok); return response.json();
}
async function generateKeys(pages, bridge) {
  const state = await fixtureState(bridge), receipts = [];
  for (const fixture of state.fixtures.filter(f => !state.received.includes(f.name))) {
    const origin = loopbackOrigin(fixture.origin);
    const page = pages.find(p => p.url().startsWith(origin + '/'));
    assert(page, 'Log in to each disposable website first');
    await page.goto(origin + '/mail?topicId=' + encodeURIComponent(fixture.topicId), {waitUntil:'domcontentloaded'});
    const keySection=page.getByRole('region',{name:'桌面连接密钥'});
    await keySection.waitFor({state:'visible'});
    await page.getByRole('textbox', {name:'密钥名称',exact:true}).fill(fixture.label);
    await page.getByRole('button', {name:'生成连接密钥',exact:true}).click();
    const field = page.getByRole('textbox', {name:'完整连接密钥',exact:true});
    await field.waitFor({state:'visible'});
    const key = await field.inputValue(); assert(key.startsWith('wc_conn_v1.'));
    // Node-side fetch: no browser storage, URL credentials, or clipboard history.
    const response = await fetch(loopbackOrigin(bridge) + '/key', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:fixture.name,key})});
    assert(response.ok, 'Fixture transfer failed');
    await page.getByRole('button', {name:'隐藏密钥',exact:true}).click();
    await field.waitFor({state:'detached'});
    receipts.push({name:fixture.name,generatedViaWeb:true,keyHidden:true});
  }
  return receipts;
}
async function revokeSharedKey(pages, bridge) {
  const state = await fixtureState(bridge);
  assert.equal(state.stage, 'awaiting-browser-revocation', 'Wait for the desktop checks to finish first');
  const fixture = state.fixtures.at(-1), origin = loopbackOrigin(fixture.origin);
  const page = pages.find(p => p.url().startsWith(origin + '/')); assert(page);
  await page.goto(origin + '/mail?topicId=' + encodeURIComponent(fixture.topicId), {waitUntil:'domcontentloaded'});
  const summary = page.locator('summary').filter({hasText:'已生成的授权'}); await summary.click();
  await page.getByRole('button', {name:'刷新授权列表',exact:true}).click();
  const button = page.getByRole('button', {name:'撤销授权 ' + fixture.label,exact:true});
  page.once('dialog', dialog => dialog.accept());
  await button.click(); await button.waitFor({state:'detached'});
  return {name:fixture.name,revokedInWeb:true};
}
module.exports = {generateKeys, revokeSharedKey};
