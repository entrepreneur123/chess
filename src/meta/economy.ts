/**
 * Tunable meta numbers (match pacing; the bot squad lives in opponent.ts). There is no economy: no coins, boxes or costs.
 */
import { BOARD_SIZE } from '../engine/types';

export const APP_NAME = 'GRID CLASH';
export const APP_TAGLINE = `${BOARD_SIZE}×${BOARD_SIZE} 전술 아레나`;

export const PACING = {
  searchMinMs: 1200,
  searchMaxMs: 2000,
  foundHoldMs: 1400,
  botThinkMinMs: 500,
  botThinkMaxMs: 900,
  timerWarnMs: 10_000,
};
