import { describe, expect, it } from 'vitest';
import { chooseAction, isSkillAction } from '../src/ai/bot';
import { CHARACTERS, applyMove, applySkill, createGame, getLegalMoves, isLegalMove, isLegalSkill, randomFormation, type CharacterId } from '../src/engine';
import {
  PROFILE_VERSION,
  buyCharacter,
  buyableIds,
  createDefaultProfile,
  loadProfile,
  sanitizeProfile,
  settleMatch,
  upgradeCharacter,
  type KeyValueStorage,
  type Profile,
} from '../src/meta/profile';
import {
  ARENA_DEFS,
  DUNGEON_LEVELS,
  DUNGEON_REWARD,
  UNLOCK_PRICE,
  UNREACHABLE,
  UPGRADE_COST,
  arenaForRating,
  arenaProgress,
  dayKey,
  opponentRating,
  shopPool,
  unlockArenaOf,
  upgradeCost,
} from '../src/meta/progression';
import { seededRng } from '../src/meta/rng';
import { rngFrom } from './helpers';

const mem = (text: string | null): KeyValueStorage => ({ getItem: () => text, setItem: () => {} });
const DAY1 = new Date(2026, 10, 3, 10, 0, 0);
const DAY1_LATE = new Date(2026, 10, 3, 23, 59, 0);
const DAY2 = new Date(2026, 10, 4, 0, 1, 0);

const withP = (patch: Partial<Profile>): Profile => ({ ...createDefaultProfile(), ...patch });

describe('migration v3 -> v4', () => {
  const v3 = {
    version: 3,
    grades: { sad: 3, marki: 2, walk: 1, insaner: 3, brutile: 2 },
    formation: [
      { character: 'sad', level: 3, row: 2, col: 7 },
      { character: 'marki', level: 2, row: 2, col: 4 },
      { character: 'walk', level: 1, row: 1, col: 5 },
    ],
    formationSaved: true,
    stats: { wins: 9, losses: 4, draws: 1 },
    difficulty: 'extreme-not-valid',
    settings: { sound: false, voice: true, haptics: false, view: 'top' },
    onboarding: { tutorialSeen: true, firstMoveDone: true },
  };

  it('resets progression: 3 starters at 1성, all grades 1, 0 tokens / essence / rating', () => {
    let saved: string | null = JSON.stringify(v3);
    const storage: KeyValueStorage = { getItem: () => saved, setItem: (_k, v) => void (saved = v) };
    const p = loadProfile(storage);
    expect(p.version).toBe(4);
    expect(p.owned).toEqual({ sad: 1, marki: 1, walk: 1, insaner: 0, brutile: 0, michelle: 0, picker: 0 });
    expect(Object.values(p.grades)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect([p.tokens, p.essence, p.rating, p.bestRating]).toEqual([0, 0, 0, 0]);
    expect(p.dungeon.lastClaimDay).toBeNull();
    expect(p.dungeonLevel).toBe('easy');
    // Kept: stats, settings (music defaults on), onboarding, the all-owned formation's squares.
    expect(p.stats).toEqual({ wins: 9, losses: 4, draws: 1 });
    expect(p.settings).toEqual({ sound: false, music: true, voice: true, haptics: false, view: 'top' });
    expect(p.onboarding.tutorialSeen).toBe(true);
    expect(p.formationSaved).toBe(true);
    expect(p.formation).toEqual([
      { character: 'sad', level: 1, row: 2, col: 7 },
      { character: 'marki', level: 1, row: 2, col: 4 },
      { character: 'walk', level: 1, row: 1, col: 5 },
    ]);
    const stored = JSON.parse(saved!);
    expect(stored.version).toBe(PROFILE_VERSION);
    expect(stored).not.toHaveProperty('difficulty');
  });

  it('a formation with a piece that is no longer owned falls back to the default', () => {
    const p = sanitizeProfile({
      ...v3,
      formation: [
        { character: 'insaner', level: 3, row: 2, col: 7 },
        { character: 'marki', level: 2, row: 2, col: 4 },
        { character: 'walk', level: 1, row: 1, col: 5 },
      ],
    });
    expect(p.formation.map((s) => s.character)).toEqual(['sad', 'marki', 'walk']);
    expect(p.formationSaved).toBe(false);
  });

  it('maps the old bot difficulty to the preselected dungeon difficulty', () => {
    expect(sanitizeProfile({ ...v3, difficulty: 'hard' }).dungeonLevel).toBe('hard');
  });
});

describe('v4 sanitizing', () => {
  it('rejects negative / fractional / junk numbers and keeps the starters owned', () => {
    const p = sanitizeProfile({
      version: 4,
      owned: { sad: 0, marki: 7, walk: 2, insaner: 3, brutile: '1' },
      grades: { sad: 3, marki: 2, walk: 3, insaner: 2, brutile: 3 },
      tokens: -5,
      essence: 12.9,
      rating: -40,
      bestRating: 'x',
      dungeon: { lastClaimDay: 'yesterday' },
      dungeonLevel: 'nightmare',
    });
    expect(p.owned).toEqual({ sad: 1, marki: 1, walk: 2, insaner: 3, brutile: 0, michelle: 0, picker: 0 });
    expect(p.grades).toEqual({ sad: 1, marki: 1, walk: 2, insaner: 2, brutile: 1, michelle: 1, picker: 1 });
    expect([p.tokens, p.essence, p.rating, p.bestRating]).toEqual([0, 12, 0, 0]);
    expect(p.dungeon.lastClaimDay).toBeNull();
    expect(p.dungeonLevel).toBe('easy');
  });

  it('bestRating is never below the rating; a valid day key survives', () => {
    const p = sanitizeProfile({ version: 4, rating: 812, bestRating: 300, dungeon: { lastClaimDay: '2026-11-03' } });
    expect(p.bestRating).toBe(812);
    expect(p.dungeon.lastClaimDay).toBe('2026-11-03');
  });
});

describe('essence shop', () => {
  it('pool per arena is cumulative: starters, + Brutile (2), + Insaner (3), + Michelle (4), + Picker (5), then nothing new', () => {
    const starters = ['sad', 'marki', 'walk'];
    expect(ARENA_DEFS.map((a) => shopPool(a))).toEqual([
      starters,
      [...starters, 'brutile'],
      [...starters, 'brutile', 'insaner'],
      [...starters, 'brutile', 'insaner', 'michelle'],
      [...starters, 'brutile', 'insaner', 'michelle', 'picker'],
      [...starters, 'brutile', 'insaner', 'michelle', 'picker'],
    ]);
  });

  it('Michelle opens in arena 4 for 30 essence and Picker in arena 5 for 50; upgrades follow rarity', () => {
    expect(unlockArenaOf('michelle')?.id).toBe('frostkeep');
    expect(unlockArenaOf('picker')?.id).toBe('madcrown');
    expect(UNLOCK_PRICE[CHARACTERS.michelle.rarity]).toBe(30);
    expect(UNLOCK_PRICE[CHARACTERS.picker.rarity]).toBe(50);
    expect([upgradeCost('michelle', 1), upgradeCost('michelle', 2)]).toEqual([5, 50]);
    expect([upgradeCost('picker', 1), upgradeCost('picker', 2)]).toEqual([10, 100]);
    expect(UNREACHABLE).toEqual([]);
    // Only arena 6 still waits for a character.
    expect(ARENA_DEFS.filter((a) => a.unlocks.length === 0).map((a) => a.index)).toEqual([6]);
  });

  it('buying: locked below the arena, short of essence, then bought at 1성; never negative', () => {
    const price = UNLOCK_PRICE.legendary;
    let r = buyCharacter(withP({ rating: 300, essence: 999 }), 'brutile');
    expect(r).toMatchObject({ ok: false, reason: 'arena' });
    r = buyCharacter(withP({ rating: 301, essence: price - 1 }), 'brutile');
    expect(r).toMatchObject({ ok: false, reason: 'essence' });
    expect(r.profile.essence).toBe(price - 1);
    r = buyCharacter(withP({ rating: 301, essence: price }), 'brutile');
    expect(r.ok).toBe(true);
    expect(r.profile.essence).toBe(0);
    expect(r.profile.owned.brutile).toBe(1);
    expect(r.profile.grades.brutile).toBe(1);
    expect(buyCharacter(r.profile, 'brutile')).toMatchObject({ ok: false, reason: 'owned' });
    expect(buyCharacter(withP({ rating: 5000, essence: 10_000 }), 'sad')).toMatchObject({ ok: false, reason: 'owned' });
  });

  it('after a demotion, owned characters stay owned and higher-arena ones are locked again', () => {
    const owned = { ...createDefaultProfile().owned, brutile: 1 as const };
    const p = withP({ rating: 590, owned, essence: 500 });
    expect(buyableIds(p)).toEqual([]);
    expect(buyCharacter(p, 'insaner')).toMatchObject({ ok: false, reason: 'arena' });
    expect(buyableIds(withP({ rating: 601 }))).toEqual(['brutile', 'insaner']);
  });
});

describe('star upgrades', () => {
  it('costs per rarity, insufficient tokens, max level; never negative; the new star is fielded', () => {
    let p = withP({ tokens: UPGRADE_COST.common[1] - 1 });
    let r = upgradeCharacter(p, 'sad');
    expect(r).toMatchObject({ ok: false, reason: 'tokens' });
    expect(r.profile).toBe(p);
    p = withP({ tokens: UPGRADE_COST.common[1] + UPGRADE_COST.common[2] });
    r = upgradeCharacter(p, 'sad');
    expect(r.ok).toBe(true);
    expect(r.profile.owned.sad).toBe(2);
    expect(r.profile.grades.sad).toBe(2);
    expect(r.profile.formation.find((s) => s.character === 'sad')?.level).toBe(2);
    expect(r.profile.tokens).toBe(UPGRADE_COST.common[2]);
    r = upgradeCharacter(r.profile, 'sad');
    expect(r.ok).toBe(true);
    expect(r.profile.owned.sad).toBe(3);
    expect(r.profile.tokens).toBe(0);
    const max = upgradeCharacter({ ...r.profile, tokens: 9999 }, 'sad');
    expect(max).toMatchObject({ ok: false, reason: 'max' });
    expect(upgradeCharacter(withP({ tokens: 9999 }), 'brutile')).toMatchObject({ ok: false, reason: 'locked' });
    // Rarity table: rare 10/100, epic 20/150, legendary 50/300.
    expect(upgradeCharacter(withP({ tokens: 10 }), 'marki').profile.tokens).toBe(0);
    expect(upgradeCharacter(withP({ tokens: 19 }), 'walk').reason).toBe('tokens');
  });
});

describe('settleMatch', () => {
  it('ranked win / loss move the rating inside the starting arena\'s range', () => {
    for (const a of ARENA_DEFS) {
      const rng = seededRng(a.index * 7);
      const start = a.max === null ? a.min + 100 : Math.floor((a.min + a.max) / 2);
      for (let i = 0; i < 60; i++) {
        const w = settleMatch(withP({ rating: start }), { mode: 'ranked', result: 'win', rng, now: DAY1 }).summary;
        expect(w.ratingDelta).toBeGreaterThanOrEqual(a.win[0]);
        expect(w.ratingDelta).toBeLessThanOrEqual(a.win[1]);
        const l = settleMatch(withP({ rating: start }), { mode: 'ranked', result: 'loss', rng, now: DAY1 }).summary;
        expect(-l.ratingDelta).toBeGreaterThanOrEqual(a.loss[0]);
        expect(-l.ratingDelta).toBeLessThanOrEqual(a.loss[1]);
        expect(w.arenaBefore).toBe(a.id);
      }
    }
  });

  it('ranked essence 3 / 1 / 0, draw keeps the rating, stats count', () => {
    const rng = rngFrom(3);
    const base = withP({ rating: 100, essence: 4 });
    const w = settleMatch(base, { mode: 'ranked', result: 'win', rng, now: DAY1 });
    const d = settleMatch(base, { mode: 'ranked', result: 'draw', rng, now: DAY1 });
    const l = settleMatch(base, { mode: 'ranked', result: 'loss', rng, now: DAY1 });
    expect([w.summary.essenceGained, d.summary.essenceGained, l.summary.essenceGained]).toEqual([3, 1, 0]);
    expect([w.profile.essence, d.profile.essence, l.profile.essence]).toEqual([7, 5, 4]);
    expect(d.summary.ratingDelta).toBe(0);
    expect(d.profile.rating).toBe(100);
    expect(w.profile.stats.wins).toBe(1);
    expect(l.profile.stats.losses).toBe(1);
    expect(d.profile.stats.draws).toBe(1);
    expect(w.summary.tokensGained).toBe(0);
  });

  it('the rating never goes below 0', () => {
    const rng = rngFrom(4);
    for (const r of [0, 1, 3, 5, 6]) {
      const s = settleMatch(withP({ rating: r }), { mode: 'ranked', result: 'loss', rng, now: DAY1 });
      expect(s.profile.rating).toBeGreaterThanOrEqual(0);
      expect(s.profile.rating).toBe(Math.max(0, r - -s.summary.ratingDelta));
    }
    expect(settleMatch(withP({ rating: 0 }), { mode: 'ranked', result: 'loss', rng, now: DAY1 }).profile.rating).toBe(0);
  });

  it('demotion across 601 -> 600 drops to arena 2; promotion 300 -> 301+ opens Brutile in the shop', () => {
    const rng = rngFrom(5);
    const down = settleMatch(withP({ rating: 601 }), { mode: 'ranked', result: 'loss', rng, now: DAY1 }).summary;
    expect(down.arenaBefore).toBe('blightmire');
    expect(down.arenaAfter).toBe('emberforge');
    expect(down.demoted).toBe(true);
    expect(down.promoted).toBe(false);
    expect(down.ratingAfter).toBeLessThanOrEqual(600);
    // 601 loses 15-17 (arena 3's range): 584..586.
    expect(down.ratingAfter).toBeGreaterThanOrEqual(584);
    expect(down.ratingAfter).toBeLessThanOrEqual(586);
    expect(down.newShopCharacters).toEqual([]);

    const up = settleMatch(withP({ rating: 290 }), { mode: 'ranked', result: 'win', rng, now: DAY1 });
    expect(up.summary.promoted).toBe(true);
    expect(up.summary.arenaAfter).toBe('emberforge');
    expect(up.summary.newShopCharacters).toEqual(['brutile']);
    expect(up.profile.bestRating).toBe(up.profile.rating);
    // Already owned: no call-out.
    const owned = { ...createDefaultProfile().owned, brutile: 1 as const };
    expect(settleMatch(withP({ rating: 290, owned }), { mode: 'ranked', result: 'win', rng, now: DAY1 }).summary.newShopCharacters).toEqual([]);
  });

  it('casual: essence and stats, no rating change', () => {
    const rng = rngFrom(6);
    for (const result of ['win', 'draw', 'loss'] as const) {
      const r = settleMatch(withP({ rating: 450, essence: 0 }), { mode: 'casual', result, rng, now: DAY1 });
      expect(r.profile.rating).toBe(450);
      expect(r.summary.ratingDelta).toBe(0);
      expect(r.summary.promoted || r.summary.demoted).toBe(false);
      expect(r.profile.essence).toBe({ win: 3, draw: 1, loss: 0 }[result]);
      expect(r.profile.stats.wins + r.profile.stats.losses + r.profile.stats.draws).toBe(1);
    }
  });

  it('dungeon: only a win claims, once per local day key; a loss or draw changes nothing', () => {
    const rng = rngFrom(7);
    for (const level of DUNGEON_LEVELS) {
      const base = withP({ rating: 500, essence: 9, tokens: 1 });
      for (const result of ['loss', 'draw'] as const) {
        const r = settleMatch(base, { mode: 'dungeon', result, dungeonLevel: level, rng, now: DAY1 });
        expect(r.profile.tokens).toBe(1);
        expect(r.profile.dungeon.lastClaimDay).toBeNull();
        expect(r.profile.rating).toBe(500);
        expect(r.profile.essence).toBe(9);
        expect(r.profile.stats).toEqual(base.stats);
        expect(r.summary.dungeonAlreadyClaimed).toBe(false);
        expect(r.summary.tokensGained).toBe(0);
      }
      const first = settleMatch(base, { mode: 'dungeon', result: 'win', dungeonLevel: level, rng, now: DAY1 });
      expect(first.summary.tokensGained).toBe(DUNGEON_REWARD[level]);
      expect(first.profile.tokens).toBe(1 + DUNGEON_REWARD[level]);
      expect(first.profile.dungeon.lastClaimDay).toBe(dayKey(DAY1));
      expect(first.profile.dungeonLevel).toBe(level);
      expect(first.profile.rating).toBe(500);
      expect(first.profile.essence).toBe(9);
      expect(first.profile.stats).toEqual(base.stats);
      const again = settleMatch(first.profile, { mode: 'dungeon', result: 'win', dungeonLevel: 'extreme', rng, now: DAY1_LATE });
      expect(again.summary.tokensGained).toBe(0);
      expect(again.summary.dungeonAlreadyClaimed).toBe(true);
      expect(again.profile.tokens).toBe(first.profile.tokens);
      const next = settleMatch(first.profile, { mode: 'dungeon', result: 'win', dungeonLevel: level, rng, now: DAY2 });
      expect(next.summary.tokensGained).toBe(DUNGEON_REWARD[level]);
      expect(next.profile.dungeon.lastClaimDay).toBe(dayKey(DAY2));
    }
  });
});

describe('matchmaking helpers', () => {
  it('opponentRating stays in the band; arenaProgress measures toward the next arena', () => {
    const rng = rngFrom(8);
    for (let i = 0; i < 300; i++) {
      const r = opponentRating('ranked', 320, rng);
      expect(r).toBeGreaterThanOrEqual(301);
      expect(r).toBeLessThanOrEqual(380);
    }
    expect(arenaProgress(0)).toMatchObject({ toNext: 301, progress: 0 });
    expect(arenaProgress(2000).toNext).toBe(1);
    expect(arenaProgress(2500)).toMatchObject({ next: null, progress: 1 });
    expect(arenaForRating(2000).id).toBe('madcrown');
    expect(arenaForRating(2001).id).toBe('apex');
  });
});

describe('extreme bot', () => {
  it('produces legal actions (moves and the wasteland) until the game ends', () => {
    const rng = rngFrom(9);
    const squads: CharacterId[][] = [
      ['brutile', 'insaner', 'walk'],
      ['brutile', 'sad', 'marki'],
    ];
    for (let gi = 0; gi < 3; gi++) {
      let g = createGame(
        randomFormation(rng, { sad: 3, marki: 3, walk: 3, insaner: 3, brutile: 3 }, squads[gi % 2]),
        randomFormation(rng, { sad: 3, marki: 3, walk: 3, insaner: 3, brutile: 3 }, squads[(gi + 1) % 2]),
        (gi % 2) as 0 | 1,
      );
      let guard = 0;
      while (g.status === 'playing' && guard++ < 260) {
        const a = chooseAction(g, g.turn === 0 ? 'extreme' : 'hard', { rng, timeBudgetMs: 6 });
        expect(a).not.toBeNull();
        if (isSkillAction(a)) {
          expect(isLegalSkill(g, a)).toBe(true);
          g = applySkill(g, a);
        } else {
          expect(getLegalMoves(g).length).toBeGreaterThan(0);
          expect(isLegalMove(g, a!)).toBe(true);
          g = applyMove(g, a!);
        }
      }
    }
  }, 60_000);
});

describe('profile store', () => {
  it('a v4 profile round-trips', () => {
    const p = withP({ tokens: 7, essence: 33, rating: 640, bestRating: 700, dungeon: { lastClaimDay: '2026-11-03' }, dungeonLevel: 'hard' });
    expect(loadProfile(mem(JSON.stringify(p)))).toEqual(p);
  });
});
