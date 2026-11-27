// Pure Web Audio API wind-chime notification sound for private control window ONLY.
// Never imported by display.tsx or obs-display.tsx so it can never leak into OBS audio capture.

let lastPlayedAt = 0;
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

export function playWindChime(volumePercent = 70, force = false): void {
  const nowMs = Date.now();
  if (!force && nowMs - lastPlayedAt < 4000) return;
  const level = Math.min(1, Math.max(0, volumePercent / 100));
  if (level <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const trigger = () => {
    try {
      if (ctx.state !== 'running') return;
      const fireMs = Date.now();
      if (!force && fireMs - lastPlayedAt < 4000) return;
      lastPlayedAt = fireMs;
      const t0 = ctx.currentTime + 0.02;
      // Two gentle harmonic bell notes (E6 -> B6) reminiscent of a glass wind chime
      const notes: Array<{ freq: number; start: number; dur: number; amp: number }> = [
        { freq: 1318.5, start: 0, dur: 0.42, amp: 0.14 * level },
        { freq: 1975.5, start: 0.11, dur: 0.52, amp: 0.11 * level },
      ];
      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.freq, t0 + note.start);
        gain.gain.setValueAtTime(0.0001, t0 + note.start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.amp), t0 + note.start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.start + note.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + note.start);
        osc.stop(t0 + note.start + note.dur + 0.02);
      }
    } catch {
      // Audio playback is strictly best-effort and must never disturb live controls.
    }
  };

  if (ctx.state === 'running') {
    trigger();
    return;
  }
  if (ctx.state === 'suspended') {
    // Only schedule oscillators if AudioContext actually resumes promptly; never queue stale notes while suspended.
    let settled = false;
    const timer = window.setTimeout(() => { settled = true; }, 350);
    void ctx.resume().then(() => {
      window.clearTimeout(timer);
      if (!settled) trigger();
    }).catch(() => {
      window.clearTimeout(timer);
    });
  }
}
