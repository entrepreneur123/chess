import { describe, expect, it } from 'vitest';
import { botLevels, botSquad, createOpponent } from '../src/meta/opponent';
import { createDefaultProfile, sanitizeProfile, squadOfProfile } from '../src/meta/profile';
import { createGame, defaultFormation, validateFormation } from '../src/engine';
import { rngFrom } from './helpers';

describe('squads', () => {
  it('the default squad is the three starters; legendaries can be fielded at once (no unlocking)', () => {
    const p = createDefaultProfile();
    expect(squadOfProfile(p)).toEqual(['sad', 'marki', 'walk']);
    const raw = { ...p, formation: defaultFormation(undefined, ['insaner', 'brutile', 'marki']), formationSaved: true };
    expect(validateFormation(raw.formation).ok).toBe(true);
    expect(squadOfProfile(sanitizeProfile(raw))).toEqual(['insaner', 'brutile', 'marki']);
  });
});

const LEGENDS = ['insaner', 'brutile'];
const ALL = ['sad', 'marki', 'walk', 'insaner', 'brutile'];

describe('bot opponent composition', () => {
  const N = 400;
  const run = (difficulty: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = rngFrom(seed);
    const opps = [];
    for (let i = 0; i < N; i++) opps.push(createOpponent(difficulty, { sad: 1, marki: 1, walk: 1, insaner: 1, brutile: 1 }, rng, ['sad', 'marki', 'walk']));
    return opps;
  };

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`${difficulty}: 3 distinct known characters on a valid formation, levels mirrored`, () => {
      for (const opp of run(difficulty, 11)) {
        expect(opp.formation).toHaveLength(3);
        expect(validateFormation(opp.formation).ok).toBe(true);
        const ids = opp.formation.map((s) => s.character);
        expect(new Set(ids).size).toBe(3);
        for (const id of ids) expect(ALL).toContain(id);
        for (const s of opp.formation) expect(s.level).toBe(opp.levels[s.character]);
        // createGame accepts it as player 1's formation.
        expect(() => createGame(defaultFormation(), opp.formation, 0)).not.toThrow();
      }
    });
  }

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

  it('hard: all 3-star, always at least one legendary, a second one only sometimes', () => {
    let two = 0;
    const seen = new Set<string>();
    for (const opp of run('hard', 41)) {
      const ids = opp.formation.map((s) => s.character);
      expect(opp.formation.every((s) => s.level === 3)).toBe(true);
      const legends = ids.filter((id) => LEGENDS.includes(id)).length;
      expect(legends).toBeGreaterThanOrEqual(1);
      if (legends === 2) two++;
      ids.forEach((id) => seen.add(id));
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
    // P(second legendary) = 1 - C(3,2)/C(4,2) = 1/2.
    expect(two).toBeGreaterThan(N * 0.35);
    expect(two).toBeLessThan(N * 0.65);
  });

  it('formations are varied', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const keys = new Set(run(difficulty, 51).map((o) => JSON.stringify(o.formation)));
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
