import { describe, expect, it } from 'vitest';
import type { CharacterId } from '../src/engine/types';
import { playCharSfx, playVoice, playWasteDeath, preloadCharacterAudio, stopVoice } from '../src/audio/voice';
import {
  CHAR_SFX,
  GENERIC_SFX,
  VOICE_CLIPS,
  VOICE_TEXT,
  WASTE_DEATH_SFX,
  type CharAudioEvent,
} from '../src/audio/voiceManifest';

// The project has no @types/node: load the few fs helpers through an untyped dynamic import.
interface Fs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  statSync(p: string): { size: number };
}
const nodeFs = 'node:fs';
const fsP: Promise<Fs> = import(/* @vite-ignore */ nodeFs);
const audioDir = decodeURIComponent(new URL('../public/audio/', import.meta.url).pathname);
const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
// Typed as a full record so adding a CharacterId without listing it here fails to compile.
const CHAR_SET: Record<CharacterId, true> = { sad: true, marki: true, walk: true, insaner: true, brutile: true, michelle: true, picker: true };
const ALL_CHARS = Object.keys(CHAR_SET) as CharacterId[];
/**
 * Characters whose voices are recorded. Michelle and Picker are voiced separately (their clips land
 * in the generated manifest later); until then they must simply stay silent, see the last test.
 */
const VOICED = new Set<CharacterId>(['sad', 'marki', 'walk', 'insaner', 'brutile']);
const CHARS = ALL_CHARS.filter((c) => VOICED.has(c) || (VOICE_CLIPS as Partial<typeof VOICE_CLIPS>)[c] !== undefined);
const VOICE_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture', 'skill', 'death', 'victory'];
const SFX_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture', 'skill'];

function allFiles(): string[] {
  const out = new Set<string>();
  for (const c of CHARS) {
    for (const list of Object.values(VOICE_CLIPS[c] ?? {})) for (const f of list ?? []) out.add(f);
    for (const f of Object.values(CHAR_SFX[c] ?? {})) if (f) out.add(f);
  }
  for (const f of Object.values(GENERIC_SFX)) if (f) out.add(f);
  if (WASTE_DEATH_SFX) out.add(WASTE_DEATH_SFX);
  return [...out];
}

describe('character audio manifest', () => {
  it('has a voice line for every character x event the game uses', () => {
    for (const c of CHARS) {
      for (const e of VOICE_EVENTS) expect(VOICE_CLIPS[c][e]?.length ?? 0, `${c}.${e}`).toBeGreaterThan(0);
      // Captures are the most frequent highlight: at least two variants so it does not repeat.
      expect(VOICE_CLIPS[c].capture!.length, `${c}.capture variants`).toBeGreaterThanOrEqual(2);
    }
    expect(VOICE_CLIPS.insaner.chain?.length ?? 0).toBeGreaterThan(0);
    // chain is insaner's mechanic only.
    for (const c of CHARS) if (c !== 'insaner') expect(VOICE_CLIPS[c].chain, `${c}.chain`).toBeUndefined();
  });

  it('captions every voice clip', () => {
    for (const c of CHARS)
      for (const list of Object.values(VOICE_CLIPS[c])) for (const f of list ?? []) expect(VOICE_TEXT[f], f).toBeTruthy();
  });

  it('has character sound effects for select/move/capture/skill, a chain chime and a shared death', () => {
    for (const c of CHARS) for (const e of SFX_EVENTS) expect(CHAR_SFX[c][e], `${c}.${e}`).toBeTruthy();
    expect(CHAR_SFX.insaner.chain).toBeTruthy();
    expect(GENERIC_SFX.death).toBeTruthy();
    expect(WASTE_DEATH_SFX).toBe('sfx/waste-death.m4a');
  });

  it('every listed file exists under public/audio and is a small m4a', async () => {
    const { existsSync, statSync } = await fsP;
    for (const f of allFiles()) {
      expect(f, f).toMatch(/^(vo|sfx)\/[a-z0-9-]+\.m4a$/);
      const p = join(audioDir, f);
      expect(existsSync(p), p).toBe(true);
      const size = statSync(p).size;
      expect(size, f).toBeGreaterThan(1000);
      expect(size, f).toBeLessThan(40_000);
    }
  });

  it('keeps the whole audio payload under 1.2 MB', async () => {
    const { readdirSync, statSync } = await fsP;
    let total = 0;
    for (const sub of ['vo', 'sfx']) {
      const dir = join(audioDir, sub);
      for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
    }
    expect(total).toBeLessThan(1.2 * 1024 * 1024);
  });

  it('is a safe no-op without Web Audio (node test environment)', async () => {
    expect(() => playVoice('sad', 'capture', { level: 3, owner: 1 })).not.toThrow();
    expect(() => playCharSfx('insaner', 'chain')).not.toThrow();
    expect(() => playVoice('brutile', 'skill', { level: 1 })).not.toThrow();
    expect(() => playWasteDeath()).not.toThrow();
    expect(() => stopVoice()).not.toThrow();
    await expect(preloadCharacterAudio(CHARS)).resolves.toBeUndefined();
  });

  it('new characters and new game events never throw, voiced or not', async () => {
    for (const c of ['michelle', 'picker'] as CharacterId[]) {
      for (const e of ['select', 'move', 'capture', 'death', 'victory', 'trap-set', 'trap-sprung', 'hop-multi'] as const) {
        expect(() => playVoice(c, e, { level: 2, owner: 0 })).not.toThrow();
        expect(() => playCharSfx(c, e)).not.toThrow();
      }
    }
    await expect(preloadCharacterAudio(['michelle', 'picker'])).resolves.toBeUndefined();
  });
});
