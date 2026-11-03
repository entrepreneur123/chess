/**
 * Tunable meta numbers (match pacing, bot squad). There is no economy: no coins, boxes or costs.
 */
import type { Difficulty } from '../ai/bot';

export const APP_NAME = 'GRID CLASH';
export const APP_TAGLINE = '12×12 전술 아레나';

/** Chance that the bot swaps one of its mirrored squad members for the legendary (when the player has none). */
export const BOT_LEGENDARY_CHANCE: Record<Difficulty, number> = { easy: 0, normal: 0.2, hard: 0.45 };

export const PACING = {
  searchMinMs: 1200,
  searchMaxMs: 2000,
  foundHoldMs: 1400,
  botThinkMinMs: 500,
  botThinkMaxMs: 900,
  timerWarnMs: 10_000,
};
