import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWindChimeSqlite } from '../dist/sqlite/index.js';
import { createWindChimeService } from '../dist/server/index.js';
import { countWindChimeMessages, filterWindChimeMessages } from '../dist/core/index.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'windchime-keyword-'));
  const filename = join(directory, 'mail.sqlite');
  const storage = createWindChimeSqlite({ filename });
  const service = createWindChimeService({ storage, hashSalt: '', blockedTerms: ['secret'] });
  await service.ready();
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  let ip = 0;
  const submit = (text, topicSlug = 'default') => service.submitMessage({ text, nickname: 'secret nick', linkUrl: 'https://secret.test', topicSlug }, new Request('https://mail.test', { headers: { 'x-real-ip': `test-${++ip}` } }));
  return { storage, service, submit, filename };
}

test('stored or environment word lists never enable matching; future submissions follow the explicit switch', async t => {
  const f = await fixture(t);
  await f.service.setBlockedTerms(['secret']);
  assert.deepEqual(await f.service.getSettings(), { enabled: true, blockedTermsEnabled: false });
  await f.submit('secret accepted while disabled');
  assert.equal((await f.storage.get('SELECT is_flagged FROM mail_messages')).is_flagged, 0);
  await f.service.setBlockedTermsEnabled(true);
  await f.submit('secret marked after enable');
  assert.equal((await f.service.listMessages()).counts.flagged, 1);
  await f.service.setBlockedTermsEnabled(false);
  await f.submit('secret accepted again');
  const before = await f.storage.all('SELECT id,text,is_flagged FROM mail_messages ORDER BY id');
  await f.service.setBlockedTermsEnabled(true);
  assert.deepEqual(await f.storage.all('SELECT id,text,is_flagged FROM mail_messages ORDER BY id'), before, 'enabling never rescans old submissions');
  assert.equal((await f.service.listMessages()).counts.all, 2);
  assert.equal((await f.service.listMessages()).counts.flagged, 1);
  await assert.rejects(f.service.setBlockedTermsEnabled('true'), { code: 'INVALID_INPUT' });
});

test('disabled filter returns historical originals, ordinary counts and selections without modifying stored flags', async t => {
  const f = await fixture(t);
  await f.service.setBlockedTermsEnabled(true);
  await f.submit('secret historical text');
  const flagged = (await f.service.listMessages({ filter: 'flagged' })).items[0];
  assert.equal(flagged.text, '');
  await f.service.updateMessage(flagged.id, { isFavorited: true });
  const before = await f.storage.all('SELECT * FROM mail_messages');
  await f.service.setBlockedTermsEnabled(false);
  for (const filter of ['all', 'unread', 'favorited']) {
    const result = await f.service.listMessages({ filter });
    assert.equal(result.blockedTermsEnabled, false);
    assert.equal(result.items[0].text, 'secret historical text');
    assert.equal(result.items[0].nickname, 'secret nick');
    assert.equal(result.items[0].isFlagged, true, 'historical metadata remains available to compatible hosts');
    assert.deepEqual(result.counts, { all: 1, unread: 1, favorited: 1, flagged: 0 });
    assert.deepEqual(countWindChimeMessages(result.items, false), result.counts);
    assert.equal(filterWindChimeMessages(result.items, filter, false).length, 1);
  }
  assert.deepEqual((await f.service.listMessages({ filter: 'flagged' })).items, []);
  assert.deepEqual(await f.storage.all('SELECT * FROM mail_messages'), before);
  const topic = (await f.service.listTopics({ withCounts: true }))[0];
  assert.equal(topic.unreadCount, 1); assert.equal(topic.flaggedCount, 0);
  await f.service.setBlockedTermsEnabled(true);
  assert.equal((await f.service.listMessages()).items.length, 0);
  assert.equal((await f.service.listMessages({ filter: 'flagged' })).items[0].text, '');
});

test('mark read and archive includes historical flagged originals only when the filter is disabled', async t => {
  const f = await fixture(t);
  const topic = await f.service.createTopic({ slug: 'event', title: 'Event' });
  await f.service.setBlockedTermsEnabled(true); await f.submit('secret activity', topic.slug);
  await f.service.setBlockedTermsEnabled(false);
  const result = await f.service.archiveTopic(topic.id, { markReadFirst: true });
  assert.equal(result.unreadCount, 0); assert.equal(result.flaggedCount, 0);
  const row = await f.storage.get('SELECT is_read,is_flagged FROM mail_messages WHERE topic_id=?', [topic.id]);
  assert.deepEqual(row, { is_read: 1, is_flagged: 1 });
});

test('keyword switch is persisted across service restarts and never grants or revokes broadcast approval', async t => {
  const f = await fixture(t); await f.submit('Ready to review');
  let state = await f.service.broadcast.state('default');
  const message = state.messages[0];
  state = await f.service.broadcast.action({ topicId: 'default', action: 'approve', messageId: message.id, expectedDraftRevision: message.draftRevision, expectedRevision: state.revision, operationId: randomUUID() }, 'test');
  assert.equal(state.current, null); assert.deepEqual(state.queue, [message.id]);
  const approved = await f.storage.all('SELECT * FROM mail_live_drafts');
  await f.service.setBlockedTermsEnabled(true);
  await f.service.setBlockedTermsEnabled(false);
  assert.deepEqual(await f.storage.all('SELECT * FROM mail_live_drafts'), approved);
  const reopened = createWindChimeService({ storage: f.storage, hashSalt: '', blockedTerms: ['secret'], runtimeEpoch: 'new-process' });
  assert.equal((await reopened.getSettings()).blockedTermsEnabled, false);
  state = await reopened.broadcast.state('default');
  assert.deepEqual(state.queue, [message.id]); assert.equal(state.current, null);
});
