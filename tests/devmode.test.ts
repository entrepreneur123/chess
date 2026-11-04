/**
 * Developer mode (owner testing tool): one switch gives infinite currency, rating DEV_RATING and
 * every character at 3성; switching it off restores the real profile exactly. The real profile
 * waits in `dev.snapshot`, which must survive reloads, matches and corrupt saves.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, validateFormation } from '../src/engine';
import {
  DEV_CURRENCY,
  DEV_RATING,
  buyBlocker,
  buyCharacter,
  createDefaultProfile,
  disableDevMode,
  enableDevMode,
  getProfile,
  isDevMode,
  loadProfile,
  persistProfile,
  sanitizeProfile,
  setGrade,
  setProfile,
  settleMatch,
  unlockDevMode,
  updateProfile,
  upgradeBlocker,
  upgradeCharacter,
  type KeyValueStorage,
  type Profile,
} from '../src/meta/profile';
import { arenaForRating } from '../src/meta/progression';
import { createOpponent } from '../src/meta/opponent';
import { seededRng } from '../src/meta/rng';

/** A lived-in real profile: some progress, a saved formation, changed settings. */
function realProfile(): Profile {
  const p = createDefaultProfile();
  return {
    ...p,
    owned: { ...p.owned, sad: 2, brutile: 1 },
    grades: { ...p.grades, sad: 2 },
    formation: p.formation.map((s) => (s.character === 'sad' ? { ...s, level: 2 } : s)),
    formationSaved: true,
    tokens: 37,
    essence: 12,
    rating: 412,
    bestRating: 455,
    stats: { wins: 9, losses: 4, draws: 1 },
    settings: { ...p.settings, music: false },
    onboarding: { tutorialSeen: true, firstMoveDone: true, trapTip: true, stunTip: false },
  };
}

function memStorage(): KeyValueStorage & { text: string | null } {
  const s = {
    text: null as string | null,
    getItem: () => s.text,
    setItem: (_k: string, v: string) => {
      s.text = v;
    },
  };
  return s;
}

describe('developer mode', () => {
  it('starts locked and off; unlocking only reveals it', () => {
    const p = createDefaultProfile();
    expect(p.devMode).toEqual({ unlocked: false, snapshot: null });
    expect(isDevMode(p)).toBe(false);
    const u = unlockDevMode(p);
    expect(u.devMode).toEqual({ unlocked: true, snapshot: null });
    expect(isDevMode(u)).toBe(false);
    expect(unlockDevMode(u)).toBe(u);
  });

  it('enable sets infinite currency, rating 10000 and every character owned and fielded at 3성', () => {
    const real = realProfile();
    const d = enableDevMode(real);
    expect(isDevMode(d)).toBe(true);
    expect(d.tokens).toBe(DEV_CURRENCY);
    expect(d.essence).toBe(DEV_CURRENCY);
    expect(d.rating).toBe(DEV_RATING);
    expect(DEV_RATING).toBe(10000);
    for (const id of CHARACTER_IDS) {
      expect(d.owned[id]).toBe(3);
      expect(d.grades[id]).toBe(3);
    }
    expect(d.formation.every((s) => s.level === 3)).toBe(true);
    expect(validateFormation(d.formation).ok).toBe(true);
    // The snapshot is the real profile (without dev state), untouched.
    const { devMode: _dev, ...base } = real;
    expect(d.devMode.snapshot).toEqual(base);
    // Enabling again never overwrites the first snapshot.
    expect(enableDevMode(d)).toBe(d);
  });

  it('currency never decreases on buy or upgrade while it is on', () => {
    // A dev profile where a character is somehow below 3성 / not owned: spending is still free.
    const d = enableDevMode(realProfile());
    const partial: Profile = { ...d, owned: { ...d.owned, marki: 1, picker: 0 }, grades: { ...d.grades, marki: 1, picker: 1 } };
    expect(upgradeBlocker(partial, 'marki')).toBeNull();
    const up = upgradeCharacter(partial, 'marki');
    expect(up.ok).toBe(true);
    expect(up.profile.owned.marki).toBe(2);
    expect(up.profile.tokens).toBe(DEV_CURRENCY);
    expect(buyBlocker(partial, 'picker')).toBeNull();
    const buy = buyCharacter(partial, 'picker');
    expect(buy.ok).toBe(true);
    expect(buy.profile.essence).toBe(DEV_CURRENCY);
    // In the store, every write keeps both currencies pinned (match rewards included).
    setProfile(d);
    updateProfile((p) => ({ ...p, tokens: p.tokens - 500, essence: p.essence + 3 }));
    expect(getProfile().tokens).toBe(DEV_CURRENCY);
    expect(getProfile().essence).toBe(DEV_CURRENCY);
    // Off: spending works as usual again.
    const real = { ...realProfile(), tokens: 10 };
    expect(upgradeCharacter(real, 'marki').profile.tokens).toBe(0);
  });

  it('disable restores the exact previous profile', () => {
    const real = realProfile();
    let d = enableDevMode(unlockDevMode(real));
    // Play with it: pick grades, change the formation, win and lose ranked matches.
    d = setGrade(d, 'walk', 1);
    d = { ...d, formationSaved: false };
    const rng = seededRng(3);
    for (const result of ['win', 'loss', 'win', 'draw'] as const) d = settleMatch(d, { mode: 'ranked', result, rng, now: new Date(2026, 10, 4) }).profile;
    expect(d.rating).not.toBe(DEV_RATING); // the rating may move while it is on
    const back = disableDevMode(d);
    expect(isDevMode(back)).toBe(false);
    expect(back).toEqual({ ...real, devMode: { unlocked: true, snapshot: null } });
    expect(disableDevMode(back)).toBe(back);
  });

  it('match results while on do not corrupt the snapshot', () => {
    const real = realProfile();
    const d = enableDevMode(real);
    const snap = JSON.stringify(d.devMode.snapshot);
    const rng = seededRng(11);
    let p = d;
    for (let i = 0; i < 20; i++) p = settleMatch(p, { mode: i % 3 === 0 ? 'dungeon' : 'ranked', result: i % 2 ? 'win' : 'loss', rng, now: new Date(2026, 10, 4 + i) }).profile;
    expect(JSON.stringify(p.devMode.snapshot)).toBe(snap);
    // Mutating the live dev profile can never reach the snapshot (it is a deep copy).
    p.formation[0].row = 1;
    p.stats.wins = 999;
    expect(JSON.stringify(p.devMode.snapshot)).toBe(snap);
  });

  it('persists across reload (localStorage)', () => {
    const storage = memStorage();
    const real = realProfile();
    const d = enableDevMode(real);
    persistProfile(d, storage);
    const loaded = loadProfile(storage);
    expect(isDevMode(loaded)).toBe(true);
    expect(loaded).toEqual(d);
    // And switching off after the reload still restores the real profile.
    expect(disableDevMode(loaded)).toEqual({ ...real, devMode: { unlocked: true, snapshot: null } });
    // The unlocked-but-off state persists too.
    persistProfile(disableDevMode(loaded), storage);
    expect(loadProfile(storage).devMode).toEqual({ unlocked: true, snapshot: null });
  });

  it('the old v2 `dev` account flag never turns dev mode on', () => {
    const p = sanitizeProfile({ version: 2, dev: { snapshot: {}, unlocked: true }, coins: 5 });
    expect(p.devMode).toEqual({ unlocked: false, snapshot: null });
    expect('dev' in p).toBe(false);
  });

  it('profiles saved before dev mode existed read as locked and off', () => {
    const { devMode: _dev, ...old } = realProfile();
    const p = sanitizeProfile(JSON.parse(JSON.stringify(old)));
    expect(p.devMode).toEqual({ unlocked: false, snapshot: null });
    expect(p.tokens).toBe(37);
  });

  it('a corrupted snapshot falls back safely', () => {
    const d = enableDevMode(realProfile());
    const raw = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;

    // Not an object at all: dev mode stays on (the DEV chip keeps saying so) and switching it off
    // gives a fresh starter profile that keeps the player's settings, never the dev values.
    for (const bad of ['garbage', 42, true, [1, 2]]) {
      const p = sanitizeProfile({ ...raw, devMode: { unlocked: true, snapshot: bad } });
      expect(isDevMode(p)).toBe(true);
      expect(p.tokens).toBe(DEV_CURRENCY);
      const off = disableDevMode(p);
      expect(off.tokens).toBe(0);
      expect(off.essence).toBe(0);
      expect(off.rating).toBe(0);
      expect(off.owned).toEqual(createDefaultProfile().owned);
      expect(off.settings.music).toBe(false);
      expect(off.onboarding.tutorialSeen).toBe(true);
    }

    // An object with hostile fields is sanitized field by field like any saved profile.
    const p = sanitizeProfile({ ...raw, devMode: { unlocked: 'x', snapshot: { version: 5, tokens: -5, essence: 'lots', rating: 1e400, owned: { sad: 9, rakaeli: 3 }, formation: 'no', devMode: { snapshot: {} } } } });
    expect(isDevMode(p)).toBe(true);
    const off = disableDevMode(p);
    expect(off.tokens).toBe(0);
    expect(off.essence).toBe(0);
    expect(off.rating).toBe(0);
    expect(off.owned.rakaeli).toBe(3);
    expect(off.owned.sad).toBe(1);
    expect(validateFormation(off.formation).ok).toBe(true);
    expect(off.devMode).toEqual({ unlocked: true, snapshot: null });
    // A nested snapshot inside the snapshot is never carried.
    expect('devMode' in (p.devMode.snapshot as object)).toBe(false);

    // A dev profile edited by hand gets its fixed values back on load.
    const tampered = sanitizeProfile({ ...raw, tokens: 3, essence: 0, owned: { sad: 1 } });
    expect(tampered.tokens).toBe(DEV_CURRENCY);
    expect(tampered.essence).toBe(DEV_CURRENCY);
    expect(CHARACTER_IDS.every((id) => tampered.owned[id] === 3)).toBe(true);

    // Unreadable JSON never throws.
    expect(() => loadProfile({ getItem: () => '{"devMode":', setItem: () => {} })).not.toThrow();
  });
});

describe('matchmaking at the dev rating', () => {
  it('rating 10000 is the legend arena', () => {
    expect(arenaForRating(DEV_RATING).id).toBe('apex');
  });

  it('createOpponent works at rating 10000 in ranked and casual', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 200; i++) {
      const mode = i % 2 ? 'ranked' : 'casual';
      const opp = createOpponent({ mode, rating: DEV_RATING, playerGrades: [3, 3, 3] }, rng);
      expect(opp.arena).toBe('apex');
      expect(opp.difficulty).toBe('extreme');
      expect(Number.isInteger(opp.rating)).toBe(true);
      expect(Math.abs(opp.rating - DEV_RATING)).toBeLessThanOrEqual(mode === 'ranked' ? 60 : 150);
      expect(validateFormation(opp.formation).ok).toBe(true);
      expect(opp.formation).toHaveLength(3);
      for (const s of opp.formation) expect(s.level).toBeGreaterThanOrEqual(2);
    }
  });

  it('settling a ranked match at 10000 keeps the legend arena and its rating steps', () => {
    const d = enableDevMode(createDefaultProfile());
    const rng = seededRng(5);
    const win = settleMatch(d, { mode: 'ranked', result: 'win', rng, now: new Date() });
    expect(win.summary.arenaBefore).toBe('apex');
    expect(win.summary.ratingDelta).toBeGreaterThanOrEqual(14);
    expect(win.summary.ratingDelta).toBeLessThanOrEqual(16);
    const loss = settleMatch(d, { mode: 'ranked', result: 'loss', rng, now: new Date() });
    expect(loss.summary.arenaAfter).toBe('apex');
    expect(loss.summary.ratingDelta).toBeLessThanOrEqual(-20);
  });
});
