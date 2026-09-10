const crypto = require('node:crypto');
function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入网站地址');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('网站地址不能包含凭据、查询或片段');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('网站必须使用 HTTPS；本机联调可使用 HTTP');
  if (url.pathname !== '/' && url.pathname !== '/api/mail/live' && url.pathname !== '/api/mail/live/') throw new Error('请填写网站首页地址');
  return url.origin;
}
function validateRequest(request, mode, topicId) {
  if (!['control', 'display'].includes(mode)) throw new Error('未知窗口权限');
  if (!request || typeof request !== 'object' || typeof request.path !== 'string' || request.path.length > 2048) throw new Error('无效请求');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new Error('不允许此操作');
  if (!request.path.startsWith('/') || request.path.startsWith('//') || /[\\\x00-\x20]/.test(request.path) || /%2f|%5c|%2e/i.test(request.path)) throw new Error('不允许此路径');
  const url = new URL(request.path, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || url.hash) throw new Error('不允许跳转');
  const route = `${request.method} ${url.pathname}`;
  const control = [
    /^GET \/control\/state$/, /^POST \/control\/action$/, /^POST \/control\/message$/,
    /^GET \/control\/grants$/, /^DELETE \/control\/grants\/[A-Za-z0-9_-]+$/,
    /^GET \/control\/assets\/[A-Za-z0-9_-]+$/,
  ];
  const display = [/^POST \/display\/open$/, /^GET \/display\/frame$/, /^GET \/display\/assets\/[A-Za-z0-9_-]+$/];
  if (!(mode === 'control' ? control : display).some(pattern => pattern.test(route))) throw new Error('此窗口没有执行该操作的权限');
  if (request.body !== undefined && JSON.stringify(request.body).length > 65536) throw new Error('请求过大');
  if (mode === 'control') {
    if (url.searchParams.has('topicId') && url.searchParams.get('topicId') !== topicId) throw new Error('不可访问其他信箱');
    if (request.method === 'GET' || request.method === 'DELETE') url.searchParams.set('topicId', topicId);
    if (request.method === 'POST' && (!request.body || request.body.topicId !== topicId)) throw new Error('不可操作其他信箱');
  }
  return { path: url.pathname + url.search, method: request.method, body: request.body };
}
function restoreSite(site) {
  if (!site || typeof site !== 'object') throw new Error('无效设备凭据');
  for (const field of ['id', 'siteId', 'topicId']) if (typeof site[field] !== 'string' || !site[field] || site[field].length > 200) throw new Error('无效信箱标识');
  if (typeof site.token !== 'string' || !site.token.startsWith('wc_ctl_') || site.token.length > 256 || typeof site.expiresAt !== 'string') throw new Error('无效设备授权');
  const origin = normalizeOrigin(site.origin);
  // Keep the v1 device vault readable while discarding removed integration metadata.
  return { id: site.id, label: typeof site.label === 'string' ? site.label.slice(0, 80) : new URL(origin).hostname, origin, siteId: site.siteId, topicId: site.topicId, token: site.token, expiresAt: site.expiresAt };
}
function verifier() { return crypto.randomBytes(32).toString('base64url'); }
function challenge(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }
function publicSite(site) {
  return { id: site.id, label: site.label, origin: site.origin, siteId: site.siteId, topicId: site.topicId, expiresAt: site.expiresAt };
}
module.exports = { normalizeOrigin, validateRequest, restoreSite, verifier, challenge, publicSite };
