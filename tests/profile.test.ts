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
  it('only records the outcome (there is no economy)', () => {
    let p = createDefaultProfile();
    p = applyMatchResult(p, 'win');
    p = applyMatchResult(p, 'loss');
    p = applyMatchResult(p, 'draw');
    p = applyMatchResult(p, 'win');
    expect(p.stats).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(Object.keys(p).sort()).toEqual(['difficulty', 'formation', 'formationSaved', 'grades', 'onboarding', 'settings', 'stats', 'version']);
  });
});

describe('star grades', () => {
  it('every character is available at every grade; the formation follows the chosen grade', () => {
    let p = createDefaultProfile();
    for (const id of CHARACTER_IDS) expect(p.grades[id]).toBe(DEFAULT_GRADE);
    p = setGrade(p, 'sad', 3);
    expect(p.grades.sad).toBe(3);
    expect(p.formation.find((s) => s.character === 'sad')?.level).toBe(3);
    p = setGrade(p, 'sad', 1);
    expect(p.formation.find((s) => s.character === 'sad')?.level).toBe(1);
    expect(setGrade(p, 'sad', 1)).toBe(p);
    // A legendary can be fielded right away, at any grade.
    p = setGrade(p, 'brutile', 2);
    expect(levelsOf(p).brutile).toBe(2);
  });

  it('a saved formation with any characters (incl. legendaries) survives sanitizing', () => {
    const p = createDefaultProfile();
    const raw = {
      ...p,
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
    // Slot levels always mirror the chosen grades.
    expect(s.formation.map((x) => x.level)).toEqual([3, 2, 1]);
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

  it('migrates a v2 save: reached levels become grades, the economy fields are dropped', () => {
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
    expect(p.grades).toMatchObject({ sad: 3, marki: 2, walk: 1, insaner: 1, brutile: 1 });
    expect(p.stats.wins).toBe(5);
    expect(p.difficulty).toBe('hard');
    expect(p.formationSaved).toBe(true);
    const stored = JSON.parse(saved!);
    for (const k of ['coins', 'gems', 'lastFreeBoxAt', 'dev', 'characters']) expect(stored).not.toHaveProperty(k);
    expect(stored.version).toBe(PROFILE_VERSION);
  });
});

describe('board view setting', () => {
  it('defaults to the tilted view, keeps top, and rejects junk', () => {
    expect(createDefaultProfile().settings.view).toBe('tilt');
    const base = createDefaultProfile();
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, view: 'top' } }).settings.view).toBe('top');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true, view: 'iso' } }).settings.view).toBe('tilt');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true } }).settings).toEqual({ sound: false, voice: true, haptics: true, view: 'tilt' });
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, voice: false } }).settings.voice).toBe(false);
  });
});
