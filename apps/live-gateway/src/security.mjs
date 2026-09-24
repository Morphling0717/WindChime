import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';

export class GatewayError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const requireValue = (condition, code, status) => { if (!condition) throw new GatewayError(code, status); };
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const seconds = () => Math.floor(Date.now() / 1000);
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function canonicalOrigin(value, development = false) {
  let url;
  try { url = new URL(value); } catch { throw new GatewayError('invalid_site_origin'); }
  requireValue(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'invalid_site_origin');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireValue(url.protocol === 'https:' || (development && local && url.protocol === 'http:'), 'https_required');
  return url.origin;
}
export function sameOriginUrl(value, origin) {
  let url;
  try { url = new URL(value, origin); } catch { throw new GatewayError('invalid_site_url'); }
  requireValue(url.origin === origin && !url.username && !url.password && !url.hash, 'site_origin_mismatch');
  return url.href;
}
export function identifier(value, name = 'identifier') {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value), `invalid_${name}`);
  return value;
}
export function textField(value, max = 160) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), 'invalid_text');
  return value;
}

export function verifyH5Launch(fields, secret, now = seconds(), maxAge = 600) {
  requireValue(typeof secret === 'string' && secret.length >= 1, 'h5_not_configured', 503);
  const values = {};
  for (const key of ['Caller', 'Code', 'Mid', 'Timestamp', 'CodeSign']) {
    const value = fields instanceof URLSearchParams ? fields.getAll(key) : [fields?.[key]];
    requireValue(value.length === 1 && typeof value[0] === 'string' && value[0].length > 0 && value[0].length < 512 && !/[\r\n]/.test(value[0]), 'invalid_launch', 401);
    values[key] = value[0];
  }
  requireValue(values.Caller === 'bilibili' && /^\d+$/.test(values.Mid) && /^\d{1,12}$/.test(values.Timestamp), 'invalid_launch', 401);
  const timestamp = Number(values.Timestamp);
  requireValue(timestamp <= now + 30 && timestamp >= now - maxAge, 'launch_expired', 401);
  const canonical = ['Caller', 'Code', 'Mid', 'Timestamp'].map(key => `${key}:${values[key]}`).join('\n');
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');
  requireValue(/^[a-fA-F0-9]{64}$/.test(values.CodeSign) && equalSecret(expected, values.CodeSign.toLowerCase()), 'invalid_launch_signature', 401);
  return { code: values.Code, mid: values.Mid, replayKey: digest(canonical + '\n' + expected), expiresAt: timestamp + maxAge + 30 };
}

export function createSigner(pem, issuer, now = seconds) {
  const privateKey = createPrivateKey(pem);
  requireValue(privateKey.asymmetricKeyType === 'ed25519', 'invalid_signing_key', 500);
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = digest(publicKey.export({ type: 'spki', format: 'der' })).slice(0,24);
  return {
    kid,
    publicKeyPem: publicKey.export({ type:'spki', format:'pem' }),
    publicJwk: { ...jwk, kid, use: 'sig', alg: 'EdDSA' },
    sign(claims, ttl = 60) {
      const issued = now();
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ ...claims, iss: issuer, iat: issued, exp: issued + ttl, jti: randomToken() })).toString('base64url');
      const input = `${header}.${payload}`;
      return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
    }
  };
}
export function generateSigningKey() {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
}
// Verification helper is used by gateway contract tests and can be copied into a non-Node site adapter.
export function verifyProof(token, jwk, { issuer, audience, kind, now = seconds() }) {
  try {
    const parts = token.split('.');
    requireValue(parts.length === 3, 'invalid_proof', 401);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    requireValue(header.alg === 'EdDSA' && header.typ === 'JWT' && header.kid === jwk.kid, 'invalid_proof', 401);
    requireValue(verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url')), 'invalid_proof', 401);
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    requireValue(claims.iss === issuer && claims.aud === audience && claims.kind === kind && Number.isInteger(claims.exp) && claims.exp > now && Number.isInteger(claims.iat) && claims.iat <= now + 5 && claims.exp - claims.iat <= 120 && typeof claims.jti === 'string', 'invalid_proof', 401);
    return claims;
  } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('invalid_proof', 401); }
}
