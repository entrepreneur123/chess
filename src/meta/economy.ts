/**
 * Every tunable number of the meta game lives here (coins, costs, rewards, drop rates, pacing).
 */
import type { Difficulty } from '../ai/bot';
import type { Level, Rarity } from '../engine/types';

export const APP_NAME = 'GRID CLASH';
export const APP_TAGLINE = '12×12 전술 아레나';

export const START_COINS = 300;
/** Premium (test) currency. No real billing: gem packs are granted for free while testing. */
export const START_GEMS = 200;

/** Cost to go from `level` to `level + 1` (cards from boxes + gems). Level 3 is max. */
export const LEVEL_UP_COST: Record<1 | 2, { cards: number; gems: number }> = {
  1: { cards: 2, gems: 120 },
  2: { cards: 4, gems: 360 },
};
export const MAX_LEVEL: Level = 3;

export const MATCH_REWARD: { win: Record<Difficulty, number>; draw: number; loss: number } = {
  win: { easy: 60, normal: 100, hard: 150 },
  draw: 40,
  loss: 25,
};
/** Gems earned per win (small trickle so free players can level up slowly). */
export const MATCH_GEM_REWARD: Record<Difficulty, number> = { easy: 10, normal: 20, hard: 35 };
/**
 * A loss or draw only pays out if the player made at least this many moves; otherwise instant
 * resigns / AFK timeout forfeits could be farmed for coins.
 */
export const MIN_MOVES_FOR_REWARD = 3;

export const BOX = {
  basicPrice: 150,
  freeCooldownMs: 24 * 60 * 60 * 1000,
  rarityWeights: { common: 60, rare: 30, epic: 10, legendary: 0 } as Record<Rarity, number>,
  amountMin: 1,
  amountMax: 3,
};

/**
 * Placeholder IAP catalog. There is NO billing: while testing, every pack is granted for free
 * (`testGrant`), clearly labelled as a test grant in the shop.
 */
export const GEM_PACKS = [
  { id: 'gems_small', gems: 80, priceLabel: '₩1,200', testGrant: true },
  { id: 'gems_medium', gems: 500, priceLabel: '₩6,500', testGrant: true },
  { id: 'gems_large', gems: 1200, priceLabel: '₩14,000', testGrant: true },
];

export const PACING = {
  searchMinMs: 1200,
  searchMaxMs: 2000,
  foundHoldMs: 1400,
  botThinkMinMs: 500,
  botThinkMaxMs: 900,
  timerWarnMs: 10_000,
};
