import test from 'node:test';
import assert from 'node:assert/strict';
import { readDisplayBootstrap } from '../display/bootstrap.mjs';

test('ordinary display reload retains only its readonly connection inputs and can reopen blank',()=>{
  const source='https://gateway.example/display?unexpected=query#siteBaseUrl=https%3A%2F%2Fsite.example%2Fapi%2Fmail%2Flive&token=wc_disp_test&snapshot=untrusted-content';
  const first=readDisplayBootstrap(source);
  const reload=readDisplayBootstrap(new URL(first.reloadUrl,source).href);
  assert.equal(reload.platformMode,false);assert.equal(reload.displayToken,'wc_disp_test');
  assert.equal(reload.siteBaseUrl,'https://site.example/api/mail/live');
  assert.equal(Object.keys(reload).some(key=>/snapshot|frame|approval|current/i.test(key)),false);
  assert.equal(new URL(first.reloadUrl,source).search,'');
  assert.ok(!first.reloadUrl.includes('snapshot'));
  assert.ok(!first.reloadUrl.includes('untrusted-content'));
});

test('H5 reload discards a consumed proof but preserves the authenticated parent bridge request',()=>{
  const source='https://gateway.example/display#siteBaseUrl=https%3A%2F%2Fsite.example%2Fapi%2Fmail%2Flive&gatewayOrigin=https%3A%2F%2Fgateway.example&gatewayBridgeId=bridge-a&gatewayBindingId=topic-binding&gatewayDisplayProof=already-used-proof&token=must-not-retain';
  const first=readDisplayBootstrap(source);assert.equal(first.initialProof,'already-used-proof');
  const reload=readDisplayBootstrap(new URL(first.reloadUrl,source).href);
  assert.equal(reload.platformMode,true);assert.equal(reload.initialProof,null);assert.equal(reload.displayToken,'');
  assert.equal(reload.bridgeId,'bridge-a');assert.equal(reload.gatewayOrigin,'https://gateway.example');
  assert.equal(reload.siteBaseUrl,'https://site.example/api/mail/live');
  assert.ok(!first.reloadUrl.includes('already-used-proof'));assert.ok(!first.reloadUrl.includes('must-not-retain'));
});
