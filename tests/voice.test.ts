import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/engine/characters';
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
const CHAR_SET: Record<CharacterId, true> = { sad: true, marki: true, walk: true, insaner: true, brutile: true, michelle: true, picker: true, rakaeli: true };
const ROSTER = Object.keys(CHAR_SET) as CharacterId[];
/**
 * Characters the generated manifest already voices. A character ships before its recordings (the
 * game then stays silent for it, see 'degrades to silence' below); once its manifest entry lands
 * every requirement here applies to it automatically.
 */
const CHARS = ROSTER.filter((c) => (VOICE_CLIPS as Partial<typeof VOICE_CLIPS>)[c] !== undefined);
/** The five original characters: every requirement they had before the roster grew still applies. */
const ORIGINAL: CharacterId[] = ['sad', 'marki', 'walk', 'insaner', 'brutile'];
/**
 * Trait events and their owners. A character with a trait and no skill (`CHARACTERS[c].skill` is
 * undefined) is voiced on its trait events instead of 'skill'. The originals' 'skill' audio event is
 * their signature-move / absorb / wasteland sound, so it stays required for them even though only
 * brutile has a `skill` definition.
 */
const TRAIT_EVENTS: Partial<Record<CharacterId, CharAudioEvent[]>> = {
  michelle: ['trap-set', 'trap-sprung'],
  picker: ['hop-multi'],
};
/**
 * Second-form events and their owner: Rakaeli's transformed form (타천) has its own lines for every
 * moment plus the line and effect for turning back (awake-end). He keeps his 'skill' (the transform
 * cast). There is no awake-select effect: it falls back to his select effect, like awake-death to death.
 */
const FORM_VOICE_EVENTS: Partial<Record<CharacterId, CharAudioEvent[]>> = {
  rakaeli: ['awake-select', 'awake-move', 'awake-capture', 'awake-death', 'awake-end'],
};
const FORM_SFX_EVENTS: Partial<Record<CharacterId, CharAudioEvent[]>> = {
  rakaeli: ['awake-move', 'awake-capture', 'awake-end'],
};
const usesTraitsInsteadOfSkill = (c: CharacterId): boolean => !CHARACTERS[c].skill && !!CHARACTERS[c].trait;
const BASE_VOICE_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture', 'death', 'victory'];
const BASE_SFX_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture'];
const voiceEvents = (c: CharacterId): CharAudioEvent[] => [
  ...BASE_VOICE_EVENTS,
  ...(usesTraitsInsteadOfSkill(c) ? [] : (['skill'] as CharAudioEvent[])),
  ...(TRAIT_EVENTS[c] ?? []),
  ...(FORM_VOICE_EVENTS[c] ?? []),
];
const sfxEvents = (c: CharacterId): CharAudioEvent[] => [
  ...BASE_SFX_EVENTS,
  ...(usesTraitsInsteadOfSkill(c) ? [] : (['skill'] as CharAudioEvent[])),
  ...(TRAIT_EVENTS[c] ?? []),
  ...(FORM_SFX_EVENTS[c] ?? []),
];
/**
 * vo + sfx payload budget. Raised from 1.2 MiB to 1.5 MiB on 2026-11-04 (lead decision) when the roster
 * grew from 5 to 7 characters, so the budget per character stays about the same (0.24 -> 0.21 MiB). Measured
 * then: 1,424,699 bytes (vo 1,153,610 + sfx 271,089).
 */
const AUDIO_BUDGET_BYTES = 1.5 * 1024 * 1024;

function allFiles(): string[] {
  const out = new Set<string>();
  for (const c of CHARS) {
    for (const list of Object.values(VOICE_CLIPS[c])) for (const f of list ?? []) out.add(f);
    for (const f of Object.values(CHAR_SFX[c])) if (f) out.add(f);
  }
  for (const f of Object.values(GENERIC_SFX)) if (f) out.add(f);
  if (WASTE_DEATH_SFX) out.add(WASTE_DEATH_SFX);
  return [...out];
}

describe('character audio manifest', () => {
  it('keeps the skill requirement on the original five and uses traits only for trait characters', () => {
    for (const c of ORIGINAL) expect(usesTraitsInsteadOfSkill(c), c).toBe(false);
    for (const c of Object.keys(TRAIT_EVENTS) as CharacterId[]) expect(usesTraitsInsteadOfSkill(c), c).toBe(true);
  });

  it('has a voice line for every character x event the game uses', () => {
    for (const c of CHARS) {
      for (const e of voiceEvents(c)) expect(VOICE_CLIPS[c][e]?.length ?? 0, `${c}.${e}`).toBeGreaterThan(0);
      // Captures are the most frequent highlight: at least two variants so it does not repeat.
      expect(VOICE_CLIPS[c].capture!.length, `${c}.capture variants`).toBeGreaterThanOrEqual(2);
    }
    expect(VOICE_CLIPS.insaner.chain?.length ?? 0).toBeGreaterThan(0);
    // chain is insaner's mechanic only.
    for (const c of CHARS) if (c !== 'insaner') expect(VOICE_CLIPS[c].chain, `${c}.chain`).toBeUndefined();
    // A character without a skill has no skill line, and trait events belong to their owner only.
    for (const c of CHARS) {
      if (usesTraitsInsteadOfSkill(c)) expect(VOICE_CLIPS[c].skill, `${c}.skill`).toBeUndefined();
      for (const [owner, evs] of Object.entries({ ...TRAIT_EVENTS, ...FORM_VOICE_EVENTS }))
        if (owner !== c) for (const e of evs ?? []) expect(VOICE_CLIPS[c][e], `${c}.${e}`).toBeUndefined();
    }
    // The transformed form captures often too: two variants.
    if (CHARS.includes('rakaeli')) expect(VOICE_CLIPS.rakaeli['awake-capture']?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('captions every voice clip', () => {
    for (const c of CHARS)
      for (const list of Object.values(VOICE_CLIPS[c])) for (const f of list ?? []) expect(VOICE_TEXT[f], f).toBeTruthy();
  });

  it('has character sound effects for select/move/capture/skill (or traits), a chain chime and a shared death', () => {
    for (const c of CHARS) for (const e of sfxEvents(c)) expect(CHAR_SFX[c][e], `${c}.${e}`).toBeTruthy();
    for (const c of CHARS) if (usesTraitsInsteadOfSkill(c)) expect(CHAR_SFX[c].skill, `${c}.skill sfx`).toBeUndefined();
    for (const c of CHARS)
      for (const [owner, evs] of Object.entries(FORM_SFX_EVENTS))
        if (owner !== c) for (const e of evs ?? []) expect(CHAR_SFX[c][e], `${c}.${e} sfx`).toBeUndefined();
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

  it('keeps the whole audio payload under the budget (1.5 MiB for 7 characters)', async () => {
    const { readdirSync, statSync } = await fsP;
    let total = 0;
    for (const sub of ['vo', 'sfx']) {
      const dir = join(audioDir, sub);
      for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
    }
    expect(total).toBeLessThan(AUDIO_BUDGET_BYTES);
  });

  it('is a safe no-op without Web Audio (node test environment)', async () => {
    expect(() => playVoice('sad', 'capture', { level: 3, owner: 1 })).not.toThrow();
    expect(() => playCharSfx('insaner', 'chain')).not.toThrow();
    expect(() => playVoice('brutile', 'skill', { level: 1 })).not.toThrow();
    expect(() => playWasteDeath()).not.toThrow();
    expect(() => stopVoice()).not.toThrow();
    await expect(preloadCharacterAudio(CHARS)).resolves.toBeUndefined();
  });

  it('every character of the roster is voiced (the five originals, michelle, picker and rakaeli)', () => {
    for (const c of ROSTER) expect(CHARS, c).toContain(c);
  });

  it("Rakaeli's transformed-form events never throw, and degrade to silence without recordings", async () => {
    for (const e of ['select', 'move', 'capture', 'skill', 'death', 'victory', 'awake-select', 'awake-move', 'awake-capture', 'awake-death', 'awake-end'] as const) {
      expect(() => playVoice('rakaeli', e, { level: 3, owner: 1 })).not.toThrow();
      expect(() => playCharSfx('rakaeli', e)).not.toThrow();
      // Node has no Web Audio: nothing is ever chosen to play.
      expect(playVoice('rakaeli', e)).toBeNull();
    }
    await expect(preloadCharacterAudio(['rakaeli'])).resolves.toBeUndefined();
  });

  it('new characters and their trait events never throw', async () => {
    for (const c of ['michelle', 'picker'] as CharacterId[]) {
      for (const e of ['select', 'move', 'capture', 'death', 'victory', 'trap-set', 'trap-sprung', 'hop-multi'] as const) {
        expect(() => playVoice(c, e, { level: 2, owner: 0 })).not.toThrow();
        expect(() => playCharSfx(c, e)).not.toThrow();
      }
    }
    await expect(preloadCharacterAudio(['michelle', 'picker'])).resolves.toBeUndefined();
  });
});
