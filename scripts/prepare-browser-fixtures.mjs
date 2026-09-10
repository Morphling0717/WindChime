import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

if (process.env.WINDCHIME_SMOKE_ALLOW_WRITES !== '1' || !process.env.WINDCHIME_SMOKE_PASSWORD)
  throw Error('Requires explicit disposable-site opt-in and password');
const output = process.argv[2];
if (!output) throw Error('Pass the fixture JSON output path');
const fixtures = [];
for (const port of [3011, 3012]) {
  const base = `http://localhost:${port}`;
  const admin = { 'x-mail-password': process.env.WINDCHIME_SMOKE_PASSWORD };
  async function request(path, method, body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { ...headers, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) });
    if (!response.ok) throw Error(`${port} ${path}: ${response.status}`);
    return response.json();
  }
  const slug = 'browser-final-' + randomUUID().slice(0, 8);
  const topic = await request('/api/mail/topics', 'POST', { slug, title: `浏览器收尾 ${port} ${slug}` }, admin);
  const form = new FormData(); form.set('topicId', topic.id);
  for (const color of ['#68a9b9', '#d79961']) {
    const bytes = await sharp({ create: { width: 180, height: 120, channels: 3, background: color } }).png().toBuffer();
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
  }
  const uploaded = await request('/api/mail/live/upload', 'POST', form);
  for (const [i, text] of ['第一封：谢谢今天的陪伴。', '第二封：祝直播顺利。'].entries())
    await request('/api/mail/messages', 'POST', { topicSlug: slug, nickname: `收尾粉丝 ${i ? 'B' : 'A'}`, text, senderFingerprint: randomUUID(), ...(i ? {} : { attachments: uploaded.attachments.map(({ id, receipt }) => ({ id, receipt })) }) }, { 'x-real-ip': `198.51.100.${30 + i + port - 3011}` });
  fixtures.push({ base, topicId: topic.id, slug });
}
await writeFile(output, JSON.stringify(fixtures, null, 2));
console.log(JSON.stringify({ prepared: fixtures }));
