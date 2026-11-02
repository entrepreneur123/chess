import { describe, expect, it } from 'vitest';
import { BOX, BOT_LEGENDARY_CHANCE } from '../src/meta/economy';
import { botSquad, createOpponent } from '../src/meta/opponent';
import { createDefaultProfile, isOwned, openBox, sanitizeProfile, setDevMode, squadOfProfile } from '../src/meta/profile';
import { defaultFormation, validateFormation } from '../src/engine';
import { rngFrom } from './helpers';

describe('legendary ownership', () => {
  it('starters are owned, the legendary is locked until its first card', () => {
    const p = createDefaultProfile();
    expect(isOwned(p, 'sad')).toBe(true);
    expect(isOwned(p, 'insaner')).toBe(false);
    expect(squadOfProfile(p)).toEqual(['sad', 'marki', 'walk']);
    const q = { ...p, characters: { ...p.characters, insaner: { level: 1 as const, cards: 1 } } };
    expect(isOwned(q, 'insaner')).toBe(true);
    expect(isOwned(setDevMode(p, true), 'insaner')).toBe(true);
  });

  it('boxes can drop legendary cards (rare) and that unlocks the character', () => {
    expect(BOX.rarityWeights.legendary).toBeGreaterThan(0);
    const rng = rngFrom(4);
    let p = createDefaultProfile();
    p = { ...p, coins: 1_000_000 };
    let got = 0;
    for (let i = 0; i < 400 && got === 0; i++) {
      const r = openBox(p, 'basic', rng, 0);
      if (!r.ok) break;
      p = r.profile;
      if (r.drop.character === 'insaner') got++;
    }
    expect(got).toBeGreaterThan(0);
    expect(isOwned(p, 'insaner')).toBe(true);
  });

  it('a saved formation that fields an unowned character is reset to the default', () => {
    const p = createDefaultProfile();
    const raw = { ...p, formation: defaultFormation(undefined, ['insaner', 'sad', 'marki']) };
    expect(validateFormation(raw.formation).ok).toBe(true);
    const s = sanitizeProfile(raw);
    expect(squadOfProfile(s)).toEqual(['sad', 'marki', 'walk']);
    expect(s.formationSaved).toBe(false);
    // Once owned, the same formation survives.
    const owned = { ...raw, characters: { ...p.characters, insaner: { level: 1, cards: 2 } }, formationSaved: true };
    expect(squadOfProfile(sanitizeProfile(owned))).toEqual(['insaner', 'sad', 'marki']);
  });
});

describe('bot squad', () => {
  it('mirrors the player squad and never brings the legendary on easy', () => {
    const rng = rngFrom(1);
    for (let i = 0; i < 50; i++) expect(botSquad('easy', ['sad', 'marki', 'walk'], rng)).toEqual(['sad', 'marki', 'walk']);
    expect(botSquad('hard', ['insaner', 'sad', 'walk'], rng)).toEqual(['insaner', 'sad', 'walk']);
  });

  it('sometimes swaps one member for the legendary on hard', () => {
    const rng = rngFrom(2);
    let withLegend = 0;
    for (let i = 0; i < 200; i++) if (botSquad('hard', ['sad', 'marki', 'walk'], rng).includes('insaner')) withLegend++;
    expect(withLegend).toBeGreaterThan(200 * BOT_LEGENDARY_CHANCE.hard * 0.6);
    expect(withLegend).toBeLessThan(200 * BOT_LEGENDARY_CHANCE.hard * 1.4);
    const opp = createOpponent('hard', { sad: 1, marki: 1, walk: 1, insaner: 1 }, rngFrom(3), ['sad', 'marki', 'walk']);
    expect(validateFormation(opp.formation).ok).toBe(true);
    expect(opp.formation).toHaveLength(3);
  });
});
