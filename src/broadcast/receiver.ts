import type { WindChimeDisplayClient, WindChimeDisplayOpen } from '../client/live.js';
import type { WindChimeLiveFrame } from '../core/live.js';

export type WindChimeDisplayValue = { frame: WindChimeLiveFrame; assetUrls: Readonly<Record<string, string>> } | null;
export type WindChimeReceiverOptions = {
  /** Poll every 250–1000 ms; omitted or non-finite values use 1000 ms. */
  pollIntervalMs?: number;
  now?: () => number;
  prepareAsset?: (blob: Blob, sha256: string, signal: AbortSignal) => Promise<string>;
  releaseAsset?: (url: string) => void;
};
async function prepareAsset(blob: Blob, sha256: string, signal: AbortSignal) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('Invalid image');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256 || signal.aborted) throw new Error('Invalid image digest');
  const decoded = await createImageBitmap(blob);
  decoded.close();
  if (signal.aborted) throw new Error('Asset cancelled');
  return URL.createObjectURL(blob);
}
/** A monotonic, bounded lease. A reconnect always creates a fresh blank receiver. */
export class WindChimeDisplayReceiver {
  private connection: WindChimeDisplayOpen | null = null;
  private stopped = true;
  private generation = 0;
  private revision = -1;
  private activation = -1;
  private deadline = 0;
  private busy = false;
  private interval?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;
  private requestAbort?: AbortController;
  private assetAbort?: AbortController;
  private urls: Record<string, string> = {};
  private value: WindChimeDisplayValue = null;
  private loadingActivation = -1;
  private listener: (value: WindChimeDisplayValue) => void = () => {};
  private now: () => number;
  private pollIntervalMs: number;
  constructor(private client: WindChimeDisplayClient, private options: WindChimeReceiverOptions = {}) {
    const monotonicStart = performance.now(); const wallStart = Date.now();
    // Some engines pause performance.now during OS sleep. Either clock advancing
    // can expire a lease; clock rollback cannot prolong one.
    this.now = options.now ?? (() => Math.max(performance.now() - monotonicStart, Date.now() - wallStart));
    this.pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(250, Math.min(1000, options.pollIntervalMs!)) : 1000;
  }
  start(listener: (value: WindChimeDisplayValue) => void) {
    this.stop(); this.stopped = false; this.listener = listener; this.listener(null);
    this.interval = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.watchdog = setInterval(() => { if (this.deadline && this.now() >= this.deadline) this.reset(); }, 50);
    void this.tick();
  }
  reset() {
    this.generation++; this.connection = null; this.deadline = 0; this.revision = -1; this.activation = -1; this.loadingActivation = -1;
    this.requestAbort?.abort(); this.assetAbort?.abort(); this.clear();
  }
  stop() { this.stopped = true; clearInterval(this.interval); clearInterval(this.watchdog); this.reset(); }
  private release(url: string) { (this.options.releaseAsset ?? URL.revokeObjectURL)(url); }
  private clear() {
    Object.values(this.urls).forEach(url => this.release(url)); this.urls = {};
    this.value = null; this.listener(null);
  }
  async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    const generation = this.generation; const began = this.now();
    const abort = new AbortController(); this.requestAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 2500);
    try {
      if (!this.connection) {
        const joined = await this.client.open(abort.signal);
        if (generation !== this.generation || this.stopped) return;
        if (!joined.receiverId || !joined.epoch || !(joined.leaseMs > 0)) throw new Error('Invalid receiver');
        this.connection = joined;
        this.deadline = began + Math.min(joined.leaseMs, 3000);
        this.clear();
        return;
      }
      const frame = await this.client.frame(this.connection.receiverId, abort.signal);
      if (generation !== this.generation || this.stopped) return;
      if (frame.receiverId !== this.connection.receiverId || frame.epoch !== this.connection.epoch || frame.revision < this.revision || frame.activation < this.activation || !(frame.leaseMs > 0)) throw new Error('Stale frame');
      this.deadline = began + Math.min(frame.leaseMs, 3000);
      if (this.now() >= this.deadline) throw new Error('Expired frame');
      this.revision = frame.revision;
      if (!frame.snapshot) { this.activation = frame.activation; this.loadingActivation = -1; this.assetAbort?.abort(); this.clear(); return; }
      if (frame.activation === this.loadingActivation) return;
      if (frame.activation === this.activation && this.value?.frame.snapshot?.id === frame.snapshot.id) {
        this.value = { frame, assetUrls: this.urls }; this.listener(this.value); return;
      }
      this.activation = frame.activation;
      this.loadingActivation = frame.activation;
      this.assetAbort?.abort(); this.clear();
      const assets = new AbortController(); this.assetAbort = assets;
      // Decoding does not block polling or the independent expiry watchdog.
      void this.loadAssets(frame, generation, assets);
    } catch { if (generation === this.generation) this.reset(); }
    finally { clearTimeout(timeout); this.busy = false; }
  }
  private async loadAssets(frame: WindChimeLiveFrame, generation: number, abort: AbortController) {
    const urls: Record<string, string> = {};
    try {
      for (const asset of frame.snapshot!.assets) {
        const blob = await this.client.asset(asset.id, frame.receiverId, frame.activation, abort.signal);
        urls[asset.id] = await (this.options.prepareAsset ?? prepareAsset)(blob, asset.sha256, abort.signal);
        if (abort.signal.aborted) throw new Error('Cancelled');
      }
      if (abort.signal.aborted || generation !== this.generation || this.stopped || frame.activation !== this.activation || this.now() >= this.deadline) throw new Error('Expired snapshot');
      this.urls = urls; this.value = { frame, assetUrls: urls }; this.listener(this.value);
      this.loadingActivation = -1;
    } catch {
      Object.values(urls).forEach(url => this.release(url));
      if (!abort.signal.aborted && generation === this.generation && frame.activation === this.activation) this.reset();
    }
  }
}
