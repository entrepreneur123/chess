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
