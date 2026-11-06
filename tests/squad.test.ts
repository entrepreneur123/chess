import { describe, expect, it } from 'vitest';
import { aiGradeCenter, botLevels, botSquad, createOpponent, matchArenaId } from '../src/meta/opponent';
import { createDefaultProfile, sanitizeProfile, squadOfProfile } from '../src/meta/profile';
import { ARENA_AI, ARENA_DEFS, arenaById, arenaForRating, shopPool } from '../src/meta/progression';
import { createGame, defaultFormation, validateFormation, type Level } from '../src/engine';
import { rngFrom } from './helpers';

describe('squads', () => {
  it('the default squad is the three starters; a legendary needs to be owned first', () => {
    const p = createDefaultProfile();
    expect(squadOfProfile(p)).toEqual(['sad', 'marki', 'walk']);
    const raw = { ...p, formation: defaultFormation(undefined, ['insaner', 'brutile', 'marki']), formationSaved: true };
    expect(validateFormation(raw.formation).ok).toBe(true);
    expect(squadOfProfile(sanitizeProfile(raw))).toEqual(['sad', 'marki', 'walk']);
    const owning = { ...raw, owned: { ...p.owned, insaner: 1, brutile: 1 } };
    expect(squadOfProfile(sanitizeProfile(owning))).toEqual(['insaner', 'brutile', 'marki']);
  });
});

const LEGENDS = ['insaner', 'brutile'];
const ALL = ['sad', 'marki', 'walk', 'insaner', 'brutile', 'michelle', 'picker', 'rakaeli', 'rampid', 'larhen', 'volkonov', 'verish', 'midos', 'hammont', 'venoa', 'glacia'];

describe('dungeon opponents (fixed tiers)', () => {
  const N = 400;
  const run = (level: 'easy' | 'normal' | 'hard' | 'extreme', seed: number) => {
    const rng = rngFrom(seed);
    const opps = [];
    for (let i = 0; i < N; i++) opps.push(createOpponent({ mode: 'dungeon', level }, rng));
    return opps;
  };

  for (const level of ['easy', 'normal', 'hard', 'extreme'] as const) {
    it(`${level}: 3 distinct known characters on a valid formation, levels mirrored, labelled AI`, () => {
      for (const opp of run(level, 11)) {
        expect(opp.isAI).toBe(true);
        expect(opp.difficulty).toBe(level);
        expect(opp.formation).toHaveLength(3);
        expect(validateFormation(opp.formation).ok).toBe(true);
        const ids = opp.formation.map((s) => s.character);
        expect(new Set(ids).size).toBe(3);
        for (const id of ids) expect(ALL).toContain(id);
        for (const s of opp.formation) expect(s.level).toBe(opp.levels[s.character]);
        expect(arenaForRating(opp.rating).id).toBe(opp.arena);
        expect(() => createGame(defaultFormation(), opp.formation, 0)).not.toThrow();
      }
    });
  }

  it('above easy, the bot sets up inside the 2 x 10 zone on columns 2..7 (off the first storm columns)', () => {
    for (const level of ['normal', 'hard', 'extreme'] as const) {
      const rows = new Set<number>();
      for (const opp of run(level, 31)) {
        for (const s of opp.formation) {
          expect(s.row).toBeGreaterThanOrEqual(0);
          expect(s.row).toBeLessThanOrEqual(1);
          expect(s.col).toBeGreaterThanOrEqual(2);
          expect(s.col).toBeLessThanOrEqual(7);
          if (s.character === 'marki' || s.character === 'michelle') expect(s.row).toBe(1);
          if (s.character === 'brutile') expect(s.row).toBe(0);
          rows.add(s.row);
        }
      }
      expect([...rows].sort()).toEqual([0, 1]);
    }
  });

  it('easy: every member is 2-star, characters drawn from the whole roster (legendaries too)', () => {
    const seen = new Set<string>();
    for (const opp of run('easy', 21)) {
      for (const s of opp.formation) {
        expect(s.level).toBe(2);
        seen.add(s.character);
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it('normal: exactly one 3-star and two 2-stars, the 3-star member varies', () => {
    const starred = new Set<string>();
    for (const opp of run('normal', 31)) {
      const lv = opp.formation.map((s) => s.level).sort();
      expect(lv).toEqual([2, 2, 3]);
      starred.add(opp.formation.find((s) => s.level === 3)!.character);
    }
    expect([...starred].sort()).toEqual([...ALL].sort());
  });

  it('extreme: all 3-star, every legendary fielded, the third member varies', () => {
    const thirds = new Set<string>();
    for (const opp of run('extreme', 43)) {
      const ids = opp.formation.map((s) => s.character);
      expect(opp.formation.every((s) => s.level === 3)).toBe(true);
      for (const l of LEGENDS) expect(ids).toContain(l);
      ids.filter((id) => !LEGENDS.includes(id)).forEach((id) => thirds.add(id));
    }
    expect([...thirds].sort()).toEqual(ALL.filter((id) => !LEGENDS.includes(id)).sort());
  });

  for (const level of ['hard'] as const) {
    it(`${level}: all 3-star, always at least one legendary, a second one only sometimes`, () => {
      let two = 0;
      const seen = new Set<string>();
      for (const opp of run(level, 41)) {
        const ids = opp.formation.map((s) => s.character);
        expect(opp.formation.every((s) => s.level === 3)).toBe(true);
        const legends = ids.filter((id) => LEGENDS.includes(id)).length;
        expect(legends).toBeGreaterThanOrEqual(1);
        if (legends === 2) two++;
        ids.forEach((id) => seen.add(id));
      }
      expect([...seen].sort()).toEqual([...ALL].sort());
      // P(second legendary) = 1 - C(10,2)/C(11,2) = 2/11 (12 characters, 2 of them legendary).
      expect(two).toBeGreaterThan(N * 0.12);
      expect(two).toBeLessThan(N * 0.3);
    });
  }

  it('formations are varied', () => {
    for (const level of ['easy', 'normal', 'hard', 'extreme'] as const) {
      const keys = new Set(run(level, 51).map((o) => JSON.stringify(o.formation)));
      expect(keys.size).toBeGreaterThan(N * 0.9);
    }
  });

  it('botSquad / botLevels keep their call signatures', () => {
    const rng = rngFrom(61);
    const sq = botSquad('hard', ['sad', 'marki', 'walk'], rng);
    expect(sq).toHaveLength(3);
    expect(sq.some((id) => LEGENDS.includes(id))).toBe(true);
    const lv = botLevels('normal', { sad: 1 }, rng, sq);
    expect(sq.map((id) => lv[id]).sort()).toEqual([2, 2, 3]);
  });
});

describe('ranked / casual opponents (simulated rating band)', () => {
  const ratings = [0, 150, 300, 301, 450, 600, 601, 999, 1000, 1001, 1500, 1501, 2000, 2001, 2600];
  const gradeSets: Level[][] = [
    [1, 1, 1],
    [1, 2, 2],
    [2, 2, 2],
    [3, 3, 2],
    [3, 3, 3],
  ];

  it('ranked: the opponent stays in the player\'s arena within ±60, the squad comes from that arena\'s pool', () => {
    const rng = rngFrom(71);
    for (const r of ratings) {
      const mine = arenaForRating(r);
      for (let i = 0; i < 80; i++) {
        const opp = createOpponent({ mode: 'ranked', rating: r, playerGrades: [1, 1, 1] }, rng);
        expect(opp.isAI).toBe(true);
        expect(opp.arena).toBe(mine.id);
        expect(Math.abs(opp.rating - r)).toBeLessThanOrEqual(60);
        expect(opp.rating).toBeGreaterThanOrEqual(mine.min);
        if (mine.max !== null) expect(opp.rating).toBeLessThanOrEqual(mine.max);
        const pool = shopPool(mine);
        for (const s of opp.formation) expect(pool).toContain(s.character);
        expect(opp.difficulty).toBe(ARENA_AI[mine.id]);
        expect(validateFormation(opp.formation).ok).toBe(true);
      }
    }
  });

  it('casual: within ±150 (floored at 0), squad limited to the opponent arena\'s cumulative pool', () => {
    const rng = rngFrom(81);
    let crossed = 0;
    for (const r of ratings) {
      for (let i = 0; i < 80; i++) {
        const opp = createOpponent({ mode: 'casual', rating: r, playerGrades: [2, 2, 2] }, rng);
        expect(Math.abs(opp.rating - r)).toBeLessThanOrEqual(150);
        expect(opp.rating).toBeGreaterThanOrEqual(0);
        const a = arenaForRating(opp.rating);
        expect(opp.arena).toBe(a.id);
        if (a.id !== arenaForRating(r).id) crossed++;
        for (const s of opp.formation) expect(shopPool(a)).toContain(s.character);
        expect(opp.difficulty).toBe(ARENA_AI[a.id]);
      }
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it('arena 1 opponents only field the three starters; Brutile first appears from arena 2', () => {
    const rng = rngFrom(91);
    for (let i = 0; i < 200; i++) {
      const opp = createOpponent({ mode: 'ranked', rating: 120, playerGrades: [1, 1, 1] }, rng);
      expect(opp.formation.map((s) => s.character).sort()).toEqual(['marki', 'sad', 'walk']);
    }
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) createOpponent({ mode: 'ranked', rating: 450, playerGrades: [1, 1, 1] }, rng).formation.forEach((s) => seen.add(s.character));
    expect(seen.has('brutile')).toBe(true);
    expect(seen.has('insaner')).toBe(false);
  });

  it('grades track the player\'s fielded grades: within ±1 of the rounded average, clamped to 1–3', () => {
    const rng = rngFrom(101);
    for (const g of gradeSets) {
      const c = aiGradeCenter(g);
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const opp = createOpponent({ mode: 'ranked', rating: 700, playerGrades: g }, rng);
        for (const s of opp.formation) {
          expect(Math.abs(s.level - c)).toBeLessThanOrEqual(1);
          expect(s.level).toBeGreaterThanOrEqual(1);
          expect(s.level).toBeLessThanOrEqual(3);
          expect(s.level).toBe(opp.levels[s.character]);
          seen.add(s.level);
        }
      }
      expect(seen.size).toBeGreaterThan(1); // it does vary
    }
    expect(aiGradeCenter([1, 1, 2])).toBe(1);
    expect(aiGradeCenter([2, 2, 3])).toBe(2);
    expect(aiGradeCenter([3, 3, 3])).toBe(3);
  });

  it('AI strength follows the arena table (1 easy, 2–3 normal, 4–5 hard, 6 extreme)', () => {
    expect(ARENA_DEFS.map((a) => ARENA_AI[a.id])).toEqual(['easy', 'normal', 'normal', 'hard', 'hard', 'extreme']);
  });

  it('match theme: the opponent\'s arena for casual, the player\'s arena otherwise', () => {
    expect(matchArenaId('casual', 100, 'emberforge')).toBe('emberforge');
    expect(matchArenaId('ranked', 100, 'moonrune')).toBe('moonrune');
    expect(matchArenaId('dungeon', 650, 'apex')).toBe('blightmire');
    expect(arenaById('apex').index).toBe(6);
  });
});
