const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrigin, validateRequest, restoreSite, verifier, challenge, publicSite } = require('../security.cjs');
test('site connections only accept explicit HTTPS origin or loopback development origin', () => {
  assert.equal(normalizeOrigin('https://mail.example.com'), 'https://mail.example.com');
  assert.equal(normalizeOrigin('http://127.0.0.1:3011'), 'http://127.0.0.1:3011');
  for (const input of ['file:///etc/passwd','http://remote.example.com','https://user:secret@example.com','https://example.com?token=x','https://example.com/admin']) assert.throws(() => normalizeOrigin(input));
});
test('display IPC cannot call admin, pairing, grant, filesystem or other hosts', () => {
  assert.equal(validateRequest({ path:'/display/frame?receiverId=abc',method:'GET'}, 'display').path, '/display/frame?receiverId=abc');
  for (const input of [
    {path:'/control/state',method:'GET'}, {path:'/control/action',method:'POST',body:{}},
    {path:'/control/grants',method:'POST',body:{}}, {path:'/devices/poll',method:'POST',body:{}},
    {path:'//evil.test/display/frame',method:'GET'}, {path:'/display/../control/state',method:'GET'},
    {path:'/display/%2e%2e/control/state',method:'GET'}, {path:'/display/frame',method:'DELETE'},
  ]) assert.throws(() => validateRequest(input, 'display'));
});
test('control IPC enforces selected topic and excludes token-producing endpoints', () => {
  assert.equal(validateRequest({path:'/control/state',method:'GET'}, 'control','topic-A').path, '/control/state?topicId=topic-A');
  assert.throws(() => validateRequest({path:'/control/state?topicId=topic-B',method:'GET'}, 'control','topic-A'));
  assert.throws(() => validateRequest({path:'/control/action',method:'POST',body:{topicId:'topic-B',action:'show'}}, 'control','topic-A'));
  for (const path of ['/control/grants','/devices/poll','/gateway/exchange','/gateway/renew','/control/binding-challenge','/control/bind']) assert.throws(() => validateRequest({path,method:'POST',body:{topicId:'topic-A'}}, 'control','topic-A'));
  assert.throws(() => validateRequest({path:'/control/bind',method:'DELETE'},'control','topic-A'));
  assert.throws(() => validateRequest({path:'/display/frame',method:'GET'},'unknown'));
});
test('pairing verifier is unpredictable and public metadata omits credentials and obsolete integration fields', () => {
  assert.notEqual(verifier(), verifier()); assert.equal(challenge('example').length, 43);
  const metadata = publicSite({id:'a',label:'A',origin:'https://a.test',siteId:'s',topicId:'t',token:'wc_ctl_SECRET',sessionToken:'BILI',expiresAt:'x',gatewayOrigin:'https://old-gateway.test',bindingId:'old-binding'});
  assert(!JSON.stringify(metadata).includes('SECRET')); assert(!JSON.stringify(metadata).includes('BILI'));
  assert(!('gatewayOrigin' in metadata)); assert(!('bindingId' in metadata));
  assert.equal(require('../security.cjs').launchCode, undefined);
});

test('v1 device connections retain necessary credentials and ignore obsolete gateway metadata', () => {
  const legacy={id:'a',label:'A',origin:'https://a.test',siteId:'s',topicId:'t',token:'wc_ctl_SECRET',expiresAt:'2026-10-01T00:00:00Z',gatewayOrigin:'https://old-gateway.test',bindingId:'old-binding',sessionToken:'old-session'};
  const restored=restoreSite(legacy);
  assert.deepEqual(Object.keys(restored).sort(),['id','label','origin','siteId','topicId','token','expiresAt'].sort());
  for(const field of Object.keys(restored))assert.equal(restored[field],legacy[field]);
  assert.throws(()=>restoreSite({...legacy,origin:'http://remote.test'}));
  assert.throws(()=>restoreSite({...legacy,token:'wc_disp_readonly'}));
  assert.throws(()=>restoreSite({...legacy,topicId:null}));
});
