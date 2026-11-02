import { describe, expect, it } from 'vitest';
import { BOX, MATCH_REWARD } from '../src/meta/economy';
import {
  applyMatchResult,
  createDefaultProfile,
  freeBoxRemainingMs,
  levelUp,
  loadProfile,
  openBox,
  sanitizeProfile,
  type KeyValueStorage,
} from '../src/meta/profile';

const mem = (text: string | null): KeyValueStorage => ({ getItem: () => text, setItem: () => {} });

describe('match rewards', () => {
  it('pays normal rewards for a played-out game', () => {
    const p = createDefaultProfile();
    expect(applyMatchResult(p, 'win', 'hard', 12).reward).toBe(MATCH_REWARD.win.hard);
    expect(applyMatchResult(p, 'loss', 'easy', 12).reward).toBe(MATCH_REWARD.loss);
    expect(applyMatchResult(p, 'draw', 'easy', 30).reward).toBe(MATCH_REWARD.draw);
  });

  it('does not pay for an instant resign / AFK forfeit (reward farming)', () => {
    let p = createDefaultProfile();
    const start = p.coins;
    for (let i = 0; i < 10; i++) p = applyMatchResult(p, 'loss', 'normal', 0).profile;
    expect(p.coins).toBe(start);
    expect(p.stats.losses).toBe(10); // still recorded
  });
});

describe('profile sanitizing', () => {
  it('survives garbage', () => {
    for (const t of ['', 'null', '[]', '{', '{"coins":-5}', '{"coins":"9999"}', '{"characters":{"sad":{"level":7,"cards":-3}}}']) {
      const p = loadProfile(mem(t));
      expect(p.coins).toBeGreaterThanOrEqual(0);
      expect([1, 2, 3]).toContain(p.characters.sad.level);
      expect(p.characters.sad.cards).toBeGreaterThanOrEqual(0);
    }
  });

  it('a free-box timestamp from the future (clock moved back) locks out for at most one cooldown', () => {
    const now = Date.UTC(2026, 0, 1);
    const p = sanitizeProfile({ ...createDefaultProfile(), lastFreeBoxAt: now + 365 * 24 * 3600 * 1000 }, now);
    expect(freeBoxRemainingMs(p, now)).toBeLessThanOrEqual(BOX.freeCooldownMs);
    expect(freeBoxRemainingMs(p, now + BOX.freeCooldownMs)).toBe(0);
  });

  it('never levels past 3 or spends below zero', () => {
    let p = { ...createDefaultProfile(), gems: 100_000 };
    p = { ...p, characters: { ...p.characters, sad: { level: 1, cards: 1000 } } };
    for (let i = 0; i < 10; i++) p = levelUp(p, 'sad');
    expect(p.characters.sad.level).toBe(3);
    expect(p.formation.find((s) => s.character === 'sad')?.level).toBe(3);
    const poor = { ...createDefaultProfile(), coins: 0, gems: 0, characters: { ...p.characters, marki: { level: 1 as const, cards: 99 } } };
    expect(levelUp(poor, 'marki')).toBe(poor);
    expect(openBox(poor, 'basic').ok).toBe(false);
  });

  it('the free box cannot be claimed twice in a row', () => {
    const now = Date.UTC(2026, 0, 1);
    const a = openBox(createDefaultProfile(), 'free', Math.random, now);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(openBox(a.profile, 'free', Math.random, now + 1000).ok).toBe(false);
  });
});

describe('profile store', () => {
  it('persists a clamped future free-box timestamp so later launches are not locked again', () => {
    let saved: string | null = JSON.stringify({ ...createDefaultProfile(), lastFreeBoxAt: Date.now() + 365 * 24 * 3600 * 1000 });
    const storage: KeyValueStorage = { getItem: () => saved, setItem: (_k, v) => void (saved = v) };
    const first = loadProfile(storage);
    expect(first.lastFreeBoxAt).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(saved!).lastFreeBoxAt).toBe(first.lastFreeBoxAt);
  });
});

describe('developer account', () => {
  it('unlocks with the dev query, maxes every character, never spends, and can be turned off', async () => {
    const { applyDevQuery, canLevelUp, levelUp, openBox, applyMatchResult, createDefaultProfile } = await import('../src/meta/profile');
    const { DEV_CODE, DEV_CURRENCY } = await import('../src/meta/economy');
    const base = createDefaultProfile();
    expect(applyDevQuery(base, '?dev=wrong')).toBe(base);
    const dev = applyDevQuery(base, `?dev=${DEV_CODE}`);
    expect(dev.dev).toBe(true);
    expect(dev.coins).toBe(DEV_CURRENCY);
    expect(Object.values(dev.characters).every((c) => c.level === 3)).toBe(true);
    expect(dev.formation.every((s) => s.level === 3)).toBe(true);
    expect(canLevelUp(dev, 'sad')).toEqual({ ok: false, reason: 'max' });
    expect(levelUp(dev, 'sad')).toBe(dev);
    const box = openBox(dev, 'basic');
    expect(box.ok && box.profile.coins).toBe(DEV_CURRENCY);
    const free1 = openBox(dev, 'free');
    expect(free1.ok && openBox(free1.profile, 'free').ok).toBe(true);
    expect(applyMatchResult(dev, 'win', 'hard').profile.gems).toBe(DEV_CURRENCY);
    const off = applyDevQuery(dev, '?dev=off');
    expect(off.dev).toBe(false);
    expect(off.coins).toBe(base.coins);
    expect(off.characters.sad.level).toBe(1);
  });
});

describe('board view setting', () => {
  it('defaults to the tilted view, keeps top, and rejects junk', () => {
    expect(createDefaultProfile().settings.view).toBe('tilt');
    const base = createDefaultProfile();
    expect(sanitizeProfile({ ...base, settings: { ...base.settings, view: 'top' } }).settings.view).toBe('top');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true, view: 'iso' } }).settings.view).toBe('tilt');
    expect(sanitizeProfile({ ...base, settings: { sound: false, haptics: true } }).settings).toEqual({ sound: false, haptics: true, view: 'tilt' });
  });
});
