import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { BilibiliClient } from './bilibili.mjs';
import { GatewayState } from './state.mjs';
import { GatewayError, canonicalOrigin, createSigner, digest, equalSecret, identifier, randomToken, requireValue, sameOriginUrl, seconds, textField, verifyH5Launch } from './security.mjs';

const publicDirectory = new URL('../public/', import.meta.url);
const STATIC = { '/':['index.html','text/html; charset=utf-8'], '/pair':['pair.html','text/html; charset=utf-8'], '/h5':['h5.html','text/html; charset=utf-8'], '/display':['display.html','text/html; charset=utf-8'], '/display.js':['display.js','text/javascript; charset=utf-8'], '/h5.mjs':['h5.mjs','text/javascript; charset=utf-8'], '/pair.mjs':['pair.mjs','text/javascript; charset=utf-8'], '/gateway.css':['gateway.css','text/css; charset=utf-8'] };

export function configFromEnv(env = process.env) {
  const development = env.NODE_ENV !== 'production';
  return {
    origin: canonicalOrigin(env.GATEWAY_ORIGIN || 'http://localhost:3390', development), development,
    port:Number(env.PORT || 3390), host:env.HOST || '127.0.0.1', dataDir:env.DATA_DIR || './data',
    accessKey:env.BILIBILI_ACCESS_KEY_ID || '', secret:env.BILIBILI_ACCESS_KEY_SECRET || '', h5SignSecret:env.BILIBILI_H5_SIGN_SECRET || '',
    h5AppId:env.BILIBILI_H5_APP_ID || '', desktopAppId:env.BILIBILI_DESKTOP_APP_ID || ''
  };
}

async function readJson(req) {
  requireValue((req.headers['content-type'] || '').split(';')[0] === 'application/json', 'json_required',415);
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; requireValue(total <= 16384,'body_too_large',413); chunks.push(chunk); }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requireValue(result && typeof result === 'object' && !Array.isArray(result), 'invalid_json');
    return result;
  } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('invalid_json'); }
}

export function createGateway({ config, signingKey, state = new GatewayState(), client, now = seconds } = {}) {
  const signer = createSigner(signingKey, config.origin, now);
  const platform = client || new BilibiliClient({ ...config, now });
  const sessions = new Map(); // Never persisted: restart must not restore authorization or output.
  const rate = new Map();
  let tickActive = false;
  let closed = false;

  const json = (res,status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };
  function limited(req) {
    const key = req.socket.remoteAddress || 'unknown'; const time = now();
    let item = rate.get(key);
    if (!item || item.until <= time) { item = { until:time+60,count:0 }; rate.set(key,item); }
    requireValue(++item.count <= 2400,'rate_limited',429);
    if (rate.size > 10000) for (const [id,entry] of rate) if (entry.until <= time) rate.delete(id);
  }
  function token(req) { return typeof req.headers.authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization)?.[1] : null; }
  function sessionAuth(req,id) {
    const session = sessions.get(id); const supplied = token(req);
    requireValue(session && supplied && equalSecret(session.tokenHash,digest(supplied)), 'session_unauthorized',401);
    requireValue(session.active && now() - session.lastConsumerSeen < 10 && now() - session.lastPlatformHeartbeat < 26,'session_expired',410);
    session.lastConsumerSeen = now();
    return session;
  }
  function pairingAuth(req,id) {
    const pairing = state.data.pairings[id]; const supplied = token(req);
    requireValue(pairing && pairing.expiresAt > now() && supplied && equalSecret(pairing.completionHash,digest(supplied)), 'pairing_unauthorized',401);
    return pairing;
  }
  function bindForSession(id,session) {
    const binding = state.data.bindings[id];
    requireValue(binding && !binding.revoked && binding.biliSubject === session.subject, 'binding_forbidden',403);
    if(session.role==='display')requireValue(session.displayBindingId===id,'binding_scope_mismatch',403);
    return binding;
  }
  function proofClaims(kind,binding,session) {
    return { kind,aud:binding.siteOrigin,siteId:binding.siteId,topicId:binding.topicId,bindingId:binding.bindingId,biliSubject:session.subject,sessionId:session.id };
  }
  function makePairing(body) {
    state.prune(now()); requireValue(Object.keys(state.data.pairings).length < 5000,'gateway_capacity',503);
    const siteOrigin=canonicalOrigin(body.siteOrigin,config.development);
    const id=randomToken();const completionToken=randomToken();
    const pairing={id,siteOrigin,siteId:identifier(body.siteId,'site_id'),topicId:identifier(body.topicId,'topic_id'),nonce:textField(body.nonce,256),topicName:textField(body.topicName||body.topicId,100),returnUrl:sameOriginUrl(body.returnUrl||'/mail/connect',siteOrigin),siteBaseUrl:sameOriginUrl(body.siteBaseUrl||'/api/mail/live',siteOrigin),displayUrl:`${config.origin}/display`,completionHash:digest(completionToken),expiresAt:now()+300,bindingId:randomToken(),authorized:null};
    state.data.pairings[id]=pairing;
    return {pairing,completionToken};
  }
  async function endSession(session) {
    if (!session.active) return;
    session.active = false; // Revocation precedes awaiting the external API.
    try { await platform.end(session.gameId,session.appId); } catch { /* Safe state stays ended even when platform end fails. */ }
  }
  async function startSession(channel,code,expectedMid = null) {
    requireValue(typeof code === 'string' && code.length >= 1 && code.length <= 256 && !/[\r\n]/.test(code),'invalid_identity_code');
    requireValue(channel === 'h5' || channel === 'desktop','invalid_channel');
    requireValue(sessions.size < 10000,'gateway_capacity',503);
    const result = await platform.start(channel,code);
    if (expectedMid && result.uid && expectedMid !== result.uid) {
      try { await platform.end(result.gameId,result.appId); } catch { /* never admit a mismatched subject */ }
      throw new GatewayError('platform_identity_mismatch',401);
    }
    const id = randomToken(); const sessionToken = randomToken();
    const session = { id,channel,...result,role:expectedMid?'display':'controller',launchMode:expectedMid?'h5-signed-launch':'manual-identity-code',tokenHash:digest(sessionToken),active:true,lastConsumerSeen:now(),lastPlatformHeartbeat:now(),createdAt:now() };
    sessions.set(id,session);
    return { session,sessionToken };
  }
  function publicSession({ session,sessionToken }) {
    return { sessionId:session.id,sessionToken,subject:session.subject,label:session.label,channel:session.channel,launchMode:session.launchMode,selectedBindingId:session.role==='display'?session.displayBindingId:(state.data.selectedBindings[session.subject]||null),expiresAt:now()+10,heartbeatIntervalMs:1000,
      bindings:Object.values(state.data.bindings).filter(b=>!b.revoked && b.biliSubject===session.subject && (session.role!=='display'||b.bindingId===session.displayBindingId)).map(b=>({bindingId:b.bindingId,siteOrigin:b.siteOrigin,siteBaseUrl:b.siteBaseUrl,siteId:b.siteId,topicId:b.topicId,topicName:b.topicName,displayUrl:b.displayUrl})) };
  }

  async function tick() {
    if (tickActive) return; tickActive = true;
    try {
      const time = now();
      await Promise.allSettled([...sessions.values()].map(async session=> {
        if (!session.active) { if (time-session.lastConsumerSeen > 600) sessions.delete(session.id); return; }
        if (time-session.lastConsumerSeen >= 10 || time-session.lastPlatformHeartbeat >= 26) { await endSession(session); return; }
        if (time-session.lastPlatformHeartbeat >= 20) {
          try { await platform.heartbeat(session.gameId); if (session.active) session.lastPlatformHeartbeat=now(); }
          catch { await endSession(session); }
        }
      }));
    } finally { tickActive=false; }
  }

  async function route(req,res) {
    const url = new URL(req.url,config.origin); const path = url.pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${path === '/display' ? `https: ${config.development?'http://localhost:* http://127.0.0.1:*':''}`:''}; img-src 'self' blob:; frame-src 'self'; frame-ancestors 'self' https://play-live.bilibili.com; form-action 'self'; base-uri 'none'`);
    if (req.headers.origin) {
      const origin = canonicalOrigin(req.headers.origin,config.development);
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && path === '/healthz') { json(res,200,{ok:true,protocolVersion:1}); return; }
    if (req.method === 'GET' && path === '/.well-known/windchime-gateway.json') {
      json(res,200,{protocolVersion:1,issuer:config.origin,publicKeys:{[signer.kid]:signer.publicKeyPem},jwks:{keys:[signer.publicJwk]},platformConfigured:{h5:!!(config.accessKey&&config.secret&&config.h5SignSecret&&config.h5AppId),desktop:!!(config.accessKey&&config.secret&&config.desktopAppId)}}); return;
    }
    if (req.method === 'GET' && STATIC[path]) {
      const [file,type] = STATIC[path]; const content = await readFile(new URL(file,publicDirectory));
      res.writeHead(200,{'Content-Type':type}); res.end(content); return;
    }
    limited(req);
    if (req.method === 'POST' && path === '/api/pairings') {
      const body = await readJson(req);
      const {pairing,completionToken}=makePairing(body);await state.save();
      json(res,201,{pairingId:pairing.id,pairingUrl:`${config.origin}/pair?id=${pairing.id}`,completionToken,expiresAt:pairing.expiresAt}); return;
    }
    let match = /^\/api\/pairings\/([A-Za-z0-9_-]+)$/.exec(path);
    if (match && req.method === 'GET') {
      const pairing = state.data.pairings[match[1]];
      requireValue(pairing&&pairing.expiresAt>now(),'pairing_expired',410);
      json(res,200,{pairingId:pairing.id,siteOrigin:pairing.siteOrigin,siteId:pairing.siteId,topicId:pairing.topicId,topicName:pairing.topicName,expiresAt:pairing.expiresAt}); return;
    }
    if (req.method === 'POST' && path === '/api/sessions/start') {
      const body = await readJson(req); const result = await startSession(body.channel,body.code);
      json(res,201,publicSession(result)); return;
    }
    if (req.method === 'POST' && path === '/api/h5/launch') {
      const body = await readJson(req);
      // Reject duplicate query parameters before turning them into an object.
      requireValue(typeof body.query === 'string' && body.query.length < 4096,'invalid_launch',401);
      const fields = new URLSearchParams(body.query);
      requireValue(fields.getAll('bindingId').length<=1,'invalid_launch',401);
      const verified = verifyH5Launch(fields,config.h5SignSecret,now());
      state.prune(now());
      requireValue(!state.data.replays[verified.replayKey],'launch_replayed',401);
      state.data.replays[verified.replayKey]=verified.expiresAt; await state.save();
      const result = await startSession('h5',verified.code,verified.mid);
      const available=Object.values(state.data.bindings).filter(b=>!b.revoked&&b.biliSubject===result.session.subject);
      const selected=fields.get('bindingId')||state.data.selectedBindings[result.session.subject]||(available.length===1?available[0].bindingId:null);
      const binding=available.find(b=>b.bindingId===selected);
      if(!binding){await endSession(result.session);throw new GatewayError('binding_not_ready',403);}
      result.session.displayBindingId=binding.bindingId;
      json(res,201,publicSession(result)); return;
    }
    match = /^\/api\/pairings\/([A-Za-z0-9_-]+)\/authorize$/.exec(path);
    if (match && req.method === 'POST') {
      const body = await readJson(req); const session = sessionAuth(req,body.sessionId);
      requireValue(session.role!=='display','display_session_read_only',403);
      const pairing = state.data.pairings[match[1]];
      requireValue(pairing&&pairing.expiresAt>now()&&!pairing.completed,'pairing_expired',410);
      requireValue(!pairing.authorized || pairing.authorized.subject === session.subject,'pairing_identity_conflict',409);
      pairing.authorized={subject:session.subject,sessionId:session.id};
      await state.save();
      const proof = signer.sign({...proofClaims('binding',pairing,session),nonce:pairing.nonce},120);
      const returnUrl = new URL(pairing.returnUrl);
      returnUrl.hash = new URLSearchParams({gatewayBindingProof:proof,gatewayPairingId:pairing.id,gatewayOrigin:config.origin}).toString();
      json(res,200,{proof,returnUrl:returnUrl.href,bindingId:pairing.bindingId}); return;
    }
    match = /^\/api\/pairings\/([A-Za-z0-9_-]+)\/complete$/.exec(path);
    if (match && req.method === 'POST') {
      const pairing = pairingAuth(req,match[1]);
      const body=await readJson(req);
      requireValue(body.bindingId===undefined||body.bindingId===pairing.bindingId,'binding_scope_mismatch',403);
      requireValue(pairing.authorized,'pairing_not_authorized',409);
      if(pairing.completed){json(res,200,{ok:true,bindingId:pairing.bindingId,h5Url:`${config.origin}/h5?bindingId=${pairing.bindingId}`});return;}
      // The site must first consume the proof at its admin-protected /control/bind.
      // Forging gateway metadata cannot grant site rights: the site checks its own binding record.
      for(const previous of Object.values(state.data.bindings)){
        if(previous.siteId===pairing.siteId&&previous.siteOrigin===pairing.siteOrigin&&previous.topicId===pairing.topicId&&previous.biliSubject===pairing.authorized.subject)previous.revoked=true;
      }
      state.data.bindings[pairing.bindingId]={bindingId:pairing.bindingId,siteOrigin:pairing.siteOrigin,siteBaseUrl:pairing.siteBaseUrl,siteId:pairing.siteId,topicId:pairing.topicId,topicName:pairing.topicName,displayUrl:pairing.displayUrl,biliSubject:pairing.authorized.subject,createdAt:now(),revoked:false};
      // This only selects a destination for a future plugin launch; it cannot arm content.
      state.data.selectedBindings[pairing.authorized.subject]=pairing.bindingId;
      pairing.completed=true; await state.save();
      json(res,200,{ok:true,bindingId:pairing.bindingId,h5Url:`${config.origin}/h5?bindingId=${pairing.bindingId}`}); return;
    }
    match=/^\/api\/sessions\/([A-Za-z0-9_-]+)\/bind$/.exec(path);
    if(match&&req.method==='POST'){
      const session=sessionAuth(req,match[1]);const body=await readJson(req);
      requireValue(session.role!=='display','display_session_read_only',403);
      requireValue(body.challenge&&typeof body.challenge==='object','invalid_binding_challenge');
      const {pairing,completionToken}=makePairing({...body.challenge,siteBaseUrl:body.siteBaseUrl||body.challenge.siteBaseUrl});
      pairing.authorized={subject:session.subject,sessionId:session.id};await state.save();
      const proof=signer.sign({...proofClaims('binding',pairing,session),nonce:pairing.nonce},120);
      json(res,200,{proof,bindingId:pairing.bindingId,pairingId:pairing.id,completionToken});return;
    }
    match=/^\/api\/sessions\/([A-Za-z0-9_-]+)\/select$/.exec(path);
    if(match&&req.method==='POST'){
      const session=sessionAuth(req,match[1]);const body=await readJson(req);const binding=bindForSession(body.bindingId,session);
      requireValue(session.role!=='display','display_session_read_only',403);
      state.data.selectedBindings[session.subject]=binding.bindingId;await state.save();
      json(res,200,{ok:true,selectedBindingId:binding.bindingId,appliesTo:'next-launch'});return;
    }
    match = /^\/api\/sessions\/([A-Za-z0-9_-]+)\/(lease|display|keepalive|end)$/.exec(path);
    if (match && req.method === 'POST') {
      const session = sessionAuth(req,match[1]);
      const body = await readJson(req);
      if (match[2] === 'end') { await endSession(session); json(res,200,{ok:true}); return; }
      if (match[2] === 'keepalive') { json(res,200,{ok:true,expiresAt:now()+10}); return; }
      const binding = bindForSession(body.bindingId,session);
      if (body.siteId !== undefined) requireValue(body.siteId===binding.siteId,'binding_scope_mismatch',403);
      if (body.topicId !== undefined) requireValue(body.topicId===binding.topicId,'binding_scope_mismatch',403);
      if (body.siteOrigin !== undefined) requireValue(body.siteOrigin===binding.siteOrigin,'binding_scope_mismatch',403);
      const ttl = match[2] === 'lease' ? 3 : 60;
      json(res,200,{proof:signer.sign(proofClaims(match[2],binding,session),ttl),expiresAt:now()+ttl,siteOrigin:binding.siteOrigin,siteBaseUrl:binding.siteBaseUrl,displayUrl:binding.displayUrl}); return;
    }
    throw new GatewayError('not_found',404);
  }
  const server = createServer((req,res)=> {
    route(req,res).catch(error=> {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof GatewayError;
      json(res,known ? error.status : 500,{error:known ? error.code : 'internal_error',...(known&&error.platformCode!==undefined ? {platformCode:error.platformCode}: {})});
    });
  });
  const timer = setInterval(()=>{ void tick(); },1000); timer.unref();
  return { server,state,signer,tick,sessions,
    async close() { if(closed)return;closed=true;clearInterval(timer);await Promise.allSettled([...sessions.values()].map(endSession));try{await state.save();}finally{if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));} }
  };
}
