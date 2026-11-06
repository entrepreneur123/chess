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
const CHAR_SET: Record<CharacterId, true> = { sad: true, marki: true, walk: true, insaner: true, brutile: true, michelle: true, picker: true, rakaeli: true, rampid: true, larhen: true, volkonov: true, verish: true, midos: true, hammont: true, venoa: true, glacia: true };
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
  // Verish pierces through every enemy in her lane: one move can capture several, like Picker's hop.
  verish: ['hop-multi'],
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
/**
 * Who has a 'skill' audio event: the original five (their signature move, skill or not) and every
 * character with an active skill. A later character with neither a skill nor a trait (Rampid,
 * Larhen) has none.
 */
// Hammont has no active skill, but his knock-back hit is his signature: it plays 'skill' (like the
// originals' signature moves). Venoa's shots are captures ('capture').
const hasSkillAudio = (c: CharacterId): boolean => ORIGINAL.includes(c) || !!CHARACTERS[c].skill || c === 'hammont';
const BASE_VOICE_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture', 'death', 'victory'];
const BASE_SFX_EVENTS: CharAudioEvent[] = ['select', 'move', 'capture'];
const voiceEvents = (c: CharacterId): CharAudioEvent[] => [
  ...BASE_VOICE_EVENTS,
  ...(hasSkillAudio(c) ? (['skill'] as CharAudioEvent[]) : []),
  ...(TRAIT_EVENTS[c] ?? []),
  ...(FORM_VOICE_EVENTS[c] ?? []),
];
const sfxEvents = (c: CharacterId): CharAudioEvent[] => [
  ...BASE_SFX_EVENTS,
  ...(hasSkillAudio(c) ? (['skill'] as CharAudioEvent[]) : []),
  ...(TRAIT_EVENTS[c] ?? []),
  ...(FORM_SFX_EVENTS[c] ?? []),
];
/**
 * vo + sfx payload budget. Raised from 1.2 MiB to 1.5 MiB on 2026-11-04 (lead decision) when the roster
 * grew from 5 to 7 characters, so the budget per character stays about the same (0.24 -> 0.21 MiB). Measured
 * then: 1,424,699 bytes (vo 1,153,610 + sfx 271,089).
 * Raised again to 1.75 MiB on 2026-11-04 for Rakaeli, the 8th character, who has two forms: 18 voice lines
 * (twice a normal set; encoded at 48 kbps instead of 64 to keep them compact) and 7 effects, together
 * 292,879 bytes (vo 236,571 + sfx 56,308), about 1.4x a one-form character. Measured: 1,717,578 bytes
 * (vo 1,390,181 + sfx 327,397), 0.21 MiB per character; headroom 117,430 bytes.
 * Raised to 2.25 MiB on 2026-11-05 for the three later commons (Rampid, Larhen, Volkonov): 29 voice
 * lines (386,729 bytes) and 10 effects (76,026 bytes), about 0.15 MiB per character, below the
 * average. Measured: 2,180,333 bytes for 11 characters; headroom 178,963 bytes.
 * Raised to 2.5 MiB on 2026-11-05 for Verish, the 12th character (a rare): 10 voice lines (166,279
 * bytes) and 4 effects (27,132 bytes), 193,411 bytes (0.18 MiB). Measured: 2,373,744 bytes (vo
 * 1,943,189 + sfx 430,555), 14,448 bytes over 2.25 MiB; 0.19 MiB per character; headroom 247,696 bytes.
 * Midos, the 13th character (an epic), fits without a raise (2026-11-06): 11 voice lines (193,599
 * bytes) and 4 effects (36,406 bytes). Measured: 2,603,749 bytes on disk for vo + sfx; headroom
 * 17,691 bytes, so the next character needs a new lead decision on this budget.
 * Raised to 3.25 MiB on 2026-11-06 for the trio (Hammont, Venoa, Glacia): 31 voice lines (447,598
 * bytes) and 11 effects (89,604 bytes), 537,202 bytes, about 0.17 MiB per character, below the
 * average. Measured: 3,140,951 bytes for 16 characters (0.19 MiB each); headroom 266,921 bytes.
 */
const AUDIO_BUDGET_BYTES = 3.25 * 1024 * 1024;

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
      if (!hasSkillAudio(c)) expect(VOICE_CLIPS[c].skill, `${c}.skill`).toBeUndefined();
      // An event two characters share (hop-multi: picker and verish) is allowed for both.
      const own = new Set([...(TRAIT_EVENTS[c] ?? []), ...(FORM_VOICE_EVENTS[c] ?? [])]);
      for (const [owner, evs] of Object.entries({ ...TRAIT_EVENTS, ...FORM_VOICE_EVENTS }))
        if (owner !== c) for (const e of evs ?? []) if (!own.has(e)) expect(VOICE_CLIPS[c][e], `${c}.${e}`).toBeUndefined();
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
    for (const c of CHARS) if (!hasSkillAudio(c)) expect(CHAR_SFX[c].skill, `${c}.skill sfx`).toBeUndefined();
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

  it('keeps the whole audio payload under the budget (2.5 MiB for 12 characters)', async () => {
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
    for (const c of ['michelle', 'picker', 'verish'] as CharacterId[]) {
      for (const e of ['select', 'move', 'capture', 'death', 'victory', 'trap-set', 'trap-sprung', 'hop-multi'] as const) {
        expect(() => playVoice(c, e, { level: 2, owner: 0 })).not.toThrow();
        expect(() => playCharSfx(c, e)).not.toThrow();
      }
    }
    await expect(preloadCharacterAudio(['michelle', 'picker', 'verish'])).resolves.toBeUndefined();
  });
});
