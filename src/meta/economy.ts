/**
 * Every tunable number of the meta game lives here (coins, costs, rewards, drop rates, pacing).
 */
import type { Difficulty } from '../ai/bot';
import type { Level, Rarity } from '../engine/types';

export const APP_NAME = 'Tactics 12';

export const START_COINS = 300;

/** Cost to go from `level` to `level + 1`. Level 3 is max. */
export const LEVEL_UP_COST: Record<1 | 2, { cards: number; coins: number }> = {
  1: { cards: 2, coins: 100 },
  2: { cards: 4, coins: 300 },
};
export const MAX_LEVEL: Level = 3;

export const MATCH_REWARD: { win: Record<Difficulty, number>; draw: number; loss: number } = {
  win: { easy: 60, normal: 100, hard: 150 },
  draw: 40,
  loss: 25,
};

export const BOX = {
  basicPrice: 150,
  freeCooldownMs: 24 * 60 * 60 * 1000,
  rarityWeights: { common: 60, rare: 30, epic: 10, legendary: 0 } as Record<Rarity, number>,
  amountMin: 1,
  amountMax: 3,
};

/** Placeholder IAP catalog (no billing in the MVP). */
export const GEM_PACKS = [
  { id: 'gems_small', gems: 80, priceLabel: '₩1,200' },
  { id: 'gems_medium', gems: 500, priceLabel: '₩6,500' },
  { id: 'gems_large', gems: 1200, priceLabel: '₩14,000' },
];

export const PACING = {
  searchMinMs: 1200,
  searchMaxMs: 2000,
  foundHoldMs: 1400,
  botThinkMinMs: 500,
  botThinkMaxMs: 900,
  timerWarnMs: 10_000,
};
