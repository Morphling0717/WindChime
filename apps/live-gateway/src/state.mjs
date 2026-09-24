import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateSigningKey } from './security.mjs';

export class GatewayState {
  constructor(path = null, data = {}) {
    this.path = path;
    this.data = { version:1, pairings:{}, bindings:{}, selectedBindings:{}, replays:{}, ...data };
    this.pending = Promise.resolve();
  }
  static async open(directory) {
    const dir = resolve(directory);
    await mkdir(dir, { recursive:true, mode:0o700 });
    const path = resolve(dir,'gateway-state.json');
    let data;
    try { data = JSON.parse(await readFile(path,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Gateway persistent state is unreadable; refusing to reset authorizations.'); }
    if (data && data.version !== 1) throw new Error('Unsupported gateway state version.');
    return new GatewayState(path,data);
  }
  save() {
    if (!this.path) return Promise.resolve();
    const snapshot = JSON.stringify(this.data);
    this.pending = this.pending.then(async()=> {
      await writeFile(this.path + '.tmp', snapshot, { mode:0o600 });
      await rename(this.path + '.tmp', this.path);
    });
    return this.pending;
  }
  prune(now) {
    for (const [key,expiry] of Object.entries(this.data.replays)) if (expiry <= now) delete this.data.replays[key];
    for (const [id,pairing] of Object.entries(this.data.pairings)) if (pairing.expiresAt <= now) delete this.data.pairings[id];
  }
}
export async function loadSigningKey(directory) {
  const path = resolve(directory,'gateway-signing-key.pem');
  try { return await readFile(path,'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pem = generateSigningKey();
  await writeFile(path,pem,{ flag:'wx',mode:0o600 });
  return pem;
}
