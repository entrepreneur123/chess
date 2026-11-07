/**
 * Per-character move signature shared by both boards (render/BoardView.ts, render/Board2DView.ts):
 * a light ribbon in the character's colours (CHARACTER_FX) left behind by sliding moves. Leapers
 * (Walk, Larhen, Rakaeli) and Brutile have their own trails; Picker and Verish hop square by square
 * and mark each square with a ring instead, so none of them is listed here.
 */
import type { CharacterId } from '../engine/types';

export interface MoveTrail {
  /** Ribbon width (cells). */
  width: number;
  /** How long a trail point lives (ms). */
  life: number;
}

export const MOVE_TRAIL: Partial<Record<CharacterId, MoveTrail>> = {
  sad: { width: 0.3, life: 260 },
  marki: { width: 0.4, life: 300 },
  insaner: { width: 0.3, life: 260 },
  michelle: { width: 0.26, life: 300 },
  rampid: { width: 0.3, life: 280 },
  volkonov: { width: 0.28, life: 320 },
  midos: { width: 0.36, life: 340 },
  hammont: { width: 0.38, life: 280 },
  venoa: { width: 0.24, life: 260 },
  glacia: { width: 0.34, life: 380 },
};
