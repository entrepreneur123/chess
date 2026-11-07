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
      'bestRating', 'devMode', 'dungeon', 'dungeonLevel', 'essence', 'formation', 'formationSaved', 'grades', 'onboarding', 'owned', 'rating', 'settings', 'stats', 'tokens', 'version',
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
        { character: 'insaner', level: 1, row: 1, col: 3 },
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
        { character: 'insaner', level: 1, row: 1, col: 3 },
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

  it('migrates a v2 save through v3 and v4 to v5: economy fields dropped, progression reset', () => {
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
    // The old formation used row 2 of the 3 x 12 zone: same squad, preset squares, unsaved.
    expect(p.formationSaved).toBe(false);
    expect(p.formation.map((s) => s.character)).toEqual(['sad', 'marki', 'walk']);
    expect(p.formation.map((s) => s.level)).toEqual([1, 1, 1]);
    expect(validateFormation(p.formation).ok).toBe(true);
    const stored = JSON.parse(saved!);
    for (const k of ['coins', 'gems', 'lastFreeBoxAt', 'dev', 'characters', 'difficulty']) expect(stored).not.toHaveProperty(k);
    expect(stored.version).toBe(PROFILE_VERSION);
  });
});

describe('migration v4 -> v5 (12 x 12 board with a 3 x 12 zone -> 10 x 10 with 2 x 10)', () => {
  /** A v4 save of a progressed player whose formation used the old zone. */
  const v4 = (formation: unknown[], formationSaved = true) => ({
    version: 4,
    owned: { sad: 3, marki: 2, walk: 1, insaner: 3, brutile: 1, michelle: 0, picker: 2 },
    grades: { sad: 3, marki: 2, walk: 1, insaner: 2, brutile: 1, michelle: 1, picker: 2 },
    formation,
    formationSaved,
    tokens: 321,
    essence: 77,
    rating: 1234,
    bestRating: 1500,
    dungeon: { lastClaimDay: '2026-11-01' },
    dungeonLevel: 'hard',
    stats: { wins: 40, losses: 12, draws: 3 },
    settings: { sound: false, music: false, voice: true, haptics: false, view: 'top' },
    onboarding: { tutorialSeen: true, firstMoveDone: true, trapTip: true, stunTip: false },
  });
  const load = (raw: unknown) => {
    let saved: string | null = JSON.stringify(raw);
    const storage: KeyValueStorage = { getItem: () => saved, setItem: (_k, v) => void (saved = v) };
    return { p: loadProfile(storage), stored: () => JSON.parse(saved!) };
  };

  it('is version 5', () => {
    expect(PROFILE_VERSION).toBe(5);
  });

  it('resets a formation outside the new zone (row > 1) to the presets of the same owned squad, keeping everything else', () => {
    const { p, stored } = load(
      v4([
        { character: 'insaner', level: 2, row: 2, col: 7 },
        { character: 'picker', level: 2, row: 1, col: 4 },
        { character: 'sad', level: 3, row: 0, col: 5 },
      ]),
    );
    expect(p.version).toBe(5);
    expect(p.formation.map((s) => s.character)).toEqual(['insaner', 'picker', 'sad']);
    expect(p.formation.map((s) => [s.row, s.col])).toEqual([[0, 5], [0, 6], [1, 6]]);
    expect(p.formation.map((s) => s.level)).toEqual([2, 2, 3]); // the fielded grades
    expect(validateFormation(p.formation).ok).toBe(true);
    expect(p.formationSaved).toBe(false);
    // Every other v4 field survives untouched.
    // (Rakaeli is newer than the save: locked, grade 1.)
    expect(p.owned).toEqual({ sad: 3, marki: 2, walk: 1, insaner: 3, brutile: 1, michelle: 0, picker: 2, rakaeli: 0, rampid: 0, larhen: 0, volkonov: 0, verish: 0, midos: 0, hammont: 0, venoa: 0, glacia: 0 });
    expect(p.grades).toEqual({ sad: 3, marki: 2, walk: 1, insaner: 2, brutile: 1, michelle: 1, picker: 2, rakaeli: 1, rampid: 1, larhen: 1, volkonov: 1, verish: 1, midos: 1, hammont: 1, venoa: 1, glacia: 1 });
    expect([p.tokens, p.essence, p.rating, p.bestRating]).toEqual([321, 77, 1234, 1500]);
    expect(p.dungeon.lastClaimDay).toBe('2026-11-01');
    expect(p.dungeonLevel).toBe('hard');
    expect(p.stats).toEqual({ wins: 40, losses: 12, draws: 3 });
    expect(p.settings).toEqual({ sound: false, music: false, voice: true, haptics: false, powerSave: false, selectFx: true, view: 'top' });
    expect(p.onboarding).toEqual({ tutorialSeen: true, firstMoveDone: true, trapTip: true, stunTip: false });
    // The migrated profile is written back at once.
    expect(stored().version).toBe(5);
    expect(stored().formation).toEqual(p.formation);
  });

  it('a column past the new right edge (col > 9) also resets the formation', () => {
    const { p } = load(
      v4([
        { character: 'sad', level: 3, row: 0, col: 11 },
        { character: 'marki', level: 2, row: 1, col: 2 },
        { character: 'walk', level: 1, row: 0, col: 3 },
      ]),
    );
    expect(p.formation).toEqual([
      { character: 'sad', level: 3, row: 1, col: 6 },
      { character: 'marki', level: 2, row: 1, col: 3 },
      { character: 'walk', level: 1, row: 0, col: 4 },
    ]);
    expect(p.formationSaved).toBe(false);
  });

  it('keeps a saved formation that already fits the 2 x 10 zone', () => {
    const f = [
      { character: 'sad', level: 3, row: 1, col: 9 },
      { character: 'marki', level: 2, row: 1, col: 0 },
      { character: 'insaner', level: 2, row: 0, col: 4 },
    ];
    const { p } = load(v4(f));
    expect(p.formation).toEqual(f);
    expect(p.formationSaved).toBe(true);
  });

  it('a reset squad with a character no longer owned falls back to the starters', () => {
    const { p } = load(
      v4([
        { character: 'michelle', level: 1, row: 2, col: 5 },
        { character: 'sad', level: 3, row: 1, col: 4 },
        { character: 'walk', level: 1, row: 0, col: 5 },
      ]),
    );
    expect(p.formation.map((s) => s.character)).toEqual(['sad', 'marki', 'walk']);
    expect(validateFormation(p.formation).ok).toBe(true);
    expect(p.formationSaved).toBe(false);
  });

  it('junk formations still end valid', () => {
    for (const f of [[], [null, 3, 'x'], [{ character: 'sad', row: 'a', col: 99 }]]) {
      const { p } = load(v4(f as unknown[]));
      expect(validateFormation(p.formation).ok).toBe(true);
    }
  });
});

describe('board view setting', () => {
  it('defaults to the tilted view, keeps top, and rejects junk', () => {
    expect(createDefaultProfile().settings.view).toBe('tilt');
    const base = createDefaultProfile();
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, view: 'top' } }).settings.view).toBe('top');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true, view: 'iso' } }).settings.view).toBe('tilt');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true } }).settings).toEqual({ sound: false, music: true, voice: true, haptics: true, powerSave: false, selectFx: true, view: 'tilt' });
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, music: false } }).settings.music).toBe(false);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, music: 'no' } }).settings.music).toBe(true);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, voice: false } }).settings.voice).toBe(false);
    // 선택 이펙트: on by default (older saves have no key), and an explicit off is kept.
    expect(sanitizeProfile({ ...base, settings: { sound: true } }).settings.selectFx).toBe(true);
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, selectFx: false } }).settings.selectFx).toBe(false);
  });
});
