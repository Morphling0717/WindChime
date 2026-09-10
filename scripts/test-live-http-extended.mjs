import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';

// Adds only UUID-named fixtures; never changes default, global settings, or other messages.
const sites = (process.env.WINDCHIME_SMOKE_URLS || 'http://localhost:3011,http://localhost:3012').split(',').map(value => new URL(value).origin);
assert.equal(sites.length, 2, 'Two independently configured disposable sites are required');
assert(sites.every(site => ['localhost', '127.0.0.1'].includes(new URL(site).hostname)));
assert.equal(process.env.WINDCHIME_SMOKE_ALLOW_WRITES, '1', 'Only explicitly authorized disposable databases');
const password = process.env.WINDCHIME_SMOKE_PASSWORD;
assert(password, 'Set WINDCHIME_SMOKE_PASSWORD for the local test servers');
const prefix = '/api/mail/live';
const bearer = token => ({ authorization: `Bearer ${token}` });
let passed = 0;
const ok = (value, message) => { assert(value, message); passed++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); passed++; };
const fixtures = [];
const events = [];

async function request(site, path, { method = 'GET', body, headers = {}, status = 200 } = {}) {
  const response = await fetch(site + path, {
    method, signal: AbortSignal.timeout(15000), headers: { ...headers, ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (status !== null) equal(response.status, status, `${site} ${method} ${path}: ${JSON.stringify(data)}`);
  return { status: response.status, data, headers: response.headers };
}
const admin = (site, path, options = {}) => request(site, path, { ...options, headers: { 'x-mail-password': password, ...options.headers } });

async function setup(site) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const fixture = { site, suffix, topics: [], grants: [], ip: `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}` };
  fixtures.push(fixture);
  fixture.caps = (await request(site, prefix + '/capabilities')).data;
  for (const label of ['a', 'b']) {
    const topic = (await admin(site, '/api/mail/topics', { method: 'POST', body: { slug: `live-extra-${label}-${suffix}`, title: `HTTP 补测 ${label} ${suffix}`, note: `Private synthetic note ${suffix}` }, status: 201 })).data;
    fixture.topics.push(topic);
  }
  fixture.topic = fixture.topics[0];
  fixture.other = fixture.topics[1];
  fixture.state = async () => (await admin(site, prefix + `/control/state?topicId=${fixture.topic.id}`)).data;
  fixture.command = async (action, messageId, more = {}, status = 200) => {
    const state = await fixture.state();
    const message = state.messages.find(value => value.id === messageId);
    return (await admin(site, prefix + '/control/action', { method: 'POST', body: { topicId: fixture.topic.id, action, messageId, expectedRevision: state.revision, expectedDraftRevision: message?.draftRevision, operationId: randomUUID(), ...more }, status })).data;
  };
  fixture.grant = async (topicId, kind = 'display', authority) => {
    const value = (await admin(site, prefix + '/control/grants', { method: 'POST', body: { topicId, kind, label: `Synthetic HTTP ${suffix}` }, headers: authority ? bearer(authority) : {}, status: 201 })).data;
    fixture.grants.push(value); return value;
  };
  fixture.open = async grant => (await request(site, prefix + '/display/open', { method: 'POST', body: {}, headers: bearer(grant.token) })).data;
  fixture.frame = async (grant, receiver, status = 200) => (await request(site, prefix + `/display/frame?receiverId=${receiver.receiverId}`, { headers: bearer(grant.token), status })).data;
  fixture.asset = (grant, receiver, assetId, activation, status = 200) => request(site, prefix + `/display/assets/${assetId}?receiverId=${receiver.receiverId}&activation=${activation}`, { headers: bearer(grant.token), status });
  fixture.submit = async (text, topic = fixture.topic, attachments) => {
    await request(site, '/api/mail/messages', { method: 'POST', body: { text, nickname: `Private fan ${suffix}`, topicSlug: topic.slug, senderFingerprint: randomUUID(), attachments }, headers: { 'x-real-ip': fixture.ip + '-' + randomUUID() }, status: 201 });
    const state = (await admin(site, prefix + `/control/state?topicId=${topic.id}`)).data;
    const message = state.messages.find(value => value.source.text === text);
    ok(message, 'synthetic message is visible only to its private control scope');
    return message.id;
  };
  fixture.upload = async (topic, color) => {
    const png = await sharp({ create: { width: 12, height: 9, channels: 4, background: color } }).png().toBuffer();
    const form = new FormData(); form.set('topicId', topic.id); form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic.png');
    const uploaded = (await request(site, prefix + '/upload', { method: 'POST', body: form, headers: { 'x-real-ip': fixture.ip }, status: 201 })).data.attachments[0];
    equal(uploaded.mimeType, 'image/webp'); equal([uploaded.width, uploaded.height], [12, 9]);
    return uploaded;
  };
  return fixture;
}

async function exercise(f) {
  const { site, topic, other } = f;
  const imageA = await f.upload(topic, 'red'), imageB = await f.upload(topic, 'blue');
  const receipts = image => [{ id: image.id, receipt: image.receipt }];
  await request(site, '/api/mail/messages', { method: 'POST', body: { text: 'Wrong topic receipt', topicSlug: other.slug, attachments: receipts(imageA) }, headers: { 'x-real-ip': f.ip + '-wrong' }, status: 409 });
  const a = await f.submit(`Image letter A ${f.suffix}`, topic, receipts(imageA));
  const b = await f.submit(`Image letter B ${f.suffix}`, topic, receipts(imageB));
  const fresh = await f.submit(`Unread private letter ${f.suffix}`);
  const foreign = await f.submit(`Other topic private ${f.suffix}`, other);
  await request(site, '/api/mail/messages', { method: 'POST', body: { text: 'Receipt replay', topicSlug: topic.slug, attachments: receipts(imageA) }, headers: { 'x-real-ip': f.ip + '-replay' }, status: 409 });
  const d = await f.grant(topic.id), control = await f.grant(topic.id, 'control'), dOther = await f.grant(other.id);
  f.display = d; f.control = control;
  let receiver = await f.open(d);
  const otherReceiver = await f.open(dOther);
  await request(site, prefix + `/control/state?topicId=${other.id}`, { headers: bearer(control.token), status: 403 });
  await request(site, prefix + '/control/grants', { method: 'POST', body: { topicId: other.id, kind: 'display' }, headers: bearer(control.token), status: 403 });
  await request(site, prefix + '/control/action', { method: 'POST', body: { topicId: topic.id, action: 'show', messageId: foreign, expectedRevision: (await f.state()).revision, operationId: randomUUID() }, headers: bearer(control.token), status: 404 });
  await request(site, prefix + `/control/state?topicId=${topic.id}`, { headers: { ...bearer(d.token), 'x-mail-password': password }, status: 401 });
  await request(site, prefix + '/control/action', { method: 'POST', body: { topicId: topic.id, action: 'hide', expectedRevision: 0, operationId: randomUUID() }, headers: bearer(d.token), status: 401 });
  await request(site, prefix + '/control/grants', { method: 'POST', body: { topicId: topic.id, kind: 'control' }, headers: bearer(d.token), status: 401 });
  await request(site, '/api/mail/messages?topicId=' + topic.id, { headers: bearer(d.token), status: 401 });
  await f.frame(dOther, receiver, 409);
  await f.frame(d, otherReceiver, 409);
  await request(site, prefix + `/control/assets/${imageA.id}?topicId=${topic.id}`, { headers: bearer(d.token), status: 401 });
  await request(site, prefix + `/control/assets/${imageA.id}?topicId=${other.id}`, { headers: bearer(control.token), status: 403 });
  const privateImage = await request(site, prefix + `/control/assets/${imageA.id}?topicId=${topic.id}`, { headers: bearer(control.token) });
  equal(createHash('sha256').update(privateImage.data).digest('hex'), imageA.sha256, 'private preview has normalized immutable bytes');
  const deniedCookie = await admin(site, prefix + `/control/state?topicId=${topic.id}`, { headers: { origin: 'http://localhost:3390', 'sec-fetch-site': 'same-site' }, status: 403 });
  equal(deniedCookie.headers.get('access-control-allow-credentials'), null, 'external origins never receive credentialed CORS');
  receiver = await f.open(d);
  await admin(site, `/api/mail/messages/${fresh}?topicId=${topic.id}`, { method: 'PATCH', body: { isRead: true, isFavorited: true, isFlagged: false } });
  equal((await f.state()).messages.find(value => value.id === fresh).status, 'pending', 'legacy read/favorite/unflag never approve');
  equal((await f.frame(d, receiver)).snapshot, null);
  await f.command('approve', a); await f.command('approve', b);
  equal((await f.frame(d, receiver)).snapshot, null);
  await f.asset(d, receiver, imageA.id, 0, 404);
  await f.command('show', a);
  let frame = await f.frame(d, receiver);
  const aActivation = frame.activation;
  equal(frame.snapshot.messageId, a); equal(frame.snapshot.assets.map(value => value.id), [imageA.id]);
  ok(!JSON.stringify(frame).includes(foreign) && !JSON.stringify(frame).includes(fresh), 'frame excludes pending/other messages');
  const publicImage = await f.asset(d, receiver, imageA.id, frame.activation);
  equal(createHash('sha256').update(publicImage.data).digest('hex'), imageA.sha256);
  equal(publicImage.headers.get('cache-control'), 'no-store');
  await f.asset(d, receiver, imageB.id, frame.activation, 404);
  await f.command('show', b); frame = await f.frame(d, receiver);
  await f.asset(d, receiver, imageA.id, aActivation, 404);
  await f.asset(d, receiver, imageA.id, frame.activation, 404);
  await f.asset(d, receiver, imageB.id, frame.activation);
  await f.command('hide'); await f.asset(d, receiver, imageB.id, frame.activation, 404);
  await f.command('reorder', undefined, { order: [b, a] });
  await request(site, prefix + '/control/message', { method: 'POST', body: { topicId: topic.id, messageId: a, isRead: true, isFavorited: true }, headers: bearer(control.token) });
  await f.command('end');
  const reconnect = await f.open(d);
  equal((await f.frame(d, reconnect)).snapshot, null);
  let state = await f.state(); equal(state.queue, [b, a]);
  const preserved = state.messages.find(value => value.id === a); ok(preserved.isRead && preserved.isFavorited && preserved.status === 'approved', 'end/reopen preserves read/favorite/approved order');
  const operations = ['grid', 'row'].map(imageLayout => ({ topicId: topic.id, action: 'appearance', appearance: { imageLayout }, expectedRevision: state.revision, operationId: randomUUID() }));
  const raced = await Promise.all(operations.map(body => request(site, prefix + '/control/action', { method: 'POST', body, headers: bearer(control.token), status: null })));
  equal(raced.map(value => value.status).sort(), [200, 409], 'only one concurrent revision succeeds');
  equal(raced.find(value => value.status === 409).data.code, 'REVISION_CONFLICT');
  state = await f.state(); equal(state.revision, operations[0].expectedRevision + 1);
  receiver = await f.open(d);
  state = await f.state();
  const showCommand = { topicId: topic.id, action: 'show', messageId: a, expectedRevision: state.revision, operationId: randomUUID() };
  await request(site, prefix + '/control/action', { method: 'POST', body: showCommand, headers: bearer(control.token) });
  equal((await f.frame(d, receiver)).snapshot.messageId, a);
  await f.command('hide');
  await request(site, prefix + '/control/action', { method: 'POST', body: showCommand, headers: bearer(control.token) });
  equal((await f.frame(d, receiver)).snapshot, null, 'late idempotent replay never restores hidden mail');
  await f.command('show', a); frame = await f.frame(d, receiver);
  await new Promise(resolve => setTimeout(resolve, 3250));
  equal((await f.frame(d, receiver, 409)).code, 'RECEIVER_EXPIRED');
  equal((await f.state()).current, null, 'expired receiver is not reported active');
  receiver = await f.open(d); equal((await f.frame(d, receiver)).snapshot, null, 'reconnect cannot resume old display');
  await f.asset(d, receiver, imageA.id, frame.activation, 404);
  equal((await f.state()).queue, [b, a]);
  await f.command('show', a);
  await admin(site, `/api/mail/messages/${a}?topicId=${topic.id}`, { method: 'PATCH', body: { isFlagged: true } });
  equal((await f.frame(d, receiver)).snapshot, null, 'legacy flag withdraws current');
  equal((await f.state()).messages.find(value => value.id === a).status, 'pending');
  await admin(site, `/api/mail/messages/${a}?topicId=${topic.id}`, { method: 'PATCH', body: { isFlagged: false } });
  equal((await f.state()).messages.find(value => value.id === a).status, 'pending');
  await f.command('approve', a); await f.command('reorder', undefined, { order: [b, a] });
  await f.command('show', b);
  await admin(site, `/api/mail/messages/${b}?topicId=${topic.id}`, { method: 'DELETE' });
  equal((await f.frame(d, receiver)).snapshot, null, 'legacy delete withdraws current and its image');
  await f.asset(d, receiver, imageB.id, (await f.frame(d, receiver)).activation, 404);
  equal((await f.state()).queue, [a]);
  const child = await f.grant(topic.id, 'display', control.token);
  const childReceiver = await f.open(child);
  receiver = await f.open(d); await f.command('show', a);
  equal((await f.frame(child, childReceiver)).snapshot.messageId, a);
  await admin(site, prefix + `/control/grants/${control.id}?topicId=${topic.id}`, { method: 'DELETE' });
  await f.frame(child, childReceiver, 401);
  equal((await f.frame(d, receiver)).snapshot.messageId, a, 'device revocation does not revoke independent browser display');
  await f.command('end');
  equal((await f.state()).queue, [a]);
  const final = await f.state(); ok(final.messages.find(value => value.id === a).isRead && final.messages.find(value => value.id === a).isFavorited);
  const otherState = (await admin(site, prefix + `/control/state?topicId=${other.id}`)).data;
  const otherMessage = otherState.messages.find(value => value.id === foreign);
  await admin(site, prefix + '/control/action', { method: 'POST', body: { topicId: other.id, action: 'approve', messageId: foreign, expectedRevision: otherState.revision, expectedDraftRevision: otherMessage.draftRevision, operationId: randomUUID() } });
  const freshOtherReceiver = await f.open(dOther);
  const otherApproved = (await admin(site, prefix + `/control/state?topicId=${other.id}`)).data;
  await admin(site, prefix + '/control/action', { method: 'POST', body: { topicId: other.id, action: 'show', messageId: foreign, expectedRevision: otherApproved.revision, operationId: randomUUID() } });
  equal((await f.frame(dOther, freshOtherReceiver)).snapshot.messageId, foreign);
  await admin(site, `/api/mail/topics/${other.id}`, { method: 'DELETE', body: { markReadFirst: false } });
  equal((await f.frame(dOther, freshOtherReceiver)).snapshot, null, 'legacy archive withdraws current');
  events.push({ site, topicId: topic.id, retainedApprovedMessageId: a, archivedTopicId: other.id, siteId: f.caps.siteId, scenarios: ['topic/control/display isolation', 'current-only normalized image bytes', 'single-use/topic-bound fan receipts', 'legacy read/favorite/unflag stays pending', 'concurrent revision conflict', 'late show replay stays hidden', '3-second receiver expiry/reconnect blank', 'read/favorite/order survive end/reopen', 'legacy flag/delete/archive withdrawal', 'device child grant revocation'] });
}

try {
  for (const site of sites) await setup(site);
  equal(fixtures[0].caps.siteId === fixtures[1].caps.siteId, false, 'sites have separate persistent identities');
  for (const fixture of fixtures) await exercise(fixture);
  for (let index = 0; index < fixtures.length; index++) {
    const own = fixtures[index], other = fixtures[1 - index];
    await request(other.site, prefix + '/display/open', { method: 'POST', body: {}, headers: bearer(own.display.token), status: 401 });
    const liveControl = await own.grant(own.topic.id, 'control');
    await request(other.site, prefix + `/control/state?topicId=${other.topic.id}`, { headers: bearer(liveControl.token), status: 401 });
  }
  console.log(JSON.stringify({ node: process.version, passed, fixtures: events, limitation: 'Does not restart the running hosts; process restart is covered separately by the real child-process integration test.' }, null, 2));
} finally {
  // Leave synthetic letters available for inspection. Revoke only our own grants and blank our own topics.
  for (const fixture of fixtures) {
    for (const topic of fixture.topics) await admin(fixture.site, prefix + '/control/action', { method: 'POST', body: { topicId: topic.id, action: 'end', expectedRevision: 0, operationId: randomUUID() } }).catch(error => console.error(`Fixture end failed: ${fixture.site} ${topic.id}: ${error.message}`));
    for (const grant of fixture.grants) await admin(fixture.site, prefix + `/control/grants/${grant.id}?topicId=${grant.topicId}`, { method: 'DELETE' }).catch(error => console.error(`Fixture grant cleanup failed: ${fixture.site} ${grant.id}: ${error.message}`));
  }
}
