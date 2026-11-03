import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, validateFormation } from '../src/engine';
import {
  DEFAULT_GRADE,
  PROFILE_VERSION,
  applyMatchResult,
  createDefaultProfile,
  levelsOf,
  loadProfile,
  sanitizeProfile,
  setGrade,
  type KeyValueStorage,
} from '../src/meta/profile';

const mem = (text: string | null): KeyValueStorage => ({ getItem: () => text, setItem: () => {} });

describe('match results', () => {
  it('records the outcome in the stats', () => {
    let p = createDefaultProfile();
    p = applyMatchResult(p, 'win');
    p = applyMatchResult(p, 'loss');
    p = applyMatchResult(p, 'draw');
    p = applyMatchResult(p, 'win');
    expect(p.stats).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(Object.keys(p).sort()).toEqual([
      'bestRating', 'dungeon', 'dungeonLevel', 'essence', 'formation', 'formationSaved', 'grades', 'onboarding', 'owned', 'rating', 'settings', 'stats', 'tokens', 'version',
    ]);
  });
});

describe('star grades', () => {
  it('only owned stars can be fielded; the formation follows the chosen grade', () => {
    let p = createDefaultProfile();
    for (const id of CHARACTER_IDS) expect(p.grades[id]).toBe(DEFAULT_GRADE);
    expect(setGrade(p, 'sad', 3)).toBe(p); // 3성 not owned
    p = { ...p, owned: { ...p.owned, sad: 3 } };
    p = setGrade(p, 'sad', 3);
    expect(p.grades.sad).toBe(3);
    expect(p.formation.find((s) => s.character === 'sad')?.level).toBe(3);
    p = setGrade(p, 'sad', 1);
    expect(p.formation.find((s) => s.character === 'sad')?.level).toBe(1);
    expect(setGrade(p, 'sad', 1)).toBe(p);
    // A locked legendary cannot be fielded at any grade.
    expect(setGrade(p, 'brutile', 1)).toBe(p);
    expect(levelsOf(p).brutile).toBe(1);
  });

  it('a saved formation with owned legendaries survives sanitizing; grades are capped at the owned star', () => {
    const p = createDefaultProfile();
    const raw = {
      ...p,
      owned: { ...p.owned, insaner: 3, brutile: 1 },
      grades: { ...p.grades, insaner: 3, brutile: 2 },
      formation: [
        { character: 'insaner', level: 1, row: 2, col: 3 },
        { character: 'brutile', level: 1, row: 1, col: 6 },
        { character: 'walk', level: 1, row: 0, col: 9 },
      ],
      formationSaved: true,
    };
    const s = sanitizeProfile(raw);
    expect(validateFormation(s.formation).ok).toBe(true);
    expect(s.formationSaved).toBe(true);
    // Slot levels mirror the grades; brutile's 2성 is capped to the owned 1성.
    expect(s.formation.map((x) => x.level)).toEqual([3, 1, 1]);
  });

  it('a formation with an unowned character falls back to the default', () => {
    const p = createDefaultProfile();
    const s = sanitizeProfile({
      ...p,
      formation: [
        { character: 'insaner', level: 1, row: 2, col: 3 },
        { character: 'sad', level: 1, row: 1, col: 6 },
        { character: 'walk', level: 1, row: 0, col: 9 },
      ],
      formationSaved: true,
    });
    expect(s.formation.map((x) => x.character)).toEqual(['sad', 'marki', 'walk']);
    expect(s.formationSaved).toBe(false);
  });
});

describe('profile sanitizing and migration', () => {
  it('survives garbage', () => {
    for (const t of ['', 'null', '[]', '{', '{"grades":{"sad":7}}', '{"grades":"x"}', '{"stats":{"wins":-3}}']) {
      const p = loadProfile(mem(t));
      expect([1, 2, 3]).toContain(p.grades.sad);
      expect(p.stats.wins).toBeGreaterThanOrEqual(0);
      expect(validateFormation(p.formation).ok).toBe(true);
    }
  });

  it('migrates a v2 save through v3 to v4: economy fields dropped, progression reset', () => {
    const v2 = {
      version: 2,
      coins: 1234,
      gems: 99,
      lastFreeBoxAt: 1,
      dev: true,
      characters: { sad: { level: 3, cards: 4 }, marki: { level: 2, cards: 0 }, walk: { level: 1, cards: 9 }, insaner: { level: 1, cards: 0 } },
      formation: [
        { character: 'sad', level: 3, row: 2, col: 7 },
        { character: 'marki', level: 2, row: 2, col: 4 },
        { character: 'walk', level: 1, row: 1, col: 5 },
      ],
      formationSaved: true,
      stats: { wins: 5, losses: 2, draws: 1 },
      difficulty: 'hard',
    };
    let saved: string | null = JSON.stringify(v2);
    const storage: KeyValueStorage = { getItem: () => saved, setItem: (_k, v) => void (saved = v) };
    const p = loadProfile(storage);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.grades).toMatchObject({ sad: 1, marki: 1, walk: 1, insaner: 1, brutile: 1 });
    expect(p.stats.wins).toBe(5);
    expect(p.dungeonLevel).toBe('hard');
    expect(p.formationSaved).toBe(true);
    expect(p.formation.map((s) => s.level)).toEqual([1, 1, 1]);
    const stored = JSON.parse(saved!);
    for (const k of ['coins', 'gems', 'lastFreeBoxAt', 'dev', 'characters', 'difficulty']) expect(stored).not.toHaveProperty(k);
    expect(stored.version).toBe(PROFILE_VERSION);
  });
});

describe('board view setting', () => {
  it('defaults to the tilted view, keeps top, and rejects junk', () => {
    expect(createDefaultProfile().settings.view).toBe('tilt');
    const base = createDefaultProfile();
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, view: 'top' } }).settings.view).toBe('top');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true, view: 'iso' } }).settings.view).toBe('tilt');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true } }).settings).toEqual({ sound: false, music: true, voice: true, haptics: true, view: 'tilt' });
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, music: false } }).settings.music).toBe(false);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, music: 'no' } }).settings.music).toBe(true);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, voice: false } }).settings.voice).toBe(false);
  });
});
