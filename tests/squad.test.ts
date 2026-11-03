import { describe, expect, it } from 'vitest';
import { BOT_LEGENDARY_CHANCE } from '../src/meta/economy';
import { botSquad, createOpponent } from '../src/meta/opponent';
import { createDefaultProfile, sanitizeProfile, squadOfProfile } from '../src/meta/profile';
import { defaultFormation, validateFormation } from '../src/engine';
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

describe('bot squad', () => {
  it('mirrors the player squad and never brings the legendary on easy', () => {
    const rng = rngFrom(1);
    for (let i = 0; i < 50; i++) expect(botSquad('easy', ['sad', 'marki', 'walk'], rng)).toEqual(['sad', 'marki', 'walk']);
    expect(botSquad('hard', ['insaner', 'sad', 'walk'], rng)).toEqual(['insaner', 'sad', 'walk']);
  });

  it('sometimes swaps one member for a legendary on hard', () => {
    const rng = rngFrom(2);
    let withLegend = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const sq = botSquad('hard', ['sad', 'marki', 'walk'], rng);
      const legend = sq.find((id) => id === 'insaner' || id === 'brutile');
      if (legend) {
        withLegend++;
        seen.add(legend);
      }
    }
    expect([...seen].sort()).toEqual(['brutile', 'insaner']);
    expect(withLegend).toBeGreaterThan(200 * BOT_LEGENDARY_CHANCE.hard * 0.6);
    expect(withLegend).toBeLessThan(200 * BOT_LEGENDARY_CHANCE.hard * 1.4);
    const opp = createOpponent('hard', { sad: 1, marki: 1, walk: 1, insaner: 1, brutile: 1 }, rngFrom(3), ['sad', 'marki', 'walk']);
    expect(validateFormation(opp.formation).ok).toBe(true);
    expect(opp.formation).toHaveLength(3);
  });
});
