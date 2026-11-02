/**
 * Character voice lines (AI voice actors, Korean) and character-specific sound effects.
 *
 * - Clips are small AAC (.m4a) files under public/audio/, listed in ./voiceManifest.ts.
 * - Everything is lazy: bytes are fetched on first need (or by preloadCharacterAudio at match
 *   start) and decoded once into the shared AudioContext from ./sfx.ts. Nothing here ever blocks
 *   gameplay or throws: missing files, decode failures and environments without Web Audio (Vitest,
 *   SSR, very old WebViews) all degrade to silence.
 * - Voice lines never overlap: a new line fades the previous one out unless the previous line has
 *   a higher priority and is still playing (then the new one is dropped). Each event also has a
 *   cooldown so rapid taps do not turn into chatter.
 * - Settings are read at play time: `settings.sound` gates everything, `settings.voice` (optional,
 *   defaults to on) gates voice lines only.
 */
import type { CharacterId } from '../engine/types';
import { getProfile } from '../meta/profile';
import { audioOut, getAudioContext, isSoundOn } from './sfx';
import { CHAR_SFX, GENERIC_SFX, VOICE_CLIPS, type CharAudioEvent } from './voiceManifest';

export type { CharAudioEvent };

export interface VoiceOptions {
  /** Unit grade: 1-star lines are pitched a touch younger/brighter, 3-star a touch heavier. */
  level?: 1 | 2 | 3;
  /** 0 = the player, 1 = the opponent (played slightly quieter). */
  owner?: 0 | 1;
}

// Mix levels (relative to the shared master bus of sfx.ts). Clips are mastered to -16 LUFS.
const VOICE_GAIN = 0.85;
const ENEMY_VOICE_GAIN = 0.68;
const CHAR_SFX_GAIN = 0.75;

/** Higher wins: a lower-priority line never cuts off a higher-priority one that is still playing. */
const PRIORITY: Record<CharAudioEvent, number> = {
  select: 1,
  move: 1,
  capture: 2,
  skill: 2,
  chain: 3,
  death: 3,
  victory: 4,
};

/** Minimum gap between two voice lines of the same event (any character). */
const VOICE_COOLDOWN_MS: Record<CharAudioEvent, number> = {
  select: 650,
  move: 1100,
  capture: 250,
  skill: 350,
  chain: 300,
  death: 250,
  victory: 2000,
};

/** Probability that a voice line is spoken at all (keeps frequent events from getting repetitive). */
const VOICE_CHANCE: Partial<Record<CharAudioEvent, number>> = { move: 0.6 };

/** Playback-rate tint per grade (pitch and speed move together; +-3% is subtle but audible). */
const LEVEL_RATE: Record<1 | 2 | 3, number> = { 1: 1.035, 2: 1, 3: 0.97 };

const FADE_S = 0.06;
const SFX_MIN_GAP_MS = 45;
/** A clip that was not decoded in time is played late only within this window, else dropped. */
const LATE_WINDOW_MS = 220;

interface Playing {
  src: AudioBufferSourceNode;
  gain: GainNode;
  priority: number;
  endsAt: number;
}

const bytes = new Map<string, Promise<ArrayBuffer | null>>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();
const ready = new Map<string, AudioBuffer>();
const lastVoiceAt = new Map<CharAudioEvent, number>();
const lastVariant = new Map<string, number>();
const lastSfxAt = new Map<string, number>();
let current: Playing | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function hasBrowserAudio(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

function voiceOn(): boolean {
  try {
    return isSoundOn() && (getProfile().settings as { voice?: boolean }).voice !== false;
  } catch {
    return false;
  }
}

function soundOn(): boolean {
  try {
    return isSoundOn();
  } catch {
    return false;
  }
}

function assetUrl(rel: string): string {
  let base = './';
  try {
    base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  } catch {
    /* non-Vite environment */
  }
  return `${base.endsWith('/') ? base : `${base}/`}audio/${rel}`;
}

function fetchBytes(rel: string): Promise<ArrayBuffer | null> {
  let p = bytes.get(rel);
  if (!p) {
    p = fetch(assetUrl(rel))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    bytes.set(rel, p);
  }
  return p;
}

/** decodeAudioData with the callback form too (older Safari has no promise return). */
function decodeCompat(c: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const p = c.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

/** Fetch + decode once; resolves null on any failure (and keeps that result: no retry storms). */
function load(rel: string): Promise<AudioBuffer | null> {
  const done = ready.get(rel);
  if (done) return Promise.resolve(done);
  let p = decoding.get(rel);
  if (p) return p;
  const c = getAudioContext();
  if (!c) return fetchBytes(rel).then(() => null); // warm the bytes; decode once a context exists
  p = fetchBytes(rel)
    .then((b) => (b ? decodeCompat(c, b.slice(0)) : null))
    .then((buf) => {
      if (buf) {
        ready.set(rel, buf);
        bytes.delete(rel); // the decoded buffer is all we need from now on
      }
      return buf;
    })
    .catch(() => null);
  decoding.set(rel, p);
  return p;
}

function pickVariant(key: string, list: readonly string[]): string {
  if (list.length === 1) return list[0];
  const prev = lastVariant.get(key);
  let i = Math.floor(Math.random() * list.length);
  if (i === prev) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  lastVariant.set(key, i);
  return list[i];
}

function stopCurrent(at: number): void {
  const p = current;
  if (!p) return;
  current = null;
  try {
    p.gain.gain.cancelScheduledValues(at);
    p.gain.gain.setValueAtTime(p.gain.gain.value, at);
    p.gain.gain.linearRampToValueAtTime(0.0001, at + FADE_S);
    p.src.stop(at + FADE_S + 0.01);
  } catch {
    /* already stopped */
  }
}

/** Play a decoded buffer on the shared bus. Returns the node pair, or null when audio is unavailable. */
function playBuffer(buf: AudioBuffer, gain: number, rate = 1): { src: AudioBufferSourceNode; gain: GainNode } | null {
  const o = audioOut();
  if (!o) return null;
  try {
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = o.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(o.out);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start(o.ctx.currentTime + 0.005);
    return { src, gain: g };
  } catch {
    return null;
  }
}

/**
 * Voice line for a character event. Fire-and-forget; safe to call anywhere (no-ops when muted,
 * before the first user gesture, or without Web Audio).
 */
export function playVoice(character: CharacterId, event: CharAudioEvent, opts: VoiceOptions = {}): void {
  try {
    if (!hasBrowserAudio() || !voiceOn()) return;
    const list = VOICE_CLIPS[character]?.[event];
    if (!list || list.length === 0) return;
    const chance = VOICE_CHANCE[event];
    if (chance !== undefined && Math.random() > chance) return;
    const o = audioOut();
    if (!o) return;
    const t = nowMs();
    const prevAt = lastVoiceAt.get(event);
    if (prevAt !== undefined && t - prevAt < VOICE_COOLDOWN_MS[event]) return;
    const priority = PRIORITY[event];
    if (current && current.priority > priority && o.ctx.currentTime < current.endsAt - 0.08) return;
    lastVoiceAt.set(event, t);

    const rel = pickVariant(`${character}:${event}`, list);
    const level = opts.level ?? 2;
    const rate = LEVEL_RATE[level] ?? 1;
    const gain = (opts.owner === 1 ? ENEMY_VOICE_GAIN : VOICE_GAIN) * (level === 3 ? 1.06 : 1);
    const start = (buf: AudioBuffer | null): void => {
      if (!buf || !voiceOn()) return;
      const out = audioOut();
      if (!out) return;
      // Re-check priority: something more important may have started while this was decoding.
      if (current && current.priority > priority && out.ctx.currentTime < current.endsAt - 0.08) return;
      stopCurrent(out.ctx.currentTime);
      const p = playBuffer(buf, gain, rate);
      if (!p) return;
      const playing: Playing = { ...p, priority, endsAt: out.ctx.currentTime + buf.duration / rate };
      current = playing;
      p.src.addEventListener('ended', () => {
        if (current === playing) current = null;
      });
    };
    const buf = ready.get(rel);
    if (buf) start(buf);
    else void load(rel).then((b) => (nowMs() - t <= LATE_WINDOW_MS ? start(b) : undefined));
  } catch {
    /* never let audio break gameplay */
  }
}

/** Character-specific sound effect (falls back to a shared effect for death). Overlaps freely. */
export function playCharSfx(character: CharacterId, event: CharAudioEvent): void {
  try {
    if (!hasBrowserAudio() || !soundOn()) return;
    const rel = CHAR_SFX[character]?.[event] ?? GENERIC_SFX[event];
    if (!rel) return;
    if (!audioOut()) return;
    const t = nowMs();
    const prev = lastSfxAt.get(rel);
    if (prev !== undefined && t - prev < SFX_MIN_GAP_MS) return;
    lastSfxAt.set(rel, t);
    const buf = ready.get(rel);
    if (buf) playBuffer(buf, CHAR_SFX_GAIN);
    else void load(rel).then((b) => (b && nowMs() - t <= LATE_WINDOW_MS ? playBuffer(b, CHAR_SFX_GAIN) : undefined));
  } catch {
    /* never let audio break gameplay */
  }
}

/** Every clip (voice + sfx) a character can use. */
function clipsFor(character: CharacterId): string[] {
  const out = new Set<string>();
  const v = VOICE_CLIPS[character] ?? {};
  for (const list of Object.values(v)) for (const rel of list ?? []) out.add(rel);
  for (const rel of Object.values(CHAR_SFX[character] ?? {})) if (rel) out.add(rel);
  for (const rel of Object.values(GENERIC_SFX)) if (rel) out.add(rel);
  return [...out];
}

/**
 * Fetch and decode the clips of the given characters (call at match start). Resolves when done;
 * never rejects. Without an AudioContext yet it only warms the bytes.
 */
export async function preloadCharacterAudio(characters: CharacterId[]): Promise<void> {
  try {
    if (!hasBrowserAudio() || !soundOn()) return;
    const rels = new Set<string>();
    for (const c of characters) for (const rel of clipsFor(c)) rels.add(rel);
    await Promise.all([...rels].map((rel) => load(rel).catch(() => null)));
  } catch {
    /* ignore */
  }
}

/** Stop any voice line immediately (e.g. when leaving a match). */
export function stopVoice(): void {
  try {
    const c = getAudioContext();
    if (c) stopCurrent(c.currentTime);
    current = null;
  } catch {
    /* ignore */
  }
}
