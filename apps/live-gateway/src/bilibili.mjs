import { createHash, createHmac, randomUUID } from 'node:crypto';
import { GatewayError, requireValue } from './security.mjs';

export function appIdLiteral(value) {
  const text = String(value ?? '');
  requireValue(/^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n, 'invalid_app_id', 503);
  return text;
}
export function encodeStart(code, appId) { return `{"code":${JSON.stringify(code)},"app_id":${appIdLiteral(appId)}}`; }
export function encodeEnd(gameId, appId) { return `{"app_id":${appIdLiteral(appId)},"game_id":${JSON.stringify(gameId)}}`; }

export function signedHeaders(body, accessKey, secret, timestamp = Math.floor(Date.now()/1000), nonce = randomUUID()) {
  requireValue(typeof accessKey === 'string' && !!accessKey && typeof secret === 'string' && !!secret, 'platform_not_configured', 503);
  const headers = {
    'x-bili-accesskeyid': accessKey,
    'x-bili-content-md5': createHash('md5').update(body).digest('hex'),
    'x-bili-signature-method': 'HMAC-SHA256',
    'x-bili-signature-nonce': nonce,
    'x-bili-signature-version': '1.0',
    'x-bili-timestamp': String(timestamp)
  };
  const canonical = Object.keys(headers).sort().map(key=>`${key}:${headers[key]}`).join('\n');
  return { Accept:'application/json', 'Content-Type':'application/json', ...headers, Authorization:createHmac('sha256',secret).update(canonical).digest('hex') };
}

export class BilibiliClient {
  constructor({ accessKey, secret, h5AppId, desktopAppId, fetchImpl = fetch, now = () => Math.floor(Date.now()/1000) }) {
    Object.assign(this, { accessKey, secret, h5AppId, desktopAppId, fetchImpl, now });
  }
  appId(channel) {
    requireValue(channel === 'h5' || channel === 'desktop', 'invalid_channel');
    return appIdLiteral(channel === 'h5' ? this.h5AppId : this.desktopAppId);
  }
  async call(path, body) {
    const headers = signedHeaders(body, this.accessKey, this.secret, this.now());
    let response;
    try {
      response = await this.fetchImpl(`https://live-open.biliapi.com${path}`, { method:'POST', headers, body, redirect:'error', signal:AbortSignal.timeout(5000) });
      requireValue(response.ok, 'platform_unavailable', 502);
      const data = await response.json();
      if (data.code !== 0) {
        // Stable numeric code aids private configuration diagnosis; never return raw platform messages or bodies.
        const error = new GatewayError('platform_rejected', 502);
        error.platformCode = Number.isSafeInteger(data.code) ? data.code : null;
        throw error;
      }
      return data.data;
    } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('platform_unavailable', 502); }
  }
  async start(channel, code) {
    const appId = this.appId(channel);
    const data = await this.call('/v2/app/start', encodeStart(code, appId));
    const anchor = data?.anchor_info;
    const validGame=typeof data?.game_info?.game_id==='string'&&data.game_info.game_id.length>0;
    const validAnchor=(typeof anchor?.union_id==='string'&&anchor.union_id.length>0)||(typeof anchor?.open_id==='string'&&anchor.open_id.length>0);
    if(!validGame||!validAnchor){
      if(validGame)try{await this.end(data.game_info.game_id,appId);}catch{/* never retain an unidentifiable platform session */}
      throw new GatewayError('invalid_platform_response',502);
    }
    const developerScope=createHash('sha256').update(this.accessKey).digest('hex').slice(0,24);
    const subject = anchor.union_id ? `bilibili:${developerScope}:union:${anchor.union_id}` : `bilibili:${developerScope}:app:${appId}:${anchor.open_id}`;
    return { gameId:data.game_info.game_id, appId, subject, uid:anchor.uid == null ? null : String(anchor.uid), roomId:anchor.room_id == null ? null : String(anchor.room_id), label:typeof anchor.uname === 'string' ? anchor.uname.slice(0,100) : 'B站主播' };
  }
  heartbeat(gameId) { return this.call('/v2/app/heartbeat', JSON.stringify({ game_id:gameId })); }
  end(gameId, appId) { return this.call('/v2/app/end', encodeEnd(gameId,appId)); }
}
