/**
 * Synthesized sound effects + haptics. No audio files: every sound is a few oscillators / a
 * filtered noise burst built on demand and torn down when it ends.
 *
 * - The AudioContext is created lazily on the first user gesture (autoplay policy) and only if
 *   sound is enabled. It is suspended while the page is hidden.
 * - Settings are read from the profile at play time, so toggles apply immediately.
 */
import { getProfile } from '../meta/profile';

export type SfxName =
  | 'click'
  | 'select'
  | 'tap'
  | 'move'
  | 'jump'
  | 'land'
  | 'capture'
  | 'turn'
  | 'tick'
  | 'tickUrgent'
  | 'win'
  | 'lose'
  | 'draw'
  | 'boxShake'
  | 'reveal'
  | 'coin'
  | 'levelup'
  | 'page';

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let installed = false;
const lastPlayed = new Map<SfxName, number>();

function soundOn(): boolean {
  return getProfile().settings.sound;
}

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create (or resume) the context. Only call from a user gesture or when one already happened. */
function ensureContext(): AudioContext | null {
  if (!ctx) {
    const Ctor = audioCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state !== 'running' && !document.hidden) {
    void ctx.resume().catch(() => {});
    // iOS / iPadOS WebKit only unlocks Web Audio once a sound is STARTED inside the gesture, so
    // start a one-sample silent buffer too (harmless everywhere else).
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }
  return ctx;
}

/**
 * Wire the gesture unlock + background suspend once (app lifetime). Safe to call repeatedly.
 */
export function installAudio(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  // Which events count as a user activation for audio differs: Chromium accepts pointerdown,
  // iOS / iPadOS Safari only touchend and click (a pointerdown/touchstart resume() is ignored there,
  // which used to leave the game silent until a settings switch was tapped). Listen to all of them.
  const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  const unlock = () => {
    if (!soundOn()) return;
    const c = ensureContext();
    if (c && c.state === 'running') for (const ev of UNLOCK_EVENTS) document.removeEventListener(ev, unlock, true);
  };
  for (const ev of UNLOCK_EVENTS) document.addEventListener(ev, unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else if (soundOn()) void ctx.resume().catch(() => {});
  });
  // Delegated UI click sound for every button-like control (opt out with data-sfx="none").
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null;
      const btn = t?.closest?.('button, [role="button"], [role="switch"], [role="tab"]');
      if (!btn || btn.hasAttribute('disabled') || btn.closest('[data-sfx="none"]')) return;
      sfx('click');
    },
    true,
  );
}

/** True when the player has sound enabled (read live from the profile). */
export function isSoundOn(): boolean {
  return soundOn();
}

/**
 * The shared AudioContext, if one has been created by a user gesture (never creates one).
 * Other audio modules (character voices) decode and play through it.
 */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/**
 * The shared output bus (master gain -> compressor -> destination) when the context is running,
 * so character voice/SFX share the same loudness control and limiter as the synthesized sounds.
 */
export function audioOut(): { ctx: AudioContext; out: AudioNode } | null {
  if (!ctx || !master || ctx.state !== 'running') return null;
  return { ctx, out: master };
}

/** Called when the user turns sound on from settings (a gesture): create the context now. */
export function primeAudio(): void {
  if (soundOn()) ensureContext();
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.6);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x3fffffff - 1) * 0.9;
    }
  }
  return noiseBuf;
}

interface ToneOpts {
  type?: Wave;
  gain?: number;
  to?: number;
  attack?: number;
  /** Optional low-pass cutoff for softer timbres. */
  lp?: number;
}

function tone(c: AudioContext, out: AudioNode, freq: number, at: number, dur: number, o: ToneOpts = {}): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + dur);
  const peak = o.gain ?? 0.2;
  const atk = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let last: AudioNode = g;
  let lp: BiquadFilterNode | null = null;
  osc.connect(g);
  if (o.lp) {
    lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp;
    g.connect(lp);
    last = lp;
  }
  last.connect(out);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
    lp?.disconnect();
  };
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function burst(
  c: AudioContext,
  out: AudioNode,
  at: number,
  dur: number,
  o: { type?: BiquadFilterType; freq: number; to?: number; q?: number; gain?: number },
): void {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, at);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, at + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, at + Math.min(0.02, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
  src.start(at, Math.random() * 0.2);
  src.stop(at + dur + 0.02);
}

// Note frequencies used by jingles.
const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, E4: 329.63, C4: 261.63, D5: 587.33 };

/** Minimum gap between two plays of the same sound (prevents stacking on rapid input). */
const MIN_GAP_MS: Partial<Record<SfxName, number>> = { click: 40, tap: 40, select: 40, coin: 45, tick: 300, tickUrgent: 300 };

export function sfx(name: SfxName): void {
  if (!soundOn()) return;
  const nowMs = performance.now();
  const gap = MIN_GAP_MS[name] ?? 30;
  const prev = lastPlayed.get(name);
  if (prev !== undefined && nowMs - prev < gap) return;
  lastPlayed.set(name, nowMs);
  const c = ctx;
  // Before the first gesture there is no context: stay silent rather than create a blocked one.
  if (!c || !master || c.state !== 'running') return;
  const out = master;
  const t = c.currentTime + 0.005;
  switch (name) {
    case 'click':
      tone(c, out, 1400, t, 0.045, { to: 900, gain: 0.07 });
      break;
    case 'page':
      burst(c, out, t, 0.09, { freq: 2400, to: 4200, q: 0.8, gain: 0.05 });
      break;
    case 'tap':
      tone(c, out, 620, t, 0.07, { gain: 0.08, type: 'triangle' });
      break;
    case 'select':
      tone(c, out, 660, t, 0.06, { gain: 0.11, type: 'triangle' });
      tone(c, out, 990, t + 0.045, 0.09, { gain: 0.1, type: 'triangle' });
      break;
    case 'move':
      burst(c, out, t, 0.18, { freq: 600, to: 1700, q: 0.9, gain: 0.09 });
      break;
    case 'jump':
      tone(c, out, 300, t, 0.16, { to: 820, gain: 0.12, type: 'sine' });
      burst(c, out, t, 0.12, { freq: 1500, to: 3000, q: 1.2, gain: 0.04 });
      break;
    case 'land':
      tone(c, out, 210, t, 0.09, { to: 115, gain: 0.24, type: 'triangle', lp: 900 });
      burst(c, out, t, 0.05, { type: 'lowpass', freq: 1200, q: 0.7, gain: 0.06 });
      break;
    case 'capture':
      burst(c, out, t, 0.22, { type: 'lowpass', freq: 2600, to: 300, q: 0.7, gain: 0.32 });
      tone(c, out, 190, t, 0.22, { to: 55, gain: 0.3, type: 'square', lp: 700 });
      tone(c, out, N.E6, t + 0.07, 0.18, { gain: 0.06 });
      tone(c, out, N.A5 * 2, t + 0.11, 0.2, { gain: 0.045 });
      break;
    case 'turn':
      tone(c, out, N.A5, t, 0.32, { gain: 0.11, attack: 0.008 });
      tone(c, out, N.E6, t + 0.09, 0.42, { gain: 0.09, attack: 0.008 });
      break;
    case 'tick':
      tone(c, out, 1700, t, 0.03, { gain: 0.06, type: 'square', lp: 4000 });
      break;
    case 'tickUrgent':
      tone(c, out, 2100, t, 0.04, { gain: 0.09, type: 'square', lp: 5000 });
      break;
    case 'win': {
      const seq = [N.C5, N.E5, N.G5, N.C6];
      seq.forEach((f, i) => tone(c, out, f, t + i * 0.09, 0.22, { type: 'triangle', gain: 0.16 }));
      const end = t + seq.length * 0.09;
      for (const f of [N.C6, N.E6, N.G5 * 2]) tone(c, out, f, end, 0.9, { type: 'triangle', gain: 0.08, attack: 0.02 });
      burst(c, out, end, 0.5, { type: 'highpass', freq: 6000, q: 0.5, gain: 0.03 });
      break;
    }
    case 'lose':
      tone(c, out, N.G4, t, 0.3, { type: 'sine', gain: 0.12, lp: 1400 });
      tone(c, out, N.E4, t + 0.24, 0.3, { type: 'sine', gain: 0.11, lp: 1400 });
      tone(c, out, N.C4, t + 0.48, 0.7, { type: 'sine', gain: 0.1, lp: 1200, attack: 0.02 });
      break;
    case 'draw':
      tone(c, out, N.E5, t, 0.25, { type: 'triangle', gain: 0.1 });
      tone(c, out, N.E5, t + 0.2, 0.45, { type: 'triangle', gain: 0.09 });
      break;
    case 'boxShake':
      for (let i = 0; i < 4; i++) {
        burst(c, out, t + i * 0.16, 0.1, { type: 'lowpass', freq: 500, q: 0.8, gain: 0.16 });
        tone(c, out, 140, t + i * 0.16, 0.08, { to: 90, gain: 0.12, type: 'triangle', lp: 600 });
      }
      break;
    case 'reveal': {
      burst(c, out, t, 0.35, { type: 'lowpass', freq: 3000, to: 400, q: 0.6, gain: 0.25 });
      const seq = [N.G5, N.C6, N.E6, N.G5 * 2];
      seq.forEach((f, i) => tone(c, out, f, t + 0.05 + i * 0.06, 0.4, { type: 'sine', gain: 0.08 }));
      break;
    }
    case 'levelup': {
      // Rising power-up arpeggio with a shimmer tail.
      const seq = [N.C5, N.E5, N.G5, N.C6, N.E6];
      seq.forEach((f, i) => tone(c, out, f, t + i * 0.07, 0.26, { type: 'triangle', gain: 0.14 }));
      const end = t + seq.length * 0.07;
      for (const f of [N.C6, N.G5 * 2]) tone(c, out, f, end, 0.8, { type: 'sine', gain: 0.08, attack: 0.02 });
      burst(c, out, end, 0.45, { type: 'highpass', freq: 5000, q: 0.5, gain: 0.04 });
      break;
    }
    case 'coin':
      tone(c, out, 1975, t, 0.06, { gain: 0.05, type: 'square', lp: 6000 });
      tone(c, out, 2637, t + 0.035, 0.08, { gain: 0.045, type: 'square', lp: 6000 });
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------------------------

export type HapticName = 'light' | 'select' | 'capture' | 'turn' | 'win' | 'lose' | 'warn';

const PATTERNS: Record<HapticName, number | number[]> = {
  light: 8,
  select: 12,
  turn: 18,
  capture: [28, 40, 18],
  warn: 22,
  win: [30, 60, 30, 60, 90],
  lose: 60,
};

export function haptic(name: HapticName): void {
  if (!getProfile().settings.haptics) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[name]);
  } catch {
    /* some browsers throw without a user gesture */
  }
}
