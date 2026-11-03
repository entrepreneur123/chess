/**
 * Arena background music: one seamless loop per arena (public/audio/bgm/<id>.m4a).
 *
 * - Web Audio only: each track is fetched and decoded once into an AudioBuffer and played by an
 *   AudioBufferSourceNode with `loop = true`, which loops sample-accurately (no <audio> gap).
 * - The files carry a 0.512 s guard pad of the music on each side of the loop (see
 *   docs/brand/audio/bgm/README.md). On decode the loop region is copied into its own buffer and
 *   its last 40 ms are blended into the audio just before the loop start, so the wrap from the
 *   last sample to the first continues the waveform exactly, whatever AAC priming the decoder kept.
 * - Lazy: a track is loaded on first request; at most MAX_CACHED decoded loops stay in memory
 *   (least recently used goes first; a decoded 70 s stereo loop is about 27 MB of float32).
 * - Shares the AudioContext and output bus of ./sfx.ts. Nothing here creates a context outside a
 *   user gesture: before the first gesture (autoplay policy) a request is queued and starts on
 *   the next pointer/key gesture. The shared context is suspended while the page is hidden (by
 *   sfx.ts installAudio, and by this module as a fallback), which pauses the music.
 * - Plays only when `setMusicEnabled(true)` (default) and the profile has `settings.sound` and
 *   `settings.music` (missing `music` counts as on). Settings are re-checked after every click.
 * - Never throws: a missing file, a decode error or an environment without Web Audio is silence.
 */
import { getProfile } from '../meta/profile';
import { audioOut, getAudioContext, primeAudio } from './sfx';
import { setVoiceActivityListener } from './voice';

/** Loop points in samples at 48 kHz (the files' rate), from docs/brand/audio/bgm/loops.json. */
const LOOPS: Record<string, { start: number; length: number }> = {
  moonrune: { start: 24576, length: 3291136 },
  emberforge: { start: 24576, length: 3686400 },
  blightmire: { start: 24576, length: 3072000 },
  frostkeep: { start: 24576, length: 3359744 },
  madcrown: { start: 24576, length: 3351552 },
  apex: { start: 24576, length: 3456000 },
};
const LOOP_RATE = 48000;

/** The arena tracks that ship with the game. */
export const MUSIC_TRACK_IDS = Object.keys(LOOPS);

/** Music level on the shared bus (files are mastered to -20 LUFS; voice clips to -16 LUFS). */
export const MUSIC_GAIN = 0.5;
/** Level while voice lines and cut-ins play (about -8 dB). */
export const DUCK_GAIN = 0.4;
const CROSSFADE_S = 0.8;
/** Must match SEAM_BLEND_S in docs/brand/audio/bgm/measure_bgm.py. */
export const SEAM_BLEND_S = 0.04;
const MAX_CACHED = 2;
const DUCK_ATTACK_TAU = 0.06;
const DUCK_RELEASE_TAU = 0.25;

// ------------------------------------------------------------------------------------------------
// Backend (overridable in unit tests)
// ------------------------------------------------------------------------------------------------

interface Backend {
  /** The running context and the bus to connect to, or null before unlock / while suspended. */
  out(): { ctx: AudioContext; out: AudioNode } | null;
  fetchBytes(url: string): Promise<ArrayBuffer | null>;
  /** settings.sound && settings.music (music defaults to on). */
  settingsAllow(): boolean;
  /** Called from a user gesture: create/resume the shared context if sound is on. */
  prime(): void;
  hidden(): boolean;
}

function assetBase(): string {
  let base = './';
  try {
    base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  } catch {
    /* non-Vite environment */
  }
  return base.endsWith('/') ? base : `${base}/`;
}

const defaultBackend: Backend = {
  out: () => audioOut(),
  fetchBytes: (url) =>
    typeof fetch === 'function'
      ? fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null)
      : Promise.resolve(null),
  settingsAllow: () => {
    const s = getProfile().settings as { sound: boolean; music?: boolean };
    return s.sound && s.music !== false;
  },
  prime: () => primeAudio(),
  hidden: () => typeof document !== 'undefined' && document.hidden,
};

let be: Backend = defaultBackend;

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------

interface Voice {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

let desired: string | null = null;
let enabled = true;
let ducked = false;
let current: Voice | null = null;
let bus: { ctx: AudioContext; music: GainNode; duck: GainNode } | null = null;
let requestSeq = 0;
let waiting = false;
let installed = false;
const cache = new Map<string, AudioBuffer>(); // insertion order = LRU order
const loading = new Map<string, Promise<AudioBuffer | null>>();
const failed = new Set<string>();

function allowed(): boolean {
  try {
    return enabled && be.settingsAllow();
  } catch {
    return false;
  }
}

function trackUrl(id: string): string {
  return `${assetBase()}audio/bgm/${id}.m4a`;
}

/** decodeAudioData with the callback form too (older Safari has no promise return). */
function decode(c: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const p = c.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * The playable loop: [loopStart, loopEnd) of the decoded file, with its last SEAM_BLEND_S faded
 * into the audio just before loopStart so the end flows into the start. Falls back to the whole
 * decoded buffer when there are no (valid) loop points. Exported for tests.
 */
export function buildLoopBuffer(c: BaseAudioContext, dec: AudioBuffer, id: string): AudioBuffer {
  const lp = LOOPS[id];
  if (!lp) return dec;
  const sr = dec.sampleRate;
  const a = Math.round((lp.start / LOOP_RATE) * sr);
  const n = Math.round((lp.length / LOOP_RATE) * sr);
  const x = Math.min(Math.round(SEAM_BLEND_S * sr), a, n);
  if (n <= 0 || a + n > dec.length) return dec;
  const out = c.createBuffer(dec.numberOfChannels, n, sr);
  for (let ch = 0; ch < dec.numberOfChannels; ch++) {
    const src = dec.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(a, a + n));
    for (let i = 0; i < x; i++) {
      const w = (i + 1) / x;
      const k = n - x + i;
      dst[k] = dst[k] * (1 - w) + src[a - x + i] * w;
    }
  }
  return out;
}

function remember(id: string, buf: AudioBuffer): void {
  cache.delete(id);
  cache.set(id, buf);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

function load(id: string, c: AudioContext): Promise<AudioBuffer | null> {
  const hit = cache.get(id);
  if (hit) {
    remember(id, hit); // refresh LRU position
    return Promise.resolve(hit);
  }
  if (failed.has(id)) return Promise.resolve(null);
  let p = loading.get(id);
  if (p) return p;
  p = be
    .fetchBytes(trackUrl(id))
    .then((bytes) => (bytes ? decode(c, bytes) : null))
    .then((dec) => {
      if (!dec) {
        failed.add(id);
        return null;
      }
      const buf = buildLoopBuffer(c, dec, id);
      remember(id, buf);
      return buf;
    })
    .catch(() => {
      failed.add(id);
      return null;
    })
    .finally(() => loading.delete(id));
  loading.set(id, p);
  return p;
}

function ensureBus(o: { ctx: AudioContext; out: AudioNode }): { ctx: AudioContext; music: GainNode; duck: GainNode } {
  if (bus && bus.ctx === o.ctx) return bus;
  const music = o.ctx.createGain();
  const duck = o.ctx.createGain();
  music.gain.value = MUSIC_GAIN;
  duck.gain.value = ducked ? DUCK_GAIN : 1;
  music.connect(duck);
  duck.connect(o.out);
  bus = { ctx: o.ctx, music, duck };
  current = null;
  return bus;
}

/**
 * Freeze a param at its current value from time t on, so a new ramp can start there without a jump
 * (cancelScheduledValues alone would snap a ramp in progress back to its start value).
 */
function holdAt(p: AudioParam, t: number): void {
  const q = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof q.cancelAndHoldAtTime === 'function') q.cancelAndHoldAtTime(t);
  else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

function fadeOut(v: Voice, ctx: AudioContext): void {
  try {
    const t = ctx.currentTime;
    holdAt(v.gain.gain, t);
    v.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_S);
    v.src.stop(t + CROSSFADE_S + 0.05);
  } catch {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
  }
}

function startVoice(id: string, buf: AudioBuffer, b: NonNullable<typeof bus>): void {
  const ctx = b.ctx;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  const t = ctx.currentTime + 0.01;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + CROSSFADE_S);
  src.connect(gain);
  gain.connect(b.music);
  src.onended = () => {
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      /* ignore */
    }
  };
  src.start(t);
  if (current) fadeOut(current, ctx);
  current = { id, src, gain };
}

function stopAll(): void {
  if (current && bus) fadeOut(current, bus.ctx);
  current = null;
}

/** Bring playback in line with `desired`, `enabled`, the settings and the context state. */
function sync(): void {
  if (!allowed() || desired === null) {
    requestSeq++;
    stopAll();
    return;
  }
  if (current && current.id === desired) return;
  const o = be.out();
  if (!o || be.hidden()) {
    queueForGesture();
    return;
  }
  waiting = false;
  const b = ensureBus(o);
  const id = desired;
  const seq = ++requestSeq;
  void load(id, o.ctx).then((buf) => {
    try {
      if (seq !== requestSeq || desired !== id || !allowed()) return;
      if (current && current.id === id) return;
      if (!buf) {
        stopAll(); // the requested arena has no music: fade out the previous one
        return;
      }
      const live = be.out();
      if (!live || live.ctx !== b.ctx || be.hidden()) {
        queueForGesture();
        return;
      }
      startVoice(id, buf, b);
    } catch {
      /* never let music break the game */
    }
  });
}

function retry(): void {
  try {
    if (!desired || !allowed()) return;
    if (!be.out()) be.prime(); // inside a gesture: creating/resuming the context is allowed
    sync();
  } catch {
    /* ignore */
  }
}

/** Wait for the next user gesture or visibility/context change, then try again. */
function queueForGesture(): void {
  waiting = true;
  install();
}

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const onGesture = () => {
    if (!waiting) return;
    // Let sfx.ts's own gesture unlock run first (same event, capture phase).
    setTimeout(() => {
      retry();
      // resume() is async: if the context is still starting, try again once it reports running.
      const c = getAudioContext();
      if (waiting && c && c.state !== 'running') {
        try {
          c.addEventListener('statechange', () => retry(), { once: true });
        } catch {
          /* ignore */
        }
      }
    }, 0);
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener('touchend', onGesture, true);
  // Settings toggles are clicks: re-check sound/music after each one.
  document.addEventListener(
    'click',
    () =>
      setTimeout(() => {
        if (desired === null && !current) return;
        try {
          if (allowed() && !be.out()) return; // still locked: the gesture handler deals with it
          sync();
        } catch {
          /* ignore */
        }
      }, 0),
    true,
  );
  document.addEventListener('visibilitychange', () => {
    try {
      const o = be.out();
      if (be.hidden()) {
        // sfx.ts suspends the shared context when hidden; do it here too in case it is not installed.
        if (o) void o.ctx.suspend().catch(() => {});
      } else if (desired && allowed()) {
        if (o?.ctx.state === 'suspended') void o.ctx.resume().catch(() => {});
        setTimeout(retry, 0);
      }
    } catch {
      /* ignore */
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------------------------------------

/**
 * Play the loop for `id` (an arena id, see MUSIC_TRACK_IDS), crossfading about 800 ms from the
 * current one; null fades the music out. Does nothing if that track is already playing. Before the
 * first user gesture, or while the page is hidden, the request is queued.
 */
export function setMusicTrack(id: string | null): void {
  try {
    install();
    if (id === desired && (id === null || (current && current.id === id))) return;
    desired = id;
    sync();
  } catch {
    /* never throws */
  }
}

/** Turn music on or off (the settings toggle). Off fades out; on resumes the requested track. */
export function setMusicEnabled(on: boolean): void {
  try {
    install();
    enabled = on;
    if (on && desired && !be.out()) be.prime(); // usually called from the toggle's click
    sync();
  } catch {
    /* never throws */
  }
}

/** Lower the music by about 8 dB (true) while voice lines and cut-ins play; false restores it. */
export function duckMusic(on: boolean): void {
  try {
    ducked = on;
    if (!bus) return;
    const g = bus.duck.gain;
    const t = bus.ctx.currentTime;
    holdAt(g, t);
    g.setTargetAtTime(on ? DUCK_GAIN : 1, t, on ? DUCK_ATTACK_TAU : DUCK_RELEASE_TAU);
  } catch {
    /* never throws */
  }
}

// Duck under character voice lines (voice.ts reports when a line starts and when speech ends).
setVoiceActivityListener(duckMusic);

// ------------------------------------------------------------------------------------------------
// Test hooks (not for game code)
// ------------------------------------------------------------------------------------------------

/** Replace parts of the backend (tests) and reset all state. Pass nothing to restore defaults. */
export function _resetMusicForTests(overrides?: Partial<Backend>): void {
  be = overrides ? { ...defaultBackend, ...overrides } : defaultBackend;
  desired = null;
  enabled = true;
  ducked = false;
  current = null;
  bus = null;
  requestSeq++;
  waiting = false;
  cache.clear();
  loading.clear();
  failed.clear();
}

/** Snapshot of the internal state (tests). */
export function _musicStateForTests(): { desired: string | null; playing: string | null; cached: string[]; enabled: boolean; ducked: boolean } {
  return { desired, playing: current?.id ?? null, cached: [...cache.keys()], enabled, ducked };
}

/** What a user gesture does to a queued request (tests). */
export function _gestureForTests(): void {
  retry();
}
